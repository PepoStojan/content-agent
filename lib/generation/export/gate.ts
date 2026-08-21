import { computeQaStaleness } from "@/lib/generation/qa/staleness";
import type { QaCategory, QaStatus } from "@/lib/generation/qa/types";

/**
 * Phase 4.7 foundation (EXPORT-02) — `computeExportGate()`, the one
 * deterministic gate ED2/ED13 (docs/architecture/phase-4-7-export-plan.md)
 * lock. Consumes `computeQaStaleness()` (lib/generation/qa/staleness.ts)
 * directly rather than re-deriving staleness — never a second staleness
 * algorithm.
 *
 * Allowed only when: a QA report exists, it is not stale, and its
 * `overall_status !== 'fail'`. Blocked otherwise, for exactly one of
 * three reasons: `fail`, `stale`, `no_qa`. An Allowed result also
 * carries ED13's derived provenance tier — `verified` (all 9
 * categories evaluated) or `partially_verified` (QD9, fewer than 9) —
 * computed from the report's own `skipped_categories`, never stored
 * redundantly (ED13's own locked reasoning).
 *
 * Pure, synchronous, no I/O — the caller already has this data in
 * hand (the same shape `page.tsx`'s QA tab already fetches, QU9/
 * Toyota "avoid unnecessary queries") or will fetch it once for the
 * Export tab; this function issues no query itself.
 */

export interface ExportGateQaReport {
  id: string;
  overallStatus: QaStatus | null;
  blueprintVersionId: string | null;
  evaluatedCategories: QaCategory[];
  skippedCategories: QaCategory[];
}

export interface ExportGateInput {
  /** The project's latest `qa_reports` row, or null if none exists yet. */
  latestQaReport: ExportGateQaReport | null;
  /** The project's current approved Blueprint version id, or null if none. */
  currentBlueprintVersionId: string | null;
  /** `qa_report_content_versions.content_version_id` for `latestQaReport` — the exact content versions it evaluated. Ignored when `latestQaReport` is null. */
  evaluatedContentVersionIds: string[];
  /** The current `content_versions.id` for every leaf that has content today. */
  currentContentVersionIds: Set<string>;
}

export type ExportVerificationTier = "verified" | "partially_verified" | "unverified";

export type ExportGateResult =
  | { decision: "allowed"; tier: Exclude<ExportVerificationTier, "unverified">; qaReportId: string }
  | { decision: "blocked"; reason: "fail" | "stale" | "no_qa"; qaReportId: string | null };

export function computeExportGate(input: ExportGateInput): ExportGateResult {
  if (!input.latestQaReport) {
    return { decision: "blocked", reason: "no_qa", qaReportId: null };
  }

  const { isStale } = computeQaStaleness({
    currentBlueprintVersionId: input.currentBlueprintVersionId,
    reportBlueprintVersionId: input.latestQaReport.blueprintVersionId,
    evaluatedContentVersionIds: input.evaluatedContentVersionIds,
    currentContentVersionIds: input.currentContentVersionIds,
  });

  if (isStale) {
    return { decision: "blocked", reason: "stale", qaReportId: input.latestQaReport.id };
  }

  if (input.latestQaReport.overallStatus === "fail") {
    return { decision: "blocked", reason: "fail", qaReportId: input.latestQaReport.id };
  }

  const tier: Exclude<ExportVerificationTier, "unverified"> =
    input.latestQaReport.skippedCategories.length === 0 ? "verified" : "partially_verified";

  return { decision: "allowed", tier, qaReportId: input.latestQaReport.id };
}

export interface ExportAuthorization {
  /** Whether this export attempt may proceed at all. */
  authorized: boolean;
  /** Set only when `authorized` is true. */
  qaBypassed?: boolean;
  tier?: ExportVerificationTier;
  qaReportId?: string | null;
  /** Set only when `authorized` is false — why the request was rejected. */
  rejectionReason?: string;
}

/**
 * Server-side authorization step (ED12 requirement 6) — the actual
 * enforcement point, independent of whatever the client rendered.
 * Distinguishes a normal export request from an explicit bypass
 * request and re-checks the gate in both directions:
 *
 * - `bypassRequested: false` (normal export) is authorized only when
 *   the gate is actually `allowed` server-side — a client cannot
 *   force a normal export through a gate that would have blocked it.
 * - `bypassRequested: true` ("Export without QA") is authorized only
 *   when the gate is actually `blocked` server-side — a bypass is
 *   never accepted when nothing is actually being bypassed (ED12's
 *   own "never let a normal export pointlessly mark itself
 *   unverified" rule). No automatic bypass — this function never
 *   returns `qaBypassed: true` unless `bypassRequested` was `true`.
 *
 * UI confirmation (the "Export without QA" modal/step) is explicitly
 * out of scope for this foundation step — this function only
 * implements the server-side decision that confirmation step will
 * eventually gate.
 */
export function authorizeExport(gate: ExportGateResult, bypassRequested: boolean): ExportAuthorization {
  if (!bypassRequested) {
    if (gate.decision !== "allowed") {
      return {
        authorized: false,
        rejectionReason: `Export is blocked (${gate.reason}). Use the explicit "Export without QA" bypass, or resolve QA first.`,
      };
    }
    return { authorized: true, qaBypassed: false, tier: gate.tier, qaReportId: gate.qaReportId };
  }

  // bypassRequested === true
  if (gate.decision === "allowed") {
    return {
      authorized: false,
      rejectionReason: "QA is currently passing — a bypass is not available when normal Export is already allowed.",
    };
  }
  return { authorized: true, qaBypassed: true, tier: "unverified", qaReportId: gate.qaReportId };
}
