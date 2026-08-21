"use server";

import { revalidatePath } from "next/cache";

import { getAnthropicClient, getModelId } from "@/lib/ai/client";
import {
  buildFactualSystemPrompt,
  buildFactualUserMessage,
  buildIntentSystemPrompt,
  buildIntentUserMessage,
  FACTUAL_TOOL_NAME,
  factualOutputSchema,
  factualToolInputSchema,
  INTENT_TOOL_NAME,
  intentOutputSchema,
  intentToolInputSchema,
  PROMPT_VERSION,
  type FactualSectionInput,
} from "@/lib/ai/prompts/qa/v1";
import { canManageProfiles, requireProfile } from "@/lib/auth/session";
import { filterRelevantEvidence, type ResearchSourceRow } from "@/lib/generation/content/evidence";
import {
  completeGeneration,
  failGeneration,
  recordArtifactPersisted,
  recordProviderCompleted,
  startGeneration,
} from "@/lib/generation/engine";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

import { runDeterministicQaChecks } from "./run-deterministic-qa";
import { ALL_QA_CATEGORIES, splitQaCategorySelection, type QaCategory, type QaFinding, type QaStatus } from "./types";
import { validateLlmFinding } from "./validate-llm-findings";

/**
 * The full Phase 4.6 QA orchestrator — the third piece of the locked
 * architecture, after the DB/RLS foundation and the deterministic
 * layer. Structurally parallel to
 * `lib/generation/content/generate-content-section.ts`: gather inputs
 * -> call the model(s) -> validate -> persist -> the three-phase
 * Generation Engine lifecycle, unmodified (no `engine.ts` change,
 * matching the "third stage reuses it unchanged" pattern already
 * proven twice, Phase 4.6 plan §10).
 *
 * QD4 (amended 2026-08-20, LEAVES-04) / QD9 (Partial QA, implemented
 * QA-17): **maximum** 2 LLM calls, determined by which categories are
 * selected — `intent` selected → 1 whole-document call; `factual`
 * selected → 1 batched call covering every leaf section that
 * currently has content; neither selected → 0 Anthropic calls.
 * Deterministic-only QA never calls Anthropic. The 7 deterministic
 * categories are computed by `runDeterministicQaChecks()`, itself
 * gated by the same selection — this file adds the LLM half and
 * persistence around it, it does not change a single deterministic
 * check's own logic.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function assertCanRunQa() {
  const profile = await requireProfile();
  if (!canManageProfiles(profile.role)) {
    throw new Error("You don't have permission to run QA on this project.");
  }
  return profile;
}

/** D1's "durably store the raw response before any parse/insert is attempted" step, both calls together — same `project-files` bucket convention as every other stage. */
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

export interface GenerateQaReportResult {
  qaReportId: string;
  overallStatus: QaStatus;
  findingCounts: { pass: number; warn: number; fail: number };
  rejectedLlmFindingCount: number;
}

