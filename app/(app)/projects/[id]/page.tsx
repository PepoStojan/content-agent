import Link from "next/link";
import { notFound } from "next/navigation";

import { GenerationTestControls } from "@/app/(app)/projects/[id]/generation-test-controls";
import { BlueprintReview, type BlueprintNodeItem } from "@/app/(app)/projects/[id]/blueprint-review";
import { BriefReview } from "@/app/(app)/projects/[id]/brief-review";
import type { ContentSectionDetail } from "@/app/(app)/projects/[id]/content-editor";
import { ProjectTabs } from "@/app/(app)/projects/[id]/project-tabs";
import type { QaFindingDetail, QaReportSummary } from "@/app/(app)/projects/[id]/qa-review";
import { Card } from "@/components/design-system/card";
import { GenerationProgress } from "@/components/design-system/generation-progress";
import { StatusBadge } from "@/components/design-system/status-badge";
import { canManageProfiles, requireProfile } from "@/lib/auth/session";
import { orderNodesByDocumentPosition } from "@/lib/generation/blueprint/tree-order";
import { derivePipelineStage } from "@/lib/generation/derive-pipeline-stage";
import { computeExportGate, type ExportGateResult } from "@/lib/generation/export/gate";
import {
  computeExportSnapshotEligibility,
  deriveExportVerificationTier,
  type ExportData,
} from "@/lib/generation/export/snapshot";
import { computeQaStaleness } from "@/lib/generation/qa/staleness";
import type { GenerationState } from "@/lib/generation/state-machine";
import { projectStatusBadge, type ProjectStatus } from "@/lib/projects/status";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";

/** Statuses reached before a Brief has ever been approved — Blueprint stays locked for all of these. */
const BLUEPRINT_LOCKED_STATUSES = new Set<ProjectStatus>([
  "draft",
  "ingesting",
  "ready_for_brief",
  "brief_generated",
  "brief_changes_requested",
]);

/** Statuses reached before a Blueprint has ever been approved — Content Editor stays locked for all of these (plan §17: unlocks only at blueprint_approved or later). */
const CONTENT_EDITOR_LOCKED_STATUSES = new Set<ProjectStatus>([
  ...BLUEPRINT_LOCKED_STATUSES,
  "brief_approved",
  "blueprint_generated",
  "blueprint_changes_requested",
]);

function asStringArray(value: Json | null): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * `evidenceUsed` is not persisted on `content_versions` (no such
 * column — Content's Zod output schema only maps `body` onto the DB
 * row, per the Phase 4.5 data-contract's "don't invent database
 * fields" rule) or in `generation_runs.metadata`. It is only ever
 * present in the raw provider response that D1 already durably
 * writes to Storage before any parse is attempted
 * (`generation_runs.output_ref`). Reading it back here is UI-layer,
 * best-effort display logic — it does not touch, call, or modify any
 * Content generation backend code. Returns null (never throws) on any
 * failure, so a Storage hiccup degrades the display, not the page.
 */
async function getEvidenceUsedFromOutputRef(
  supabase: SupabaseServerClient,
  outputRef: Json | null,
): Promise<string[] | null> {
  if (!outputRef || typeof outputRef !== "object" || Array.isArray(outputRef)) return null;
  const bucket = (outputRef as { bucket?: unknown }).bucket;
  const path = (outputRef as { path?: unknown }).path;
  if (typeof bucket !== "string" || typeof path !== "string") return null;

  try {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) return null;
    const raw = JSON.parse(await data.text());
    const content = Array.isArray(raw?.content) ? raw.content : [];
    const toolUse = content.find((block: { type?: unknown }) => block?.type === "tool_use");
    const evidenceUsed = toolUse?.input?.evidenceUsed;
    return Array.isArray(evidenceUsed) ? evidenceUsed.filter((v): v is string => typeof v === "string") : null;
  } catch {
    return null;
  }
}

