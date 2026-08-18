import { SidebarNav } from "@/components/design-system/sidebar-nav";
import { requireProfile } from "@/lib/auth/session";

/**
 * Shared shell for every real app screen. Sidebar layout/tokens match
 * Design V1 exactly (232px fixed width, logo block, nav, "Research
 * Agent" note pinned to the bottom via margin-top:auto).
 *
 * The user chip + sign-out link is a Phase 2 addition — Design V1 has
 * no sign-out affordance anywhere in its frozen screens, so this is
 * new surface area, not a restyle, same category as the sign-in page.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();

  return (
    <div className="flex h-screen bg-background">
      <div className="flex w-[232px] shrink-0 flex-col border-r border-border bg-card p-4">
        <div className="mb-4 flex items-center gap-2.5 border-b border-border pb-5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2.2}>
              <path d="M4 19h16" />
              <path d="M6 15l4-6 4 3 4-8" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight text-text-primary">Content Maker</div>
            <div className="text-[10px] uppercase tracking-wide text-text-muted">SEO Workbench</div>
          </div>
        </div>

        <SidebarNav />

        <div className="mt-auto flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 rounded-panel border border-border bg-secondary p-2.5">
            <div className="flex min-w-0 items-center gap-2">
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatarUrl} alt="" className="size-7 shrink-0 rounded-pill border border-border" />
              ) : (
                <div className="flex size-7 shrink-0 items-center justify-center rounded-pill bg-card text-xs font-semibold text-text-primary">
                  {profile.displayName.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-text-primary">{profile.displayName}</div>
                <div className="truncate text-[10px] text-text-muted">{profile.email}</div>
              </div>
            </div>
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                className="shrink-0 text-[11px] font-medium text-text-secondary hover:text-text-primary"
              >
                Sign out
              </button>
            </form>
          </div>

          <div className="rounded-panel border border-border bg-secondary p-3">
            <div className="mb-0.5 text-[11px] font-semibold text-text-secondary">Research Agent</div>
            <div className="text-[11px] leading-relaxed text-text-muted">
              Separate upstream system. This workbench only consumes its exported research files.
            </div>
          </div>
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
