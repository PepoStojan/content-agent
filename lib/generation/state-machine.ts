import type { Database } from "@/lib/supabase/types";

/**
 * Phase 4.1 — the generation pipeline state machine. Pure, reusable
 * logic with no I/O: every future generation stage (Phase 4.2+) reads
 * and writes state through this module rather than each stage
 * inventing its own transition rules. No AI generation happens here.
 */

export type GenerationState = Database["public"]["Enums"]["generation_state"];

/**
 * Mirrors the DB `generation_stage` enum exactly (via the generated
 * types, not hand-typed) — this is what `generation_events.stage`
 * accepts. Five real, loggable generation stages only. "Draft" is not
 * one of them: nothing generates during draft, so there is no event
 * to log with that stage. Never widen this to include "draft" to
 * paper over a caller bug — see PipelineStage below for the separate,
 * UI-only concept that does include it.
 */
export type GenerationEventStage = Database["public"]["Enums"]["generation_stage"];

/**
 * UI-only concept for the visual pipeline (components/design-system/
 * generation-progress.tsx): six display steps, including "draft" as
 * the step before any generation starts. Deliberately a different
 * type from GenerationEventStage — this one must never be written to
 * the `generation_stage` column directly.
 *
 * PIPELINE_STAGES is the one canonical list; PipelineStage is derived
 * from it (not declared separately) so there is exactly one place
 * that names these six values.
 */
export const PIPELINE_STAGES = ["draft", "strategy", "blueprint", "content", "qa", "export"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** The linear "happy path" order, used to derive progress and the next state. */
export const GENERATION_STATE_ORDER: GenerationState[] = [
  "draft",
  "strategy_pending",
  "strategy_generating",
  "strategy_completed",
  "blueprint_pending",
  "blueprint_generating",
  "blueprint_completed",
  "content_pending",
  "content_generating",
  "content_completed",
  "qa_pending",
  "qa_running",
  "qa_completed",
  "export_pending",
  "export_completed",
];

const PIPELINE_STAGE_BY_STATE: Record<GenerationState, PipelineStage> = {
  draft: "draft",
  strategy_pending: "strategy",
  strategy_generating: "strategy",
  strategy_completed: "strategy",
  blueprint_pending: "blueprint",
  blueprint_generating: "blueprint",
  blueprint_completed: "blueprint",
  content_pending: "content",
  content_generating: "content",
  content_completed: "content",
  qa_pending: "qa",
  qa_running: "qa",
  qa_completed: "qa",
  export_pending: "export",
  export_completed: "export",
  // Display-only fallback for the progress UI; never used to write to
  // generation_events (see eventStageForTransition below).
  failed: "draft",
};

/** For the UI pipeline display only. Do not use this to populate `generation_events.stage`. */
export function pipelineStageForState(state: GenerationState): PipelineStage {
  return PIPELINE_STAGE_BY_STATE[state];
}

/**
 * The stage to log on a `generation_events` row for a transition from
 * `from` to `to`. For every real stage transition this is just that
 * stage. For a transition INTO "failed", there is no stage inherent
 * in "failed" itself — it must be derived from `from`, the state that
 * was actually active when the failure happened. `from` can never be
 * "draft" or "failed" here because no transition reaches "failed"
 * from either (see TRANSITIONS below), so this always resolves to one
 * of the five real GenerationEventStage values — it can never produce
 * "draft", which is why this function's return type is
 * GenerationEventStage, not PipelineStage.
 */
export function eventStageForTransition(from: GenerationState, to: GenerationState): GenerationEventStage {
  const resolved = to === "failed" ? from : to;
  const stage = PIPELINE_STAGE_BY_STATE[resolved];
  if (stage === "draft") {
    throw new Error(
      `Cannot derive a generation_events stage for transition ${from} → ${to}: resolved to "draft", which is not a valid generation_stage.`
    );
  }
  return stage;
}

/**
 * Valid forward transitions. Linear pipeline (pending → generating →
 * completed → next stage's pending), any active state can fail, and
 * `failed` can only re-enter at a stage's own pending state (a manual
 * retry decision, never an automatic resume). Note "draft" only ever
 * transitions to "strategy_pending" — it can never fail directly.
 */
const TRANSITIONS: Record<GenerationState, GenerationState[]> = {
  draft: ["strategy_pending"],
  strategy_pending: ["strategy_generating", "failed"],
  strategy_generating: ["strategy_completed", "failed"],
  strategy_completed: ["blueprint_pending"],
  blueprint_pending: ["blueprint_generating", "failed"],
  blueprint_generating: ["blueprint_completed", "failed"],
  blueprint_completed: ["content_pending"],
  content_pending: ["content_generating", "failed"],
  content_generating: ["content_completed", "failed"],
  content_completed: ["qa_pending"],
  qa_pending: ["qa_running", "failed"],
  qa_running: ["qa_completed", "failed"],
  qa_completed: ["export_pending"],
  export_pending: ["export_completed", "failed"],
  export_completed: [],
  failed: [
    "strategy_pending",
    "blueprint_pending",
    "content_pending",
    "qa_pending",
    "export_pending",
  ],
};

export function canTransition(from: GenerationState, to: GenerationState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStates(from: GenerationState): GenerationState[] {
  return TRANSITIONS[from] ?? [];
}

/** 0–100, based on position in the happy-path order. `failed` reports 0 progress for its stage. */
export function generationProgressPercent(state: GenerationState): number {
  if (state === "failed") return 0;
  const index = GENERATION_STATE_ORDER.indexOf(state);
  if (index === -1) return 0;
  return Math.round((index / (GENERATION_STATE_ORDER.length - 1)) * 100);
}
