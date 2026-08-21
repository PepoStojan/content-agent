"use client";

import { CheckCircle2, ShieldAlert, ShieldQuestion } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/design-system/card";
import { StatusBadge } from "@/components/design-system/status-badge";
import { ALL_EXPORT_FORMATS, EXPORT_FORMAT_AVAILABILITY, FORMAT_LABEL, type ExportFormat } from "@/lib/generation/export/formats";
import type { ExportVerificationTier } from "@/lib/generation/export/gate";
import type { ExportData } from "@/lib/generation/export/snapshot";
import type { Database } from "@/lib/supabase/types";

import { requestExport, type RequestExportResult } from "./export-actions";

type QaCategory = Database["public"]["Enums"]["qa_category"];

/** Same fixed, locked category order/labels as `qa-review.tsx` (QD3/QU1) — duplicated locally rather than shared, matching this codebase's existing small-constant-per-component convention. */
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

function orderedCategoryLabels(categories: QaCategory[]): string[] {
  const set = new Set(categories);
  return QA_CATEGORY_ORDER.filter((c) => set.has(c)).map((c) => CATEGORY_LABEL[c]);
}

const DEFAULT_SELECTED_FORMATS: ExportFormat[] = ["markdown"];

/** ED14 §3 — text + icon + StatusBadge together; color is never the only signal. */
const TIER_DISPLAY: Record<ExportVerificationTier, { label: string; tone: "success" | "warning" | "danger"; Icon: typeof CheckCircle2 }> = {
  verified: { label: "Verified", tone: "success", Icon: CheckCircle2 },
  partially_verified: { label: "Partially verified", tone: "warning", Icon: ShieldQuestion },
  unverified: { label: "Unverified", tone: "danger", Icon: ShieldAlert },
};

const BYPASS_CONFIRMATION_COPY =
  "This content has not passed a current QA validation. The exported file will be marked Unverified.";

export interface ExportReviewProps {
  projectId: string;
  canManage: boolean;
  exportData: ExportData;
  onReviewQa: () => void;
  /** MILESTONE-02 — reuses `page.tsx`'s already-computed `currentHasNoContent` (zero new query): true when the current Blueprint version's leaf sections exist but none has generated Content yet. Messaging-only — does not change the gate decision or unlock a new export path. */
  hasNoContent?: boolean;
}

function TierBadge({ tier }: { tier: ExportVerificationTier }) {
  const { label, tone, Icon } = TIER_DISPLAY[tier];
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-text-secondary" aria-hidden="true" />
      <StatusBadge tone={tone}>{label}</StatusBadge>
    </div>
  );
}

function FormatChecklist({ selected, onToggle }: { selected: Set<ExportFormat>; onToggle: (format: ExportFormat) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {ALL_EXPORT_FORMATS.map((format) => {
        const available = EXPORT_FORMAT_AVAILABILITY[format];
        return (
          <label
            key={format}
            className={
              "flex items-center gap-2.5 rounded-[8px] border border-border px-3 py-2 text-[13px] " +
              (available ? "cursor-pointer text-text-primary" : "cursor-not-allowed text-text-muted opacity-60")
            }
          >
            <input
              type="checkbox"
              checked={selected.has(format)}
              disabled={!available}
              onChange={() => onToggle(format)}
              className="size-4"
            />
            <span className="flex-1">{FORMAT_LABEL[format]}</span>
            {!available ? <span className="text-[11px] text-text-muted">Not yet available</span> : null}
          </label>
        );
      })}
    </div>
  );
}