const CONTENT_TYPE_LABEL: Record<string, string> = {
  blog_post: "Blog post",
  landing_page: "Landing page",
  comparison_page: "Comparison page",
  guide: "Guide",
};

/**
 * Project Workspace shell. Brief/Blueprint/Content/QA/Export
 * generation is out of scope for Phase 3 — this establishes the
 * header, status badge (derived from the real project_status state
 * machine, never from which tab is open, per Architecture V1), and
 * the tab bar in its locked state. Real tab content is later phases.
 */
export default async function ProjectWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, name, content_type, market, target_query, status, generation_state, current_website_dataset_id",
    )
    .eq("id", id)
    .maybeSingle();

  if (!project) notFound();

  const badge = projectStatusBadge(project.status as ProjectStatus);
  const generationState = project.generation_state as GenerationState;
  const projectStatus = project.status as ProjectStatus;

  const { data: contentBrief } = await supabase
    .from("content_briefs")
    .select("id, current_version_id")
    .eq("project_id", project.id)
    .maybeSingle();

  const { data: currentVersion } = contentBrief?.current_version_id
    ? await supabase.from("brief_versions").select("*").eq("id", contentBrief.current_version_id).single()
    : { data: null };

  const [{ data: topics }, { data: internalLinks }, { data: previousVersions }] = currentVersion
    ? await Promise.all([
        supabase.from("brief_topics").select("id, label").eq("brief_version_id", currentVersion.id),
        supabase.from("brief_internal_links").select("id, anchor_text, target_url").eq("brief_version_id", currentVersion.id),
        supabase
          .from("brief_versions")
          .select("id, version, status, created_at")
          .eq("project_id", project.id)
          .order("version", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  let latestFailedError: { type: string; message: string } | null = null;
  if (!currentVersion) {
    const { data: latestRun } = await supabase
      .from("generation_runs")
      .select("status, error")
      .eq("project_id", project.id)
      .eq("type", "brief_generate")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestRun?.status === "failed" && latestRun.error) {
      latestFailedError = latestRun.error as { type: string; message: string };
    }
  }

  // The exact approved Brief version to generate/regenerate the Blueprint
  // against — never resolved dynamically inside generateBlueprint() itself.
  const approvedBriefVersionId = currentVersion?.status === "approved" ? currentVersion.id : null;

  // --- Blueprint tab data (Phase 4.4) -------------------------------------

  const { data: contentBlueprint } = await supabase
    .from("content_blueprints")
    .select("id, current_version_id")
    .eq("project_id", project.id)
    .maybeSingle();

  const { data: currentBlueprintVersion } = contentBlueprint?.current_version_id
    ? await supabase.from("blueprint_versions").select("*").eq("id", contentBlueprint.current_version_id).single()
    : { data: null };

  let blueprintNodes: BlueprintNodeItem[] = [];
  let previousBlueprintVersions: {
    id: string;
    version: number;
    status: Database["public"]["Enums"]["artifact_version_status"];
    created_at: string;
  }[] = [];
  let sourceBriefVersion: { id: string; version: number } | null = null;
  let wordCountWarning: string | null = null;

  if (currentBlueprintVersion) {
    const [
      { data: rawNodes },
      { data: previousVersionsData },
      { data: sourceBriefVersionData },
      { data: generationRun },
      { data: websiteUrls },
      { data: internalLinkCandidates },
    ] = await Promise.all([
      supabase
        .from("blueprint_nodes")
        .select("*")
        .eq("blueprint_version_id", currentBlueprintVersion.id)
        .order("level", { ascending: true })
        .order("position", { ascending: true }),
      supabase
        .from("blueprint_versions")
        .select("id, version, status, created_at")
        .eq("project_id", project.id)
        .order("version", { ascending: false }),
      supabase.from("brief_versions").select("id, version").eq("id", currentBlueprintVersion.brief_version_id).single(),
      currentBlueprintVersion.generation_run_id
        ? supabase.from("generation_runs").select("metadata").eq("id", currentBlueprintVersion.generation_run_id).maybeSingle()
        : Promise.resolve({ data: null }),
      project.current_website_dataset_id
        ? supabase.from("website_urls").select("id, url").eq("website_dataset_id", project.current_website_dataset_id)
        : Promise.resolve({ data: [] }),
      supabase.from("internal_link_candidates").select("id, url").eq("project_id", project.id),
    ]);

    const candidateUrlById = new Map<string, string>();
    for (const u of websiteUrls ?? []) candidateUrlById.set(u.id, u.url);
    for (const c of internalLinkCandidates ?? []) candidateUrlById.set(c.id, c.url);

    blueprintNodes = (rawNodes ?? []).map((n) => {
      const rawLinks = Array.isArray(n.internal_link_targets) ? n.internal_link_targets : [];
      return {
        id: n.id,
        parentId: n.parent_id,
        level: n.level,
        position: n.position,
        title: n.title,
        goal: n.goal,
        researchSupport: n.research_support,
        uniqueContribution: n.unique_contribution,
        entities: asStringArray(n.entities),
        internalLinkTargets: rawLinks
          .filter((l): l is { candidateId: string; anchorText: string; reason: string } =>
            typeof l === "object" && l !== null && "candidateId" in l && "anchorText" in l && "reason" in l,
          )
          .map((l) => ({
            candidateId: l.candidateId,
            anchorText: l.anchorText,
            reason: l.reason,
            targetUrl: candidateUrlById.get(l.candidateId) ?? null,
          })),
        evidenceRequirement: n.evidence_requirement,
        writingNotes: n.writing_notes,
        targetWordCount: n.target_word_count,
      };
    });

    previousBlueprintVersions = previousVersionsData ?? [];
    sourceBriefVersion = sourceBriefVersionData ?? null;

    const metadata = generationRun?.metadata as { wordCountWarning?: string } | null;
    wordCountWarning = metadata?.wordCountWarning ?? null;
  }

  let latestFailedBlueprintError: { type: string; message: string } | null = null;
  if (!currentBlueprintVersion) {
    const { data: latestBlueprintRun } = await supabase
      .from("generation_runs")
      .select("status, error")
      .eq("project_id", project.id)
      .eq("type", "blueprint_generate")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestBlueprintRun?.status === "failed" && latestBlueprintRun.error) {
      latestFailedBlueprintError = latestBlueprintRun.error as { type: string; message: string };
    }
  }

  const blueprintUnlocked = !BLUEPRINT_LOCKED_STATUSES.has(projectStatus);
  const contentEditorUnlocked = !CONTENT_EDITOR_LOCKED_STATUSES.has(projectStatus);

  // --- Content Editor tab data (Phase 4.5) --------------------------------
  //
  // Content only ever exists for LEAF Blueprint nodes (structural/
  // non-leaf nodes never get a content_documents row — Phase 4.5 plan
  // §1/§14, CD1). Every leaf node's own blueprint_version_id already
  // pins its content to the exact Blueprint version by construction
  // (plan §15) — nothing here re-resolves "current."

  const contentSections: ContentSectionDetail[] = [];

  if (currentBlueprintVersion && blueprintNodes.length > 0) {
    const parentIds = new Set(blueprintNodes.map((n) => n.parentId).filter((pid): pid is string => pid !== null));
    // True document order (root-first DFS, siblings by `position`) —
    // NOT the same as sorting by (level, position), which groups every
    // node of the same depth together instead of interleaving a
    // section's own subsections immediately after it. Reuses the same
    // canonical helper `lib/generation/qa/lineage.ts` already uses for
    // its own article assembly — one algorithm, not two. Pure in-memory
    // reorder of `blueprintNodes`, already fetched above; no new query.
    const leafNodes = orderNodesByDocumentPosition(blueprintNodes).filter((n) => !parentIds.has(n.id));
    const leafNodeIds = leafNodes.map((n) => n.id);

    const [{ data: contentDocs }, { data: latestFailedContentRuns }] = await Promise.all([
      leafNodeIds.length > 0
        ? supabase.from("content_documents").select("id, blueprint_node_id, current_version_id").in("blueprint_node_id", leafNodeIds)
        : Promise.resolve({ data: [] }),
      supabase
        .from("generation_runs")
        .select("blueprint_node_id, status, error, started_at")
        .eq("project_id", project.id)
        .eq("type", "content_generate")
        .eq("status", "failed")
        .order("started_at", { ascending: false }),
    ]);

    const contentDocumentIds = (contentDocs ?? []).map((d) => d.id);
    const { data: allContentVersions } =
      contentDocumentIds.length > 0
        ? await supabase
            .from("content_versions")
            .select("id, content_document_id, version, status, body, created_at, approved_at, generation_run_id, model_id")
            .in("content_document_id", contentDocumentIds)
            .order("version", { ascending: true })
        : { data: [] };

    const generationRunIds = (allContentVersions ?? [])
      .map((v) => v.generation_run_id)
      .filter((id): id is string => id !== null);
    const { data: generationRuns } =
      generationRunIds.length > 0
        ? await supabase.from("generation_runs").select("id, output_ref").in("id", generationRunIds)
        : { data: [] };

    const outputRefById = new Map((generationRuns ?? []).map((r) => [r.id, r.output_ref]));
    const evidenceUsedByGenerationRunId = new Map<string, string[] | null>();
    await Promise.all(
      generationRunIds.map(async (runId) => {
        evidenceUsedByGenerationRunId.set(runId, await getEvidenceUsedFromOutputRef(supabase, outputRefById.get(runId) ?? null));
      }),
    );

    const versionsByDocumentId = new Map<string, typeof allContentVersions>();
    for (const v of allContentVersions ?? []) {
      const list = versionsByDocumentId.get(v.content_document_id) ?? [];
      list.push(v);
      versionsByDocumentId.set(v.content_document_id, list);
    }

    const latestFailedByNodeId = new Map<string, { type: string; message: string }>();
    for (const run of latestFailedContentRuns ?? []) {
      if (run.blueprint_node_id && !latestFailedByNodeId.has(run.blueprint_node_id) && run.error) {
        latestFailedByNodeId.set(run.blueprint_node_id, run.error as { type: string; message: string });
      }
    }

    for (const node of leafNodes) {
      const doc = (contentDocs ?? []).find((d) => d.blueprint_node_id === node.id) ?? null;
      const versions = doc ? (versionsByDocumentId.get(doc.id) ?? []) : [];
      const currentRaw = doc?.current_version_id ? versions.find((v) => v.id === doc.current_version_id) ?? null : null;

      contentSections.push({
        blueprintNodeId: node.id,
        title: node.title,
        targetWordCount: node.targetWordCount,
        currentVersion: currentRaw
          ? {
              id: currentRaw.id,
              version: currentRaw.version,
              status: currentRaw.status,
              body: currentRaw.body,
              createdAt: currentRaw.created_at,
              approvedAt: currentRaw.approved_at,
              generationRunId: currentRaw.generation_run_id,
              modelId: currentRaw.model_id,
            }
          : null,
        previousVersions: versions
          .slice()
          .reverse()
          .map((v) => ({ id: v.id, version: v.version, status: v.status, createdAt: v.created_at })),
        evidenceUsed: currentRaw?.generation_run_id
          ? (evidenceUsedByGenerationRunId.get(currentRaw.generation_run_id) ?? null)
          : null,
        blueprintVersionNumber: currentBlueprintVersion.version,
        briefVersionNumber: sourceBriefVersion?.version ?? 0,
        latestFailedError: currentRaw ? null : (latestFailedByNodeId.get(node.id) ?? null),
        // LEAVES-01 — read-only Blueprint context for the Content
        // Editor. `node` is already the full BlueprintNodeItem
        // (blueprintNodes, fetched once above for the Blueprint
        // Review tab) — no new query, just a second read of fields
        // already in memory.
        blueprintContext: {
          goal: node.goal,
          entities: node.entities,
          researchSupport: node.researchSupport,
          uniqueContribution: node.uniqueContribution,
          evidenceRequirement: node.evidenceRequirement,
          internalLinkTargets: node.internalLinkTargets,
          targetWordCount: node.targetWordCount,
        },
      });
    }
  }

  // --- BD6 UX gap (docs/architecture/phase-4-4-blueprint-plan.md §19) ----
  // If the current Blueprint version has zero generated Content, check
  // whether an earlier Blueprint version has Content still safely
  // stored under it (orphaned by a Blueprint edit/regeneration, never
  // deleted — BD5 point 8). Only queried when actually needed (every
  // current section already shows currentVersion: null), not on every
  // render, per the Toyota Performance Principle ("avoid unnecessary DB
  // queries"). No Content is read, copied, or migrated here — only
  // which prior version it belongs to and, for the read-only preview,
  // its title/body, both already-immutable rows.
  let previousContentInfo: { blueprintVersionNumber: number; sections: { title: string; body: string }[] } | null = null;
  const currentHasNoContent = contentSections.length > 0 && contentSections.every((s) => s.currentVersion === null);

  if (currentHasNoContent && currentBlueprintVersion) {
    const { data: anyContentDocs } = await supabase
      .from("content_documents")
      .select("id, blueprint_node_id, current_version_id")
      .eq("project_id", project.id);

    if (anyContentDocs && anyContentDocs.length > 0) {
      const priorNodeIds = anyContentDocs.map((d) => d.blueprint_node_id);
      const { data: priorNodes } = await supabase
        .from("blueprint_nodes")
        .select("id, title, blueprint_version_id")
        .in("id", priorNodeIds)
        .neq("blueprint_version_id", currentBlueprintVersion.id);

      const priorVersionIds = [...new Set((priorNodes ?? []).map((n) => n.blueprint_version_id))];
      if (priorVersionIds.length > 0) {
        // Most recent prior version that actually has Content — matches
        // "Blueprint version N" in the banner copy exactly.
        const mostRecentPriorVersion = previousBlueprintVersions
          .filter((v) => priorVersionIds.includes(v.id))
          .sort((a, b) => b.version - a.version)[0];

        if (mostRecentPriorVersion) {
          const nodesInThatVersion = (priorNodes ?? []).filter((n) => n.blueprint_version_id === mostRecentPriorVersion.id);
          const docsInThatVersion = anyContentDocs.filter((d) => nodesInThatVersion.some((n) => n.id === d.blueprint_node_id));
          const versionIdByDocId = new Map(docsInThatVersion.map((d) => [d.id, d.current_version_id]));
          const currentVersionIds = docsInThatVersion.map((d) => d.current_version_id).filter((id): id is string => id !== null);

          const { data: priorBodies } =
            currentVersionIds.length > 0
              ? await supabase.from("content_versions").select("id, body").in("id", currentVersionIds)
              : { data: [] };
          const bodyById = new Map((priorBodies ?? []).map((v) => [v.id, v.body]));
          const titleByNodeId = new Map(nodesInThatVersion.map((n) => [n.id, n.title]));

          const sections = docsInThatVersion
            .map((d) => {
              const versionId = versionIdByDocId.get(d.id);
              const body = versionId ? bodyById.get(versionId) : null;
              const title = titleByNodeId.get(d.blueprint_node_id) ?? "(untitled section)";
              return body ? { title, body } : null;
            })
            .filter((s): s is { title: string; body: string } => s !== null);

          if (sections.length > 0) {
            previousContentInfo = { blueprintVersionNumber: mostRecentPriorVersion.version, sections };
          }
        }
      }
    }
  }

  // --- Pipeline stage derivation (2026-08-20) -----------------------------
  // projects.generation_state is stale for real projects (confirmed live:
  // it can say "export_pending" with zero Content generated, or
  // "strategy_pending" with all Content approved — it only ever advances
  // via the Phase 4.1 dev-test harness, no real generation code path
  // writes to it). The Generation Pipeline widget now reads a derived
  // stage computed from real data instead. generationState itself is
  // untouched and still drives GenerationTestControls below — nothing
  // here writes to generation_state or changes its meaning for that
  // harness. One new query (latest qa_reports row, indexed on
  // project_id) is the only addition; everything else reuses data
  // already fetched above (contentSections, currentVersion, currentBlueprintVersion).
  // EXPORT-03: evaluated_categories/skipped_categories (QD9) added to
  // this already-existing query's own select list — zero new queries,
  // reused by both the QA tab and the Export data block below.
  const { data: latestQaReport } = await supabase
    .from("qa_reports")
    .select("id, run_at, overall_status, blueprint_version_id, brief_version_id, evaluated_categories, skipped_categories")
    .eq("project_id", project.id)
    .order("run_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const derivedPipeline = derivePipelineStage(
    {
      briefExists: currentVersion !== null,
      briefApproved: currentVersion?.status === "approved",
      blueprintApproved: currentBlueprintVersion?.status === "approved",
      contentTotalLeaves: contentSections.length,
      contentApprovedLeaves: contentSections.filter((s) => s.currentVersion?.status === "approved").length,
      hasCurrentQaReport:
        latestQaReport != null && currentBlueprintVersion != null && latestQaReport.blueprint_version_id === currentBlueprintVersion.id,
      exportDone: false,
    },
    (latestFailedError !== null && !currentVersion) ||
      (latestFailedBlueprintError !== null && !currentBlueprintVersion),
  );

  // --- QA tab data (Phase 4.6 QA UI, docs/architecture/phase-4-6-qa-ui-plan.md) ---
  // Reuses contentSections (already built above, QU9) as the primary
  // section lookup — an extra query only runs when a finding
  // references a content_version_id that isn't among the current
  // Blueprint's leaves (an orphaned/stale reference, BD6), and only
  // when a QA report actually exists at all. Staleness (QD6) is
  // derived once, here, not recomputed anywhere else in the tree.
  let qaReportSummary: QaReportSummary | null = null;

  // Computed once, shared by both the QA tab's staleness check and
  // Export gating below — not recomputed a second time in either
  // place (Toyota, EXPORT-03 §5).
  const currentContentVersionIds = new Set(contentSections.filter((s) => s.currentVersion).map((s) => s.currentVersion!.id));

  // --- Export data-fetching layer (Phase 4.7 foundation, EXPORT-03) ---
  // computeExportGate()/authorizeExport() (lib/generation/export/gate.ts)
  // are reused unmodified — computed exactly once, right here, from
  // data this block and the ones above it already fetch. No second
  // Brief/Blueprint/Content/QA query, no reproduced gate logic.
  let exportGate: ExportGateResult;

  if (latestQaReport) {
    const [{ data: qaFindingsRaw }, { data: qaReportContentVersions }] = await Promise.all([
      supabase
        .from("qa_findings")
        .select("id, category, method, status, note, quote, content_version_id")
        .eq("qa_report_id", latestQaReport.id),
      supabase.from("qa_report_content_versions").select("content_version_id").eq("qa_report_id", latestQaReport.id),
    ]);

    const sectionByContentVersionId = new Map<
      string,
      { title: string; blueprintNodeId: string; isInCurrentBlueprint: boolean }
    >();
    for (const s of contentSections) {
      if (s.currentVersion) {
        sectionByContentVersionId.set(s.currentVersion.id, {
          title: s.title,
          blueprintNodeId: s.blueprintNodeId,
          isInCurrentBlueprint: true,
        });
      }
    }

    const referencedIds = new Set<string>();
    for (const f of qaFindingsRaw ?? []) {
      if (f.content_version_id) referencedIds.add(f.content_version_id);
    }
    const missingIds = [...referencedIds].filter((id) => !sectionByContentVersionId.has(id));

    if (missingIds.length > 0) {
      // Orphaned references only (BD6/stale report) — small, rare, extra lookup.
      const { data: orphanedVersions } = await supabase
        .from("content_versions")
        .select("id, blueprint_node_id")
        .in("id", missingIds);
      const orphanedNodeIds = [...new Set((orphanedVersions ?? []).map((v) => v.blueprint_node_id))];
      const { data: orphanedNodes } =
        orphanedNodeIds.length > 0
          ? await supabase.from("blueprint_nodes").select("id, title").in("id", orphanedNodeIds)
          : { data: [] };
      const titleByNodeId = new Map((orphanedNodes ?? []).map((n) => [n.id, n.title]));
      for (const v of orphanedVersions ?? []) {
        sectionByContentVersionId.set(v.id, {
          title: titleByNodeId.get(v.blueprint_node_id) ?? "(section no longer available)",
          blueprintNodeId: v.blueprint_node_id,
          isInCurrentBlueprint: false,
        });
      }
    }

    const findings: QaFindingDetail[] = (qaFindingsRaw ?? []).map((f) => ({
      id: f.id,
      category: f.category,
      method: f.method,
      status: f.status,
      note: f.note,
      quote: f.quote,
      contentVersionId: f.content_version_id,
      section: f.content_version_id ? (sectionByContentVersionId.get(f.content_version_id) ?? null) : null,
    }));

    // Staleness (QD6) — computed via the one shared function
    // (`computeQaStaleness()`, lib/generation/qa/staleness.ts,
    // EXPORT-02) also consumed by Export gating. No logic change from
    // before the extraction — same two triggers, same result shape.
    const evaluatedContentVersionIds = (qaReportContentVersions ?? []).map((r) => r.content_version_id);
    const { isStale, staleReason } = computeQaStaleness({
      currentBlueprintVersionId: currentBlueprintVersion?.id ?? null,
      reportBlueprintVersionId: latestQaReport.blueprint_version_id,
      evaluatedContentVersionIds,
      currentContentVersionIds,
    });

    qaReportSummary = {
      id: latestQaReport.id,
      runAt: latestQaReport.run_at,
      overallStatus: latestQaReport.overall_status ?? "pass",
      findings,
      isStale,
      staleReason,
      // QD9 (Partial QA, QA-17) — already fetched above (EXPORT-03's own
      // addition to this same query, reused by the Export gate below) —
      // zero new queries.
      evaluatedCategories: latestQaReport.evaluated_categories,
      skippedCategories: latestQaReport.skipped_categories,
    };

    // Export gate (ED2/ED12/ED13) — computed once, reusing the exact
    // same inputs the staleness check above just used (no second QA
    // query). `computeExportGate()` calls `computeQaStaleness()`
    // internally with these identical inputs, so its own stale
    // determination matches `isStale` above by construction, not by
    // re-implementing the comparison a second time in page.tsx.
    exportGate = computeExportGate({
      latestQaReport: {
        id: latestQaReport.id,
        overallStatus: latestQaReport.overall_status,
        blueprintVersionId: latestQaReport.blueprint_version_id,
        evaluatedCategories: latestQaReport.evaluated_categories,
        skippedCategories: latestQaReport.skipped_categories,
      },
      currentBlueprintVersionId: currentBlueprintVersion?.id ?? null,
      evaluatedContentVersionIds,
      currentContentVersionIds,
    });
  } else {
    exportGate = computeExportGate({
      latestQaReport: null,
      currentBlueprintVersionId: currentBlueprintVersion?.id ?? null,
      evaluatedContentVersionIds: [],
      currentContentVersionIds,
    });
  }

  // --- Export data assembly (EXPORT-03 §1) --------------------------------
  // Every field reuses data already fetched/computed above — no new
  // Brief/Blueprint/Content/QA query. Content-version ordering reuses
  // `contentSections`, itself already built from
  // `orderNodesByDocumentPosition()` (§3) — never DB row order, a flat
  // level/position sort, or a status sort.
  const exportSnapshotEligibility = computeExportSnapshotEligibility({
    pinnedBriefVersionId: sourceBriefVersion?.id ?? null,
    blueprintApproved: currentBlueprintVersion?.status === "approved",
  });

  const exportData: ExportData = {
    briefVersionId: sourceBriefVersion?.id ?? null,
    briefVersionNumber: sourceBriefVersion?.version ?? null,
    blueprintVersionId: currentBlueprintVersion?.id ?? null,
    blueprintVersionNumber: currentBlueprintVersion?.version ?? null,
    contentVersions: contentSections.map((s) => ({
      blueprintNodeId: s.blueprintNodeId,
      title: s.title,
      contentVersionId: s.currentVersion?.id ?? null,
    })),
    qaReport: latestQaReport
      ? {
          id: latestQaReport.id,
          overallStatus: latestQaReport.overall_status,
          evaluatedCategories: latestQaReport.evaluated_categories,
          skippedCategories: latestQaReport.skipped_categories,
        }
      : null,
    qaStale: qaReportSummary?.isStale ?? false,
    qaFailingFindingCount: qaReportSummary?.findings.filter((f) => f.status === "fail").length ?? 0,
    qaStaleReason: qaReportSummary?.staleReason ?? null,
    gate: exportGate,
    verificationTier: deriveExportVerificationTier(exportGate),
    snapshotEligibility: exportSnapshotEligibility,
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-10 pt-6">
        <Link href="/dashboard" className="text-xs text-text-muted hover:text-text-primary">
          &larr; Dashboard
        </Link>
        <div className="mb-4 mt-2.5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">{project.name}</h1>
            <div className="font-mono text-xs text-text-muted">
              {CONTENT_TYPE_LABEL[project.content_type] ?? project.content_type} · {project.market || "—"} · target:{" "}
              {project.target_query || "—"}
            </div>
          </div>
          <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
        </div>
      </div>

      <ProjectTabs
        blueprintUnlocked={blueprintUnlocked}
        contentEditorUnlocked={contentEditorUnlocked}
        briefReview={
          <BriefReview
            key="brief"
            projectId={project.id}
            canManage={canManageProfiles(profile.role)}
            projectStatus={projectStatus}
            currentVersion={currentVersion}
            topics={topics ?? []}
            internalLinks={internalLinks ?? []}
            previousVersions={previousVersions ?? []}
            latestFailedError={latestFailedError}
          />
        }
        blueprintReview={
          <BlueprintReview
            key="blueprint"
            projectId={project.id}
            canManage={canManageProfiles(profile.role)}
            projectStatus={projectStatus}
            currentVersion={currentBlueprintVersion}
            nodes={blueprintNodes}
            previousVersions={previousBlueprintVersions}
            sourceBriefVersion={sourceBriefVersion}
            currentBriefVersionNumber={currentVersion?.version ?? null}
            approvedBriefVersionId={approvedBriefVersionId}
            wordCountWarning={wordCountWarning}
            latestFailedError={latestFailedBlueprintError}
          />
        }
        contentEditorProps={{
          projectId: project.id,
          canManage: canManageProfiles(profile.role),
          sections: contentSections,
          previousContentInfo,
        }}
        qaReviewProps={{
          projectId: project.id,
          canManage: canManageProfiles(profile.role),
          report: qaReportSummary,
          hasNoContent: currentHasNoContent,
        }}
        exportReviewProps={{
          projectId: project.id,
          canManage: canManageProfiles(profile.role),
          exportData,
          hasNoContent: currentHasNoContent,
        }}
        sidebar={
          <div key="sidebar" className="flex w-64 shrink-0 flex-col gap-4">
            <Card>
              <div className="mb-3 text-xs font-semibold text-text-secondary">Generation pipeline</div>
              <GenerationProgress currentStage={derivedPipeline.currentStage} failed={derivedPipeline.failed} />
            </Card>
            {canManageProfiles(profile.role) ? (
              <GenerationTestControls projectId={project.id} state={generationState} />
            ) : null}
          </div>
        }
      />
    </div>
  );
}
