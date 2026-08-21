"use server";

import { revalidatePath } from "next/cache";

import { getAnthropicClient, getModelId } from "@/lib/ai/client";
import {
  CONTENT_TOOL_NAME,
  PROMPT_VERSION,
  buildContentSystemPrompt,
  buildContentUserMessage,
  contentToolInputSchema,
} from "@/lib/ai/prompts/content/v1";
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

import { buildContentInput, type ContentInputPackage } from "./input";
import { persistContentVersion } from "./persist";
import { parseContentSectionOutput, validateContentSection } from "./validate";

/**
 * generateContentSection() — Phase 4.5 orchestrator, structurally
 * parallel to lib/generation/blueprint/generate-blueprint.ts. Wires:
 * gather inputs -> call the model -> validate -> persist -> flip the
 * three-phase Generation Engine API. Generates exactly ONE leaf
 * section per call (CD1/CD10) — there is no whole-article code path.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function assertCanGenerateContent() {
  const profile = await requireProfile();
  if (!canManageProfiles(profile.role)) {
    throw new Error("You don't have permission to generate Content for this project.");
  }
  return profile;
}

export interface ContentModelResult {
  /** Unvalidated — must be parsed against contentSectionOutputSchema by the caller before use. */
  output: unknown;
  /** The full raw provider response, written to Storage before any parsing is attempted (D1). */
  raw: unknown;
  telemetry: GenerationTelemetry;
}

/**
 * The real Anthropic call: one non-streaming Messages request (D6),
 * forced tool-use against the two-field Content Section schema, no
 * agentic tool-use loop. Uses the centralized client/model resolver
 * (lib/ai/client.ts) exclusively.
 */
async function invokeContentModel(
  input: ContentInputPackage,
  regenerationInstruction?: string,
): Promise<ContentModelResult> {
  const client = getAnthropicClient();
  const model = getModelId();

  const system = buildContentSystemPrompt(input.project.contentType, input.node, input.brand);
  const userMessage = buildContentUserMessage(input, regenerationInstruction);

  const response = await client.messages.create({
    model,
    // One section's body (target word counts observed so far are in
    // the low hundreds), not a full document — Blueprint's 16000
    // budget (needed for an entire recursive node tree) would be
    // wildly oversized here; a generous single-section budget is
    // enough without inviting runaway output.
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: userMessage }],
    tools: [
      {
        name: CONTENT_TOOL_NAME,
        description: "Emit this section's body and its evidence provenance references.",
        input_schema: contentToolInputSchema as { type: "object"; [k: string]: unknown },
      },
    ],
    tool_choice: { type: "tool", name: CONTENT_TOOL_NAME },
  });

  const toolUse = response.content.find(
    (block): block is Extract<typeof block, { type: "tool_use" }> => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(`Content model call returned no tool_use block (stop_reason: ${response.stop_reason}).`);
  }

  // Prefer what the provider's response actually reports over what was requested.
  const reportedModel = response.model || model;

  const telemetry: GenerationTelemetry = {
    provider: "anthropic",
    model: reportedModel,
    providerRequestId: response.id,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    // No published per-model pricing table wired yet (same "not yet
    // priced" convention as Brief/Blueprint) — 0 means "not yet
    // priced," never a claim the call was free.
    estimatedCostUsd: 0,
    finishReason: response.stop_reason ?? "unknown",
  };

  return { output: toolUse.input, raw: response, telemetry };
}

/** D1's "durably store the raw response before any parse/insert is attempted" step — reuses the existing private `project-files` bucket, same convention as Brief/Blueprint. */
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

export type GenerateContentSectionResult =
  | { status: "already_active" }
  | {
      status: "completed";
      contentVersionId: string;
      version: number;
      evidenceUsed: string[];
      linkStrippedCount: number;
    };

/**
 * @param blueprintNodeId Must be a leaf node of the project's
 * currently-approved Blueprint version, whose exact source Brief
 * version must also still be approved — enforced inside
 * buildContentInput(), never resolved as "current" here.
 * @param regenerationInstruction Optional free-text instruction for a
 * user-triggered regenerate (CD4) — carried into the prompt as
 * reference data and persisted on this run's generation_runs.metadata,
 * never a separate "Request Changes" state/table.
 */
export async function generateContentSection(
  projectId: string,
  blueprintNodeId: string,
  regenerationInstruction?: string,
): Promise<GenerateContentSectionResult> {
  const profile = await assertCanGenerateContent();
  const supabase = await createClient();

  const started = await startGeneration({ projectId, type: "content_generate", blueprintNodeId });
  if (started.status === "already_active") {
    return { status: "already_active" };
  }
  const generationRunId = started.generationRunId;

  try {
    const input = await buildContentInput(supabase, projectId, blueprintNodeId);

    const modelResult = await invokeContentModel(input, regenerationInstruction);
    const output = parseContentSectionOutput(modelResult.output);

    const validated = validateContentSection(output, input);

    const outputRef = await writeProviderOutputToStorage(supabase, projectId, generationRunId, modelResult.raw);

    await recordProviderCompleted({
      generationRunId,
      projectId,
      outputRef,
      telemetry: modelResult.telemetry,
      metadata: {
        ...(regenerationInstruction ? { regenerationInstruction } : {}),
        ...(validated.linkStrippedCount > 0 ? { linkStrippedCount: validated.linkStrippedCount } : {}),
      },
    });

    const persisted = await persistContentVersion(supabase, {
      projectId,
      blueprintNodeId,
      body: validated.body,
      createdBy: profile.userId,
      generationRunId,
      model: modelResult.telemetry.model,
      promptVersion: PROMPT_VERSION,
    });

    await recordArtifactPersisted({ generationRunId, projectId });
    await completeGeneration({ generationRunId, projectId });

    revalidatePath(`/projects/${projectId}`);
    return {
      status: "completed",
      contentVersionId: persisted.contentVersionId,
      version: persisted.version,
      evidenceUsed: validated.evidenceUsed,
      linkStrippedCount: validated.linkStrippedCount,
    };
  } catch (error) {
    await failGeneration({
      generationRunId,
      projectId,
      error: {
        type: "content_generation_failed",
        message: error instanceof Error ? error.message : "Unknown error generating Content.",
        retryable: true,
      },
    });
    throw error;
  }
}