/** Shared by both the Allowed path's `ExportAction` and the Blocked path's bypass result — a completed export (verified, partially verified, or unverified via ED12) always renders identically, no matter which path produced it. */
function ExportResultCard({ result }: { result: RequestExportResult }) {
  return (
    <Card>
      <p className="text-[13px] font-semibold text-text-primary">Export complete</p>
      <div className="mt-1 flex items-center gap-2">
        <TierBadge tier={result.verificationTier} />
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {result.files.map((file) => (
          <div key={file.fileName} className="flex items-center justify-between gap-3 rounded-[8px] border border-border px-3 py-2 text-[12.5px]">
            <div className="flex flex-col">
              <span className="text-text-primary">{file.fileName}</span>
              <span className="text-[11px] text-text-muted">
                {FORMAT_LABEL[file.format]} · {formatBytes(file.sizeBytes)}
              </span>
            </div>
            <a href={file.downloadUrl} download={file.fileName} className="text-[12.5px] font-semibold text-primary underline">
              Download
            </a>
          </div>
        ))}
      </div>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * ED14 §8/§9 — idle/running/success/failed, wired to the real
 * `requestExport()` server action. Markdown (EXPORT-07) is the first
 * format to ever reach a real `success` here — HTML/DOCX/Structured
 * JSON stay unavailable, so a request including any of them still
 * fails honestly (§6, EXPORT-06, unchanged). Success shows exactly
 * what the server actually generated: real file name, MIME type,
 * size, and a real time-limited download link — nothing fabricated.
 */
function ExportAction({
  canManage,
  hasSelection,
  attemptState,
  attemptResult,
  attemptErrorMessage,
  onExport,
}: {
  canManage: boolean;
  hasSelection: boolean;
  attemptState: "idle" | "running" | "success" | "failed";
  attemptResult: RequestExportResult | null;
  attemptErrorMessage: string | null;
  onExport: () => void;
}) {
  if (!canManage) return null;

  if (attemptState === "running") {
    return (
      <Button disabled className="self-start">
        Exporting…
      </Button>
    );
  }

  if (attemptState === "success" && attemptResult) {
    return <ExportResultCard result={attemptResult} />;
  }

  if (attemptState === "failed") {
    const message = attemptResult?.error?.message ?? attemptErrorMessage ?? "The export failed. Nothing was generated.";
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[12.5px] text-status-danger-fg">{message}</p>
        <Button variant="outline" onClick={onExport} className="self-start">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <Button onClick={onExport} disabled={!hasSelection}>
      Export
    </Button>
  );
}

function BypassConfirmationModal({
  onCancel,
  onConfirm,
  pending,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <Card className="max-w-md">
        <p className="text-[13px] font-semibold text-text-primary">Export without QA</p>
        <p className="mt-2 text-[12.5px] text-text-secondary">{BYPASS_CONFIRMATION_COPY}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {pending ? "Exporting…" : "Export without QA"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function ExportReview({ projectId, canManage, exportData, onReviewQa, hasNoContent }: ExportReviewProps) {
  const [selectedFormats, setSelectedFormats] = useState<Set<ExportFormat>>(new Set(DEFAULT_SELECTED_FORMATS));
  const [bypassModalOpen, setBypassModalOpen] = useState(false);
  const [attemptState, setAttemptState] = useState<"idle" | "running" | "success" | "failed">("idle");
  const [attemptResult, setAttemptResult] = useState<RequestExportResult | null>(null);
  const [attemptErrorMessage, setAttemptErrorMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleFormat(format: ExportFormat) {
    if (!EXPORT_FORMAT_AVAILABILITY[format]) return;
    setSelectedFormats((prev) => {
      const next = new Set(prev);
      if (next.has(format)) next.delete(format);
      else next.add(format);
      return next;
    });
  }

  function runExport(bypassRequested: boolean) {
    setAttemptState("running");
    setAttemptErrorMessage(null);
    startTransition(async () => {
      try {
        // Only the confirmed bypass action ever sends bypassRequested: true
        // (requirement 5) — never a default, never inferred client-side.
        const result = await requestExport(projectId, [...selectedFormats], bypassRequested);
        setAttemptResult(result);
        setAttemptState(result.status === "done" ? "success" : "failed");
      } catch (e) {
        setAttemptResult(null);
        setAttemptErrorMessage(e instanceof Error ? e.message : "Failed to export.");
        setAttemptState("failed");
      } finally {
        setBypassModalOpen(false);
      }
    });
  }

  // --- 1. Snapshot not ready — checked FIRST, before any QA-related state (ED14 §1/§2) ---
  if (!exportData.snapshotEligibility.eligible) {
    return (
      <Card>
        <p className="text-[13px] font-semibold text-text-primary">Export isn&apos;t ready yet</p>
        <p className="mt-1.5 text-[12.5px] text-text-secondary">{exportData.snapshotEligibility.reason}</p>
        <p className="mt-2 text-[11.5px] text-text-muted">
          No format selection or Export action is available until an approved Brief and Blueprint version can be
          resolved for this project.
        </p>
      </Card>
    );
  }

  const { gate, verificationTier } = exportData;

  // --- 2/3/4. Blocked states — no-QA / stale / FAIL (ED14 §2/§4) ---
  if (gate.decision === "blocked") {
    const reasonText =
      gate.reason === "no_qa" && hasNoContent
        ? "This Blueprint has no generated Content yet — there's nothing to export. Generate and approve Content for at least one section in the Content Editor tab first."
        : gate.reason === "no_qa"
          ? "Run QA before exporting."
          : gate.reason === "stale"
          ? (exportData.qaStaleReason ?? "QA is out of date. Re-run validation before exporting.")
          : `${exportData.qaFailingFindingCount} finding${exportData.qaFailingFindingCount === 1 ? "" : "s"} must be resolved before export.`;

    return (
      <div className="flex flex-col gap-4">
        <Card>
          <div className="mb-2 flex items-center gap-2">
            <StatusBadge tone="danger">Export blocked</StatusBadge>
          </div>
          <p className="text-[13px] text-text-primary">{reasonText}</p>
        </Card>

        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onReviewQa}>
              Review QA
            </Button>
            <Button variant="outline" onClick={() => setBypassModalOpen(true)}>
              Export without QA
            </Button>
          </div>
        ) : null}

        {attemptState === "running" ? <p className="text-[12.5px] text-text-muted">Exporting…</p> : null}

        {attemptState === "success" && attemptResult ? <ExportResultCard result={attemptResult} /> : null}

        {attemptState === "failed" && (attemptResult || attemptErrorMessage) ? (
          <p className="text-[12.5px] text-status-danger-fg">
            {attemptResult?.error?.message ?? attemptErrorMessage}
          </p>
        ) : null}

        {bypassModalOpen ? (
          <BypassConfirmationModal
            onCancel={() => setBypassModalOpen(false)}
            onConfirm={() => runExport(true)}
            pending={pending}
          />
        ) : null}
      </div>
    );
  }

  // --- 5/6. Allowed — Verified / Partially verified (ED14 §6) ---
  const evaluatedCount = exportData.qaReport?.evaluatedCategories.length ?? 0;
  const skippedLabels = orderedCategoryLabels(exportData.qaReport?.skippedCategories ?? []);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="mb-2 flex items-center justify-between gap-3">
          <TierBadge tier={verificationTier} />
          <span className="font-mono text-[11px] text-text-muted">{evaluatedCount}/9 categories evaluated</span>
        </div>
        {verificationTier === "partially_verified" ? (
          <p className="text-[12.5px] text-text-secondary">
            Partially verified — {evaluatedCount} of 9 QA categories evaluated. Skipped: {skippedLabels.join(", ")}.
            This is not the same as a full PASS — the skipped categories were never checked.
          </p>
        ) : (
          <p className="text-[12.5px] text-text-secondary">Verified — all 9 QA categories evaluated, no failures.</p>
        )}
      </Card>

      {canManage ? (
        <Card>
          <p className="mb-2.5 text-[13px] font-semibold text-text-primary">Formats</p>
          <FormatChecklist selected={selectedFormats} onToggle={toggleFormat} />
          <div className="mt-3">
            <ExportAction
              canManage={canManage}
              hasSelection={selectedFormats.size > 0}
              attemptState={attemptState}
              attemptResult={attemptResult}
              attemptErrorMessage={attemptErrorMessage}
              onExport={() => runExport(false)}
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
