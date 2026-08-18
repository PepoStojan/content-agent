"use server";

import { revalidatePath } from "next/cache";

import { canManageProfiles, requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";

/**
 * The Generation Engine — Phase 4.2 skeleton (D1–D7). Manages
 * `generation_runs` rows only. Contains zero knowledge of what a
 * Strategy Brief, Blueprint, or any other stage actually is — a
 * caller passes a `type` and gets back a row id; everything about
 * *what* gets generated belongs to the caller, not here.
 */

export type GenerationRunType = Database["public"]["Enums"]["generation_run_type"];
export type GenerationRunStatus = Database["public"]["Enums"]["generation_run_status"];

async function assertCanRunGenerations() {
  const profile = await requireProfile();
  if (!canManageProfiles(profile.role)) {
    throw new Error("You don't have permission to run generations on this project.");
  }
  return profile;
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

// --- startGeneration ---------------------------------------------------

export interface StartGenerationInput {
  projectId: string;
  type: GenerationRunType;
  inputRef?: Record<string, unknown>;
  /** Set when this call is a user-triggered regenerate of a prior run. */
  retryOfGenerationRun?: string;
}

export interface StartGenerationResult {
  generationRunId: string;
  status: "started" | "already_active";
}

/**
 * Creates a new generation_runs row and marks it running. The
 * partial unique index (D2) is the actual duplicate guard — this
 * function just turns the resulting constraint violation into a
 * clear, non-error result instead of a raw Postgres error reaching
 * the caller.
 */
export async function startGeneration(input: StartGenerationInput): Promise<StartGenerationResult> {
  const profile = await assertCanRunGenerations();
  const supabase = await createClient();

  let attemptNumber = 1;
  if (input.retryOfGenerationRun) {
    const { data: previous } = await supabase
      .from("generation_runs")
      .select("attempt_number")
      .eq("id", input.retryOfGenerationRun)
      .single();
    attemptNumber = (previous?.attempt_number ?? 0) + 1;
  }

  const { data, error } = await supabase
    .from("generation_runs")
    .insert({
      organization_id: profile.organizationId,
      project_id: input.projectId,
      type: input.type,
      status: "running",
      input_ref: (input.inputRef as Json) ?? null,
      attempt_number: attemptNumber,
      retry_of_generation_run: input.retryOfGenerationRun ?? null,
      started_at: new Date().toISOString(),
      created_by: profile.userId,
    })
    .select("id")
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      return { generationRunId: "", status: "already_active" };
    }
    throw new Error(error.message);
  }

  revalidatePath(`/projects/${input.projectId}`);
  return { generationRunId: data.id, status: "started" };
}

// --- completeGeneration --------------------------------------------------

export interface GenerationTelemetry {
  provider: string;
  model: string;
  providerRequestId?: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  finishReason: string;
}

