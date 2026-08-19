"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/design-system/card";
import { ProvenanceBadge } from "@/components/design-system/provenance-badge";
import { StatusBadge } from "@/components/design-system/status-badge";
import { StickyApprovalFooter } from "@/components/design-system/sticky-approval-footer";
import { formatDate } from "@/lib/format/date";
import { generateStrategyBrief } from "@/lib/generation/brief/generate-strategy-brief";
import type { Database } from "@/lib/supabase/types";

import { approveBriefVersion, requestBriefChanges } from "./brief-actions";

type BriefVersionRow = Database["public"]["Tables"]["brief_versions"]["Row"];

export interface BriefTopicItem {
  id: string;
  label: string;
}

export interface BriefInternalLinkItem {
  id: string;
  anchor_text: string;
  target_url: string;
}

export interface BriefVersionSummary {
  id: string;
  version: number;
  status: Database["public"]["Enums"]["artifact_version_status"];
  created_at: string;
}

export interface BriefReviewProps {
  projectId: string;
  canManage: boolean;
  projectStatus: Database["public"]["Enums"]["project_status"];
  currentVersion: BriefVersionRow | null;
  topics: BriefTopicItem[];
  internalLinks: BriefInternalLinkItem[];
  previousVersions: BriefVersionSummary[];
  latestFailedError: { type: string; message: string } | null;
}

