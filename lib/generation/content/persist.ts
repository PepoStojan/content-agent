import type { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

/**
 * The insert-only content_versions write path (Phase 4.5 data-contract
 * item 5; CD5, locked). Same head+version+flip-last discipline as
 * `lib/generation/blueprint/persist.ts`, with no children step (a
 * section has no sub-artifacts) and, unlike Blueprint, no separate
 * "AI vs manual" persist function — CD5 locks that manual Edit and AI
 * Regenerate share this exact same insert-only path, distinguished
 * only by whether `generationRunId`/`model`/`promptVersion` are
 * present (a real generation) or omitted (a manual edit has no
 * generation provenance — that absence is itself the honest signal,
 * not a separate status value; Phase 4.5 plan §11).
 *
 * Regeneration isolation (plan §14) requires no special logic here:
 * `content_documents.blueprint_node_id` is unique per node, so this
 * function only ever touches the one document/version chain for the
 * `blueprintNodeId` it was called with — a sibling section's rows are
 * different rows entirely, untouched by construction.
 *
 * Does not call the Generation Engine (`recordProviderCompleted` /
 * `recordArtifactPersisted` / `completeGeneration`) — that orchestration
 * belongs to the future `generateContentSection()` call, not yet
 * implemented (out of scope for this task).
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface PersistContentVersionInput {
  projectId: string;
  blueprintNodeId: string;
  body: string;
  /** Defaults to 'ai_generated' — the enum encodes approval state, not authorship (plan §11); an Approve action elsewhere flips an already-current version to 'approved'. */
  status?: Database["public"]["Enums"]["content_version_status"];
  createdBy: string;
  /** Present for an AI-generated version; omit (or pass null) for a manual Edit. */
  generationRunId?: string | null;
  model?: string | null;
  promptVersion?: string | null;
}

export interface PersistContentVersionResult {
  contentDocumentId: string;
  contentVersionId: string;
  version: number;
}

export async function persistContentVersion(
  supabase: SupabaseServerClient,
  input: PersistContentVersionInput,
): Promise<PersistContentVersionResult> {
  const { data: existingDocument, error: fetchDocumentError } = await supabase
    .from("content_documents")
    .select("id")
    .eq("blueprint_node_id", input.blueprintNodeId)
    .maybeSingle();
  if (fetchDocumentError) throw new Error(fetchDocumentError.message);

  let contentDocumentId = existingDocument?.id ?? null;
  if (!contentDocumentId) {
    const { data: createdDocument, error: createDocumentError } = await supabase
      .from("content_documents")
      .insert({ project_id: input.projectId, blueprint_node_id: input.blueprintNodeId })
      .select("id")
      .single();
    if (createDocumentError) throw new Error(createDocumentError.message);
    contentDocumentId = createdDocument.id;
  }

  const { data: latestVersion, error: latestVersionError } = await supabase
    .from("content_versions")
    .select("version")
    .eq("content_document_id", contentDocumentId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestVersionError) throw new Error(latestVersionError.message);

  const nextVersion = (latestVersion?.version ?? 0) + 1;

  const { data: contentVersion, error: insertVersionError } = await supabase
    .from("content_versions")
    .insert({
      content_document_id: contentDocumentId,
      blueprint_node_id: input.blueprintNodeId,
      project_id: input.projectId,
      version: nextVersion,
      body: input.body,
      status: input.status ?? "ai_generated",
      generation_run_id: input.generationRunId ?? null,
      model_id: input.model ?? null,
      prompt_version: input.promptVersion ?? null,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (insertVersionError) throw new Error(insertVersionError.message);

  const contentVersionId = contentVersion.id;

  // Head-flip, done last — the same "safe intermediate state" property
  // as Brief/Blueprint: if this update fails, the version row exists
  // but isn't yet current, which is recoverable, not corrupt.
  const { error: flipError } = await supabase
    .from("content_documents")
    .update({ current_version_id: contentVersionId })
    .eq("id", contentDocumentId);
  if (flipError) throw new Error(flipError.message);

  return { contentDocumentId, contentVersionId, version: nextVersion };
}
