"use server";

import { revalidatePath } from "next/cache";

import { canManageProfiles, requireProfile } from "@/lib/auth/session";
import { canTransition, eventStageForTransition, type GenerationState } from "@/lib/generation/state-machine";
import { createClient } from "@/lib/supabase/server";

/**
 * The single write path every future generation stage (Phase 4.2+)
 * will call to move a project's generation_state forward and log the
 * transition. Rejects invalid transitions server-side rather than
 * trusting the caller — RLS on `projects`/`generation_events` is the
 * hard boundary, this is the state-machine-correctness boundary on
 * top of it.
 */
export async function transitionGenerationState(
  projectId: string,
  to: GenerationState,
  event: string,
  metadata: Record<string, unknown> = {}
) {
  const profile = await requireProfile();
  if (!canManageProfiles(profile.role)) {
    throw new Error("You don't have permission to change this project's generation state.");
  }

  const supabase = await createClient();

  const { data: project, error: fetchError } = await supabase
    .from("projects")
    .select("generation_state")
    .eq("id", projectId)
    .single();
  if (fetchError) throw new Error(fetchError.message);

  const from = project.generation_state as GenerationState;
  if (!canTransition(from, to)) {
    throw new Error(`Invalid generation state transition: ${from} → ${to}`);
  }

  const startedAt = new Date();

  const { error: updateError } = await supabase
    .from("projects")
    .update({ generation_state: to })
    .eq("id", projectId);
  if (updateError) throw new Error(updateError.message);

  const finishedAt = new Date();
  const status = to === "failed" ? "failed" : "completed";

  const { error: eventError } = await supabase.from("generation_events").insert({
    project_id: projectId,
    stage: eventStageForTransition(from, to),
    event,
    status,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    metadata: { from, to, ...metadata },
  });
  if (eventError) throw new Error(eventError.message);

  revalidatePath(`/projects/${projectId}`);
  return to;
}
