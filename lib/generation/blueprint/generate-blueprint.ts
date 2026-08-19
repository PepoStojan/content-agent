"use server";

import { revalidatePath } from "next/cache";

import { getAnthropicClient, getModelId } from "@/lib/ai/client";
import {
  BLUEPRINT_TOOL_NAME,
  PROMPT_VERSION,
  blueprintToolInputSchema,
  buildBlueprintSystemPrompt,
  buildBlueprintUserMessage,
} from "@/lib/ai/prompts/blueprint/v1";
import { canManageProfiles, requireProfile } from "@/lib/auth/session";
import { assertBrandCompliance } from "@/lib/generation/brief/brand-compliance";
import { assertNoEmDash } from "@/lib/generation/brief/em-dash";
import {
  completeGeneration,
  failGeneration,
  recordArtifactPersisted,
  recordProviderCompleted,
  startGeneration,
  type GenerationTelemetry,
} from "@/lib/generation/engine";
import { createClient } from "@/lib/supabase/server";

import { assertEntityTraceability, buildEntityPool } from "./entities";
import { buildBlueprintInput, type BlueprintInputPackage } from "./input";
import { validateNodeInternalLinks } from "./internal-links";
import { flattenBlueprintTree } from "./nodes";
import { persistBlueprintVersion } from "./persist";
import { blueprintOutputSchema, normalizeBlueprintToolOutput } from "./schema";
import { checkWordCountSanity } from "./word-count";

/**
 * generateBlueprint() — Phase 4.4 orchestrator, structurally parallel
 * to lib/generation/brief/generate-strategy-brief.ts. Wires: gather
 * inputs -> call the model -> validate -> flatten/persist -> flip the
 * three-phase Generation Engine API.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function assertCanGenerateBlueprint() {
  const profile = await requireProfile();
  if (!canManageProfiles(profile.role)) {
    throw new Error("You don't have permission to generate a Blueprint for this project.");
  }
  return profile;
}

export interface BlueprintModelResult {
  /** Unvalidated — must be parsed against blueprintOutputSchema by the caller before use. */
  output: unknown;
  /** The full raw provider response, written to Storage before any parsing is attempted (D1). */
  raw: unknown;
  telemetry: GenerationTelemetry;
}

/**
 * The real Anthropic call: one non-streaming Messages request (D6),
 * forced tool-use against the recursive Blueprint node-tree schema,
 * no agentic tool-use loop. Uses the centralized client/model
 * resolver (lib/ai/client.ts) exclusively — no model string is named
 * here, and the API key is never read, logged, or referenced outside
 * that server-only module.
 */
async function invokeBlueprintModel(input: BlueprintInputPackage): Promise<BlueprintModelResult> {
  const client = getAnthropicClient();
  const model = getModelId();

  const system = buildBlueprintSystemPrompt(input.project.contentType, input.brand);
  const userMessage = buildBlueprintUserMessage(input);

  const response = await client.messages.create({
    model,
    // Blueprint's structured output (a full recursive node tree) is
    // materially larger than Brief's flatter schema — Brief's 8192
    // budget was reused unchanged for the first real test and the
    // model hit it mid-tree, truncating the JSON and failing schema
    // validation (plan §15's own flagged risk, confirmed live). Set
    // generously per that warning.
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: userMessage }],
    tools: [
      {
        name: BLUEPRINT_TOOL_NAME,
        description: "Emit the complete, structured Content Blueprint as a single recursive node tree.",
        input_schema: blueprintToolInputSchema as { type: "object"; [k: string]: unknown },
      },
    ],
    tool_choice: { type: "tool", name: BLUEPRINT_TOOL_NAME },
  });

  const toolUse = response.content.find(
    (block): block is Extract<typeof block, { type: "tool_use" }> => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(`Blueprint model call returned no tool_use block (stop_reason: ${response.stop_reason}).`);
  }

  // Prefer what the provider's response actually reports over what was requested.
  const reportedModel = response.model || model;
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;

  const telemetry: GenerationTelemetry = {
    provider: "anthropic",
    model: reportedModel,
    providerRequestId: response.id,
    inputTokens,
    outputTokens,
    // No published per-model pricing table wired yet (same "not yet
    // priced" convention as Brief's estimateCostUsd) — 0 here means
    // "not yet priced," never a claim the call was free.
    estimatedCostUsd: 0,
    finishReason: response.stop_reason ?? "unknown",
  };

  return { output: normalizeBlueprintToolOutput(toolUse.input), raw: response, telemetry };
}

/** D1's "durably store the raw response before any parse/insert is attempted" step — reuses the existing private `project-files` bucket, same convention as Brief. */
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

export type GenerateBlueprintResult =
  | { status: "already_active" }
  | { status: "completed"; blueprintVersionId: string; version: number; wordCountWarning: string | null };

/**
 * @param briefVersionId The exact, already-approved Brief version to build against (plan §0/§2/§4) — never resolved internally from `content_briefs.current_version_id`.
 */
