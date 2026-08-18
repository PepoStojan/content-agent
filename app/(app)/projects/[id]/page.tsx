import Link from "next/link";
import { notFound } from "next/navigation";

import { Card } from "@/components/design-system/card";
import { LockedTab } from "@/components/design-system/locked-tab";
import { StatusBadge } from "@/components/design-system/status-badge";
import { requireProfile } from "@/lib/auth/session";
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
  await requireProfile();
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, content_type, market, target_query, status")
    .eq("id", id)
    .maybeSingle();

  if (!project) notFound();

  const badge = projectStatusBadge(project.status as ProjectStatus);

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

      <div className="flex-1 overflow-y-auto p-10">
        <Card className="max-w-xl">
          <p className="text-sm text-text-secondary">
            Strategy Brief generation isn&rsquo;t implemented yet — coming in a later phase. Research and website
            knowledge upload for this project are complete.
          </p>
        </Card>
      </div>
    </div>
  );
}
