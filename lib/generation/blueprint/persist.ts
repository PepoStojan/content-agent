import type { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

import type { BlueprintInternalLinkDraft } from "./internal-links";
import type { BlueprintNodeDraft } from "./nodes";

/**
 * The artifact_persisted write sequence for Blueprint — same
 * head+version+children+flip-last discipline as
 * lib/generation/brief/persist.ts, with one addition: `brief_version_id`
 * is written once, at insert time, from the exact Brief version the
 * caller built this generation against (plan §0/§4) — never
 * re-resolved from `content_briefs.current_version_id`. The database
 * trigger added in 20260824000001 makes this column immutable after
 * insert regardless of what application code does later, but the
 * write path itself must still only ever set it once, correctly,
 * here.
 *
 * No multi-statement transaction primitive is available at this
 * client layer (same constraint as Brief) — if a later step fails,
 * the version row and/or its nodes already exist but aren't yet
 * current, a safe, recoverable intermediate state that maps onto "not
 * yet artifact_persisted" (plan §12/§10 — failure/recovery mirrors
 * Phase 4.3 exactly).
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface PersistBlueprintVersionInput {
  projectId: string;
  briefVersionId: string;
  generationRunId: string;
  createdBy: string;
  nodes: BlueprintNodeDraft[];
  validatedInternalLinks: Map<string, BlueprintInternalLinkDraft[]>;
  model: string;
  promptVersion: string;
}

export interface PersistBlueprintVersionResult {
  contentBlueprintId: string;
  blueprintVersionId: string;
  version: number;
}

export async function persistBlueprintVersion(
  supabase: SupabaseServerClient,
  input: PersistBlueprintVersionInput,
): Promise<PersistBlueprintVersionResult> {
  const { data: existingBlueprint, error: fetchBlueprintError } = await supabase
    .from("content_blueprints")
    .select("id")
    .eq("project_id", input.projectId)
    .maybeSingle();
  if (fetchBlueprintError) throw new Error(fetchBlueprintError.message);

  let contentBlueprintId = existingBlueprint?.id ?? null;
  if (!contentBlueprintId) {
    const { data: createdBlueprint, error: createBlueprintError } = await supabase
      .from("content_blueprints")
      .insert({ project_id: input.projectId })
      .select("id")
      .single();
    if (createBlueprintError) throw new Error(createBlueprintError.message);
    contentBlueprintId = createdBlueprint.id;
  }

  const { data: latestVersion, error: latestVersionError } = await supabase
    .from("blueprint_versions")
    .select("version")
    .eq("project_id", input.projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestVersionError) throw new Error(latestVersionError.message);

  const nextVersion = (latestVersion?.version ?? 0) + 1;

  const { data: blueprintVersion, error: insertVersionError } = await supabase
    .from("blueprint_versions")
    .insert({
      content_blueprint_id: contentBlueprintId,
      project_id: input.projectId,
      brief_version_id: input.briefVersionId,
      version: nextVersion,
      status: "draft",
      generated_at: new Date().toISOString(),
      generation_run_id: input.generationRunId,
      model_id: input.model,
      prompt_version: input.promptVersion,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (insertVersionError) throw new Error(insertVersionError.message);

  const blueprintVersionId = blueprintVersion.id;

  if (input.nodes.length > 0) {
    const { error: nodesError } = await supabase.from("blueprint_nodes").insert(
      input.nodes.map((node) => ({
        id: node.id,
        blueprint_version_id: blueprintVersionId,
        parent_id: node.parentId,
        level: node.level,
        position: node.position,
        title: node.title,
        goal: node.goal,
        research_support: node.researchSupport,
        unique_contribution: node.uniqueContribution,
        entities: node.entities as Json,
        internal_link_targets: (input.validatedInternalLinks.get(node.id) ?? []) as unknown as Json,
        evidence_requirement: node.evidenceRequirement,
        writing_notes: node.writingNotes,
        target_word_count: node.targetWordCount,
      })),
    );
    if (nodesError) throw new Error(nodesError.message);
  }

  const { error: flipError } = await supabase
    .from("content_blueprints")
    .update({ current_version_id: blueprintVersionId })
    .eq("id", contentBlueprintId);
  if (flipError) throw new Error(flipError.message);

  return { contentBlueprintId, blueprintVersionId, version: nextVersion };
}