export async function generateBlueprint(projectId: string, briefVersionId: string): Promise<GenerateBlueprintResult> {
  const profile = await assertCanGenerateBlueprint();
  const supabase = await createClient();

  // Server-side enforcement of BD2 (not just UI gating): a first
  // generation is unrestricted (beyond requiring an approved Brief,
  // checked inside buildBlueprintInput), but once a Blueprint already
  // exists, regenerating it is only allowed after "Request changes"
  // has moved the project to blueprint_changes_requested — mirrors
  // generateStrategyBrief's identical guard exactly.
  const { data: existingBlueprint } = await supabase
    .from("content_blueprints")
    .select("id")
    .eq("project_id", projectId)
    .maybeSingle();

  if (existingBlueprint) {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("status")
      .eq("id", projectId)
      .single();
    if (projectError) throw new Error(projectError.message);
    if (project.status !== "blueprint_changes_requested") {
      throw new Error("The Blueprint can only be regenerated after Request changes has been selected.");
    }
  }

  const started = await startGeneration({ projectId, type: "blueprint_generate" });
  if (started.status === "already_active") {
    return { status: "already_active" };
  }
  const generationRunId = started.generationRunId;

  try {
    const input = await buildBlueprintInput(supabase, projectId, briefVersionId);

    const modelResult = await invokeBlueprintModel(input);
    const output = blueprintOutputSchema.parse(modelResult.output);

    // The approved Brief's H1 is authoritative for the root node's
    // title, not regenerated (plan §2/§5) — enforced deterministically
    // rather than trusting the model to reproduce it verbatim.
    if (input.brief.h1) {
      output.root.title = input.brief.h1;
    }

    const nodes = flattenBlueprintTree(output.root);

    // Em-dash check, reused unmodified from Brief (plan §13) — applied
    // to every text field, including writingNotes/evidenceRequirement,
    // since an em dash appearing anywhere in generated text is a real
    // violation regardless of which field it's in.
    const allTextFields: Record<string, string | string[]> = {};
    nodes.forEach((node, i) => {
      allTextFields[`node_${i}_title`] = node.title;
      allTextFields[`node_${i}_goal`] = node.goal;
      allTextFields[`node_${i}_researchSupport`] = node.researchSupport;
      allTextFields[`node_${i}_uniqueContribution`] = node.uniqueContribution;
      allTextFields[`node_${i}_writingNotes`] = node.writingNotes;
      allTextFields[`node_${i}_evidenceRequirement`] = node.evidenceRequirement;
    });
    assertNoEmDash(allTextFields);

    // Brand compliance check, reused unmodified from Brief (plan §13).
    // writingNotes and evidenceRequirement are deliberately excluded
    // here (confirmed live: both legitimately instruct the future
    // writer to avoid a forbidden phrase, e.g. "do not mention
    // pricing" — the same false-positive class already fixed for
    // Brief's thingsToAvoid, and the same fix: these are
    // meta-instruction fields, not brand-facing copy).
    const brandCheckFields: Record<string, string | string[]> = {};
    nodes.forEach((node, i) => {
      brandCheckFields[`node_${i}_title`] = node.title;
      brandCheckFields[`node_${i}_goal`] = node.goal;
      brandCheckFields[`node_${i}_researchSupport`] = node.researchSupport;
      brandCheckFields[`node_${i}_uniqueContribution`] = node.uniqueContribution;
    });
    assertBrandCompliance(brandCheckFields, input.brand?.forbiddenPhrases ?? [], input.business?.prohibitedClaims ?? null);

    // Entity traceability — BD3, hard failure.
    const entityPool = buildEntityPool(input.brief);
    assertEntityTraceability(nodes, entityPool);

    // Internal-link whitelist, per node (plan §7).
    const validatedInternalLinks = validateNodeInternalLinks(nodes, input.availableInternalLinks);

    // Word-count sanity — BD4, WARN-level only, never fails the generation.
    const wordCountResult = checkWordCountSanity(nodes, input.project.contentType);
    const wordCountWarning = wordCountResult.withinRange
      ? null
      : `Blueprint's total word count (${wordCountResult.totalWords}) is outside the expected range for this content type (${wordCountResult.expectedMin}-${wordCountResult.expectedMax}).`;

    const outputRef = await writeProviderOutputToStorage(supabase, projectId, generationRunId, modelResult.raw);

    await recordProviderCompleted({
      generationRunId,
      projectId,
      outputRef,
      telemetry: modelResult.telemetry,
      metadata: wordCountWarning ? { wordCountWarning } : undefined,
    });

    const persisted = await persistBlueprintVersion(supabase, {
      projectId,
      briefVersionId: input.brief.id,
      generationRunId,
      createdBy: profile.userId,
      nodes,
      validatedInternalLinks,
      model: modelResult.telemetry.model,
      promptVersion: PROMPT_VERSION,
    });

    await recordArtifactPersisted({ generationRunId, projectId });
    await completeGeneration({ generationRunId, projectId });

    // Advances projects.status forward (mirrors the fix applied to
    // generateStrategyBrief) — clears blueprint_changes_requested
    // after a successful regenerate. Failure here is logged, not
    // thrown: the Blueprint artifact is already fully persisted and
    // the generation_run already completed at this point.
    const { error: statusError } = await supabase.from("projects").update({ status: "blueprint_generated" }).eq("id", projectId);
    if (statusError) {
      console.error(`Failed to advance projects.status after Blueprint generation ${generationRunId}:`, statusError.message);
    }

    revalidatePath(`/projects/${projectId}`);
    return {
      status: "completed",
      blueprintVersionId: persisted.blueprintVersionId,
      version: persisted.version,
      wordCountWarning,
    };
  } catch (error) {
    await failGeneration({
      generationRunId,
      projectId,
      error: {
        type: "blueprint_generation_failed",
        message: error instanceof Error ? error.message : "Unknown error generating the Blueprint.",
        retryable: true,
      },
    });
    throw error;
  }
}
