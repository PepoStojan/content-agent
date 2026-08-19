import Link from "next/link";
import { notFound } from "next/navigation";

import { GenerationTestControls } from "@/app/(app)/projects/[id]/generation-test-controls";
import { BriefReview } from "@/app/(app)/projects/[id]/brief-review";
import { Card } from "@/components/design-system/card";
import { GenerationProgress } from "@/components/design-system/generation-progress";
import { LockedTab } from "@/components/design-system/locked-tab";
import { StatusBadge } from "@/components/design-system/status-badge";
import { canManageProfiles, requireProfile } from "@/lib/auth/session";
import type { GenerationState } from "@/lib/generation/state-machine";
import { projectStatusBadge, type ProjectStatus } from "@/lib/projects/status";
import { createClient } from "@/lib/supabase/server";

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
    .select("id, name, content_type, market, target_query, status, generation_state")
    .eq("id", id)
    .maybeSingle();

  if (!project) notFound();

  const badge = projectStatusBadge(project.status as ProjectStatus);
  const generationState = project.generation_state as GenerationState;

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
        <div className="flex gap-1 overflow-x-auto border-b border-border">
          <LockedTab label="Brief Review" active />
          <LockedTab label="Blueprint" locked />
          <LockedTab label="Content Editor" locked />
          <LockedTab label="QA" locked />
          <LockedTab label="Export" locked />
        </div>
      </div>

      <div className="flex flex-1 gap-6 overflow-y-auto p-10">
        <BriefReview
          projectId={project.id}
          canManage={canManageProfiles(profile.role)}
          projectStatus={project.status as ProjectStatus}
          currentVersion={currentVersion}
          topics={topics ?? []}
          internalLinks={internalLinks ?? []}
          previousVersions={previousVersions ?? []}
          latestFailedError={latestFailedError}
        />

        <div className="flex w-64 shrink-0 flex-col gap-4">
          <Card>
            <div className="mb-3 text-xs font-semibold text-text-secondary">Generation pipeline</div>
            <GenerationProgress state={generationState} />
          </Card>
          {canManageProfiles(profile.role) ? (
            <GenerationTestControls projectId={project.id} state={generationState} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
