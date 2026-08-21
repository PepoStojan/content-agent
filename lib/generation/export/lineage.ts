import { orderNodesByDocumentPosition } from "@/lib/generation/blueprint/tree-order";
import type { QaCategory, QaStatus } from "@/lib/generation/qa/types";
import type { createClient } from "@/lib/supabase/server";

import { computeExportSnapshotEligibility, type ExportContentVersionEntry, type ExportSnapshotEligibility } from "./snapshot";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * EXPORT-06 — server-side lineage resolution for the real export
 * action. Deliberately independent of `page.tsx`'s own data-fetching
 * (EXPORT-03): a Server Action is a separate request/response cycle,
 * so it cannot reuse in-memory values from a prior page render — this
 * re-derives the same pinned lineage the client's `exportData` also
 * showed, but from a fresh, authoritative read, exactly matching
 * ED12 requirement 6's "never trust UI gate/tier/QA state, the server
 * must re-check." Within *this* module's own queries, each table is
 * still read exactly once (Toyota, requirement 8) — this is not a
 * duplicate of the page's own read, it is the required independent
 * re-verification at action time.
 */
export interface ExportLineage {
  snapshotEligibility: ExportSnapshotEligibility;
  briefVersionId: string | null;
  blueprintVersionId: string | null;
  contentVersions: ExportContentVersionEntry[];
  latestQaReport: {
    id: string;
    overallStatus: QaStatus | null;
    blueprintVersionId: string | null;
    evaluatedCategories: QaCategory[];
    skippedCategories: QaCategory[];
  } | null;
  evaluatedContentVersionIds: string[];
  currentContentVersionIds: Set<string>;
}

export async function resolveExportLineage(supabase: SupabaseServerClient, projectId: string): Promise<ExportLineage> {
  const { data: contentBlueprint } = await supabase
    .from("content_blueprints")
    .select("current_version_id")
    .eq("project_id", projectId)
    .maybeSingle();

  const { data: currentBlueprintVersion } = contentBlueprint?.current_version_id
    ? await supabase
        .from("blueprint_versions")
        .select("id, brief_version_id, status")
        .eq("id", contentBlueprint.current_version_id)
        .single()
    : { data: null };

  const snapshotEligibility = computeExportSnapshotEligibility({
    pinnedBriefVersionId: currentBlueprintVersion?.brief_version_id ?? null,
    blueprintApproved: currentBlueprintVersion?.status === "approved",
  });

  if (!snapshotEligibility.eligible || !currentBlueprintVersion) {
    return {
      snapshotEligibility,
      briefVersionId: null,
      blueprintVersionId: null,
      contentVersions: [],
      latestQaReport: null,
      evaluatedContentVersionIds: [],
      currentContentVersionIds: new Set(),
    };
  }

  const [{ data: rawNodes }, { data: latestQaReport }] = await Promise.all([
    supabase.from("blueprint_nodes").select("id, parent_id, position, title").eq("blueprint_version_id", currentBlueprintVersion.id),
    supabase
      .from("qa_reports")
      .select("id, overall_status, blueprint_version_id, evaluated_categories, skipped_categories")
      .eq("project_id", projectId)
      .order("run_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const nodes = rawNodes ?? [];
  const parentIds = new Set(nodes.map((n) => n.parent_id).filter((id): id is string => id !== null));
  const leafNodes = orderNodesByDocumentPosition(nodes.map((n) => ({ ...n, parentId: n.parent_id }))).filter((n) => !parentIds.has(n.id));
  const leafNodeIds = leafNodes.map((n) => n.id);

  const { data: contentDocs } =
    leafNodeIds.length > 0
      ? await supabase.from("content_documents").select("blueprint_node_id, current_version_id").in("blueprint_node_id", leafNodeIds)
      : { data: [] };

  const currentVersionByNodeId = new Map((contentDocs ?? []).map((d) => [d.blueprint_node_id, d.current_version_id]));

  const contentVersions: ExportContentVersionEntry[] = leafNodes.map((n) => ({
    blueprintNodeId: n.id,
    title: n.title,
    contentVersionId: currentVersionByNodeId.get(n.id) ?? null,
  }));

  const currentContentVersionIds = new Set(contentVersions.filter((v) => v.contentVersionId).map((v) => v.contentVersionId as string));

  let evaluatedContentVersionIds: string[] = [];
  if (latestQaReport) {
    const { data: qaReportContentVersions } = await supabase
      .from("qa_report_content_versions")
      .select("content_version_id")
      .eq("qa_report_id", latestQaReport.id);
    evaluatedContentVersionIds = (qaReportContentVersions ?? []).map((r) => r.content_version_id);
  }

  return {
    snapshotEligibility,
    briefVersionId: currentBlueprintVersion.brief_version_id,
    blueprintVersionId: currentBlueprintVersion.id,
    contentVersions,
    latestQaReport: latestQaReport
      ? {
          id: latestQaReport.id,
          overallStatus: latestQaReport.overall_status,
          blueprintVersionId: latestQaReport.blueprint_version_id,
          evaluatedCategories: latestQaReport.evaluated_categories,
          skippedCategories: latestQaReport.skipped_categories,
        }
      : null,
    evaluatedContentVersionIds,
    currentContentVersionIds,
  };
}
