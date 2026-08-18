import Link from "next/link";
import { notFound } from "next/navigation";

import { GenerationTestControls } from "@/app/(app)/projects/[id]/generation-test-controls";
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
        <Card className="max-w-xl">
          <p className="text-sm text-text-secondary">
            Strategy Brief generation isn&rsquo;t implemented yet — coming in a later phase. Research and website
            knowledge upload for this project are complete.
          </p>
        </Card>

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
