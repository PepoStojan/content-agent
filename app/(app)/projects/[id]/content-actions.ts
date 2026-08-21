"use server";

import { revalidatePath } from "next/cache";

import { canManageProfiles, requireProfile } from "@/lib/auth/session";
import { persistContentVersion } from "@/lib/generation/content/persist";
import { createClient } from "@/lib/supabase/server";

/**
 * Every mutation re-checks the role server-side before touching the
 * database, in addition to the RLS policies on content_versions/
 * content_documents — defense in depth, same pattern as
 * brief-actions.ts/blueprint-actions.ts.
 */
async function assertCanManageContent() {
  const profile = await requireProfile();
  if (!canManageProfiles(profile.role)) {
    throw new Error("You don't have permission to manage this project's Content.");
  }
  return profile;
}

/**
 * Approves the current draft Content version for one section.
 * Immutable-by-design: only this one version row is updated (status,
 * approved_by, approved_at) — no other version, and no other
 * section's content_versions row, is ever touched (Phase 4.5 plan
 * §14 — regeneration/approval isolation is automatic because every
 * leaf node owns its own content_documents/content_versions chain).
 */
export async function approveContentVersion(projectId: string, contentVersionId: string): Promise<void> {
  const profile = await assertCanManageContent();
  const supabase = await createClient();

  const { data: version, error: fetchError } = await supabase
    .from("content_versions")
    .select("id, project_id, status")
    .eq("id", contentVersionId)
    .single();
  if (fetchError) throw new Error(fetchError.message);
  if (version.project_id !== projectId) throw new Error("This Content version does not belong to this project.");
  if (version.status === "approved") throw new Error("This Content version is already approved.");

  const { error: updateError } = await supabase
    .from("content_versions")
    .update({ status: "approved", approved_by: profile.userId, approved_at: new Date().toISOString() })
    .eq("id", contentVersionId);
  if (updateError) throw new Error(updateError.message);

  revalidatePath(`/projects/${projectId}`);
}

/**
 * Manual, non-AI edit of one section's body. Reuses the existing
 * insert-only persist path (lib/generation/content/persist.ts,
 * unmodified) directly — CD5, locked: Edit and AI Regenerate share
 * the exact same write path, distinguished only by the absence of
 * generation_run_id/model_id/prompt_version here (an edit has no
 * generation provenance, which is itself the honest signal that this
 * version's body did not come from a model call — plan §11). The
 * previous version, approved or not, is left permanently intact.
 */
export async function editContentVersion(projectId: string, blueprintNodeId: string, body: string): Promise<void> {
  const profile = await assertCanManageContent();
  if (!body.trim()) {
    throw new Error("Content body cannot be empty.");
  }
  const supabase = await createClient();

  await persistContentVersion(supabase, {
    projectId,
    blueprintNodeId,
    body,
    createdBy: profile.userId,
  });

  revalidatePath(`/projects/${projectId}`);
}
