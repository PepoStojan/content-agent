import assert from "node:assert/strict";

import { authorizeExport, computeExportGate, type ExportGateInput, type ExportGateQaReport } from "./gate";

/**
 * Deterministic regression checks for the Phase 4.7 foundation's
 * `computeExportGate()`/`authorizeExport()` (EXPORT-02) —
 * dependency-free (Node's built-in `assert`), same pattern as
 * `lib/generation/blueprint/tree-order.verify.ts` and
 * `lib/generation/qa/text.verify.ts`.
 *
 * Run with: npx tsx lib/generation/export/gate.verify.ts
 *
 * Covers every state the task's own testing checklist names: no QA,
 * current PASS, current WARN, current FAIL, stale QA, partial QA, and
 * a bypass request in both its valid and rejected forms.
 */

let passed = 0;

function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const BLUEPRINT_ID = "blueprint-v1";
const ALL_9 = ["intent", "topics", "entities", "structure", "links", "brand", "factual", "style", "forbidden_chars"] as const;

function report(overrides: Partial<ExportGateQaReport> = {}): ExportGateQaReport {
  return {
    id: "qa-report-1",
    overallStatus: "pass",
    blueprintVersionId: BLUEPRINT_ID,
    evaluatedCategories: [...ALL_9],
    skippedCategories: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<ExportGateInput> = {}): ExportGateInput {
  return {
    latestQaReport: report(),
    currentBlueprintVersionId: BLUEPRINT_ID,
    evaluatedContentVersionIds: ["cv-1", "cv-2"],
    currentContentVersionIds: new Set(["cv-1", "cv-2"]),
    ...overrides,
  };
}

// --- computeExportGate(): the 5 named states -----------------------------

check("no QA: blocked, reason no_qa, qaReportId null", () => {
  const gate = computeExportGate(baseInput({ latestQaReport: null }));
  assert.deepEqual(gate, { decision: "blocked", reason: "no_qa", qaReportId: null });
});

check("current PASS, full QA: allowed, tier verified", () => {
  const gate = computeExportGate(baseInput({ latestQaReport: report({ overallStatus: "pass" }) }));
  assert.deepEqual(gate, { decision: "allowed", tier: "verified", qaReportId: "qa-report-1" });
});

check("current WARN, full QA: allowed, tier verified (WARN does not block, matches ED2's literal wording)", () => {
  const gate = computeExportGate(baseInput({ latestQaReport: report({ overallStatus: "warn" }) }));
  assert.deepEqual(gate, { decision: "allowed", tier: "verified", qaReportId: "qa-report-1" });
});

check("current FAIL: blocked, reason fail", () => {
  const gate = computeExportGate(baseInput({ latestQaReport: report({ overallStatus: "fail" }) }));
  assert.deepEqual(gate, { decision: "blocked", reason: "fail", qaReportId: "qa-report-1" });
});

check("stale QA (blueprint mismatch): blocked, reason stale — takes priority over overall_status", () => {
  const gate = computeExportGate(
    baseInput({ latestQaReport: report({ overallStatus: "pass" }), currentBlueprintVersionId: "blueprint-v2" }),
  );
  assert.deepEqual(gate, { decision: "blocked", reason: "stale", qaReportId: "qa-report-1" });
});

check("stale QA (content mismatch): blocked, reason stale", () => {
  const gate = computeExportGate(
    baseInput({ latestQaReport: report({ overallStatus: "pass" }), currentContentVersionIds: new Set(["cv-1"]) }),
  );
  assert.deepEqual(gate, { decision: "blocked", reason: "stale", qaReportId: "qa-report-1" });
});

check("partial QA, not stale, not FAIL: allowed, tier partially_verified (QD9/ED13)", () => {
  const gate = computeExportGate(
    baseInput({
      latestQaReport: report({
        overallStatus: "pass",
        evaluatedCategories: ["entities", "links"],
        skippedCategories: ["intent", "topics", "structure", "brand", "factual", "style", "forbidden_chars"],
      }),
    }),
  );
  assert.deepEqual(gate, { decision: "allowed", tier: "partially_verified", qaReportId: "qa-report-1" });
});

check("partial QA that FAILs among evaluated categories: blocked, reason fail — partial coverage never softens a FAIL (ED13)", () => {
  const gate = computeExportGate(
    baseInput({
      latestQaReport: report({
        overallStatus: "fail",
        evaluatedCategories: ["entities"],
        skippedCategories: ALL_9.filter((c) => c !== "entities"),
      }),
    }),
  );
  assert.deepEqual(gate, { decision: "blocked", reason: "fail", qaReportId: "qa-report-1" });
});

check("stale FAIL report: reason is stale, not fail — staleness is checked first", () => {
  const gate = computeExportGate(
    baseInput({ latestQaReport: report({ overallStatus: "fail" }), currentBlueprintVersionId: "blueprint-v2" }),
  );
  assert.equal(gate.decision, "blocked");
  assert.equal((gate as { reason: string }).reason, "stale");
});

// --- authorizeExport(): normal vs. explicit bypass request ---------------

check("normal request against an Allowed gate: authorized, qaBypassed false, tier from the gate", () => {
  const gate = computeExportGate(baseInput());
  const auth = authorizeExport(gate, false);
  assert.deepEqual(auth, { authorized: true, qaBypassed: false, tier: "verified", qaReportId: "qa-report-1" });
});

check("normal request against a Blocked gate: rejected, not silently authorized", () => {
  const gate = computeExportGate(baseInput({ latestQaReport: null }));
  const auth = authorizeExport(gate, false);
  assert.equal(auth.authorized, false);
  assert.ok(auth.rejectionReason);
});

check("bypass request against a Blocked (no_qa) gate: authorized, qaBypassed true, tier unverified (ED12)", () => {
  const gate = computeExportGate(baseInput({ latestQaReport: null }));
  const auth = authorizeExport(gate, true);
  assert.deepEqual(auth, { authorized: true, qaBypassed: true, tier: "unverified", qaReportId: null });
});

check("bypass request against a Blocked (fail) gate: authorized, qaBypassed true, tier unverified, qaReportId preserved (ED1/ED12)", () => {
  const gate = computeExportGate(baseInput({ latestQaReport: report({ overallStatus: "fail" }) }));
  const auth = authorizeExport(gate, true);
  assert.deepEqual(auth, { authorized: true, qaBypassed: true, tier: "unverified", qaReportId: "qa-report-1" });
});

check("bypass request against an Allowed gate: rejected — no automatic bypass, nothing to bypass", () => {
  const gate = computeExportGate(baseInput());
  const auth = authorizeExport(gate, true);
  assert.equal(auth.authorized, false);
  assert.ok(auth.rejectionReason);
});

check("qaBypassed is never true unless bypassRequested was true — no hidden/automatic bypass", () => {
  const allowedGate = computeExportGate(baseInput());
  const blockedGate = computeExportGate(baseInput({ latestQaReport: null }));
  assert.equal(authorizeExport(allowedGate, false).qaBypassed, false);
  assert.equal(authorizeExport(blockedGate, true).qaBypassed, true);
});

console.log(`\n${passed} check(s) passed.`);
