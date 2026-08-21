"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/design-system/card";
import { ProvenanceBadge } from "@/components/design-system/provenance-badge";
import { StatusBadge } from "@/components/design-system/status-badge";
import { formatDate } from "@/lib/format/date";
import { generateQaReport } from "@/lib/generation/qa/generate-qa-report";
import type { Database } from "@/lib/supabase/types";

type QaCategory = Database["public"]["Enums"]["qa_category"];
type QaMethod = Database["public"]["Enums"]["qa_method"];
type QaStatus = Database["public"]["Enums"]["qa_status"];

/**
 * The fixed, locked category order (QD3) — never re-sorted by
 * severity or alphabetically. Reused verbatim from
 * `lib/generation/qa/types.ts`'s `DETERMINISTIC_QA_CATEGORIES` plus
 * the 2 LLM categories appended in their own locked order, matching
 * `docs/architecture/phase-4-6-qa-ui-plan.md` QU1 exactly.
 */
const QA_CATEGORY_ORDER: QaCategory[] = [
  "topics",
  "entities",
  "structure",
  "links",
  "brand",
  "style",
  "forbidden_chars",
  "intent",
  "factual",
];

const CATEGORY_LABEL: Record<QaCategory, string> = {
  topics: "Topics",
  entities: "Entities",
  structure: "Structure",
  links: "Internal links",
  brand: "Brand",
  style: "Style",
  forbidden_chars: "Forbidden characters",
  intent: "Intent",
  factual: "Factual grounding",
};

export interface QaFindingDetail {
  id: string;
  category: QaCategory;
  method: QaMethod;
  status: QaStatus;
  note: string | null;
  quote: string | null;
  contentVersionId: string | null;
  /** Resolved section this finding is about — null for whole-document findings (content_version_id is also null in that case). */
  section: {
    title: string;
    blueprintNodeId: string;
    /** False when this finding's content_version_id belongs to a Blueprint version that is no longer current (BD6 — orphaned by a manual edit or AI regeneration) — "Go to section" must degrade honestly rather than navigate nowhere/wrong (QU5). */
    isInCurrentBlueprint: boolean;
  } | null;
}

export interface QaReportSummary {
  id: string;
  runAt: string;
  overallStatus: QaStatus;
  findings: QaFindingDetail[];
  isStale: boolean;
  staleReason: string | null;
  /** QD9/QU11 (Partial QA) — the exact categories this report actually evaluated/skipped, explicitly persisted, never derived from `findings` (a legitimately-evaluated category can have zero findings). */
  evaluatedCategories: QaCategory[];
  skippedCategories: QaCategory[];
}

export interface QaReviewProps {
  projectId: string;
  canManage: boolean;
  report: QaReportSummary | null;
  /** QU12 (docs/architecture/phase-4-6-qa-ui-plan.md) — "Review issue": navigates to Content Editor on the finding's section (reusing QU4's existing cross-tab mechanism, unchanged) AND opens the temporary QA diagnostic panel for this specific finding. Passes the whole finding, not just the section id, so Content Editor can build the panel from data this tab already has in hand — zero new query. */
  onReviewIssue: (finding: QaFindingDetail) => void;
  /** MILESTONE-02 — reuses `page.tsx`'s already-computed `currentHasNoContent` (zero new query): true when the current Blueprint version's leaf sections exist but none has generated Content yet. Messaging-only — does not change whether Run QA can be clicked. */
  hasNoContent?: boolean;
}

function overallTone(status: QaStatus): "success" | "warning" | "danger" {
  return status === "fail" ? "danger" : status === "warn" ? "warning" : "success";
}

function rollupStatus(findings: QaFindingDetail[]): QaStatus {
  if (findings.some((f) => f.status === "fail")) return "fail";
  if (findings.some((f) => f.status === "warn")) return "warn";
  return "pass";
}

