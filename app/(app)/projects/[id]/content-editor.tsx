"use client";

import { Bold, Heading2, Heading3, Italic, Link as LinkIcon, List, ListOrdered } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/design-system/card";
import { ProvenanceBadge } from "@/components/design-system/provenance-badge";
import { StatusBadge } from "@/components/design-system/status-badge";
import { formatDate } from "@/lib/format/date";
import { renderMarkdown } from "@/lib/format/markdown";
import { generateContentSection } from "@/lib/generation/content/generate-content-section";
import type { Database } from "@/lib/supabase/types";

import { approveContentVersion, editContentVersion } from "./content-actions";
import type { QaFindingDetail } from "./qa-review";

type ContentVersionStatus = Database["public"]["Enums"]["content_version_status"];

export interface ContentVersionDetail {
  id: string;
  version: number;
  status: ContentVersionStatus;
  body: string;
  createdAt: string;
  approvedAt: string | null;
  generationRunId: string | null;
  modelId: string | null;
}

export interface ContentPreviousVersion {
  id: string;
  version: number;
  status: ContentVersionStatus;
  createdAt: string;
}

/**
 * LEAVES-01 — read-only Blueprint-node context for the Content
 * Editor's "Blueprint context" panel. Every field here is already
 * fetched and mapped once in `page.tsx` as part of `BlueprintNodeItem`
 * (the same data the Blueprint Review tab itself renders) — this is a
 * second, read-only view of already-fetched fields, not a new query
 * and not a second editable copy of Blueprint's own inspector.
 */
export interface ContentSectionBlueprintContext {
  goal: string | null;
  entities: string[];
  researchSupport: string | null;
  uniqueContribution: string | null;
  evidenceRequirement: string | null;
  internalLinkTargets: { candidateId: string; anchorText: string; reason: string; targetUrl: string | null }[];
  targetWordCount: number | null;
}

export interface ContentSectionDetail {
  blueprintNodeId: string;
  title: string;
  targetWordCount: number | null;
  currentVersion: ContentVersionDetail | null;
  previousVersions: ContentPreviousVersion[];
  /** Best-effort, read from the generating run's durably-stored raw output — null if unavailable, never fabricated. */
  evidenceUsed: string[] | null;
  blueprintVersionNumber: number;
  briefVersionNumber: number;
  latestFailedError: { type: string; message: string } | null;
  blueprintContext: ContentSectionBlueprintContext;
}

/** BD6 (docs/architecture/phase-4-4-blueprint-plan.md §19) — read-only preview of Content still safely stored under a prior, non-current Blueprint version. Never editable here (that Content belongs to an immutable, superseded version) and never copied/migrated onto the current version. */
export interface PreviousContentInfo {
  blueprintVersionNumber: number;
  sections: { title: string; body: string }[];
}

export interface ContentEditorProps {
  projectId: string;
  canManage: boolean;
  sections: ContentSectionDetail[];
  /** Set only when the current Blueprint version has zero generated Content AND an earlier version has some (BD6) — null otherwise. */
  previousContentInfo: PreviousContentInfo | null;
  /** QU4 (docs/architecture/phase-4-6-qa-ui-plan.md) — set when this mount was reached via a QA finding's "Review issue" action; consumed once as the initial selection, same as the existing `sections[0]` default it replaces. Not a prop that re-drives selection on every render — this component still owns its own `selectedId` state after mount. */
  initialSelectedSectionId?: string | null;
  /** QU12 (docs/architecture/phase-4-6-qa-ui-plan.md) — set alongside `initialSelectedSectionId` when this mount was reached via "Review issue"; consumed once to seed the temporary, dismissible QA diagnostic panel (`activeQaFinding`). Not a persistent prop — the component owns `activeQaFinding` state after mount, clearing it on any editing action or explicit dismissal. */
  initialQaFinding?: QaFindingDetail | null;
  /**
   * MILESTONE-02 — current QA findings keyed by `blueprintNodeId`, so
   * a section selected directly from the sidebar (not via "Review
   * issue") can still surface its QA context without a trip back to
   * the QA tab. Built once in `project-tabs.tsx` from the QA tab's
   * own already-fetched `report` (zero new query) and pre-filtered
   * there to exclude a stale report and orphaned/non-current-Blueprint
   * findings — every entry here is safe to treat as "current." Never
   * persisted, never a second QA state machine — the same
   * `QaFindingDetail`/`activeQaFinding`/`QaIssuePanel` model QU12
   * already established.
   */
  currentQaFindingsBySection?: Record<string, QaFindingDetail[]>;
}