function FieldCard({
  title,
  provenance,
  children,
}: {
  title: string;
  provenance: "research" | "ai" | "user";
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

function TextList({ items }: { items: unknown }) {
  const list = Array.isArray(items) ? (items as unknown[]).filter((v): v is string => typeof v === "string") : [];
  if (list.length === 0) {
    return <p className="text-[12.5px] text-text-muted italic">None specified.</p>;
  }
  return (
    <ul className="list-disc space-y-1.5 pl-[18px] text-[12.5px] leading-relaxed text-text-secondary">
      {list.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function ChipList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-[12.5px] text-text-muted italic">No items available for this Brief.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((label, i) => (
        <span
          key={i}
          className="inline-flex items-center rounded-pill border border-border bg-elevated px-2.5 py-[5px] text-xs text-text-secondary"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function GenerateBriefControl({
  projectId,
  label,
  errorContext,
}: {
  projectId: string;
  label: string;
  errorContext: { type: string; message: string } | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      try {
        await generateStrategyBrief(projectId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to generate the Strategy Brief.");
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

export function BriefReview({
  projectId,
  canManage,
  projectStatus,
  currentVersion,
  topics,
  internalLinks,
  previousVersions,
  latestFailedError,
}: BriefReviewProps) {
  const [approvePending, startApprove] = useTransition();
  const [requestPending, startRequest] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  function onApprove() {
    if (!currentVersion) return;
    setActionError(null);
    startApprove(async () => {
      try {
        await approveBriefVersion(projectId, currentVersion.id);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Failed to approve the Brief.");
      }
    });
  }

  function onRequestChanges() {
    setActionError(null);
    startRequest(async () => {
      try {
        await requestBriefChanges(projectId);
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
          <p className="mb-1 text-sm font-semibold text-text-primary">No Strategy Brief yet</p>
          <p className="text-sm text-text-secondary">
            Generate a Strategy Brief from this project&rsquo;s research, website knowledge, and profiles.
          </p>
        </Card>
        {canManage ? (
          <GenerateBriefControl projectId={projectId} label="Generate strategy brief" errorContext={latestFailedError} />
        ) : (
          <p className="text-xs text-text-muted">
            Waiting for a team lead or SEO manager to generate the Strategy Brief.
          </p>
        )}
      </div>
    );
  }

  const changesRequested = projectStatus === "brief_changes_requested";
  const isApproved = currentVersion.status === "approved";
  const isDraft = currentVersion.status === "draft";

  return (
    <div className="flex max-w-3xl flex-col gap-4 pb-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-secondary">Version {currentVersion.version}</span>
          <span className="inline-flex items-center rounded-pill bg-secondary px-2.5 py-1 text-[11px] font-semibold text-secondary-foreground">
            Current
          </span>
          <StatusBadge tone={isApproved ? "success" : "waiting"}>{isApproved ? "Approved" : "Draft"}</StatusBadge>
        </div>
      </div>

      {isApproved && !changesRequested ? (
        <div className="flex items-center justify-between gap-3 rounded-[10px] border border-[#BFE6DA] bg-status-success-bg px-4 py-3">
          <span className="text-[12.5px] font-semibold text-status-success-fg">
            Brief approved. Locked from further edits here.
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
            Changes requested. Edit this project&rsquo;s research, website knowledge, profiles, or instructions, then
            regenerate — this Brief does not regenerate automatically.
          </span>
          {canManage ? (
            <GenerateBriefControl projectId={projectId} label="Regenerate strategy brief" errorContext={null} />
          ) : null}
        </div>
      ) : null}

      {actionError ? <p className="text-xs text-status-danger-fg">{actionError}</p> : null}

      <FieldCard title="Search intent" provenance="ai">
        <div className="mb-2 flex items-center gap-2.5">
          <span className="text-lg font-bold text-text-primary">{currentVersion.search_intent_label}</span>
          <span className="inline-flex items-center rounded-pill bg-status-success-bg px-2.5 py-[3px] text-[11px] font-semibold text-status-success-fg">
            {currentVersion.search_intent_confidence != null
              ? `${Math.round(currentVersion.search_intent_confidence * 100)}% confidence`
              : "confidence unknown"}
          </span>
        </div>
        <p className="text-[13.5px] leading-relaxed text-text-secondary">{currentVersion.search_intent_rationale}</p>
      </FieldCard>

      <FieldCard title="Target audience" provenance="ai">
        <p className="text-[13.5px] leading-relaxed text-text-secondary">{currentVersion.target_audience}</p>
      </FieldCard>

      <FieldCard title="Content objective" provenance="ai">
        <p className="text-[13.5px] leading-relaxed text-text-secondary">{currentVersion.content_objective}</p>
      </FieldCard>

      <FieldCard title="SERP interpretation" provenance="ai">
        <p className="text-[13.5px] leading-relaxed text-text-secondary">{currentVersion.serp_interpretation}</p>
      </FieldCard>

      <FieldCard title="Common competitor expectations" provenance="ai">
        <p className="text-[13.5px] leading-relaxed text-text-secondary">{currentVersion.common_competitor_expectations}</p>
      </FieldCard>

      <FieldCard title="Unique value / differentiation" provenance="ai">
        <p className="text-[13.5px] leading-relaxed text-text-secondary">{currentVersion.unique_value}</p>
      </FieldCard>

      <FieldCard title="Recommended title, H1 & meta" provenance="ai">
        <div className="flex flex-col gap-2 text-[13px]">
          <div>
            <span className="text-text-muted">Title · </span>
            <span className="font-mono">{currentVersion.title}</span>
          </div>
          <div>
            <span className="text-text-muted">H1 · </span>
            <span className="font-mono">{currentVersion.h1}</span>
          </div>
          <div>
            <span className="text-text-muted">Meta · </span>
            <span className="font-mono text-xs">{currentVersion.meta_description}</span>
          </div>
        </div>
      </FieldCard>

      <FieldCard title="Topics & questions to cover" provenance="research">
        <p className="mb-2.5 text-xs text-text-muted">
          Extracted deterministically from research evidence — not synthesized by the model.
        </p>
        <ChipList items={topics.map((t) => t.label)} />
      </FieldCard>

      <FieldCard title="Secondary topics" provenance="ai">
        <TextList items={currentVersion.secondary_topics} />
      </FieldCard>

      <FieldCard title="Entities & concepts" provenance="ai">
        <TextList items={currentVersion.entities_concepts} />
      </FieldCard>

      <FieldCard title="Questions" provenance="ai">
        <TextList items={currentVersion.questions} />
      </FieldCard>

      <FieldCard title="Internal link plan" provenance="ai">
        {internalLinks.length === 0 ? (
          <p className="text-[12.5px] text-text-muted italic">
            No internal link data available yet — Website Knowledge hasn&rsquo;t been supplied for this project.
          </p>
        ) : (
          <div className="flex flex-col">
            {internalLinks.map((link) => (
              <div key={link.id} className="flex justify-between border-b border-border py-2 text-[12.5px] last:border-b-0">
                <span>{link.anchor_text}</span>
                <span className="font-mono text-primary">{link.target_url}</span>
              </div>
            ))}
          </div>
        )}
      </FieldCard>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FieldCard title="Evidence requirements" provenance="ai">
          <TextList items={currentVersion.evidence_requirements} />
        </FieldCard>
        <FieldCard title="Things to avoid" provenance="ai">
          <TextList items={currentVersion.things_to_avoid} />
        </FieldCard>
      </div>

      <FieldCard title="Business & brand alignment" provenance="ai">
        <p className="text-[13px] leading-relaxed text-text-secondary">{currentVersion.business_brand_alignment}</p>
      </FieldCard>

      <FieldCard title="Research limitations" provenance="ai">
        <p className="text-[13px] leading-relaxed text-text-secondary">
          {currentVersion.research_limitations || "No limitations noted."}
        </p>
      </FieldCard>

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
          approveLabel={approvePending ? "Approving…" : "Approve brief"}
          onRequestChanges={onRequestChanges}
          onApprove={onApprove}
        />
      ) : null}
    </div>
  );
}
