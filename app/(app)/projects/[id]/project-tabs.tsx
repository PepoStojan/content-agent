"use client";

import { useMemo, useState } from "react";

import { LockedTab } from "@/components/design-system/locked-tab";

import { ContentEditor, type ContentEditorProps } from "./content-editor";
import { ExportReview, type ExportReviewProps } from "./export-review";
import { QaReview, type QaFindingDetail, type QaReviewProps } from "./qa-review";

type WorkspaceTab = "brief" | "blueprint" | "content" | "qa" | "export";

/**
 * Makes the project workspace tab bar stateful (Phase 4.4/4.5/4.6/4.7).
 * Brief Review, Blueprint, Content Editor, QA, and Export are all
 * real, switchable tabs now — each tab's lock state is still driven
 * by the same `projects.status` source of truth used for the header
 * status badge, never by which tab happens to be open (Design V1's
 * "Approval & Provenance Rules" #2). QA and Export both unlock at the
 * same threshold as Content Editor (`blueprint_approved`+, Phase 4.4
 * §17's original intent; ED14 §1, EXPORT-05 — no new state machine) —
 * both reuse `contentEditorUnlocked` directly, not a new condition.
 *
 * `ContentEditor`/`QaReview`/`ExportReview` are constructed HERE, not
 * passed in as pre-rendered elements or render-prop functions from the
 * Server Component parent (`page.tsx`) — a Server Component cannot
 * pass a function across the boundary into a Client Component (Next.js
 * rejects it: "Functions cannot be passed directly to Client
 * Components"). `contentEditorProps`/`qaReviewProps`/`exportReviewProps`
 * carry only plain, serializable data; the cross-tab interactivity
 * (QU4's `pendingContentSelection`, and ED14 §7's "Review QA" from the
 * Export tab) is owned and wired up entirely within this Client
 * Component, never crossing back to the server.
 *
 * QU12 ("Review issue," docs/architecture/phase-4-6-qa-ui-plan.md)
 * reuses this exact same `pendingContentSelection` mechanism — no
 * second cross-tab state machine. The state now carries the clicked
 * finding alongside the section id it already carried, so Content
 * Editor can open its temporary QA diagnostic panel from data the QA
 * tab already has in hand (zero new query).
 */
export function ProjectTabs({
  blueprintUnlocked,
  contentEditorUnlocked,
  briefReview,
  blueprintReview,
  contentEditorProps,
  qaReviewProps,
  exportReviewProps,
  sidebar,
}: {
  blueprintUnlocked: boolean;
  contentEditorUnlocked: boolean;
  briefReview: React.ReactNode;
  blueprintReview: React.ReactNode;
  contentEditorProps: Omit<ContentEditorProps, "initialSelectedSectionId" | "initialQaFinding" | "currentQaFindingsBySection">;
  qaReviewProps: Omit<QaReviewProps, "onReviewIssue">;
  exportReviewProps: Omit<ExportReviewProps, "onReviewQa">;
  sidebar: React.ReactNode;
}) {
  const [tab, setTab] = useState<WorkspaceTab>("brief");
  const [pendingContentSelection, setPendingContentSelection] = useState<{
    blueprintNodeId: string;
    qaFinding: QaFindingDetail | null;
  } | null>(null);

  // MILESTONE-02 — built once from the QA tab's own already-fetched
  // `report` (zero new query), so a section picked directly from the
  // Content Editor sidebar can still surface its QA context. A stale
  // report contributes no findings at all (its whole rollup is
  // untrustworthy, not just individual findings); within a fresh
  // report, only findings still attached to the current Blueprint
  // (`isInCurrentBlueprint`) are included — an orphaned/BD6 finding
  // must never be presented as current here, same rule QU5 already
  // applies to "Go to section."
  const currentQaFindingsBySection = useMemo(() => {
    const map: Record<string, QaFindingDetail[]> = {};
    const report = qaReviewProps.report;
    if (!report || report.isStale) return map;
    for (const finding of report.findings) {
      if (!finding.section || !finding.section.isInCurrentBlueprint) continue;
      const key = finding.section.blueprintNodeId;
      (map[key] ??= []).push(finding);
    }
    return map;
  }, [qaReviewProps.report]);

  function reviewIssue(finding: QaFindingDetail) {
    if (!finding.section) return; // QU12: only reachable via the "Review issue" button, which only renders when a section exists.
    setPendingContentSelection({ blueprintNodeId: finding.section.blueprintNodeId, qaFinding: finding });
    setTab("content");
  }

  function navigateToQa() {
    setTab("qa");
  }

  return (
    <>
      <div className="px-10">
        <div className="flex gap-1 overflow-x-auto border-b border-border">
          <LockedTab label="Brief Review" active={tab === "brief"} onClick={() => setTab("brief")} />
          <LockedTab
            label="Blueprint"
            active={tab === "blueprint"}
            locked={!blueprintUnlocked}
            onClick={() => setTab("blueprint")}
          />
          <LockedTab
            label="Content Editor"
            active={tab === "content"}
            locked={!contentEditorUnlocked}
            onClick={() => setTab("content")}
          />
          <LockedTab
            label="QA"
            active={tab === "qa"}
            locked={!contentEditorUnlocked}
            onClick={() => setTab("qa")}
          />
          <LockedTab
            label="Export"
            active={tab === "export"}
            locked={!contentEditorUnlocked}
            onClick={() => setTab("export")}
          />
        </div>
      </div>

      <div className="flex flex-1 gap-6 overflow-y-auto p-10">
        {tab === "brief" ? (
          briefReview
        ) : tab === "blueprint" ? (
          blueprintReview
        ) : tab === "content" ? (
          <ContentEditor
            key="content"
            {...contentEditorProps}
            initialSelectedSectionId={pendingContentSelection?.blueprintNodeId ?? null}
            initialQaFinding={pendingContentSelection?.qaFinding ?? null}
            currentQaFindingsBySection={currentQaFindingsBySection}
          />
        ) : tab === "qa" ? (
          <QaReview key="qa" {...qaReviewProps} onReviewIssue={reviewIssue} />
        ) : (
          <ExportReview key="export" {...exportReviewProps} onReviewQa={navigateToQa} />
        )}
        {sidebar}
      </div>
    </>
  );
}
