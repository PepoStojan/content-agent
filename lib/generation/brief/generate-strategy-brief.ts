"use server";

import { revalidatePath } from "next/cache";

import { getAnthropicClient, getModelId } from "@/lib/ai/client";
import {
  PROMPT_VERSION,
  STRATEGY_BRIEF_TOOL_NAME,
  buildStrategyBriefSystemPrompt,
  buildStrategyBriefUserMessage,
  strategyBriefToolInputSchema,
} from "@/lib/ai/prompts/brief/v1";
import { canManageProfiles, requireProfile } from "@/lib/auth/session";
import {
  completeGeneration,
  failGeneration,
  recordArtifactPersisted,
  recordProviderCompleted,
  startGeneration,
  type GenerationTelemetry,
} from "@/lib/generation/engine";
import { createClient } from "@/lib/supabase/server";

import { assertBrandCompliance } from "./brand-compliance";
import { validateInternalLinks } from "./internal-links";
import { buildStrategyBriefInput, type StrategyBriefInputPackage } from "./input";
import { assertNoEmDash } from "./em-dash";
import { persistBriefVersion } from "./persist";
import { strategyBriefAiOutputSchema } from "./schema";
import { deriveBriefTopics } from "./topics";

/**
 * generateStrategyBrief() — Phase 4.3 orchestrator. Wires the whole
 * pipeline described in the Phase 4.3 plan §6: gather inputs -> call
 * the model -> validate -> derive deterministic fields -> persist ->
 * flip the three-phase Generation Engine API.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function assertCanGenerateBrief() {
  const profile = await requireProfile();
  if (!canManageProfiles(profile.role)) {
    throw new Error("You don't have permission to generate a Strategy Brief for this project.");
  }
  return profile;
}

export interface StrategyBriefModelResult {
  /** Unvalidated — must be parsed against strategyBriefAiOutputSchema by the caller before use. */
  output: unknown;
  /** The full raw provider response, written to Storage before any parsing is attempted (D1). */
  raw: unknown;
  telemetry: GenerationTelemetry;
}

/**
 * Static per-model pricing table (D7: "estimated at write time from a
 * static per-model pricing table in code"). Rates not yet confirmed
 * against Anthropic's published pricing are left at 0 rather than a
 * guessed figure — `estimatedCostUsd: 0` here means "not yet priced,"
 * never a claim that the call was free. Update with real published
 * per-million-token rates before this number is treated as
 * meaningful anywhere downstream.
 */
const MODEL_PRICING_USD_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {};

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING_USD_PER_MILLION_TOKENS[model];
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

/**
 * The real Anthropic call: one non-streaming Messages request (D6),
 * forced tool-use against the Strategy Brief schema, no agentic
 * tool-use loop. Uses the centralized client/model resolver
 * (lib/ai/client.ts) exclusively — no model string is named here, and
 * the API key is never read, logged, or referenced outside that
 * server-only module.
 */
async function invokeStrategyBriefModel(input: StrategyBriefInputPackage): Promise<StrategyBriefModelResult> {
  const client = getAnthropicClient();
  const model = getModelId();

  const system = buildStrategyBriefSystemPrompt(input.project.contentType, input.brand);
  const userMessage = buildStrategyBriefUserMessage(input);

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    system,
    messages: [{ role: "user", content: userMessage }],
    tools: [
      {
        name: STRATEGY_BRIEF_TOOL_NAME,
        description: "Emit the complete, structured Strategy Brief.",
        input_schema: strategyBriefToolInputSchema as { type: "object"; [k: string]: unknown },
      },
    ],
    tool_choice: { type: "tool", name: STRATEGY_BRIEF_TOOL_NAME },
  });

  const toolUse = response.content.find(
    (block): block is Extract<typeof block, { type: "tool_use" }> => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(`Strategy Brief model call returned no tool_use block (stop_reason: ${response.stop_reason}).`);
  }

  // Prefer what the provider's response actually reports over what was requested (plan §7).
  const reportedModel = response.model || model;
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;

  const telemetry: GenerationTelemetry = {
    provider: "anthropic",
    model: reportedModel,
    providerRequestId: response.id,
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateCostUsd(reportedModel, inputTokens, outputTokens),
    finishReason: response.stop_reason ?? "unknown",
  };

  return { output: toolUse.input, raw: response, telemetry };
}

/**
 * D1's "durably store the raw response before any parse/insert is
 * attempted" step. Reuses the existing private `project-files`
 * Storage bucket (no new bucket/migration required) under a
 * generation-scoped path, distinct from the research/website upload
 * paths it already serves.
 */
async function writeProviderOutputToStorage(
  supabase: SupabaseServerClient,
  projectId: string,
  generationRunId: string,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const storagePath = `${projectId}/generation/${generationRunId}.json`;
  const bytes = new TextEncoder().encode(JSON.stringify(raw));
  const { error } = await supabase.storage
    .from("project-files")
    .upload(storagePath, bytes, { contentType: "application/json", upsert: true });
  if (error) throw new Error(error.message);
  return { bucket: "project-files", path: storagePath };
}

export type GenerateStrategyBriefResult =
  | { status: "already_active" }
  | { status: "completed"; briefVersionId: string; version: number };

