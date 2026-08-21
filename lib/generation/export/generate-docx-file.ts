import { EXPORT_FORMAT_MIME_TYPE } from "@/lib/generation/export/formats";
import { assembleDocxBuffer } from "@/lib/generation/export/docx-assembler";
import type { AssembledExportNode, ExportMetadataTier } from "@/lib/generation/export/markdown-assembler";
import { exportFilename } from "@/lib/generation/export/filename";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface GeneratedExportFile {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
}

const DOCX_CREATOR = "SEO Content Maker";

/**
 * EXPORT-10B — the DOCX format generator. Mirrors
 * `generate-markdown-file.ts`/`generate-html-file.ts`'s own query
 * shape exactly (the exact pinned `blueprint_version_id` for
 * structure, the exact `content_versions` rows `export_content_versions`
 * already pinned for this `exportId` for body text) — never
 * `content_documents.current_version_id` or any other "current"
 * pointer. No new query pattern, no second Storage convention: same
 * `project-files` bucket, same upload call shape as every other
 * format.
 */
export async function generateDocxFile(
  supabase: SupabaseServerClient,
  projectId: string,
  exportId: string,
  blueprintVersionId: string,
  metadataTier: ExportMetadataTier,
  evaluatedCategoryCount: number,
): Promise<GeneratedExportFile> {
  const [{ data: rawNodes, error: nodesError }, { data: pinnedVersionIds, error: ecvError }] = await Promise.all([
    supabase.from("blueprint_nodes").select("id, parent_id, level, position, title").eq("blueprint_version_id", blueprintVersionId),
    supabase.from("export_content_versions").select("content_version_id").eq("export_id", exportId),
  ]);
  if (nodesError) throw new Error(nodesError.message);
  if (ecvError) throw new Error(ecvError.message);

  const nodes = rawNodes ?? [];
  const versionIds = (pinnedVersionIds ?? []).map((r) => r.content_version_id);

  const { data: contentVersions, error: contentVersionsError } =
    versionIds.length > 0
      ? await supabase.from("content_versions").select("id, blueprint_node_id, body").in("id", versionIds)
      : { data: [], error: null };
  if (contentVersionsError) throw new Error(contentVersionsError.message);

  const bodyByNodeId = new Map((contentVersions ?? []).map((v) => [v.blueprint_node_id, v.body]));
  const parentIds = new Set(nodes.map((n) => n.parent_id).filter((id): id is string => id !== null));

  const assembledNodes: AssembledExportNode[] = nodes.map((n) => {
    const isLeaf = !parentIds.has(n.id);
    return {
      id: n.id,
      parentId: n.parent_id,
      level: n.level,
      position: n.position,
      title: n.title,
      isLeaf,
      body: isLeaf ? (bodyByNodeId.get(n.id) ?? null) : null,
    };
  });

  const rootNode = nodes.find((n) => n.parent_id === null);
  const articleTitle = rootNode?.title ?? "export";

  const bytes = await assembleDocxBuffer(
    assembledNodes,
    { tier: metadataTier, evaluatedCount: evaluatedCategoryCount },
    { title: articleTitle, creator: DOCX_CREATOR },
  );

  const fileName = exportFilename(articleTitle, "docx");
  const mimeType = EXPORT_FORMAT_MIME_TYPE.docx;
  const storagePath = `${projectId}/exports/${exportId}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from("project-files")
    .upload(storagePath, bytes, { contentType: mimeType, upsert: false });
  if (uploadError) throw new Error(uploadError.message);

  return { fileName, mimeType, sizeBytes: bytes.byteLength, storagePath };
}
