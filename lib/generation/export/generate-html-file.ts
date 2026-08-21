import { EXPORT_FORMAT_MIME_TYPE } from "@/lib/generation/export/formats";
import {
  assembleHtmlArticle,
  assembleHtmlDocument,
  renderExportMetadataHtml,
} from "@/lib/generation/export/html-assembler";
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

/**
 * EXPORT-08 — the HTML format generator. Reads only from the export's
 * own already-pinned snapshot, exactly mirroring
 * `generate-markdown-file.ts`'s own query shape (the exact pinned
 * `blueprint_version_id` for structure, the exact `content_versions`
 * rows `export_content_versions` already pinned for this `exportId`
 * for body text) — never `content_documents.current_version_id` or
 * any other "current" pointer. No duplicate storage abstraction: the
 * same `project-files` Storage bucket, the same upload call shape.
 */
export async function generateHtmlFile(
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

  const articleHtml = assembleHtmlArticle(assembledNodes);
  const metadataHtml = renderExportMetadataHtml({ tier: metadataTier, evaluatedCount: evaluatedCategoryCount });
  const document = assembleHtmlDocument(articleHtml, metadataHtml, articleTitle);

  const fileName = exportFilename(articleTitle, "html");
  const mimeType = EXPORT_FORMAT_MIME_TYPE.html;
  const bytes = new TextEncoder().encode(document);
  const storagePath = `${projectId}/exports/${exportId}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from("project-files")
    .upload(storagePath, bytes, { contentType: mimeType, upsert: false });
  if (uploadError) throw new Error(uploadError.message);

  return { fileName, mimeType, sizeBytes: bytes.byteLength, storagePath };
}