export async function generateStrategyBrief(projectId: string): Promise<GenerateStrategyBriefResult> {
  const profile = await assertCanGenerateBrief();
  const supabase = await createClient();

  // Server-side enforcement (not just UI gating) of locked behavior:
  // a first generation is unrestricted, but once a Brief already
  // exists, regenerating it is only allowed after "Request changes"
  // has moved the project to brief_changes_requested. Never triggered
  // automatically by requestBriefChanges() itself (see brief-actions.ts).
  const { data: existingBrief } = await supabase
    .from("content_briefs")
    .select("id")
    .eq("project_id", projectId)
    .maybeSingle();

  if (existingBrief) {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("status")
      .eq("id", projectId)
      .single();
    if (projectError) throw new Error(projectError.message);
    if (project.status !== "brief_changes_requested") {
      throw new Error("The Strategy Brief can only be regenerated after Request changes has been selected.");
    }
  }

  const started = await startGeneration({ projectId, type: "brief_generate" });
  if (started.status === "already_active") {
    return { status: "already_active" };
  }
  const generationRunId = started.generationRunId;

  try {
    const input = await buildStrategyBriefInput(supabase, projectId);

    const modelResult = await invokeStrategyBriefModel(input);
    const output = strategyBriefAiOutputSchema.parse(modelResult.output);

    // Em-dash check applied to the Brief's own generated text fields,
    // before persistence — a violation fails the generation rather
    // than being silently stripped or persisted (plan §7).
    assertNoEmDash({
      searchIntentLabel: output.searchIntentLabel,
      searchIntentRationale: output.searchIntentRationale,
      targetAudience: output.targetAudience,
      contentObjective: output.contentObjective,
      secondaryTopics: output.secondaryTopics,
      serpInterpretation: output.serpInterpretation,
      commonCompetitorExpectations: output.commonCompetitorExpectations,
      uniqueValue: output.uniqueValue,
      title: output.title,
      h1: output.h1,
      metaDescription: output.metaDescription,
      entitiesConcepts: output.entitiesConcepts,
      questions: output.questions,
      evidenceRequirements: output.evidenceRequirements,
      thingsToAvoid: output.thingsToAvoid,
      businessBrandAlignment: output.businessBrandAlignment,
      researchLimitations: output.researchLimitations,
    });

    // Forbidden phrases (deterministic) and prohibited claims
    // (best-effort verbatim backstop) — defense in depth alongside
    // the system prompt's brand/business instructions. thingsToAvoid
    // is deliberately excluded: its entire purpose is to name content
    // to avoid (which legitimately includes echoing a forbidden
    // phrase or prohibited claim as an instruction to the writer, e.g.
    // "do not mention pricing"), so checking it here would flag
    // correct behavior as a violation.
    assertBrandCompliance(
      {
        searchIntentRationale: output.searchIntentRationale,
        targetAudience: output.targetAudience,
        contentObjective: output.contentObjective,
        secondaryTopics: output.secondaryTopics,
        serpInterpretation: output.serpInterpretation,
        commonCompetitorExpectations: output.commonCompetitorExpectations,
        uniqueValue: output.uniqueValue,
        title: output.title,
        h1: output.h1,
        metaDescription: output.metaDescription,
        entitiesConcepts: output.entitiesConcepts,
        questions: output.questions,
        evidenceRequirements: output.evidenceRequirements,
        businessBrandAlignment: output.businessBrandAlignment,
      },
      input.brand?.forbiddenPhrases ?? [],
      input.business?.prohibitedClaims ?? null,
    );

    // AI-recommended internal links, validated against exactly the
    // Website Knowledge actually supplied — never trusted as-is (§0.3/§7).
    const validatedInternalLinks = validateInternalLinks(output.internalLinks, input.availableInternalLinkUrls);

    // Deterministic, app-derived — independent of anything the model said (§2B).
    const topics = deriveBriefTopics(input.researchSources);

    const outputRef = await writeProviderOutputToStorage(supabase, projectId, generationRunId, modelResult.raw);

    await recordProviderCompleted({
      generationRunId,
      projectId,
      outputRef,
      telemetry: modelResult.telemetry,
    });

    const persisted = await persistBriefVersion(supabase, {
      projectId,
      generationRunId,
      createdBy: profile.userId,
      researchPackageId: input.researchPackageId,
      output,
      topics,
      internalLinks: validatedInternalLinks,
      model: modelResult.telemetry.model,
      promptVersion: PROMPT_VERSION,
    });

    await recordArtifactPersisted({ generationRunId, projectId });
    await completeGeneration({ generationRunId, projectId });

    // Advances projects.status forward (Phase 4.3 plan §0.6) — required
    // explicitly here, not assumed automatic. In particular this is
    // what clears brief_changes_requested after a successful
    // regenerate, so the UI leaves the "changes requested" state and
    // shows the new draft for review, per the locked regeneration
    // lifecycle (item 1). The Brief artifact itself is already fully
    // persisted and the generation_run already completed at this
    // point, so a failure here is logged, not thrown — it must never
    // retroactively turn an already-successful generation into a
    // failed one.
    const { error: statusError } = await supabase.from("projects").update({ status: "brief_generated" }).eq("id", projectId);
    if (statusError) {
      console.error(`Failed to advance projects.status after Brief generation ${generationRunId}:`, statusError.message);
    }

    revalidatePath(`/projects/${projectId}`);
    return { status: "completed", briefVersionId: persisted.briefVersionId, version: persisted.version };
  } catch (error) {
    await failGeneration({
      generationRunId,
      projectId,
      error: {
        type: "brief_generation_failed",
        message: error instanceof Error ? error.message : "Unknown error generating the Strategy Brief.",
        retryable: true,
      },
    });
    throw error;
  }
}
