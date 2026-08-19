"use client";

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

import { approveBlueprintVersion, requestBlueprintChanges } from "./blueprint-actions";

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

interface TreeNode extends BlueprintNodeItem {
  children: TreeNode[];
}

function buildTree(nodes: BlueprintNodeItem[]): TreeNode | null {
  const byId = new Map<string, TreeNode>(nodes.map((n) => [n.id, { ...n, children: [] }]));
  let root: TreeNode | null = null;
  for (const node of byId.values()) {
    if (node.parentId === null) {
      root = node;
    } else {
      byId.get(node.parentId)?.children.push(node);
    }
  }
  for (const node of byId.values()) {
    node.children.sort((a, b) => a.position - b.position);
  }
  return root;
}

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
  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        style={{ paddingLeft: `${8 + node.level * 16}px` }}
        className={
          "flex w-full items-center justify-between gap-2 rounded-[8px] py-1.5 pr-2 text-left text-[12.5px] transition-colors " +
          (isSelected ? "bg-status-success-bg font-semibold text-status-success-fg" : "text-text-secondary hover:bg-elevated")
        }
      >
        <span className="truncate">{node.title}</span>
        {node.children.length === 0 ? (
          <span className="shrink-0 font-mono text-[10px] text-text-muted">{node.targetWordCount ?? 0}w</span>
        ) : null}
      </button>
      {node.children.map((child) => (
        <TreeRow key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
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
            Blueprint approved. Locked from further edits here.
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
            Changes requested. The entire Blueprint regenerates as a whole document — there is no per-section AI
            regeneration.
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
          {tree ? <TreeRow node={tree} selectedId={selectedId} onSelect={setSelectedId} /> : null}
        </Card>

        <div className="flex flex-col gap-4">
          {selectedNode ? (
            <>
              <FieldCard title={selectedNode.title} provenance="ai">
                <p className="text-[13.5px] leading-relaxed text-text-secondary">{selectedNode.goal}</p>
              </FieldCard>

              <FieldCard title="Research support" provenance="ai">
                <p className="text-[13px] leading-relaxed text-text-secondary">{selectedNode.researchSupport}</p>
              </FieldCard>

              <FieldCard title="Unique contribution" provenance="ai">
                <p className="text-[13px] leading-relaxed text-text-secondary">{selectedNode.uniqueContribution}</p>
              </FieldCard>

              <FieldCard title="Entities" provenance="ai">
                <ChipList items={selectedNode.entities} />
              </FieldCard>

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

              <FieldCard title="Evidence requirement" provenance="ai">
                <p className="text-[13px] leading-relaxed text-text-secondary">{selectedNode.evidenceRequirement}</p>
              </FieldCard>

              <FieldCard title="Writing notes" provenance="ai">
                <p className="text-[13px] leading-relaxed text-text-secondary">{selectedNode.writingNotes}</p>
              </FieldCard>

              <FieldCard title="Target word count" provenance="ai">
                <span className="font-mono text-[13px] text-text-secondary">{selectedNode.targetWordCount ?? 0} words</span>
              </FieldCard>
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
          <p className="mt-2 text-[11px] text-text-muted">Previous versions are immutable and shown read-only.</p>
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
