import type { Database } from "@/lib/supabase/types";

/**
 * Deterministic QA data model — Phase 4.6 (QD1–QD3, QD6,
 * docs/architecture/phase-4-6-qa-plan.md). One in-memory
 * `DeterministicFinding` maps 1:1 to a future `qa_findings` row, but
 * nothing here writes to the database yet — persistence is deferred
 * until the LLM half (`intent`/`factual`) exists too, because a
 * `qa_reports` row is defined as one complete run across all 9
 * categories (QD5), never a partial 7-of-9 snapshot.
 */

export type QaCategory = Database["public"]["Enums"]["qa_category"];
export type QaStatus = Database["public"]["Enums"]["qa_status"];
export type QaMethod = Database["public"]["Enums"]["qa_method"];

/** The 2 LLM-only categories (QD3) — `intent` (whole-document) and `factual` (per-section, batched). Not implemented in this file; produced by `lib/generation/qa/generate-qa-report.ts`. */
export const LLM_QA_CATEGORIES = ["intent", "factual"] as const satisfies readonly QaCategory[];

/**
 * A generalized finding — deterministic or LLM-sourced — the shape a
 * `qa_findings` row is actually persisted from. `DeterministicFinding`
 * (below) is the deterministic-only specialization the check modules
 * produce. `quote` (QU3/QD7, added 2026-08-20 via
 * `20260827000001_phase4_6_qa_findings_quote.sql`) is the literal
 * excerpt an LLM finding above PASS was validated against — always
 * `null` for deterministic findings (they have no "quote" concept;
 * their `note` already states the mechanical reason) and for any PASS
 * finding of either method.
 */
export interface QaFinding {
  category: QaCategory;
  method: QaMethod;
  status: QaStatus;
  note: string;
  quote: string | null;
  contentVersionId: string | null;
}

/** The 7 deterministic categories this module covers, in their fixed, locked evaluation/report order (QD3). Intentionally excludes `intent`/`factual` — those are LLM-only (QD3, QD4) and are not implemented here. */
export const DETERMINISTIC_QA_CATEGORIES = [
  "topics",
  "entities",
  "structure",
  "links",
  "brand",
  "style",
  "forbidden_chars",
] as const satisfies readonly QaCategory[];

/**
 * All 9 frozen categories, in the same fixed display order QU1 already
 * locks (deterministic categories first, then the 2 LLM categories) —
 * the "full QA" default selection (QD9). A Partial QA run's own
 * `selectedCategories` is any non-empty subset of this list; this
 * constant is what a full run's `evaluated_categories` equals and
 * what every run's `evaluated_categories ∪ skipped_categories` must
 * equal (QD9's "complementary report scope" requirement) — never
 * re-derived from the live `qa_category` enum at read time, so a
 * future enum change can't silently reinterpret an already-persisted
 * historical report's meaning.
 */
export const ALL_QA_CATEGORIES = [
  ...DETERMINISTIC_QA_CATEGORIES,
  ...LLM_QA_CATEGORIES,
] as const satisfies readonly QaCategory[];

/**
 * Splits a category selection into QD9's explicit evaluated/skipped
 * pair, always covering exactly `ALL_QA_CATEGORIES` between the two —
 * "complementary report scope," never derived from which categories
 * happened to produce findings (a legitimately-evaluated category can
 * have zero findings, e.g. `factual` with nothing to batch — QD9's
 * own reasoning for why this must be computed from the *selection*,
 * not from `qa_findings` after the fact). `selectedCategories`
 * defaults to `ALL_QA_CATEGORIES` (full QA, unchanged behavior) when
 * omitted. Server-side floor: throws on an empty selection — "at
 * least one evaluated category is required for a QA run" (QD9) is
 * enforced here, not just in a disabled UI button.
 */
export function splitQaCategorySelection(selectedCategories: readonly QaCategory[] = ALL_QA_CATEGORIES): {
  evaluatedCategories: QaCategory[];
  skippedCategories: QaCategory[];
} {
  if (selectedCategories.length === 0) {
    throw new Error("At least one QA category must be selected to run QA.");
  }
  const selected = new Set(selectedCategories);
  return {
    evaluatedCategories: ALL_QA_CATEGORIES.filter((c) => selected.has(c)),
    skippedCategories: ALL_QA_CATEGORIES.filter((c) => !selected.has(c)),
  };
}

/**
 * One deterministic finding. `contentVersionId` is the QD1 anchor —
 * set for every per-section finding, `null` for the small number of
 * genuinely whole-document findings (structure's leaf-coverage
 * summary, style's cross-section repetition check).
 */
export interface DeterministicFinding extends QaFinding {
  method: "deterministic";
}

export function finding(
  category: QaCategory,
  status: QaStatus,
  note: string,
  contentVersionId: string | null,
): DeterministicFinding {
  return { category, method: "deterministic", status, note, quote: null, contentVersionId };
}
