import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

export type AppRole = Database["public"]["Enums"]["user_role"];

export interface CurrentProfile {
  userId: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  organizationId: string;
  role: AppRole;
}

/**
 * Loads the signed-in user's profile for use in Server
 * Components/Actions. Middleware already guarantees a `profiles` row
 * exists for any request that reaches an (app) route — this redirects
 * defensively rather than assuming that invariant always holds.
 */
export async function requireProfile(): Promise<CurrentProfile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role, display_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) {
    redirect("/pending-access");
  }

  const metadata = user.user_metadata as {
    full_name?: string;
    name?: string;
    avatar_url?: string;
    picture?: string;
  };

  return {
    userId: user.id,
    email: user.email ?? null,
    displayName: profile.display_name ?? metadata.full_name ?? metadata.name ?? user.email ?? "Signed in",
    avatarUrl: metadata.avatar_url ?? metadata.picture ?? null,
    organizationId: profile.organization_id,
    role: profile.role,
  };
}

export function canManageProfiles(role: AppRole) {
  return role === "team_lead" || role === "seo_manager";
}
