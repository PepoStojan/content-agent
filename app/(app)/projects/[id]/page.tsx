import Link from "next/link";
import { notFound } from "next/navigation";

import { GenerationTestControls } from "@/app/(app)/projects/[id]/generation-test-controls";
import { BlueprintReview, type BlueprintNodeItem } from "@/app/(app)/projects/[id]/blueprint-review";
import { BriefReview } from "@/app/(app)/projects/[id]/brief-review";
import { ProjectTabs } from "@/app/(app)/projects/[id]/project-tabs";
import { Card } from "@/components/design-system/card";
import { GenerationProgress } from "@/components/design-system/generation-progress";
import { StatusBadge } from "@/components/design-system/status-badge";
import { canManageProfiles, requireProfile } from "@/lib/auth/session";
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
        sidebar={
          <div key="sidebar" className="flex w-64 shrink-0 flex-col gap-4">
            <Card>
              <div className="mb-3 text-xs font-semibold text-text-secondary">Generation pipeline</div>
              <GenerationProgress state={generationState} />
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
