import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/design-system/card";
import { StatusBadge } from "@/components/design-system/status-badge";
import { canManageProfiles, requireProfile } from "@/lib/auth/session";
import { projectStatusBadge, type ProjectStatus } from "@/lib/projects/status";
import { createClient } from "@/lib/supabase/server";

const CONTENT_TYPE_LABEL: Record<string, string> = {
  blog_post: "Blog post",
  landing_page: "Landing page",
  comparison_page: "Comparison page",
  guide: "Guide",
};

export default async function DashboardPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, content_type, market, status, updated_at")
    .order("updated_at", { ascending: false });

  return (
    <div className="p-10">
      <div className="mb-7 flex items-center justify-between gap-3.5">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Dashboard</h1>
          <p className="text-sm text-text-muted">Your content projects, in one place.</p>
        </div>
        {canManageProfiles(profile.role) ? (
          <Button render={<Link href="/new-content" />} nativeButton={false}>
            + New Content
          </Button>
        ) : null}
      </div>

      {!projects || projects.length === 0 ? (
        <div className="py-16 text-center text-sm text-text-muted">No projects yet.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const badge = projectStatusBadge(p.status as ProjectStatus);
            return (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <Card className="flex h-full flex-col gap-2.5 transition-colors hover:border-primary">
                  <div className="text-[14.5px] font-semibold text-text-primary">{p.name}</div>
                  <div className="font-mono text-[11.5px] text-text-muted">
                    {CONTENT_TYPE_LABEL[p.content_type] ?? p.content_type} · {p.market || "—"}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                    <span className="text-[11px] text-text-muted">
                      {new Date(p.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
