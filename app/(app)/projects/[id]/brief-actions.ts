"use server";

import { revalidatePath } from "next/cache";

import { canManageProfiles, requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * Every mutation re-checks the role server-side before touching the
 * database, in addition to the RLS policies on brief_versions/projects
 * — defense in depth, not a substitute for RLS (same pattern as
 * business-profiles/actions.ts).
 */
async function assertCanManageBrief() {
  const profile = await requireProfile();
  if (!canManageProfiles(profile.role)) {
    throw new Error("You don't have permission to manage this project's Strategy Brief.");
  }
  return profile;
}

/**
 * Approves the current draft Brief version. Immutable-by-design: this
 * only ever updates the one version row being approved (status,
 * approved_by, approved_at) — no other version is touched. Advances
 * projects.status to 'brief_approved' so the Dashboard badge stays
 * accurate (locked decision, Phase 4.3 plan §0.6).
 */
export async function approveBriefVersion(projectId: string, briefVersionId: string): Promise<void> {
  const profile = await assertCanManageBrief();
  const supabase = await createClient();

  const { data: version, error: fetchError } = await supabase
    .from("brief_versions")
    .select("id, project_id, status")
    .eq("id", briefVersionId)
    .single();
  if (fetchError) throw new Error(fetchError.message);
  if (version.project_id !== projectId) throw new Error("This Brief version does not belong to this project.");
  if (version.status === "approved") throw new Error("This Brief version is already approved.");

  const { error: updateError } = await supabase
    .from("brief_versions")
    .update({ status: "approved", approved_by: profile.userId, approved_at: new Date().toISOString() })
    .eq("id", briefVersionId);
  if (updateError) throw new Error(updateError.message);

  const { error: projectError } = await supabase.from("projects").update({ status: "brief_approved" }).eq("id", projectId);
  if (projectError) throw new Error(projectError.message);

  revalidatePath(`/projects/${projectId}`);
}

/**
 * Locked decision L1: Approved/draft Brief -> needs_revision. Does
 * NOT touch brief_versions at all (the version — approved or not —
 * stays exactly as it is, immutable) and never starts generation.
 * `artifact_version_status` only has draft/approved (no
 * needs_revision value), so this is represented at the project level
 * instead, reusing the existing `brief_changes_requested` value on
 * `project_status` (no schema change required). The user must
 * separately edit inputs and choose Regenerate.
 */
export async function requestBriefChanges(projectId: string): Promise<void> {
  await assertCanManageBrief();
  const supabase = await createClient();

  const { error } = await supabase.from("projects").update({ status: "brief_changes_requested" }).eq("id", projectId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${projectId}`);
}
