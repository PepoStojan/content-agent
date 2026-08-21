import { EXPORT_FORMAT_MIME_TYPE } from "@/lib/generation/export/formats";
import type { ExportVerificationTier } from "@/lib/generation/export/gate";
import { assembleJsonDocument, serializeExportJson, type JsonExportNode } from "@/lib/generation/export/json-assembler";
import { exportFilename } from "@/lib/generation/export/filename";
import type { Json } from "@/lib/supabase/types";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface GeneratedExportFile {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
}

export interface GenerateJsonFileInput {
  projectId: string;
  exportId: string;
  blueprintVersionId: string;
  briefVersionId: string | null;
  qaReportId: string | null;
  qaBypassed: boolean;
  verificationTier: ExportVerificationTier;
  evaluatedCategories: string[];
  skippedCategories: string[];
}

function asStringArray(value: Json | null): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * EXPORT-09 — the Structured JSON format generator. Mirrors
 * `generate-markdown-file.ts`/`generate-html-file.ts`'s own query
 * shape exactly (the exact pinned `blueprint_version_id` for
 * structure, the exact `content_versions` rows `export_content_versions`
 * already pinned for this `exportId` for body/status text) — never
 * `content_documents.current_version_id` or any other "current"
 * pointer. Reads two additional, small, already-scoped fields no
 * other formatter needs (`blueprint_nodes.goal`/`.entities`/
 * `.target_word_count`, `content_versions.status`) via the exact same
 * `blueprint_nodes` query, no second query — Toyota, avoid duplicate
 * fetches. The one extra query this formatter alone needs is the
 * project's own `name`/`content_type` for the metadata block (§3).
 */
export async function generateJsonFile(supabase: SupabaseServerClient, input: GenerateJsonFileInput): Promise<GeneratedExportFile> {
  const { projectId, exportId, blueprintVersionId } = input;

  const [{ data: rawNodes, error: nodesError }, { data: pinnedVersionIds, error: ecvError }, { data: project, error: projectError }] =
    await Promise.all([
      supabase
        .from("blueprint_nodes")
        .select("id, parent_id, level, position, title, goal, target_word_count, entities")
        .eq("blueprint_version_id", blueprintVersionId),
      supabase.from("export_content_versions").select("content_version_id").eq("export_id", exportId),
      supabase.from("projects").select("name, content_type").eq("id", projectId).single(),
    ]);
  if (nodesError) throw new Error(nodesError.message);
  if (ecvError) throw new Error(ecvError.message);
  if (projectError) throw new Error(projectError.message);

  const nodes = rawNodes ?? [];
  const versionIds = (pinnedVersionIds ?? []).map((r) => r.content_version_id);

  const { data: contentVersions, error: contentVersionsError } =
    versionIds.length > 0
      ? await supabase.from("content_versions").select("id, blueprint_node_id, body, status").in("id", versionIds)
      : { data: [], error: null };
  if (contentVersionsError) throw new Error(contentVersionsError.message);

  const versionByNodeId = new Map((contentVersions ?? []).map((v) => [v.blueprint_node_id, v]));
  const parentIds = new Set(nodes.map((n) => n.parent_id).filter((id): id is string => id !== null));

  const assembledNodes: JsonExportNode[] = nodes.map((n) => {
    const isLeaf = !parentIds.has(n.id);
    const version = isLeaf ? versionByNodeId.get(n.id) : undefined;
    return {
      id: n.id,
      parentId: n.parent_id,
      level: n.level,
      position: n.position,
      title: n.title,
      isLeaf,
      goal: n.goal,
      targetWordCount: n.target_word_count,
      entities: asStringArray(n.entities),
      contentVersionId: version?.id ?? null,
      status: version?.status ?? null,
      body: version?.body ?? null,
    };
  });

  const document = assembleJsonDocument(assembledNodes, {
    exportId,
    projectId,
    projectName: project.name,
    contentType: project.content_type,
    briefVersionId: input.briefVersionId,
    blueprintVersionId,
    qaReportId: input.qaReportId,
    qaBypassed: input.qaBypassed,
    verificationTier: input.verificationTier,
    evaluatedCategories: input.evaluatedCategories,
    skippedCategories: input.skippedCategories,
  });

  const jsonText = serializeExportJson(document);
  const fileName = exportFilename(document.document.title, "json");
  const mimeType = EXPORT_FORMAT_MIME_TYPE.json;
  const bytes = new TextEncoder().encode(jsonText);
  const storagePath = `${projectId}/exports/${exportId}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from("project-files")
    .upload(storagePath, bytes, { contentType: mimeType, upsert: false });
  if (uploadError) throw new Error(uploadError.message);

  return { fileName, mimeType, sizeBytes: bytes.byteLength, storagePath };
}
