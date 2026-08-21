import type { QaCategory, QaStatus } from "@/lib/generation/qa/types";

import type { ExportGateResult, ExportVerificationTier } from "./gate";

/**
 * Phase 4.7 data-fetching layer (EXPORT-03) — pure helpers consumed by
 * the project workspace's server-side data fetch (`page.tsx`). No I/O
 * here; the caller already has whatever data these functions need.
 */

export interface ExportSnapshotEligibility {
  eligible: boolean;
  reason: string | null;
}

/**
 * Requirement 2 (EXPORT-03) — before exposing an Export action, the
 * pinned lineage Brief version -> Blueprint version -> content version
 * set must be deterministically resolvable from data already pinned
 * elsewhere, never from an arbitrary "current" pointer re-resolved a
 * second time.
 *
 * `pinnedBriefVersionId` must be the Brief version the *current
 * Blueprint version was actually generated from* — its own
 * `blueprint_versions.brief_version_id` FK (BD1) — not
 * `content_briefs.current_version_id` read independently, which can
 * have moved forward past what the Blueprint reflects (Phase 4.4 §9's
 * own staleness case). The caller is responsible for passing the
 * correct pinned id; this function only checks it resolved to
 * something, it does not re-derive it.
 *
 * `blueprintApproved` mirrors the same precondition Content
 * generation itself already enforces (Phase 4.5 §15) — an exportable
 * snapshot requires the Blueprint that defines its section structure
 * to be the project's approved one, not a draft in-progress edit.
 */
export function computeExportSnapshotEligibility(input: {
  pinnedBriefVersionId: string | null;
  blueprintApproved: boolean;
}): ExportSnapshotEligibility {
  if (!input.pinnedBriefVersionId) {
    return { eligible: false, reason: "No approved Brief version is pinned to the current Blueprint." };
  }
  if (!input.blueprintApproved) {
    return { eligible: false, reason: "The current Blueprint version is not approved." };
  }
  return { eligible: true, reason: null };
}

/**
 * ED13's tier, derived — never stored (ED13, EXPORT-01/EXPORT-02's own
 * locked rule, restated here for this one call site). An Allowed gate
 * carries its own real tier (`verified`/`partially_verified`); a
 * Blocked gate has no real export yet, but the *only* tier a bypass of
 * it could ever produce is `unverified` (ED12) — this is what "would
 * result if exported right now" resolves to, for display purposes,
 * without pre-committing to an actual bypass.
 */
export function deriveExportVerificationTier(gate: ExportGateResult): ExportVerificationTier {
  return gate.decision === "allowed" ? gate.tier : "unverified";
}

/** One Blueprint leaf's exact `content_version_id` (or `null` if that leaf has no Content yet), already in document order — the caller derives this from `contentSections`, itself already built via `orderNodesByDocumentPosition()`; this type adds no new ordering of its own. */
export interface ExportContentVersionEntry {
  blueprintNodeId: string;
  title: string;
  contentVersionId: string | null;
}

/**
 * The full Export data-fetching layer's output (EXPORT-03) — every
 * field requirement 1 names, assembled once per page render from data
 * the workspace page already fetched for its other tabs. No new
 * top-level fetch is implied by this type; it is a projection, not a
 * source.
 */
export interface ExportData {
  briefVersionId: string | null;
  briefVersionNumber: number | null;
  blueprintVersionId: string | null;
  blueprintVersionNumber: number | null;
  contentVersions: ExportContentVersionEntry[];
  qaReport: {
    id: string;
    overallStatus: QaStatus | null;
    evaluatedCategories: QaCategory[];
    skippedCategories: QaCategory[];
  } | null;
  qaStale: boolean;
  qaStaleReason: string | null;
  /** Count of `fail`-status findings on the latest QA report — reused from the same `qa_findings` rows the QA tab already fetches (page.tsx), not a new query. Only meaningful when `gate.reason === 'fail'`; `0` otherwise. */
  qaFailingFindingCount: number;
  gate: ExportGateResult;
  verificationTier: ExportVerificationTier;
  snapshotEligibility: ExportSnapshotEligibility;
}
