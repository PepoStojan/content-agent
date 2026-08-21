"use server";

import { revalidatePath } from "next/cache";

import { canManageProfiles, requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

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

/**
 * Manual Blueprint node editing (BD5,
 * docs/architecture/phase-4-4-blueprint-plan.md). Field-level only —
 * no structural tree change (add/delete/reorder/re-parent) is
 * possible through this function; `parent_id`/`level`/`position` are
 * always carried forward unchanged from the current version's node.
 * Not AI-driven (BD2 unaffected) — this never calls the model.
 *
 * Versioning matches AI regeneration's own shape exactly (BD5's
 * locked requirement): a brand new `blueprint_versions` row with a
 * full new `blueprint_nodes` snapshot, never an in-place update. Every
 * node — not just the edited one — gets a fresh id, because
 * `blueprint_nodes.id` is the primary key of one specific version's
 * tree; two different `blueprint_versions` rows never share node rows
 * (same "no shared rows across versions" discipline the AI path
 * already follows in `persist.ts`). `brief_version_id` is carried
 * forward unchanged from the current version (BD5 point 7) — a manual
 * field edit is not a new Brief synthesis. `generation_run_id`/
 * `model_id`/`prompt_version` are all left `null` — a manual edit has
 * no generation provenance, the same honest-absence signal Content's
 * own manual Edit path already uses (Phase 4.5 CD5/§11).
 *
 * Existing `content_documents`/`content_versions` reference the
 * *original* version's node ids directly and are never touched here
 * (BD5 point 8) — this function only ever inserts new rows and flips
 * `content_blueprints.current_version_id`, exactly like the AI
 * regeneration path already does.
 */
export interface EditableBlueprintNodeFields {
  title: string;
  goal: string | null;
  researchSupport: string | null;
  uniqueContribution: string | null;
  entities: string[];
  internalLinkTargets: { candidateId: string; anchorText: string; reason: string }[];
  evidenceRequirement: string | null;
  writingNotes: string | null;
  targetWordCount: number | null;
}

export interface EditBlueprintNodeResult {
  blueprintVersionId: string;
  version: number;
  /** The edited node's id in the newly created version — the tree/inspector selection follows this, not the old (now-superseded) node id. */
  newBlueprintNodeId: string;
}

export async function editBlueprintNode(
  projectId: string,
  blueprintNodeId: string,
  fields: EditableBlueprintNodeFields,
): Promise<EditBlueprintNodeResult> {
  const profile = await assertCanManageBlueprint();
  const supabase = await createClient();

  const { data: contentBlueprint, error: cbError } = await supabase
    .from("content_blueprints")
    .select("id, current_version_id")
    .eq("project_id", projectId)
    .maybeSingle();
  if (cbError) throw new Error(cbError.message);
  if (!contentBlueprint?.current_version_id) {
    throw new Error("No current Blueprint version exists for this project.");
  }

  const { data: currentVersion, error: cvError } = await supabase
    .from("blueprint_versions")
    .select("id, project_id, brief_version_id")
    .eq("id", contentBlueprint.current_version_id)
    .single();
  if (cvError) throw new Error(cvError.message);
  if (currentVersion.project_id !== projectId) {
    throw new Error("The project's current Blueprint version does not belong to this project.");
  }

  const { data: existingNodes, error: nodesError } = await supabase
    .from("blueprint_nodes")
    .select("*")
    .eq("blueprint_version_id", currentVersion.id);
  if (nodesError) throw new Error(nodesError.message);
  if (!existingNodes || existingNodes.length === 0) {
    throw new Error("The current Blueprint version has no nodes.");
  }
  if (!existingNodes.some((n) => n.id === blueprintNodeId)) {
    throw new Error("This node does not belong to the current Blueprint version.");
  }

  const { data: latestVersionRow, error: latestVersionError } = await supabase
    .from("blueprint_versions")
    .select("version")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestVersionError) throw new Error(latestVersionError.message);
  const nextVersion = (latestVersionRow?.version ?? 0) + 1;

  const { data: newVersion, error: insertVersionError } = await supabase
    .from("blueprint_versions")
    .insert({
      content_blueprint_id: contentBlueprint.id,
      project_id: projectId,
      brief_version_id: currentVersion.brief_version_id,
      version: nextVersion,
      status: "draft",
      generated_at: null,
      generation_run_id: null,
      model_id: null,
      prompt_version: null,
      created_by: profile.userId,
    })
    .select("id")
    .single();
  if (insertVersionError) throw new Error(insertVersionError.message);

  const idMap = new Map<string, string>();
  for (const node of existingNodes) idMap.set(node.id, crypto.randomUUID());

  const newNodesPayload = existingNodes.map((node) => {
    const isTarget = node.id === blueprintNodeId;
    return {
      id: idMap.get(node.id)!,
      blueprint_version_id: newVersion.id,
      parent_id: node.parent_id ? (idMap.get(node.parent_id) ?? null) : null,
      level: node.level,
      position: node.position,
      title: isTarget ? fields.title : node.title,
      goal: isTarget ? fields.goal : node.goal,
      research_support: isTarget ? fields.researchSupport : node.research_support,
      unique_contribution: isTarget ? fields.uniqueContribution : node.unique_contribution,
      entities: (isTarget ? fields.entities : node.entities) as Json,
      internal_link_targets: (isTarget ? fields.internalLinkTargets : node.internal_link_targets) as unknown as Json,
      evidence_requirement: isTarget ? fields.evidenceRequirement : node.evidence_requirement,
      writing_notes: isTarget ? fields.writingNotes : node.writing_notes,
      target_word_count: isTarget ? fields.targetWordCount : node.target_word_count,
    };
  });

  const { error: insertNodesError } = await supabase.from("blueprint_nodes").insert(newNodesPayload);
  if (insertNodesError) throw new Error(insertNodesError.message);

  const { error: flipError } = await supabase
    .from("content_blueprints")
    .update({ current_version_id: newVersion.id })
    .eq("id", contentBlueprint.id);
  if (flipError) throw new Error(flipError.message);

  revalidatePath(`/projects/${projectId}`);

  return { blueprintVersionId: newVersion.id, version: nextVersion, newBlueprintNodeId: idMap.get(blueprintNodeId)! };
}
