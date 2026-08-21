import type { PipelineStage } from "./state-machine";

/**
 * A pure, read-only derivation of "what pipeline stage is this project
 * actually at," computed from real, already-authoritative data —
 * never from `projects.generation_state`.
 *
 * Why this exists: `generation_state` is stale for real projects.
 * Confirmed directly (2026-08-20): project `64f3a6aa…` shows
 * `export_pending` while it has 0/22 current Blueprint leaves with
 * Content; project `ce718b4d…` shows `strategy_pending` while 24/24
 * Content sections are approved. The column only ever advances
 * through the Phase 4.1 dev-test harness (`generation-test-controls.tsx`
 * calling `transitionGenerationState()`) — no real Brief/Blueprint/
 * Content/QA/Export code path writes to it, and none is added by this
 * module either.
 *
 * Deliberately NOT a third state machine: this is a stateless
 * projection recomputed fresh on every read from data that is already
 * each stage's own real source of truth (`brief_versions.status`,
 * `blueprint_versions.status`, `content_versions.status` counts, the
 * latest `qa_reports` row). Nothing here is stored, transitioned, or
 * written back to the database. `generation_state` itself, the state
 * machine module (`state-machine.ts`), `generation_events` logging,
 * and the dev-test harness are all left completely unmodified —
 * `generation_state` keeps whatever meaning it already had for
 * whoever still reads/writes it (the harness); this is a second,
 * independent way to answer "what stage are we at," not a replacement
 * for the first.
 *
 * `PIPELINE_STAGES`/`PipelineStage` are reused unmodified from
 * `state-machine.ts` — the six-stage vocabulary is not redefined here.
 */

export interface PipelineCompletionSignals {
  /** A Brief has been generated at least once (any version exists) — distinguishes "not started" (draft) from "awaiting approval" (strategy). */
  briefExists: boolean;
  briefApproved: boolean;
  blueprintApproved: boolean;
  /** Total leaf Blueprint nodes of the current approved Blueprint version. */
  contentTotalLeaves: number;
  /** How many of those leaves' current content_versions are `status: 'approved'`. */
  contentApprovedLeaves: number;
  /**
   * True when the most recent `qa_reports` row's `blueprint_version_id`
   * matches the project's current Blueprint version — a lightweight,
   * coarse staleness check (a new Blueprint version, whether from BD5
   * manual editing or AI regeneration, always invalidates it). This is
   * deliberately NOT the full QD6 staleness check (content-version-level
   * staleness — one section edited after QA ran — is not distinguished
   * here); that finer-grained distinction is the QA UI's own job
   * (`docs/architecture/phase-4-6-qa-ui-plan.md`), not this coarse
   * six-stage pipeline indicator's.
   */
  hasCurrentQaReport: boolean;
  /** True once an Export has actually completed for the current lineage. Always `false` today — no code path can ever set an `exports` row to `done` yet (Export is unimplemented); kept as an explicit field, not hardcoded inline, so wiring real Export completion later is a one-line change at the call site, not a change to this function. */
  exportDone: boolean;
}

export interface DerivedPipelineStage {
  currentStage: PipelineStage;
  /** True only when a real generation attempt errored at the current stage and nothing has since succeeded there — never set for "QA found issues" (a normal, expected outcome, not an error). */
  failed: boolean;
}

/**
 * Six-stage precedence, each stage's "done" condition checked in
 * order — the first incomplete stage is the current/actionable one.
 * `failed` is intentionally not derived here; callers that already
 * have a real per-stage generation error (e.g. `latestFailedError`,
 * `latestFailedBlueprintError` — both already computed by `page.tsx`
 * for their own banners) pass it in via `overrideFailed`, so this
 * function isn't the one deciding what counts as a failure.
 */
export function derivePipelineStage(
  signals: PipelineCompletionSignals,
  overrideFailed = false,
): DerivedPipelineStage {
  let currentStage: PipelineStage;

  if (!signals.briefExists) {
    currentStage = "draft";
  } else if (!signals.briefApproved) {
    currentStage = "strategy";
  } else if (!signals.blueprintApproved) {
    currentStage = "blueprint";
  } else if (signals.contentTotalLeaves === 0 || signals.contentApprovedLeaves < signals.contentTotalLeaves) {
    currentStage = "content";
  } else if (!signals.hasCurrentQaReport) {
    currentStage = "qa";
  } else {
    // QA has a current report; export is the last stage either way —
    // whether exportDone is true or still false, there is no further
    // stage to advance to (mirrors GENERATION_STATE_ORDER's own shape,
    // which also ends at export_completed with nothing after it).
    currentStage = "export";
  }

  return { currentStage, failed: overrideFailed };
}
