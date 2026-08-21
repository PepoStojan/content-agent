"use client";

import { FileText, Hash, HelpCircle, ListTree, Sparkles } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/design-system/card";
import { Chip } from "@/components/design-system/chip";
import { ProvenanceBadge } from "@/components/design-system/provenance-badge";
import { StatusBadge } from "@/components/design-system/status-badge";
import { StickyApprovalFooter } from "@/components/design-system/sticky-approval-footer";
import { formatDate } from "@/lib/format/date";
import { generateBlueprint } from "@/lib/generation/blueprint/generate-blueprint";
import type { Database } from "@/lib/supabase/types";

import { approveBlueprintVersion, editBlueprintNode, requestBlueprintChanges } from "./blueprint-actions";

type BlueprintVersionRow = Database["public"]["Tables"]["blueprint_versions"]["Row"];

export interface BlueprintNodeItem {
  id: string;
  parentId: string | null;
  level: number;
  position: number;
  title: string;
  goal: string | null;
  researchSupport: string | null;
  uniqueContribution: string | null;
  entities: string[];
  internalLinkTargets: { candidateId: string; anchorText: string; reason: string; targetUrl: string | null }[];
  evidenceRequirement: string | null;
  writingNotes: string | null;
  targetWordCount: number | null;
}

export interface BlueprintVersionSummary {
  id: string;
  version: number;
  status: Database["public"]["Enums"]["artifact_version_status"];
  created_at: string;
}

export interface BlueprintReviewProps {
  projectId: string;
  canManage: boolean;
  projectStatus: Database["public"]["Enums"]["project_status"];
  currentVersion: BlueprintVersionRow | null;
  nodes: BlueprintNodeItem[];
  previousVersions: BlueprintVersionSummary[];
  /** The exact Brief version this Blueprint version was generated from (BD1 lineage), independent of what's current now. */
  sourceBriefVersion: { id: string; version: number } | null;
  /** The project's current Brief version number, to detect staleness (plan §9) — null if none exists. */
  currentBriefVersionNumber: number | null;
  /** The exact approved brief_versions.id to generate/regenerate against — never resolved dynamically inside this component. Null if no approved Brief exists. */
  approvedBriefVersionId: string | null;
  wordCountWarning: string | null;
  latestFailedError: { type: string; message: string } | null;
}

// --- field group header (visual hierarchy, goal 2) ----------------------
// Same small-uppercase-label pattern already used elsewhere in this app
// (e.g. content-editor.tsx's "SECTIONS" sidebar label) — no new design
// language, just applied here to group the inspector's fields.

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

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
        <span className="text-[13px] font-semibold text-text-primary">{title}</span>
        <ProvenanceBadge source={provenance} />
      </div>
      {children}
    </Card>
  );
}

function ChipList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-[12.5px] text-text-muted italic">No entities assigned to this section.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((label, i) => (
        <Chip key={i} tabIndex={-1} className="cursor-default hover:border-border">
          {label}
        </Chip>
      ))}
    </div>
  );
}

const inputClass =
  "w-full rounded-[8px] border border-border bg-elevated px-2.5 py-2 font-sans text-[13px] text-text-primary outline-none focus:border-primary";
const textareaClass = inputClass + " leading-relaxed";