export async function generateQaReport(
  projectId: string,
  selectedCategories?: readonly QaCategory[],
): Promise<GenerateQaReportResult> {
  const profile = await assertCanRunQa();
  const supabase = await createClient();

  // QD9 (Partial QA) — `selectedCategories` omitted means "all 9,"
  // the unchanged full-QA default (`splitQaCategorySelection()`'s own
  // default). Server-side floor: an explicitly empty selection is
  // rejected here, not just by a disabled UI button (QD9's own
  // requirement) — `splitQaCategorySelection` throws on `[]`.
  const { evaluatedCategories, skippedCategories } = splitQaCategorySelection(selectedCategories ?? ALL_QA_CATEGORIES);
  const evaluatedSet = new Set(evaluatedCategories);
  const runIntent = evaluatedSet.has("intent");
  const runFactual = evaluatedSet.has("factual");

  const started = await startGeneration({ projectId, type: "qa_run" });
  if (started.status === "already_active") {
    throw new Error("A QA run is already active for this project.");
  }
  const generationRunId = started.generationRunId;

  try {
    // --- 1. Lineage + only the selected deterministic categories --------
    const { lineage, findings: deterministicFindings } = await runDeterministicQaChecks(supabase, projectId, evaluatedCategories);

    const evaluatedLeaves = lineage.leaves.filter(
      (l): l is typeof l & { contentVersionId: string; body: string } => l.contentVersionId !== null && l.body !== null,
    );

    // --- 2. Research evidence for `factual` (CD2's filter, reused unmodified) ---
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("current_research_package_id")
      .eq("id", projectId)
      .single();
    if (projectError) throw new Error(projectError.message);

    const researchPackageId = project.current_research_package_id;
    const { data: researchSourcesRaw, error: researchError } = researchPackageId
      ? await supabase.from("research_sources").select("id, type, payload").eq("research_package_id", researchPackageId)
      : { data: [] as ResearchSourceRow[], error: null };
    if (researchError) throw new Error(researchError.message);
    const researchSources = (researchSourcesRaw ?? []) as ResearchSourceRow[];

    // --- 3. Call 1 of up to 2: intent (whole-document, QD4) — only if selected ---
    // QD9/QD4 (amended): the Anthropic client is only touched at all
    // when at least one LLM category was selected — a deterministic-
    // only Partial QA run makes zero Anthropic calls, not "zero calls
    // but a client still instantiated."
    const anyLlmSelected = runIntent || runFactual;
    const client = anyLlmSelected ? getAnthropicClient() : null;
    const model = anyLlmSelected ? getModelId() : null;

    let intentResponse: Awaited<ReturnType<NonNullable<typeof client>["messages"]["create"]>> | null = null;
    let intentRaw: ReturnType<typeof intentOutputSchema.parse> | null = null;
    let intentUser: string | null = null;

    if (runIntent && client && model) {
      const intentSystem = buildIntentSystemPrompt();
      intentUser = buildIntentUserMessage(lineage.documentNodes, lineage.brief);
      intentResponse = await client.messages.create({
        model,
        max_tokens: 1024,
        system: intentSystem,
        messages: [{ role: "user", content: intentUser }],
        tools: [
          {
            name: INTENT_TOOL_NAME,
            description: "Emit the whole-document intent finding.",
            input_schema: intentToolInputSchema as { type: "object"; [k: string]: unknown },
          },
        ],
        tool_choice: { type: "tool", name: INTENT_TOOL_NAME },
      });
      const intentToolUse = intentResponse.content.find(
        (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
      );
      if (!intentToolUse) {
        throw new Error(`Intent QA call returned no tool_use block (stop_reason: ${intentResponse.stop_reason}).`);
      }
      intentRaw = intentOutputSchema.parse(intentToolUse.input);
    }

    // --- 4. Call 2 of up to 2: factual (batched, one call for all sections, QD4) — only if selected ---
    const factualSections: FactualSectionInput[] = evaluatedLeaves.map((leaf, index) => ({
      index,
      title: leaf.title,
      body: leaf.body,
      evidence: filterRelevantEvidence(
        { entities: leaf.entities, evidenceRequirement: null, title: leaf.title },
        researchSources,
      ).map((e) => `[research_source:${e.sourceId}] ${e.text}`),
      manuallyEdited: leaf.manuallyEdited,
    }));

    let factualRaw: { findings: { index: number; status: QaStatus; quote?: string; note: string }[] } = { findings: [] };
    let factualResponse: Awaited<ReturnType<NonNullable<typeof client>["messages"]["create"]>> | null = null;
    if (runFactual && client && model && factualSections.length > 0) {
      const factualSystem = buildFactualSystemPrompt();
      const factualUser = buildFactualUserMessage(factualSections);
      factualResponse = await client.messages.create({
        model,
        max_tokens: 4096,
        system: factualSystem,
        messages: [{ role: "user", content: factualUser }],
        tools: [
          {
            name: FACTUAL_TOOL_NAME,
            description: "Emit one grounding finding per supplied section, in order.",
            input_schema: factualToolInputSchema as { type: "object"; [k: string]: unknown },
          },
        ],
        tool_choice: { type: "tool", name: FACTUAL_TOOL_NAME },
      });
      const factualToolUse = factualResponse.content.find(
        (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
      );
      if (!factualToolUse) {
        throw new Error(`Factual QA call returned no tool_use block (stop_reason: ${factualResponse.stop_reason}).`);
      }
      factualRaw = factualOutputSchema.parse(factualToolUse.input);
    }

    // --- 5. Telemetry — one generation_runs row, whichever calls actually happened (0, 1, or 2) summed (QD8) ---
    const intentUsage = intentResponse?.usage ?? { input_tokens: 0, output_tokens: 0 };
    const factualUsage = factualResponse?.usage ?? { input_tokens: 0, output_tokens: 0 };
    const reportedModel = intentResponse?.model || factualResponse?.model || model || "n/a";

    const outputRef = await writeProviderOutputToStorage(supabase, projectId, generationRunId, {
      intent: intentResponse ? { request: intentUser, response: intentResponse } : null,
      factual: factualResponse ? { request: factualSections, response: factualResponse } : null,
    });

    await recordProviderCompleted({
      generationRunId,
      projectId,
      outputRef,
      telemetry: {
        provider: anyLlmSelected ? "anthropic" : "none",
        model: reportedModel,
        providerRequestId: intentResponse?.id ?? factualResponse?.id,
        inputTokens: intentUsage.input_tokens + factualUsage.input_tokens,
        outputTokens: intentUsage.output_tokens + factualUsage.output_tokens,
        estimatedCostUsd: 0,
        finishReason: intentResponse?.stop_reason ?? factualResponse?.stop_reason ?? "no_llm_calls",
      },
      metadata: {
        promptVersion: PROMPT_VERSION,
        evaluatedSectionCount: evaluatedLeaves.length,
        calls: {
          intent: intentResponse
            ? {
                requestId: intentResponse.id,
                inputTokens: intentUsage.input_tokens,
                outputTokens: intentUsage.output_tokens,
                stopReason: intentResponse.stop_reason,
              }
            : null,
          factual: factualResponse
            ? {
                requestId: factualResponse.id,
                inputTokens: factualUsage.input_tokens,
                outputTokens: factualUsage.output_tokens,
                stopReason: factualResponse.stop_reason,
              }
            : null,
        },
      },
    });

    // --- 6. QD7 validation — reject any above-PASS finding without a literal, locatable quote ---
    let rejectedLlmFindingCount = 0;
    const llmFindings: QaFinding[] = [];

    if (intentRaw) {
      const intentCandidates = evaluatedLeaves.map((l) => ({ contentVersionId: l.contentVersionId, body: l.body }));
      const validatedIntent = validateLlmFinding(intentRaw, intentCandidates);
      if (validatedIntent) {
        llmFindings.push({
          category: "intent",
          method: "llm",
          status: validatedIntent.status,
          note: validatedIntent.note,
          quote: validatedIntent.quote,
          contentVersionId: validatedIntent.contentVersionId,
        });
      } else {
        rejectedLlmFindingCount++;
      }
    }

    for (const raw of factualRaw.findings) {
      const leaf = evaluatedLeaves[raw.index];
      if (!leaf) {
        rejectedLlmFindingCount++;
        continue;
      }
      const validated = validateLlmFinding(raw, [{ contentVersionId: leaf.contentVersionId, body: leaf.body }]);
      if (!validated) {
        rejectedLlmFindingCount++;
        continue;
      }
      llmFindings.push({
        category: "factual",
        method: "llm",
        status: validated.status,
        note: validated.note,
        quote: validated.quote,
        contentVersionId: leaf.contentVersionId,
      });
    }

    const allFindings: QaFinding[] = [...deterministicFindings, ...llmFindings];
    const overallStatus: QaStatus = allFindings.some((f) => f.status === "fail")
      ? "fail"
      : allFindings.some((f) => f.status === "warn")
        ? "warn"
        : "pass";

    // --- 7. Persist: qa_reports -> qa_report_content_versions -> qa_findings ---
    // QD9 (implemented QA-17): `evaluatedCategories`/`skippedCategories`
    // (computed once, at the very top of this function, from the
    // caller's actual selection) are persisted exactly as selected —
    // never re-derived from which categories happened to produce
    // findings. A skipped category contributes zero `qa_findings` rows
    // and is never interpreted as PASS (QU11).
    const { data: qaReport, error: qaReportError } = await supabase
      .from("qa_reports")
      .insert({
        project_id: projectId,
        generation_run_id: generationRunId,
        brief_version_id: lineage.briefVersionId,
        blueprint_version_id: lineage.blueprintVersionId,
        triggered_by: profile.userId,
        overall_status: overallStatus,
        evaluated_categories: evaluatedCategories,
        skipped_categories: skippedCategories,
      })
      .select("id")
      .single();
    if (qaReportError) throw new Error(qaReportError.message);

    const evaluatedVersionIds = evaluatedLeaves.map((l) => l.contentVersionId);
    if (evaluatedVersionIds.length > 0) {
      const { error: qrcvError } = await supabase
        .from("qa_report_content_versions")
        .insert(evaluatedVersionIds.map((id) => ({ qa_report_id: qaReport.id, content_version_id: id })));
      if (qrcvError) throw new Error(qrcvError.message);
    }

    const findingsPayload: Database["public"]["Tables"]["qa_findings"]["Insert"][] = allFindings.map((f) => ({
      qa_report_id: qaReport.id,
      category: f.category,
      method: f.method,
      status: f.status,
      note: f.note,
      quote: f.quote,
      content_version_id: f.contentVersionId,
    }));
    if (findingsPayload.length > 0) {
      const { error: findingsError } = await supabase.from("qa_findings").insert(findingsPayload);
      if (findingsError) throw new Error(findingsError.message);
    }

    await recordArtifactPersisted({ generationRunId, projectId });
    await completeGeneration({ generationRunId, projectId });

    revalidatePath(`/projects/${projectId}`);

    return {
      qaReportId: qaReport.id,
      overallStatus,
      findingCounts: {
        pass: allFindings.filter((f) => f.status === "pass").length,
        warn: allFindings.filter((f) => f.status === "warn").length,
        fail: allFindings.filter((f) => f.status === "fail").length,
      },
      rejectedLlmFindingCount,
    };
  } catch (error) {
    await failGeneration({
      generationRunId,
      projectId,
      error: {
        type: "qa_run_failed",
        message: error instanceof Error ? error.message : "Unknown error running QA.",
        retryable: true,
      },
    });
    throw error;
  }
}
