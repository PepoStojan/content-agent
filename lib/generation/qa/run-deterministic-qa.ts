import type { createClient } from "@/lib/supabase/server";

import { checkBrand } from "./checks/brand";
import { checkEntities } from "./checks/entities";
import { checkForbiddenChars } from "./checks/forbidden-chars";
import { checkLinks } from "./checks/links";
import { checkStructure } from "./checks/structure";
import { checkStyle } from "./checks/style";
import { checkTopics } from "./checks/topics";
import { resolveQaLineage, type QaLineage } from "./lineage";
import { DETERMINISTIC_QA_CATEGORIES, type DeterministicFinding, type QaCategory } from "./types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface DeterministicQaResult {
  lineage: QaLineage;
  findings: DeterministicFinding[];
}

/**
 * The deterministic QA orchestrator — Phase 4.6, 7 of the 9 locked
 * categories (QD3: `topics`, `entities`, `structure`, `links`,
 * `brand`, `style`, `forbidden_chars`). Does NOT call Anthropic and
 * does NOT cover `intent`/`factual` (LLM-only, implemented in
 * `generate-qa-report.ts`).
 *
 * QD9/QU11 (Partial QA, locked 2026-08-20, implemented QA-17):
 * `selectedCategories` restricts which of the 7 deterministic
 * category functions actually run — a skipped category contributes
 * **zero** findings, never a synthetic "N/A" row, and its own check
 * function is never called at all (not run-then-hidden). Defaults to
 * all 7 deterministic categories (full QA, unchanged behavior) when
 * omitted. `lineage` is always resolved once regardless of selection
 * — it's a single cheap read, and every selected check needs it.
 *
 * Does NOT persist anything. A `qa_reports` row is defined as one
 * complete run (QD5, an insert-only snapshot) whose scope is exactly
 * `evaluated_categories`/`skipped_categories` (QD9) — persistence
 * (`qa_reports`/`qa_report_content_versions`/`qa_findings` inserts +
 * the `generation_runs` three-phase lifecycle, QD8) happens in
 * `generate-qa-report.ts`, which also owns the LLM half.
 *
 * Output ordering is fully deterministic: categories are evaluated
 * and concatenated in the fixed, locked order
 * (`DETERMINISTIC_QA_CATEGORIES`), and within each category every
 * check function itself produces findings in a fixed order (leaves
 * pre-sorted by level/position/id in `resolveQaLineage`; any
 * whole-document finding placed first within its category). Identical
 * inputs — the same pinned Blueprint/Brief version, the same set of
 * current content_versions, and the same category selection — always
 * produce identical findings in identical order.
 */
export async function runDeterministicQaChecks(
  supabase: SupabaseServerClient,
  projectId: string,
  selectedCategories: readonly QaCategory[] = DETERMINISTIC_QA_CATEGORIES,
): Promise<DeterministicQaResult> {
  const lineage = await resolveQaLineage(supabase, projectId);
  const selected = new Set(selectedCategories);

  const byCategory: Record<(typeof DETERMINISTIC_QA_CATEGORIES)[number], DeterministicFinding[]> = {
    topics: selected.has("topics") ? checkTopics(lineage.leaves) : [],
    entities: selected.has("entities") ? checkEntities(lineage.leaves) : [],
    structure: selected.has("structure") ? checkStructure(lineage.leaves) : [],
    links: selected.has("links") ? checkLinks(lineage.leaves) : [],
    brand: selected.has("brand") ? checkBrand(lineage.leaves, lineage.brand, lineage.business) : [],
    style: selected.has("style") ? checkStyle(lineage.leaves) : [],
    forbidden_chars: selected.has("forbidden_chars") ? checkForbiddenChars(lineage.leaves) : [],
  };

  const findings = DETERMINISTIC_QA_CATEGORIES.flatMap((category) => byCategory[category]);

  return { lineage, findings };
}