export interface CompleteGenerationInput {
  generationRunId: string;
  projectId: string;
  telemetry: GenerationTelemetry;
  outputRef?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Marks a run provider_completed → artifact_persisted → completed in
 * one call. A real stage (Phase 4.3+) that needs to persist a version
 * row *between* receiving the provider response and calling this
 * would call it in two steps instead — this single-call form is
 * correct for the skeleton, where no artifact is actually being
 * written yet.
 */
export async function completeGeneration(input: CompleteGenerationInput): Promise<void> {
  await assertCanRunGenerations();
  const supabase = await createClient();

  const { data: run, error: fetchError } = await supabase
    .from("generation_runs")
    .select("started_at")
    .eq("id", input.generationRunId)
    .single();
  if (fetchError) throw new Error(fetchError.message);

  const now = new Date();
  const startedAt = run.started_at ? new Date(run.started_at) : now;
  const durationMs = now.getTime() - startedAt.getTime();
  const totalTokens = input.telemetry.inputTokens + input.telemetry.outputTokens;

  const { error } = await supabase
    .from("generation_runs")
    .update({
      status: "completed",
      provider: input.telemetry.provider,
      model: input.telemetry.model,
      provider_request_id: input.telemetry.providerRequestId ?? null,
      input_tokens: input.telemetry.inputTokens,
      output_tokens: input.telemetry.outputTokens,
      total_tokens: totalTokens,
      estimated_cost_usd: input.telemetry.estimatedCostUsd,
      finish_reason: input.telemetry.finishReason,
      output_ref: (input.outputRef as Json) ?? null,
      metadata: (input.metadata as Json) ?? {},
      provider_completed_at: now.toISOString(),
      artifact_persisted_at: now.toISOString(),
      completed_at: now.toISOString(),
      duration_ms: durationMs,
    })
    .eq("id", input.generationRunId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${input.projectId}`);
}

// --- failGeneration --------------------------------------------------------

export interface FailGenerationInput {
  generationRunId: string;
  projectId: string;
  error: { type: string; message: string; retryable: boolean };
  /** Telemetry the caller already has, if the provider responded before the failure. */
  telemetry?: Partial<GenerationTelemetry>;
}

export async function failGeneration(input: FailGenerationInput): Promise<void> {
  await assertCanRunGenerations();
  const supabase = await createClient();

  const { data: run, error: fetchError } = await supabase
    .from("generation_runs")
    .select("started_at")
    .eq("id", input.generationRunId)
    .single();
  if (fetchError) throw new Error(fetchError.message);

  const now = new Date();
  const startedAt = run.started_at ? new Date(run.started_at) : now;

  const { error } = await supabase
    .from("generation_runs")
    .update({
      status: "failed",
      error: input.error as unknown as Json,
      provider: input.telemetry?.provider ?? null,
      model: input.telemetry?.model ?? null,
      input_tokens: input.telemetry?.inputTokens ?? null,
      output_tokens: input.telemetry?.outputTokens ?? null,
      finish_reason: input.telemetry?.finishReason ?? null,
      completed_at: now.toISOString(),
      duration_ms: now.getTime() - startedAt.getTime(),
    })
    .eq("id", input.generationRunId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${input.projectId}`);
}

// --- recoverGeneration --------------------------------------------------

export type RecoveryAction = "completed" | "needs_persist" | "failed" | "none";

export interface RecoverGenerationResult {
  generationRunId: string;
  action: RecoveryAction;
  status: GenerationRunStatus;
}

/**
 * Inspects an interrupted run and moves it toward a terminal state
 * without ever recalling the provider — per the locked architecture,
 * recovery only ever repairs *our own* persistence, never re-does
 * billed work.
 *
 * - artifact_persisted → mechanical: the version row already exists
 *   (by definition of this status), so this just finishes the last,
 *   purely-bookkeeping step and flips to completed.
 * - provider_completed → the raw response is already durably stored
 *   in output_ref (never re-fetched here). Persisting it into a real
 *   versioned artifact is stage-specific logic this engine
 *   deliberately does not have — reported back for the caller to
 *   finish, not performed here.
 * - queued / running → no evidence a response was ever received
 *   (no output_ref). Nothing to salvage; marked failed with a
 *   retryable, clearly-labeled reason.
 * - already terminal (completed/failed/cancelled) → no-op.
 */
export async function recoverGeneration(generationRunId: string): Promise<RecoverGenerationResult> {
  await assertCanRunGenerations();
  const supabase = await createClient();

  const { data: run, error: fetchError } = await supabase
    .from("generation_runs")
    .select("id, project_id, status, output_ref, started_at")
    .eq("id", generationRunId)
    .single();
  if (fetchError) throw new Error(fetchError.message);

  const now = new Date();

  if (run.status === "artifact_persisted") {
    const startedAt = run.started_at ? new Date(run.started_at) : now;
    const { error } = await supabase
      .from("generation_runs")
      .update({ status: "completed", completed_at: now.toISOString(), duration_ms: now.getTime() - startedAt.getTime() })
      .eq("id", generationRunId);
    if (error) throw new Error(error.message);
    revalidatePath(`/projects/${run.project_id}`);
    return { generationRunId, action: "completed", status: "completed" };
  }

  if (run.status === "provider_completed") {
    // No provider recall — the response is already in output_ref.
    // Persisting it is stage-specific and out of scope for this engine.
    return { generationRunId, action: "needs_persist", status: "provider_completed" };
  }

  if (run.status === "queued" || run.status === "running") {
    const startedAt = run.started_at ? new Date(run.started_at) : now;
    const { error } = await supabase
      .from("generation_runs")
      .update({
        status: "failed",
        error: {
          type: "interrupted",
          message: "Generation was interrupted before a provider response was received.",
          retryable: true,
        } as unknown as Json,
        completed_at: now.toISOString(),
        duration_ms: now.getTime() - startedAt.getTime(),
      })
      .eq("id", generationRunId);
    if (error) throw new Error(error.message);
    revalidatePath(`/projects/${run.project_id}`);
    return { generationRunId, action: "failed", status: "failed" };
  }

  return { generationRunId, action: "none", status: run.status };
}
