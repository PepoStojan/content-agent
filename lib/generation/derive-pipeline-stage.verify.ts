import assert from "node:assert/strict";

import { derivePipelineStage, type PipelineCompletionSignals } from "./derive-pipeline-stage";

/**
 * Deterministic regression checks for the pipeline-stage derivation
 * layer — dependency-free, same pattern as
 * `lib/format/markdown.verify.ts` / `lib/generation/blueprint/tree-order.verify.ts`.
 *
 * Run with: npx tsx lib/generation/derive-pipeline-stage.verify.ts
 *
 * The two cases below are the exact real desyncs this module fixes,
 * confirmed live against the database on 2026-08-20:
 * - project 64f3a6aa-3090-457a-ae54-3a1d506a87d2: generation_state
 *   said "export_pending" while 0/22 leaves had Content — the correct
 *   derived stage is "content" (or "blueprint", depending on which
 *   Blueprint version's leaves are being counted — see the case below
 *   using its real numbers).
 * - project ce718b4d-25e1-40f6-9af5-9716c7ce1aa0: generation_state
 *   said "strategy_pending" while 24/24 Content sections were
 *   approved — the correct derived stage is "qa" (no current QA report
 *   exists yet for that project).
 */

let passed = 0;

function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

function baseSignals(overrides: Partial<PipelineCompletionSignals> = {}): PipelineCompletionSignals {
  return {
    briefExists: true,
    briefApproved: true,
    blueprintApproved: true,
    contentTotalLeaves: 0,
    contentApprovedLeaves: 0,
    hasCurrentQaReport: false,
    exportDone: false,
    ...overrides,
  };
}

check("no brief yet -> draft", () => {
  const result = derivePipelineStage(baseSignals({ briefExists: false, briefApproved: false, blueprintApproved: false }));
  assert.equal(result.currentStage, "draft");
  assert.equal(result.failed, false);
});

check("brief exists but not approved -> strategy", () => {
  const result = derivePipelineStage(baseSignals({ briefApproved: false, blueprintApproved: false }));
  assert.equal(result.currentStage, "strategy");
});

check("brief approved, blueprint not approved -> blueprint", () => {
  const result = derivePipelineStage(baseSignals({ blueprintApproved: false }));
  assert.equal(result.currentStage, "blueprint");
});

check("blueprint approved, zero content leaves -> content", () => {
  const result = derivePipelineStage(baseSignals({ contentTotalLeaves: 0, contentApprovedLeaves: 0 }));
  assert.equal(result.currentStage, "content");
});

check("blueprint approved, content partially approved -> content (not qa)", () => {
  const result = derivePipelineStage(baseSignals({ contentTotalLeaves: 10, contentApprovedLeaves: 4 }));
  assert.equal(result.currentStage, "content");
});

check("all content approved, no current QA report -> qa", () => {
  const result = derivePipelineStage(baseSignals({ contentTotalLeaves: 10, contentApprovedLeaves: 10, hasCurrentQaReport: false }));
  assert.equal(result.currentStage, "qa");
});

check("all content approved, current QA report exists, export not done -> export", () => {
  const result = derivePipelineStage(
    baseSignals({ contentTotalLeaves: 10, contentApprovedLeaves: 10, hasCurrentQaReport: true, exportDone: false }),
  );
  assert.equal(result.currentStage, "export");
});

check("failed flag is passed through only when explicitly overridden (never inferred from QA status)", () => {
  const notFailed = derivePipelineStage(baseSignals(), false);
  const failed = derivePipelineStage(baseSignals(), true);
  assert.equal(notFailed.failed, false);
  assert.equal(failed.failed, true);
});

// --- REGRESSION: real project 64f3a6aa-3090-457a-ae54-3a1d506a87d2 -----
// Confirmed live: current Blueprint version has 22 leaves, 0 have any
// content_documents row at all (BD6 — orphaned by a manual Blueprint
// edit). generation_state incorrectly said "export_pending".

check("REGRESSION (64f3a6aa): 0/22 Content leaves derives to 'content', never 'export'", () => {
  const result = derivePipelineStage(
    baseSignals({ briefExists: true, briefApproved: true, blueprintApproved: true, contentTotalLeaves: 22, contentApprovedLeaves: 0 }),
  );
  assert.equal(result.currentStage, "content");
  assert.notEqual(result.currentStage, "export", "generation_state incorrectly said export_pending for this exact project");
});

// --- REGRESSION: real project ce718b4d-25e1-40f6-9af5-9716c7ce1aa0 -----
// Confirmed live: 24/24 leaves have an approved current content
// version, but no qa_reports row exists yet. generation_state
// incorrectly said "strategy_pending".

check("REGRESSION (ce718b4d): 24/24 approved Content, no QA report derives to 'qa', never 'strategy'", () => {
  const result = derivePipelineStage(
    baseSignals({ briefExists: true, briefApproved: true, blueprintApproved: true, contentTotalLeaves: 24, contentApprovedLeaves: 24, hasCurrentQaReport: false }),
  );
  assert.equal(result.currentStage, "qa");
  assert.notEqual(result.currentStage, "strategy", "generation_state incorrectly said strategy_pending for this exact project");
});

console.log(`\n${passed} check(s) passed.`);
