"use server";

import { revalidatePath } from "next/cache";

import { canManageProfiles, requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * Every mutation re-checks the role server-side before touching the
 * database, in addition to the RLS policies on blueprint_versions/projects
 * — defense in depth, not a substitute for RLS (same pattern as
 * brief-actions.ts).
 */
async function assertCanManageBlueprint() {
  const profile = await requireProfile();
  if (!canManageProfiles(profile.role)) {
    throw new Error("You don't have permission to manage this project's Blueprint.");
  }
  return profile;
}

/**
 * Approves the current draft Blueprint version. Immutable-by-design: this
 * only ever updates the one version row being approved (status,
 * approved_by, approved_at) — no other version is touched. Advances
 * projects.status to 'blueprint_approved' so the Dashboard badge and the
 * Content Editor/QA/Export lock state stay accurate (BD1/BD2, Phase 4.4
 * plan §11).
 */
export async function approveBlueprintVersion(projectId: string, blueprintVersionId: string): Promise<void> {
  const profile = await assertCanManageBlueprint();
  const supabase = await createClient();

  const { data: version, error: fetchError } = await supabase
    .from("blueprint_versions")
    .select("id, project_id, status")
    .eq("id", blueprintVersionId)
    .single();
  if (fetchError) throw new Error(fetchError.message);
  if (version.project_id !== projectId) throw new Error("This Blueprint version does not belong to this project.");
  if (version.status === "approved") throw new Error("This Blueprint version is already approved.");

  const { error: updateError } = await supabase
    .from("blueprint_versions")
    .update({ status: "approved", approved_by: profile.userId, approved_at: new Date().toISOString() })
    .eq("id", blueprintVersionId);
  if (updateError) throw new Error(updateError.message);

  const { error: projectError } = await supabase
    .from("projects")
    .update({ status: "blueprint_approved" })
    .eq("id", projectId);
  if (projectError) throw new Error(projectError.message);

  revalidatePath(`/projects/${projectId}`);
}

/**
 * Locked decision BD2 (whole-document regeneration only): approved/draft
 * Blueprint -> blueprint_changes_requested. Does NOT touch
 * blueprint_versions at all (the version — approved or not — stays
 * exactly as it is, immutable) and never starts generation. Reuses the
 * existing `blueprint_changes_requested` value on `project_status` (no
 * schema change required). The user must separately choose Regenerate.
 */
export async function requestBlueprintChanges(projectId: string): Promise<void> {
  await assertCanManageBlueprint();
  const supabase = await createClient();

  const { error } = await supabase.from("projects").update({ status: "blueprint_changes_requested" }).eq("id", projectId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${projectId}`);
}