function sectionStatus(section: ContentSectionDetail): "not_generated" | "draft" | "approved" {
  if (!section.currentVersion) return "not_generated";
  return section.currentVersion.status === "approved" ? "approved" : "draft";
}

function statusBadgeTone(status: "not_generated" | "draft" | "approved") {
  if (status === "approved") return "success" as const;
  if (status === "draft") return "waiting" as const;
  return "neutral" as const;
}

function statusBadgeLabel(status: "not_generated" | "draft" | "approved") {
  if (status === "approved") return "Approved";
  if (status === "draft") return "Draft";
  return "Not generated";
}

function wordCount(body: string): number {
  return body.trim().length === 0 ? 0 : body.trim().split(/\s+/).length;
}

type WordCountState = "below" | "within" | "above" | "unknown";

/** ±15% of the Blueprint node's own target_word_count (unchanged source) counts as "within target" — a hard exact match would flag almost every real section. */
function wordCountState(actual: number, target: number | null): WordCountState {
  if (target == null || actual === 0) return "unknown";
  const ratio = actual / target;
  if (ratio < 0.85) return "below";
  if (ratio > 1.15) return "above";
  return "within";
}

/** Same "warning" tone for both directions (no new color system) — direction is distinguished by an arrow glyph and explicit wording, not color. */
function wordCountBadge(state: WordCountState): { label: string; tone: "success" | "warning" | "neutral" } | null {
  if (state === "within") return { label: "Within target", tone: "success" };
  if (state === "below") return { label: "↓ Below target", tone: "warning" };
  if (state === "above") return { label: "↑ Above target", tone: "warning" };
  return null;
}

// --- minimal Markdown toolbar (Part 2) ----------------------------------
//
// Operates directly on the plain-text/Markdown textarea — no rich-text
// editor framework. Storage format (content_versions.body, plain
// Markdown) is unchanged; these buttons only insert/wrap Markdown
// syntax at the current selection, same as typing it by hand.

interface EditResult {
  body: string;
  selectionStart: number;
  selectionEnd: number;
}

function wrapSelection(body: string, start: number, end: number, before: string, after: string, placeholder: string): EditResult {
  const selected = body.slice(start, end) || placeholder;
  const newBody = body.slice(0, start) + before + selected + after + body.slice(end);
  const selectionStart = start + before.length;
  return { body: newBody, selectionStart, selectionEnd: selectionStart + selected.length };
}

