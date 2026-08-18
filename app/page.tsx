import { redirect } from "next/navigation";

import { Card } from "@/components/design-system/card";
import { Button } from "@/components/ui/button";
import { DesignSystemPreview } from "@/app/design-system-preview";
import { createClient } from "@/lib/supabase/server";

/**
 * Protected landing page. Phase 1 scope: prove the auth wiring works
 * (session present, basic profile loaded from the Supabase Auth user
 * object) — not a real Dashboard. The actual Dashboard screen from
 * Design V1 is a later phase's feature work.
 *
 * "Basic profile" here is the auth.users identity (name/email/avatar
 * from the Google OAuth grant), not the `profiles` table — that table
 * requires an organization_id + role, which is role/permission
 * bootstrapping explicitly out of scope for Phase 1.
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The proxy already enforces this; redirect here too as a defensive
  // fallback in case this page is ever reached another way.
  if (!user) {
    redirect("/sign-in");
  }

  const metadata = user.user_metadata as {
    full_name?: string;
    name?: string;
    avatar_url?: string;
    picture?: string;
  };
  const displayName = metadata.full_name ?? metadata.name ?? user.email ?? "Signed in";
  const avatarUrl = metadata.avatar_url ?? metadata.picture;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">
            SEO Content Maker
          </h1>
          <p className="text-sm text-text-muted">
            Phase 1 — authentication only. No product screens yet.
          </p>
        </div>
      </div>

      <Card className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              className="size-9 rounded-pill border border-border"
            />
          ) : (
            <div className="flex size-9 items-center justify-center rounded-pill bg-secondary text-sm font-semibold text-secondary-foreground">
              {displayName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <div className="text-sm font-semibold text-text-primary">{displayName}</div>
            <div className="text-xs text-text-muted">{user.email}</div>
          </div>
        </div>
        <form action="/auth/sign-out" method="post">
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </Card>

      <DesignSystemPreview />
    </main>
  );
}
