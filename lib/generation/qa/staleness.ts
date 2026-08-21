/**
 * QD6's staleness check, extracted into one shared, pure function
 * (Phase 4.7 foundation, EXPORT-02) — previously computed inline in
 * `app/(app)/projects/[id]/page.tsx` for the QA tab only. Export
 * gating (`computeExportGate()`, `lib/generation/export/gate.ts`)
 * needs the identical check, and duplicating this logic there would
 * be exactly the "computed two different ways in two different
 * places" failure `docs/architecture/phase-4-7-export-plan.md` §2 was
 * written to prevent. This module is now the single source of truth
 * for both call sites.
 *
 * Pure, synchronous, no I/O — takes whatever rows the caller already
 * fetched (both `page.tsx`'s QA tab and Export gating already have
 * this data in hand for their own other purposes, QU9/Toyota "avoid
 * unnecessary queries") and returns a staleness verdict; never issues
 * a query itself.
 *
 * Two independent triggers, either one alone makes a report stale
 * (QD6): (1) the Blueprint version the report evaluated is no longer
 * the project's current one (a leaf-set change, whether from BD5
 * manual editing or BD2 AI regeneration — QD6 does not distinguish
 * which produced the new version); (2) any content_version the report
 * evaluated is no longer the current version for its leaf (an edit or
 * regenerate happened since the report ran). Brief-lineage mismatch
 * is transitively covered without a third check: `brief_version_id`
 * is immutable per `blueprint_version_id` (BD1), so a
 * blueprint-version match already guarantees a brief-version match —
 * restated here, not just historically true in the code this was
 * extracted from.
 */

export interface QaStalenessInput {
  /** The project's current approved Blueprint version id, or null if none. */
  currentBlueprintVersionId: string | null;
  /** The QA report's own pinned `blueprint_version_id`. */
  reportBlueprintVersionId: string | null;
  /** `qa_report_content_versions.content_version_id` for this report — the exact content versions it evaluated. */
  evaluatedContentVersionIds: string[];
  /** The current `content_versions.id` for every leaf that has content today. */
  currentContentVersionIds: Set<string>;
}

export interface QaStalenessResult {
  isStale: boolean;
  staleReason: string | null;
}

export function computeQaStaleness(input: QaStalenessInput): QaStalenessResult {
  const blueprintMismatch = input.currentBlueprintVersionId !== input.reportBlueprintVersionId;
  const contentMismatch = input.evaluatedContentVersionIds.some((id) => !input.currentContentVersionIds.has(id));

  const isStale = blueprintMismatch || contentMismatch;
  const staleReason = blueprintMismatch
    ? "The Blueprint has changed since this QA report ran."
    : contentMismatch
      ? "Content has been edited or regenerated since this QA report ran."
      : null;

  return { isStale, staleReason };
}