function RunQaControl({ projectId, label }: { projectId: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      try {
        // No selection argument -> `generateQaReport()`'s own default
        // (all 9 categories, QD9) — "Run full QA"/"Re-run validation"
        // stays the unchanged default action.
        await generateQaReport(projectId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to run QA.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={onClick} disabled={pending} className="self-start">
        {pending ? "Running QA…" : label}
      </Button>
      {error ? <p className="text-xs text-status-danger-fg">{error}</p> : null}
    </div>
  );
}

/**
 * QU11 (docs/architecture/phase-4-6-qa-ui-plan.md, locked LEAVES-04,
 * implemented QA-17) — "Customize…", a secondary action alongside the
 * default "Run full QA"/"Re-run validation". Opens a 9-category
 * checklist, all checked by default (so unchecking is the actual
 * customization gesture); "Run selected" is disabled at zero
 * selections (a UI courtesy — the real floor is server-side,
 * `splitQaCategorySelection()` throws on an empty array).
 */
function CustomizeQaControl({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<QaCategory>>(new Set(QA_CATEGORY_ORDER));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(category: QaCategory) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function onRunSelected() {
    setError(null);
    startTransition(async () => {
      try {
        await generateQaReport(projectId, [...selected]);
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to run QA.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" size="sm" className="self-start" onClick={() => setOpen((v) => !v)} disabled={pending}>
        Customize…
      </Button>

      {open ? (
        <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-elevated p-3">
          <div className="flex flex-col gap-1.5">
            {QA_CATEGORY_ORDER.map((category) => (
              <label key={category} className="flex items-center gap-2 text-[12.5px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={selected.has(category)}
                  onChange={() => toggle(category)}
                  className="size-3.5"
                />
                {CATEGORY_LABEL[category]}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={onRunSelected} disabled={pending || selected.size === 0}>
              {pending ? "Running QA…" : "Run selected"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
          {error ? <p className="text-xs text-status-danger-fg">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function FindingRow({
  finding,
  onReviewIssue,
}: {
  finding: QaFindingDetail;
  onReviewIssue: (finding: QaFindingDetail) => void;
}) {
  const tone = overallTone(finding.status);
  const label = finding.status === "fail" ? "Fail" : finding.status === "warn" ? "Warn" : "Pass";

  const suggestedAction =
    finding.status === "pass"
      ? null
      : finding.section
        ? `Edit or regenerate "${finding.section.title}" to address this.`
        : "Review the whole document.";

  return (
    <div className="flex flex-col gap-1.5 border-b border-border py-3 text-[12.5px] last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={tone}>{label}</StatusBadge>
        <ProvenanceBadge source={finding.method === "llm" ? "ai" : "system"} />
        <span className="font-semibold text-text-secondary">{finding.section ? finding.section.title : "Whole document"}</span>
      </div>

      <p className="text-text-secondary">{finding.note ?? "(no explanation recorded)"}</p>

      {finding.quote ? (
        <blockquote className="border-l-2 border-border pl-2.5 font-mono text-[11.5px] italic text-text-muted">
          &ldquo;{finding.quote}&rdquo;
        </blockquote>
      ) : null}

      {finding.contentVersionId ? (
        <span className="font-mono text-[10.5px] text-text-muted">content_version: {finding.contentVersionId}</span>
      ) : null}

      {suggestedAction ? <p className="text-[11.5px] text-text-muted">{suggestedAction}</p> : null}

      {finding.section ? (
        finding.section.isInCurrentBlueprint ? (
          <Button variant="outline" size="sm" className="mt-1 self-start" onClick={() => onReviewIssue(finding)}>
            Review issue
          </Button>
        ) : (
          <p className="mt-1 text-[11px] italic text-text-muted">
            This section is no longer part of the current Blueprint version — see Blueprint version history.
          </p>
        )
      ) : null}
    </div>
  );
}

function CategoryCard({
  category,
  findings,
  notEvaluated,
  onReviewIssue,
}: {
  category: QaCategory;
  findings: QaFindingDetail[];
  /** QU11 — true when this category is in the report's `skipped_categories` (Partial QA). A skipped category is never rendered as PASS. */
  notEvaluated: boolean;
  onReviewIssue: (finding: QaFindingDetail) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = findings.length > 0 ? rollupStatus(findings) : "pass";
  const method: QaMethod = category === "intent" || category === "factual" ? "llm" : "deterministic";

  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        disabled={notEvaluated}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] font-semibold text-text-primary">{CATEGORY_LABEL[category]}</span>
          <ProvenanceBadge source={method === "llm" ? "ai" : "system"} />
        </div>
        <div className="flex items-center gap-2">
          {/* QU11 locked copy: PASS renders "Nothing found"; NOT EVALUATED renders "This category was skipped" — never confusable. */}
          <span className="text-[11px] text-text-muted">
            {notEvaluated
              ? "This category was skipped"
              : findings.length === 0
                ? "Nothing found"
                : `${findings.length} finding${findings.length === 1 ? "" : "s"}`}
          </span>
          {notEvaluated ? (
            <StatusBadge tone="neutral">Not evaluated</StatusBadge>
          ) : (
            <StatusBadge tone={overallTone(status)}>{status === "fail" ? "Fail" : status === "warn" ? "Warn" : "Pass"}</StatusBadge>
          )}
        </div>
      </button>

      {expanded && !notEvaluated ? (
        <div className="border-t border-border px-4 py-1">
          {findings.length === 0 ? (
            <p className="py-3 text-[12.5px] italic text-text-muted">
              Nothing to evaluate for this category yet — no result to flag, not an omission.
            </p>
          ) : (
            findings.map((f) => <FindingRow key={f.id} finding={f} onReviewIssue={onReviewIssue} />)
          )}
        </div>
      ) : null}
    </Card>
  );
}

export function QaReview({ projectId, canManage, report, onReviewIssue, hasNoContent }: QaReviewProps) {
  // --- No valid QA (Question/QU §5, requirement 7) ------------------------
  if (!report) {
    return (
      <div className="flex max-w-xl flex-col gap-4">
        <Card>
          <p className="mb-1 text-sm font-semibold text-text-primary">No QA run yet</p>
          {hasNoContent ? (
            <>
              <p className="text-sm text-text-secondary">
                This Blueprint has no generated Content yet — there&rsquo;s nothing for QA to check.
              </p>
              <p className="mt-1.5 text-xs text-text-muted">
                Generate and approve Content for at least one section in the Content Editor tab first, then come back
                to run QA.
              </p>
            </>
          ) : (
            <p className="text-sm text-text-secondary">Run QA to check this project&rsquo;s Content against all 9 categories.</p>
          )}
        </Card>
        {canManage ? (
          <div className="flex flex-wrap items-start gap-2">
            <RunQaControl projectId={projectId} label="Run QA" />
            <CustomizeQaControl projectId={projectId} />
          </div>
        ) : (
          <p className="text-xs text-text-muted">Waiting for a team lead or SEO manager to run QA.</p>
        )}
      </div>
    );
  }

  const findingsByCategory = new Map<QaCategory, QaFindingDetail[]>();
  for (const category of QA_CATEGORY_ORDER) findingsByCategory.set(category, []);
  for (const f of report.findings) findingsByCategory.get(f.category)?.push(f);

  const failCount = report.findings.filter((f) => f.status === "fail").length;
  const warnCount = report.findings.filter((f) => f.status === "warn").length;
  const skippedSet = new Set(report.skippedCategories);
  const isPartial = report.skippedCategories.length > 0;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 pb-4">
      {/* --- Staleness (requirement 7) — always the loudest thing on the page when true --- */}
      {report.isStale ? (
        <div className="rounded-[10px] border border-status-warning-fg/30 bg-status-warning-bg px-4 py-3 text-[12.5px] text-status-warning-fg">
          <div className="mb-0.5 font-semibold">This QA result is out of date</div>
          <div>{report.staleReason} The result below is shown for reference only — re-run QA before relying on it.</div>
          {canManage ? (
            <div className="mt-2.5">
              <RunQaControl projectId={projectId} label="Re-run validation" />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* --- Overall result (requirement 1) ------------------------------- */}
      <div
        className={
          "rounded-[10px] border px-4 py-3 text-[12.5px] " +
          (report.overallStatus === "fail"
            ? "border-status-danger-fg/30 bg-status-danger-bg text-status-danger-fg"
            : report.overallStatus === "warn"
              ? "border-status-warning-fg/30 bg-status-warning-bg text-status-warning-fg"
              : "border-[#BFE6DA] bg-status-success-bg text-status-success-fg")
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold">
              {report.overallStatus === "fail"
                ? `${failCount} finding${failCount === 1 ? "" : "s"} must be resolved before you can export.`
                : report.overallStatus === "warn"
                  ? `No blocking issues. ${warnCount} warning${warnCount === 1 ? "" : "s"} worth reviewing before export.`
                  : "All checks passed. Ready to export."}
            </div>
            <div className="mt-0.5 font-mono text-[11px] opacity-80">Run at {formatDate(report.runAt)}</div>
            {/* QU11 locked copy — shown only on a partial report; a full report shows no such line (absence is itself the "complete" signal). */}
            {isPartial ? (
              <div className="mt-1 text-[11.5px] font-semibold">
                Partial QA — {report.evaluatedCategories.length} of 9 categories evaluated.
              </div>
            ) : null}
          </div>
          {!report.isStale && canManage ? (
            <div className="flex flex-wrap items-start gap-2">
              <RunQaControl projectId={projectId} label="Re-run validation" />
              <CustomizeQaControl projectId={projectId} />
            </div>
          ) : null}
        </div>
      </div>

      {/* --- 9 fixed categories (requirements 2, 3, 4) --------------------- */}
      <div className="flex flex-col gap-2.5">
        {QA_CATEGORY_ORDER.map((category) => (
          <CategoryCard
            key={category}
            category={category}
            findings={findingsByCategory.get(category) ?? []}
            notEvaluated={skippedSet.has(category)}
            onReviewIssue={onReviewIssue}
          />
        ))}
      </div>
    </div>
  );
}
