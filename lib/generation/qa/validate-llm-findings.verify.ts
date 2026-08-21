import assert from "node:assert/strict";

import { validateLlmFinding } from "./validate-llm-findings";

/**
 * Deterministic regression checks for the QD7 validation gate,
 * updated for QU3 (`qa_findings.quote` now a separate column, not
 * embedded in `note`) — dependency-free, same pattern as
 * `lib/format/markdown.verify.ts`.
 *
 * Run with: npx tsx lib/generation/qa/validate-llm-findings.verify.ts
 *
 * No Anthropic call is made or needed — this exercises the pure
 * validation function directly against synthetic model output shapes.
 */

let passed = 0;

function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const candidates = [{ contentVersionId: "cv-1", body: "The crowded bar test is a simple, practical filter for names." }];

check("PASS: quote is null, note is untouched, contentVersionId is null", () => {
  const result = validateLlmFinding({ status: "pass", note: "Fully supported by the evidence." }, candidates);
  assert.ok(result);
  assert.equal(result.status, "pass");
  assert.equal(result.note, "Fully supported by the evidence.");
  assert.equal(result.quote, null);
  assert.equal(result.contentVersionId, null);
});

check("WARN with a matching literal quote: quote and note are separate fields, note has no embedded quote suffix", () => {
  const result = validateLlmFinding(
    { status: "warn", note: "This claim is thinly supported.", quote: "a simple, practical filter" },
    candidates,
  );
  assert.ok(result);
  assert.equal(result.status, "warn");
  assert.equal(result.note, "This claim is thinly supported.", "note must be the explanation only, no baked-in quote");
  assert.equal(result.quote, "a simple, practical filter");
  assert.equal(result.contentVersionId, "cv-1");
  assert.ok(!result.note.includes("quote:"), "note must never contain the old '(quote: ...)' embedding");
});

check("FAIL with a matching literal quote resolves the same way as WARN", () => {
  const result = validateLlmFinding(
    { status: "fail", note: "Fabricated statistic.", quote: "The crowded bar test" },
    candidates,
  );
  assert.ok(result);
  assert.equal(result.status, "fail");
  assert.equal(result.quote, "The crowded bar test");
});

check("REGRESSION (QD7): WARN/FAIL with no quote at all is rejected (returns null)", () => {
  const result = validateLlmFinding({ status: "warn", note: "Seems off." }, candidates);
  assert.equal(result, null);
});

check("REGRESSION (QD7): WARN/FAIL with a quote that does not literally appear in any candidate body is rejected", () => {
  const result = validateLlmFinding(
    { status: "fail", note: "Fabricated claim.", quote: "this text was never actually written anywhere" },
    candidates,
  );
  assert.equal(result, null);
});

check("quote is matched against the correct candidate when multiple are supplied (intent's whole-document case)", () => {
  const multi = [
    { contentVersionId: "cv-a", body: "Section A talks about onboarding." },
    { contentVersionId: "cv-b", body: "Section B talks about pricing tiers." },
  ];
  const result = validateLlmFinding({ status: "warn", note: "Pricing claim unsupported.", quote: "pricing tiers" }, multi);
  assert.ok(result);
  assert.equal(result.contentVersionId, "cv-b", "must anchor to the candidate whose body actually contains the quote");
});

check("a quote with surrounding whitespace is trimmed before matching", () => {
  const result = validateLlmFinding({ status: "warn", note: "Note.", quote: "  a simple, practical filter  " }, candidates);
  assert.ok(result);
  assert.equal(result.quote, "a simple, practical filter");
});

console.log(`\n${passed} check(s) passed.`);