/** Prefixes every line touched by the current selection — used for headings and lists. `stripHeading` removes an existing leading "#" run first, so re-applying H2/H3 doesn't stack markers. */
function prefixLines(
  body: string,
  start: number,
  end: number,
  makePrefix: (lineIndex: number) => string,
  stripHeading: boolean,
): EditResult {
  const lineStart = body.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = body.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? body.length : nextBreak;

  const block = body.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const newLines = lines.map((line, i) => {
    const cleaned = stripHeading ? line.replace(/^#{1,6}\s*/, "") : line;
    return makePrefix(i) + cleaned;
  });
  const newBlock = newLines.join("\n");

  const newBody = body.slice(0, lineStart) + newBlock + body.slice(lineEnd);
  const firstPrefixLength = makePrefix(0).length;
  return { body: newBody, selectionStart: lineStart + firstPrefixLength, selectionEnd: lineStart + newBlock.length };
}

function insertLink(body: string, start: number, end: number): EditResult {
  const selected = body.slice(start, end) || "link text";
  const insertion = `[${selected}](https://)`;
  const newBody = body.slice(0, start) + insertion + body.slice(end);
  const urlStart = start + selected.length + 3;
  return { body: newBody, selectionStart: urlStart, selectionEnd: urlStart + "https://".length };
}

type ToolbarAction = "bold" | "italic" | "h2" | "h3" | "ul" | "ol" | "link";

function applyToolbarAction(action: ToolbarAction, body: string, start: number, end: number): EditResult {
  switch (action) {
    case "bold":
      return wrapSelection(body, start, end, "**", "**", "bold text");
    case "italic":
      return wrapSelection(body, start, end, "*", "*", "italic text");
    case "h2":
      return prefixLines(body, start, end, () => "## ", true);
    case "h3":
      return prefixLines(body, start, end, () => "### ", true);
    case "ul":
      return prefixLines(body, start, end, () => "- ", false);
    case "ol":
      return prefixLines(body, start, end, (i) => `${i + 1}. `, false);
    case "link":
      return insertLink(body, start, end);
  }
}

const TOOLBAR_BUTTONS: { action: ToolbarAction; label: string; icon: typeof Bold }[] = [
  { action: "bold", label: "Bold", icon: Bold },
  { action: "italic", label: "Italic", icon: Italic },
  { action: "h2", label: "Heading 2", icon: Heading2 },
  { action: "h3", label: "Heading 3", icon: Heading3 },
  { action: "ul", label: "Bulleted list", icon: List },
  { action: "ol", label: "Numbered list", icon: ListOrdered },
  { action: "link", label: "Link", icon: LinkIcon },
];

function FieldCard({
  title,
  provenance,
  children,
}: {
  title: string;
  provenance: "research" | "ai" | "user" | "system";
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="text-[14.5px] font-semibold text-text-primary">{title}</span>
        <ProvenanceBadge source={provenance} />
      </div>
      {children}
    </Card>
  );
}

/**
 * BD6's UI-communication fix (docs/architecture/phase-4-4-blueprint-plan.md
 * §19) — the two states this task requires, mutually exclusive:
 *
 * 1. Current Blueprint version has no Content, but an earlier version
 *    does: explains where it went (still safely stored, never deleted
 *    or migrated) and offers two actions — view it read-only, or start
 *    generating for the current version. Neither action writes
 *    anything; "Generate" only moves selection to the first section,
 *    the existing per-section Generate flow (unchanged) does the rest.
 * 2. Current Blueprint version has no Content and none ever existed:
 *    the simple empty state, no mention of a prior version.
 */
function NoCurrentContentNotice({
  previousContentInfo,
  onSelectFirstSection,
}: {
  previousContentInfo: PreviousContentInfo | null;
  onSelectFirstSection: () => void;
}) {
  const [showPrevious, setShowPrevious] = useState(false);

  if (!previousContentInfo) {
    return (
      <Card>
        <p className="text-sm text-text-secondary">No Content generated yet.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[10px] border border-status-warning-fg/30 bg-status-warning-bg px-4 py-3 text-[12.5px] text-status-warning-fg">
        <p className="font-semibold">This Blueprint version does not have Content yet.</p>
        <p>
          Your existing Content is still safely stored under Blueprint version {previousContentInfo.blueprintVersionNumber}.
          It was not deleted — a Blueprint edit or regeneration created a new version, and Content must be generated
          again for its sections.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowPrevious((v) => !v)}>
            {showPrevious ? "Hide" : "View"} previous Blueprint content
          </Button>
          <Button size="sm" onClick={onSelectFirstSection}>
            Generate Content for this Blueprint
          </Button>
        </div>
      </div>

      {showPrevious ? (
        <Card>
          <p className="mb-3 text-[13px] font-semibold text-text-primary">
            Content from Blueprint version {previousContentInfo.blueprintVersionNumber} (read-only)
          </p>
          <div className="flex flex-col gap-4">
            {previousContentInfo.sections.map((s, i) => (
              <div key={i} className="border-b border-border pb-3 last:border-b-0 last:pb-0">
                <p className="mb-1.5 text-[13px] font-semibold text-text-secondary">{s.title}</p>
                <div className="text-[13px] leading-relaxed text-text-secondary">{renderMarkdown(s.body)}</div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * LEAVES-01 — "Section Blueprint" / Blueprint context panel. Purely
 * read-only: every field shown here is already editable in the
 * Blueprint Review tab's own inspector (`blueprint-review.tsx`) —
 * this component never duplicates that editing surface, it only
 * surfaces the same already-fetched fields for reference while
 * writing, so a writer doesn't have to tab-switch to recall the
 * section's goal/entities/evidence requirement. Collapsed by default
 * (Toyota "keep the writing body visually dominant" + the task's own
 * "collapsed by default is acceptable" allowance) — one click expands
 * it, no page reload, no new query.
 */
function SectionBlueprintContext({
  context,
  blueprintVersionNumber,
}: {
  context: ContentSectionBlueprintContext;
  blueprintVersionNumber: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <span className="text-[14.5px] font-semibold text-text-primary">Blueprint context</span>
          <ProvenanceBadge source="ai" />
        </div>
        <span className="text-[11px] font-semibold text-text-muted">{expanded ? "Hide" : "Show"}</span>
      </button>

      {expanded ? (
        <div className="mt-3 flex flex-col gap-3 text-[12.5px]">
          {context.goal ? (
            <div>
              <div className="mb-0.5 font-semibold text-text-secondary">Goal</div>
              <p className="text-text-secondary">{context.goal}</p>
            </div>
          ) : null}

          {context.entities.length > 0 ? (
            <div>
              <div className="mb-1 font-semibold text-text-secondary">Entities</div>
              <div className="flex flex-wrap gap-1.5">
                {context.entities.map((entity, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center rounded-[6px] border border-border bg-elevated px-2 py-[3px] text-[11px] text-text-secondary"
                  >
                    {entity}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {context.researchSupport ? (
            <div>
              <div className="mb-0.5 font-semibold text-text-secondary">Research support</div>
              <p className="text-text-secondary">{context.researchSupport}</p>
            </div>
          ) : null}

          {context.uniqueContribution ? (
            <div>
              <div className="mb-0.5 font-semibold text-text-secondary">Unique contribution</div>
              <p className="text-text-secondary">{context.uniqueContribution}</p>
            </div>
          ) : null}

          {context.evidenceRequirement ? (
            <div>
              <div className="mb-0.5 font-semibold text-text-secondary">Evidence requirement</div>
              <p className="text-text-secondary">{context.evidenceRequirement}</p>
            </div>
          ) : null}

          {context.internalLinkTargets.length > 0 ? (
            <div>
              <div className="mb-1 font-semibold text-text-secondary">Internal link targets</div>
              <div className="flex flex-col gap-1">
                {context.internalLinkTargets.map((link, i) => (
                  <div key={i} className="font-mono text-[11px] text-text-secondary">
                    {link.anchorText} &rarr; {link.targetUrl ?? "(unresolved)"}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-4 border-t border-border pt-2.5 text-[11.5px] text-text-muted">
            <span>
              Target word count: <span className="font-mono text-text-secondary">{context.targetWordCount ?? "—"}</span>
            </span>
            <span>
              Blueprint version: <span className="font-mono text-text-secondary">{blueprintVersionNumber}</span>
            </span>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * QU12 (docs/architecture/phase-4-6-qa-ui-plan.md, locked QA-11) —
 * "Review issue": a temporary, dismissible, finding-specific QA
 * diagnostic panel. Never a second QA-report view — exactly one
 * finding's context, built entirely from data already in hand
 * (`finding`, the QA tab's own already-fetched `qa_findings` row; the
 * selected section's own `blueprintContext`, LEAVES-01) — zero new
 * queries. Deliberately separate from `SectionBlueprintContext`
 * (never merged) and rendered above it, per QU12's own locked
 * requirement 4.
 */
const QA_ISSUE_CATEGORY_LABEL: Record<QaFindingDetail["category"], string> = {
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

/** Deterministic, template-based only — never AI-generated, never a button that mutates content (QU12 requirement 5/6). */
function suggestedActionFor(category: QaFindingDetail["category"]): string {
  switch (category) {
    case "entities":
    case "topics":
      return "Consider mentioning the missing concept naturally if it is relevant to this section.";
    case "links":
      return "Check whether an appropriate internal link should be added or corrected.";
    case "brand":
    case "forbidden_chars":
      return "Remove or rephrase the flagged text, then re-run QA.";
    case "factual":
      return "Verify this claim against the section's supporting evidence, or soften/remove it if unsupported.";
    case "structure":
      return "Review the section against its target word count and the Blueprint's expected outline.";
    case "intent":
    case "style":
      return "Review the whole document; this finding isn't tied to one section alone.";
  }
}

function QaIssuePanel({
  finding,
  blueprintContext,
  onDismiss,
}: {
  finding: QaFindingDetail;
  blueprintContext: ContentSectionBlueprintContext;
  onDismiss: () => void;
}) {
  const tone = finding.status === "fail" ? "danger" : finding.status === "warn" ? "warning" : "success";
  const label = finding.status === "fail" ? "Fail" : finding.status === "warn" ? "Warn" : "Pass";

  return (
    <Card className="border-primary/40">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[14.5px] font-semibold text-text-primary">QA issue</span>
          <StatusBadge tone={tone}>{label}</StatusBadge>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[11px] font-semibold text-text-muted hover:text-text-secondary"
        >
          Dismiss
        </button>
      </div>

      <div className="flex flex-col gap-3 text-[12.5px]">
        {/* A. What QA evaluated */}
        <div>
          <div className="mb-0.5 font-semibold text-text-secondary">What QA evaluated</div>
          <p className="text-text-secondary">{QA_ISSUE_CATEGORY_LABEL[finding.category]}</p>
        </div>

        {/* B. What the Blueprint expected — category-specific, only what's actually available */}
        {finding.category === "entities" && blueprintContext.entities.length > 0 ? (
          <div>
            <div className="mb-1 font-semibold text-text-secondary">What the Blueprint expected</div>
            <div className="flex flex-wrap gap-1.5">
              {blueprintContext.entities.map((entity, i) => (
                <span
                  key={i}
                  className="inline-flex items-center rounded-[6px] border border-border bg-elevated px-2 py-[3px] text-[11px] text-text-secondary"
                >
                  {entity}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {finding.category === "links" && blueprintContext.internalLinkTargets.length > 0 ? (
          <div>
            <div className="mb-1 font-semibold text-text-secondary">Expected internal link targets</div>
            <div className="flex flex-col gap-1">
              {blueprintContext.internalLinkTargets.map((link, i) => (
                <div key={i} className="font-mono text-[11px] text-text-secondary">
                  {link.anchorText} &rarr; {link.targetUrl ?? "(unresolved)"}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {(finding.category === "topics" || finding.category === "structure") && blueprintContext.goal ? (
          <div>
            <div className="mb-0.5 font-semibold text-text-secondary">What the Blueprint expected</div>
            <p className="text-text-secondary">{blueprintContext.goal}</p>
          </div>
        ) : null}

        {/* C/D/E. Detected / missing / why — the honest source is the finding's own persisted note+quote; never re-parsed into invented structured sub-fields */}
        <div>
          <div className="mb-0.5 font-semibold text-text-secondary">
            {finding.status === "pass" ? "What was detected" : "What's missing or problematic, and why"}
          </div>
          <p className="text-text-secondary">{finding.note ?? "(no explanation recorded)"}</p>
        </div>

        {finding.quote ? (
          <div>
            <div className="mb-0.5 font-semibold text-text-secondary">Quoted evidence</div>
            <blockquote className="border-l-2 border-border pl-2.5 font-mono text-[11.5px] italic text-text-muted">
              &ldquo;{finding.quote}&rdquo;
            </blockquote>
          </div>
        ) : null}

        {/* F. Suggested action — deterministic template only, never AI-generated, never auto-applied */}
        {finding.status !== "pass" ? (
          <div>
            <div className="mb-0.5 font-semibold text-text-secondary">Suggested action</div>
            <p className="text-text-secondary">{suggestedActionFor(finding.category)}</p>
          </div>
        ) : null}
      </div>

      <p className="mt-3 border-t border-border pt-2.5 text-[11px] text-text-muted">
        Use Edit or Regenerate below to address this — this panel never edits content itself.
      </p>
    </Card>
  );
}

export function ContentEditor({
  projectId,
  canManage,
  sections,
  previousContentInfo,
  initialSelectedSectionId,
  initialQaFinding,
  currentQaFindingsBySection,
}: ContentEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedSectionId ?? sections[0]?.blueprintNodeId ?? null,
  );
  // QU12 — temporary, dismissible, finding-specific QA context. Seeded
  // once from `initialQaFinding` (the "Review issue" entry path);
  // cleared on any editing action, explicit dismissal, or picking an
  // unrelated section from the sidebar (`onSelect`, below) — never a
  // persistent Content Editor feature.
  const [activeQaFinding, setActiveQaFinding] = useState<QaFindingDetail | null>(initialQaFinding ?? null);
  const selected = useMemo(
    () => sections.find((s) => s.blueprintNodeId === selectedId) ?? null,
    [sections, selectedId],
  );

  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState("");
  const [instruction, setInstruction] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const [editPending, startEdit] = useTransition();
  const [approvePending, startApprove] = useTransition();
  const [regeneratePending, startRegenerate] = useTransition();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);

  // Restores the cursor/selection after a toolbar action, once React
  // has committed the new draftBody to the (controlled) textarea —
  // setSelectionRange only works once the DOM value actually matches.
  useLayoutEffect(() => {
    if (pendingSelectionRef.current && textareaRef.current) {
      const { start, end } = pendingSelectionRef.current;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(start, end);
      pendingSelectionRef.current = null;
    }
  }, [draftBody]);

  function onToolbarAction(action: ToolbarAction) {
    const el = textareaRef.current;
    if (!el) return;
    const result = applyToolbarAction(action, draftBody, el.selectionStart, el.selectionEnd);
    pendingSelectionRef.current = { start: result.selectionStart, end: result.selectionEnd };
    setDraftBody(result.body);
  }

  function onSelect(id: string) {
    setSelectedId(id);
    setEditing(false);
    setActionError(null);
    // QU12 — a different section chosen from the sidebar is unrelated
    // to whatever finding the panel was showing; close it rather than
    // leave a stale finding's context attached to a new section.
    setActiveQaFinding(null);
  }

  function onStartEdit() {
    if (!selected?.currentVersion) return;
    setDraftBody(selected.currentVersion.body);
    setEditing(true);
    setActionError(null);
    setActiveQaFinding(null);
  }

  function onCancelEdit() {
    setEditing(false);
    setActiveQaFinding(null);
  }

  function onSaveEdit() {
    if (!selected) return;
    setActionError(null);
    startEdit(async () => {
      try {
        await editContentVersion(projectId, selected.blueprintNodeId, draftBody);
        setEditing(false);
        setActiveQaFinding(null);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Failed to save this edit.");
      }
    });
  }

  function onApprove() {
    if (!selected?.currentVersion) return;
    setActionError(null);
    startApprove(async () => {
      try {
        await approveContentVersion(projectId, selected.currentVersion!.id);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Failed to approve this section.");
      }
    });
  }

  function onRegenerate() {
    if (!selected) return;
    setActionError(null);
    setActiveQaFinding(null);
    startRegenerate(async () => {
      try {
        await generateContentSection(projectId, selected.blueprintNodeId, instruction.trim() || undefined);
        setInstruction("");
        setEditing(false);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Failed to regenerate this section.");
      }
    });
  }

  if (sections.length === 0) {
    return (
      <Card>
        <p className="text-sm text-text-secondary">
          No sections available yet — the approved Blueprint has no leaf sections to generate Content for.
        </p>
      </Card>
    );
  }

  const sectionFindings = (selected && currentQaFindingsBySection?.[selected.blueprintNodeId]) || [];

  const status = selected ? sectionStatus(selected) : "not_generated";
  // Live: while editing, this reflects draftBody on every keystroke
  // (Part 1) — it never waits for Save. Outside editing, it reflects
  // the persisted current version, same as before.
  const liveBody = editing ? draftBody : (selected?.currentVersion?.body ?? "");
  const actualWords = wordCount(liveBody);
  const target = selected?.targetWordCount ?? null;
  const wcState = wordCountState(actualWords, target);
  const wcBadge = wordCountBadge(wcState);
  const currentHasNoContent = sections.every((s) => s.currentVersion === null);

  return (
    <div className="flex min-w-0 flex-1 gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4 pb-4">
        {currentHasNoContent ? (
          <NoCurrentContentNotice
            previousContentInfo={previousContentInfo}
            onSelectFirstSection={() => sections[0] && onSelect(sections[0].blueprintNodeId)}
          />
        ) : null}

        {selected ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold text-text-primary">{selected.title}</span>
                <StatusBadge tone={statusBadgeTone(status)}>{statusBadgeLabel(status)}</StatusBadge>
                {selected.currentVersion ? (
                  <span className="text-xs font-semibold text-text-secondary">Version {selected.currentVersion.version}</span>
                ) : null}
              </div>
            </div>

            <p className="font-mono text-[11px] text-text-muted">
              Blueprint version {selected.blueprintVersionNumber} · Brief version {selected.briefVersionNumber} · Blueprint
              node {selected.blueprintNodeId}
            </p>

            {selected.latestFailedError && !selected.currentVersion ? (
              <div className="rounded-[10px] border border-status-danger-fg/30 bg-status-danger-bg px-4 py-3 text-[12.5px] text-status-danger-fg">
                <div className="mb-0.5 font-semibold">Generation failed</div>
                <div>{selected.latestFailedError.message}</div>
              </div>
            ) : null}

            {actionError ? <p className="text-xs text-status-danger-fg">{actionError}</p> : null}

            {sectionFindings.length > 0 ? (
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-text-secondary">
                    {sectionFindings.length} current QA finding{sectionFindings.length === 1 ? "" : "s"} for this section
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {sectionFindings.map((f) => {
                    const isActive = activeQaFinding?.id === f.id;
                    const tone = f.status === "fail" ? "danger" : f.status === "warn" ? "warning" : "success";
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setActiveQaFinding(f)}
                        className={
                          "flex items-center gap-1.5 rounded-[6px] border px-2 py-1 text-[11px] font-semibold transition-colors " +
                          (isActive
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-text-secondary hover:bg-elevated")
                        }
                      >
                        {QA_ISSUE_CATEGORY_LABEL[f.category]}
                        <StatusBadge tone={tone}>{f.status === "fail" ? "Fail" : f.status === "warn" ? "Warn" : "Pass"}</StatusBadge>
                      </button>
                    );
                  })}
                </div>
              </Card>
            ) : null}

            {activeQaFinding ? (
              <QaIssuePanel
                finding={activeQaFinding}
                blueprintContext={selected.blueprintContext}
                onDismiss={() => setActiveQaFinding(null)}
              />
            ) : null}

            <SectionBlueprintContext context={selected.blueprintContext} blueprintVersionNumber={selected.blueprintVersionNumber} />

            <Card>
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <span className="text-[14.5px] font-semibold text-text-primary">Section body</span>
                {selected.currentVersion ? <ProvenanceBadge source="ai" label="AI-generated" /> : null}
              </div>

              {editing ? (
                <div className="flex flex-col gap-2.5">
                  <div className="flex flex-wrap gap-1 rounded-[8px] border border-border bg-elevated p-1">
                    {TOOLBAR_BUTTONS.map(({ action, label, icon: Icon }) => (
                      <button
                        key={action}
                        type="button"
                        title={label}
                        aria-label={label}
                        onClick={() => onToolbarAction(action)}
                        className="flex size-7 items-center justify-center rounded-[6px] text-text-secondary hover:bg-card hover:text-text-primary"
                      >
                        <Icon className="size-4" />
                      </button>
                    ))}
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                    rows={14}
                    className="w-full rounded-[10px] border border-border bg-elevated p-3 font-sans text-[13.5px] leading-relaxed text-text-primary outline-none focus:border-primary"
                  />
                  <div className="flex gap-2">
                    <Button onClick={onSaveEdit} disabled={editPending}>
                      {editPending ? "Saving…" : "Save"}
                    </Button>
                    <Button variant="outline" onClick={onCancelEdit} disabled={editPending}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : selected.currentVersion ? (
                <div className="text-[13.5px] leading-relaxed text-text-secondary">
                  {renderMarkdown(selected.currentVersion.body)}
                </div>
              ) : (
                <p className="text-[12.5px] text-text-muted italic">
                  No Content has been generated for this section yet.
                </p>
              )}
            </Card>

            <FieldCard title="Word count" provenance="system">
              <div className="flex flex-wrap items-center gap-3 text-[13px]">
                <span className="font-mono text-text-secondary">
                  {actualWords} words {target != null ? `/ target ${target}` : ""}
                </span>
                {wcBadge ? <StatusBadge tone={wcBadge.tone}>{wcBadge.label}</StatusBadge> : null}
                {editing ? <span className="text-[11px] text-text-muted">updates live as you type</span> : null}
              </div>
            </FieldCard>

            <FieldCard title="Evidence used" provenance="ai">
              {selected.evidenceUsed === null ? (
                <p className="text-[12.5px] text-text-muted italic">Evidence provenance not available for this version.</p>
              ) : selected.evidenceUsed.length === 0 ? (
                <p className="text-[12.5px] text-text-muted italic">No research evidence was used for this section.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {selected.evidenceUsed.map((ref, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center rounded-[6px] border border-border bg-elevated px-2 py-[3px] font-mono text-[11px] text-text-secondary"
                    >
                      {ref}
                    </span>
                  ))}
                </div>
              )}
            </FieldCard>

            {selected.previousVersions.length > 1 ? (
              <Card>
                <div className="mb-2.5 text-[13px] font-semibold text-text-primary">Version history</div>
                <div className="flex flex-col">
                  {selected.previousVersions.map((v) => (
                    <div key={v.id} className="flex items-center justify-between border-b border-border py-2 text-xs last:border-b-0">
                      <span className="font-semibold text-text-secondary">
                        Version {v.version}
                        {selected.currentVersion?.id === v.id ? " · Current" : ""}
                      </span>
                      <div className="flex items-center gap-2">
                        <StatusBadge tone={v.status === "approved" ? "success" : "waiting"}>
                          {v.status === "approved" ? "Approved" : "Draft"}
                        </StatusBadge>
                        <span className="font-mono text-text-muted">{formatDate(v.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-text-muted">Previous versions are immutable and shown read-only.</p>
              </Card>
            ) : null}

            {canManage ? (
              <Card>
                <div className="mb-2.5 text-[13px] font-semibold text-text-primary">Regenerate with instructions</div>
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder='e.g. "Make this more specific to small businesses and remove the generic opening."'
                  rows={2}
                  className="mb-2.5 w-full rounded-[10px] border border-border bg-elevated p-2.5 font-sans text-[12.5px] text-text-primary outline-none focus:border-primary"
                />
                <div className="flex flex-wrap gap-2">
                  {!editing ? (
                    <Button variant="outline" onClick={onStartEdit} disabled={!selected.currentVersion}>
                      Edit
                    </Button>
                  ) : null}
                  <Button variant="outline" onClick={onRegenerate} disabled={regeneratePending}>
                    {regeneratePending ? "Regenerating…" : selected.currentVersion ? "Regenerate section" : "Generate section"}
                  </Button>
                  <Button onClick={onApprove} disabled={approvePending || !selected.currentVersion || status === "approved"}>
                    {approvePending ? "Approving…" : "Approve section"}
                  </Button>
                </div>
              </Card>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="flex w-[300px] shrink-0 flex-col gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">Sections</div>
        <Card className="flex flex-col gap-1 p-2">
          {sections.map((s) => {
            const st = sectionStatus(s);
            const active = s.blueprintNodeId === selectedId;
            return (
              <button
                key={s.blueprintNodeId}
                type="button"
                onClick={() => onSelect(s.blueprintNodeId)}
                className={
                  "flex items-center justify-between gap-2 rounded-[8px] px-2.5 py-2 text-left text-[12.5px] transition-colors " +
                  (active ? "bg-status-success-bg font-semibold text-status-success-fg" : "text-text-secondary hover:bg-elevated")
                }
              >
                <span className="truncate">{s.title}</span>
                <StatusBadge tone={statusBadgeTone(st)} className="shrink-0">
                  {statusBadgeLabel(st)}
                </StatusBadge>
              </button>
            );
          })}
        </Card>
      </div>
    </div>
  );
}