function GenerateBlueprintControl({
  projectId,
  briefVersionId,
  label,
  errorContext,
}: {
  projectId: string;
  briefVersionId: string;
  label: string;
  errorContext: { type: string; message: string } | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      try {
        await generateBlueprint(projectId, briefVersionId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to generate the Blueprint.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {errorContext ? (
        <div className="rounded-[10px] border border-status-danger-fg/30 bg-status-danger-bg px-4 py-3 text-[12.5px] text-status-danger-fg">
          <div className="mb-0.5 font-semibold">Generation failed</div>
          <div>{errorContext.message}</div>
        </div>
      ) : null}
      <Button onClick={onClick} disabled={pending} className="self-start">
        {pending ? "Generating…" : label}
      </Button>
      {error ? <p className="text-xs text-status-danger-fg">{error}</p> : null}
    </div>
  );
}

// --- tree with computed depth + kind (goals 3, 4) -----------------------
//
// Depth is computed here from actual parent/child structure rather than
// trusted from the stored `level` column, so the tree's visual hierarchy
// never depends on a backend convention this UI pass doesn't control.
// "Kind" is a purely presentational classification (never persisted,
// never sent back to the server) used only to pick a subtle icon/weight
// — a cosmetic reading of the title text, not a new data model.

type NodeKind = "overview" | "conclusion" | "question" | "section" | "subsection";

interface TreeNode extends BlueprintNodeItem {
  children: TreeNode[];
  depth: number;
}

function buildTree(nodes: BlueprintNodeItem[]): TreeNode | null {
  const byId = new Map<string, TreeNode>(nodes.map((n) => [n.id, { ...n, children: [], depth: 0 }]));
  let root: TreeNode | null = null;
  for (const node of byId.values()) {
    if (node.parentId === null) {
      root = node;
    } else {
      byId.get(node.parentId)?.children.push(node);
    }
  }
  function assignDepth(node: TreeNode, depth: number) {
    node.depth = depth;
    node.children.sort((a, b) => a.position - b.position);
    for (const child of node.children) assignDepth(child, depth + 1);
  }
  if (root) assignDepth(root, 0);
  return root;
}

function describeNodeKind(node: TreeNode): NodeKind {
  if (node.depth === 0) return "overview";
  const title = node.title.trim();
  if (/^conclusion\b/i.test(title)) return "conclusion";
  if (/^faq\b/i.test(title) || title.endsWith("?")) return "question";
  return node.depth === 1 ? "section" : "subsection";
}

const KIND_ICON: Record<NodeKind, typeof Hash> = {
  overview: FileText,
  section: Hash,
  subsection: ListTree,
  question: HelpCircle,
  conclusion: Sparkles,
};

function TreeRow({
  node,
  selectedId,
  onSelect,
}: {
  node: TreeNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const isSelected = node.id === selectedId;
  const kind = describeNodeKind(node);
  const Icon = KIND_ICON[kind];
  const isRoot = node.depth === 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        style={{ paddingLeft: `${8 + node.depth * 16}px` }}
        className={
          "flex w-full items-center justify-between gap-2 rounded-[8px] py-1.5 pr-2 text-left text-[12.5px] transition-colors " +
          (isSelected
            ? "bg-status-success-bg font-semibold text-status-success-fg"
            : isRoot
              ? "font-semibold text-text-primary hover:bg-elevated"
              : "text-text-secondary hover:bg-elevated")
        }
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon className={"size-3.5 shrink-0 " + (isSelected ? "text-status-success-fg" : "text-text-muted")} />
          <span className="flex min-w-0 flex-col">
            {isRoot ? (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Article overview</span>
            ) : null}
            <span className="truncate">{node.title}</span>
          </span>
        </span>
        {node.children.length === 0 ? (
          <span className="shrink-0 font-mono text-[10px] text-text-muted">{node.targetWordCount ?? 0}w</span>
        ) : null}
      </button>
      {isRoot ? <div className="my-1 border-b border-border" /> : null}
      {node.children.map((child) => (
        <TreeRow key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}

// --- manual node edit form (goal 1, BD5) --------------------------------
//
// Field-level only: title/goal/research_support/unique_contribution/
// entities/internal_link_targets/evidence_requirement/writing_notes/
// target_word_count. No structural editing (add/delete/reorder/
// re-parent) is offered here — parent_id/level/position never appear
// in this form and are never sent to editBlueprintNode. No AI call.

interface EditDraft {
  title: string;
  goal: string;
  researchSupport: string;
  uniqueContribution: string;
  entitiesText: string;
  links: { candidateId: string; anchorText: string; reason: string; targetUrl: string | null }[];
  evidenceRequirement: string;
  writingNotes: string;
  targetWordCount: string;
}

function draftFromNode(node: BlueprintNodeItem): EditDraft {
  return {
    title: node.title,
    goal: node.goal ?? "",
    researchSupport: node.researchSupport ?? "",
    uniqueContribution: node.uniqueContribution ?? "",
    entitiesText: node.entities.join("\n"),
    links: node.internalLinkTargets.map((l) => ({ ...l })),
    evidenceRequirement: node.evidenceRequirement ?? "",
    writingNotes: node.writingNotes ?? "",
    targetWordCount: node.targetWordCount != null ? String(node.targetWordCount) : "",
  };
}

export function BlueprintReview({
  projectId,
  canManage,
  projectStatus,
  currentVersion,
  nodes,
  previousVersions,
  sourceBriefVersion,
  currentBriefVersionNumber,
  approvedBriefVersionId,
  wordCountWarning,
  latestFailedError,
}: BlueprintReviewProps) {
  const tree = useMemo(() => buildTree(nodes), [nodes]);
  const [selectedId, setSelectedId] = useState<string | null>(tree?.id ?? null);
  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedId) ?? tree ?? null, [nodes, selectedId, tree]);

  const [approvePending, startApprove] = useTransition();
  const [requestPending, startRequest] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [editPending, startEdit] = useTransition();
  const [editError, setEditError] = useState<string | null>(null);

  function onApprove() {
    if (!currentVersion) return;
    setActionError(null);
    startApprove(async () => {
      try {
        await approveBlueprintVersion(projectId, currentVersion.id);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Failed to approve the Blueprint.");
      }
    });
  }

  function onRequestChanges() {
    setActionError(null);
    startRequest(async () => {
      try {
        await requestBlueprintChanges(projectId);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Failed to request changes.");
      }
    });
  }

  function onSelect(id: string) {
    setSelectedId(id);
    setEditing(false);
    setEditError(null);
  }

  function onStartEdit() {
    if (!selectedNode) return;
    setDraft(draftFromNode(selectedNode));
    setEditing(true);
    setEditError(null);
  }

  function onCancelEdit() {
    setEditing(false);
    setDraft(null);
    setEditError(null);
  }

  function onSaveEdit() {
    if (!selectedNode || !draft) return;
    setEditError(null);
    const targetWordCount = draft.targetWordCount.trim() === "" ? null : Number(draft.targetWordCount);
    if (targetWordCount !== null && (!Number.isFinite(targetWordCount) || targetWordCount < 0)) {
      setEditError("Target word count must be a positive number.");
      return;
    }
    startEdit(async () => {
      try {
        const result = await editBlueprintNode(projectId, selectedNode.id, {
          title: draft.title.trim(),
          goal: draft.goal.trim() || null,
          researchSupport: draft.researchSupport.trim() || null,
          uniqueContribution: draft.uniqueContribution.trim() || null,
          entities: draft.entitiesText
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          internalLinkTargets: draft.links.map(({ candidateId, anchorText, reason }) => ({ candidateId, anchorText, reason })),
          evidenceRequirement: draft.evidenceRequirement.trim() || null,
          writingNotes: draft.writingNotes.trim() || null,
          targetWordCount,
        });
        setEditing(false);
        setDraft(null);
        setSelectedId(result.newBlueprintNodeId);
      } catch (e) {
        setEditError(e instanceof Error ? e.message : "Failed to save this edit.");
      }
    });
  }

  // --- Empty states -------------------------------------------------------

  if (!currentVersion) {
    return (
      <div className="flex max-w-xl flex-col gap-4">
        <Card>
          <p className="mb-1 text-sm font-semibold text-text-primary">No Content Blueprint yet</p>
          <p className="text-sm text-text-secondary">
            Generate a Blueprint from this project&rsquo;s approved Strategy Brief.
          </p>
        </Card>
        {!canManage ? (
          <p className="text-xs text-text-muted">Waiting for a team lead or SEO manager to generate the Blueprint.</p>
        ) : approvedBriefVersionId ? (
          <GenerateBlueprintControl
            projectId={projectId}
            briefVersionId={approvedBriefVersionId}
            label="Generate blueprint"
            errorContext={latestFailedError}
          />
        ) : (
          <p className="text-xs text-text-muted">
            Waiting for the Strategy Brief to be approved before a Blueprint can be generated.
          </p>
        )}
      </div>
    );
  }

  const changesRequested = projectStatus === "blueprint_changes_requested";
  const isApproved = currentVersion.status === "approved";
  const isDraft = currentVersion.status === "draft";
  const isStale = sourceBriefVersion != null && currentBriefVersionNumber != null && sourceBriefVersion.version !== currentBriefVersionNumber;
  const selectedIsRoot = selectedNode != null && selectedNode.parentId === null;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 pb-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-text-secondary">Version {currentVersion.version}</span>
          <span className="inline-flex items-center rounded-pill bg-secondary px-2.5 py-1 text-[11px] font-semibold text-secondary-foreground">
            Current
          </span>
          <StatusBadge tone={isApproved ? "success" : "waiting"}>{isApproved ? "Approved" : "Draft"}</StatusBadge>
          {sourceBriefVersion ? (
            <span className="font-mono text-[11px] text-text-muted">Built from Brief version {sourceBriefVersion.version}</span>
          ) : null}
        </div>
      </div>

      {isStale ? (
        <div className="rounded-[10px] border border-status-warning-fg/30 bg-status-warning-bg px-4 py-3 text-[12.5px] text-status-warning-fg">
          This Blueprint was built from Brief version {sourceBriefVersion?.version}, but Brief version{" "}
          {currentBriefVersionNumber} is now current. Consider regenerating once you&rsquo;re ready.
        </div>
      ) : null}

      {wordCountWarning ? (
        <div className="rounded-[10px] border border-status-warning-fg/30 bg-status-warning-bg px-4 py-3 text-[12.5px] text-status-warning-fg">
          <div className="mb-0.5 font-semibold">Word-count sanity warning</div>
          <div>{wordCountWarning}</div>
        </div>
      ) : null}

      {isApproved && !changesRequested ? (
        <div className="flex items-center justify-between gap-3 rounded-[10px] border border-[#BFE6DA] bg-status-success-bg px-4 py-3">
          <span className="text-[12.5px] font-semibold text-status-success-fg">
            Blueprint approved. Editing a section here creates a new draft version for re-approval.
          </span>
          {canManage ? (
            <Button variant="outline" size="sm" onClick={onRequestChanges} disabled={requestPending}>
              {requestPending ? "…" : "Request changes"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {changesRequested ? (
        <div className="flex flex-col gap-3 rounded-[10px] border border-status-warning-fg/30 bg-status-warning-bg px-4 py-3">
          <span className="text-[12.5px] font-semibold text-status-warning-fg">
            Changes requested. Regenerate the entire Blueprint with AI, or manually edit individual sections below —
            there is no per-section AI regeneration.
          </span>
          {canManage && approvedBriefVersionId ? (
            <GenerateBlueprintControl
              projectId={projectId}
              briefVersionId={approvedBriefVersionId}
              label="Regenerate blueprint"
              errorContext={null}
            />
          ) : null}
        </div>
      ) : null}

      {actionError ? <p className="text-xs text-status-danger-fg">{actionError}</p> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[320px_1fr]">
        <Card className="max-h-[70vh] overflow-y-auto p-2">
          {tree ? <TreeRow node={tree} selectedId={selectedId} onSelect={onSelect} /> : null}
        </Card>

        <div className="flex flex-col gap-4">
          {selectedNode ? (
            <>
              {/* Inspector header — goal 5: the selected tree node and this header always correspond, since both read from the same `selectedId`/`selectedNode`. */}
              <div className="flex items-start justify-between gap-3 rounded-[10px] border border-border bg-card px-4 py-3">
                <div className="flex min-w-0 flex-col gap-1">
                  {selectedIsRoot ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">Article overview</span>
                  ) : null}
                  <span className="truncate text-[15px] font-semibold text-text-primary">{selectedNode.title}</span>
                </div>
                {canManage && !editing ? (
                  <Button variant="outline" size="sm" onClick={onStartEdit} className="shrink-0">
                    Edit
                  </Button>
                ) : null}
              </div>

              {editError ? <p className="text-xs text-status-danger-fg">{editError}</p> : null}

              {editing && draft ? (
                <>
                  <FieldGroup label="Structure">
                    <FieldCard title="Title" provenance="ai">
                      <input
                        className={inputClass}
                        value={draft.title}
                        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      />
                    </FieldCard>
                    <FieldCard title={selectedIsRoot ? "Article goal" : "Section goal"} provenance="ai">
                      <textarea
                        rows={3}
                        className={textareaClass}
                        value={draft.goal}
                        onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
                      />
                    </FieldCard>
                    <FieldCard title="Target word count" provenance="ai">
                      <input
                        type="number"
                        min={0}
                        className={inputClass}
                        value={draft.targetWordCount}
                        onChange={(e) => setDraft({ ...draft, targetWordCount: e.target.value })}
                      />
                    </FieldCard>
                  </FieldGroup>

                  <FieldGroup label="Strategy">
                    <FieldCard title="Unique contribution" provenance="ai">
                      <textarea
                        rows={3}
                        className={textareaClass}
                        value={draft.uniqueContribution}
                        onChange={(e) => setDraft({ ...draft, uniqueContribution: e.target.value })}
                      />
                    </FieldCard>
                  </FieldGroup>

                  <FieldGroup label="Research">
                    <FieldCard title="Research support" provenance="ai">
                      <textarea
                        rows={3}
                        className={textareaClass}
                        value={draft.researchSupport}
                        onChange={(e) => setDraft({ ...draft, researchSupport: e.target.value })}
                      />
                    </FieldCard>
                    <FieldCard title="Entities" provenance="ai">
                      <textarea
                        rows={3}
                        placeholder="One entity per line"
                        className={textareaClass}
                        value={draft.entitiesText}
                        onChange={(e) => setDraft({ ...draft, entitiesText: e.target.value })}
                      />
                    </FieldCard>
                    <FieldCard title="Evidence requirement" provenance="ai">
                      <textarea
                        rows={3}
                        className={textareaClass}
                        value={draft.evidenceRequirement}
                        onChange={(e) => setDraft({ ...draft, evidenceRequirement: e.target.value })}
                      />
                    </FieldCard>
                  </FieldGroup>

                  <FieldGroup label="Links">
                    <FieldCard title="Internal link targets" provenance="ai">
                      {draft.links.length === 0 ? (
                        <p className="text-[12.5px] text-text-muted italic">
                          No internal links proposed for this section.
                        </p>
                      ) : (
                        <div className="flex flex-col gap-3">
                          {draft.links.map((link, i) => (
                            <div key={i} className="flex flex-col gap-1.5 border-b border-border pb-3 last:border-b-0 last:pb-0">
                              <span className="font-mono text-[11px] text-text-muted">
                                {link.targetUrl ?? "(source no longer available)"}
                              </span>
                              <input
                                className={inputClass}
                                placeholder="Anchor text"
                                value={link.anchorText}
                                onChange={(e) => {
                                  const links = [...draft.links];
                                  links[i] = { ...links[i], anchorText: e.target.value };
                                  setDraft({ ...draft, links });
                                }}
                              />
                              <textarea
                                rows={2}
                                placeholder="Reason"
                                className={textareaClass}
                                value={link.reason}
                                onChange={(e) => {
                                  const links = [...draft.links];
                                  links[i] = { ...links[i], reason: e.target.value };
                                  setDraft({ ...draft, links });
                                }}
                              />
                              <Button
                                variant="outline"
                                size="sm"
                                className="self-start"
                                onClick={() => setDraft({ ...draft, links: draft.links.filter((_, idx) => idx !== i) })}
                              >
                                Remove link
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </FieldCard>
                  </FieldGroup>

                  <FieldGroup label="Writing">
                    <FieldCard title="Writing notes" provenance="ai">
                      <textarea
                        rows={3}
                        className={textareaClass}
                        value={draft.writingNotes}
                        onChange={(e) => setDraft({ ...draft, writingNotes: e.target.value })}
                      />
                    </FieldCard>
                  </FieldGroup>

                  <div className="flex gap-2">
                    <Button onClick={onSaveEdit} disabled={editPending}>
                      {editPending ? "Saving…" : "Save"}
                    </Button>
                    <Button variant="outline" onClick={onCancelEdit} disabled={editPending}>
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <FieldGroup label="Structure">
                    <FieldCard title={selectedIsRoot ? "Article goal" : "Section goal"} provenance="ai">
                      <p className="text-[13.5px] leading-relaxed text-text-secondary">{selectedNode.goal}</p>
                    </FieldCard>
                    <FieldCard title="Target word count" provenance="ai">
                      <span className="font-mono text-[13px] text-text-secondary">{selectedNode.targetWordCount ?? 0} words</span>
                    </FieldCard>
                  </FieldGroup>

                  <FieldGroup label="Strategy">
                    <FieldCard title="Unique contribution" provenance="ai">
                      <p className="text-[13px] leading-relaxed text-text-secondary">{selectedNode.uniqueContribution}</p>
                    </FieldCard>
                  </FieldGroup>

                  <FieldGroup label="Research">
                    <FieldCard title="Research support" provenance="ai">
                      <p className="text-[13px] leading-relaxed text-text-secondary">{selectedNode.researchSupport}</p>
                    </FieldCard>
                    <FieldCard title="Entities" provenance="ai">
                      <ChipList items={selectedNode.entities} />
                    </FieldCard>
                    <FieldCard title="Evidence requirement" provenance="ai">
                      <p className="text-[13px] leading-relaxed text-text-secondary">{selectedNode.evidenceRequirement}</p>
                    </FieldCard>
                  </FieldGroup>

                  <FieldGroup label="Links">
                    <FieldCard title="Internal link targets" provenance="ai">
                      {selectedNode.internalLinkTargets.length === 0 ? (
                        <p className="text-[12.5px] text-text-muted italic">No internal links proposed for this section.</p>
                      ) : (
                        <div className="flex flex-col">
                          {selectedNode.internalLinkTargets.map((link, i) => (
                            <div key={i} className="flex flex-col gap-0.5 border-b border-border py-2 text-[12.5px] last:border-b-0">
                              <div className="flex justify-between gap-2">
                                <span>{link.anchorText}</span>
                                <span className="font-mono text-primary">{link.targetUrl ?? "(source no longer available)"}</span>
                              </div>
                              <span className="text-[11px] text-text-muted">{link.reason}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </FieldCard>
                  </FieldGroup>

                  <FieldGroup label="Writing">
                    <FieldCard title="Writing notes" provenance="ai">
                      <p className="text-[13px] leading-relaxed text-text-secondary">{selectedNode.writingNotes}</p>
                    </FieldCard>
                  </FieldGroup>
                </>
              )}
            </>
          ) : (
            <Card>
              <p className="text-sm text-text-secondary">Select a section from the tree to inspect it.</p>
            </Card>
          )}
        </div>
      </div>

      {previousVersions.length > 1 ? (
        <Card>
          <div className="mb-2.5 text-[13px] font-semibold text-text-primary">Version history</div>
          <div className="flex flex-col">
            {previousVersions.map((v) => (
              <div key={v.id} className="flex items-center justify-between border-b border-border py-2 text-xs last:border-b-0">
                <span className="font-semibold text-text-secondary">
                  Version {v.version}
                  {v.id === currentVersion.id ? " · Current" : ""}
                </span>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={v.status === "approved" ? "success" : "waiting"}>
                    {v.status === "approved" ? "Approved" : "Draft"}
                  </StatusBadge>
                  <span className="font-mono text-text-muted">{formatDate(v.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            Previous versions are immutable and shown read-only — including versions created by a manual section edit.
          </p>
        </Card>
      ) : null}

      {canManage && isDraft ? (
        <StickyApprovalFooter
          approveLabel={approvePending ? "Approving…" : "Approve blueprint"}
          onRequestChanges={onRequestChanges}
          onApprove={onApprove}
        />
      ) : null}
    </div>
  );
}
