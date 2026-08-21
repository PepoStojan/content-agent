"use server";

import { revalidatePath } from "next/cache";

import { canManageProfiles, requireProfile } from "@/lib/auth/session";
import { authorizeExport, computeExportGate } from "@/lib/generation/export/gate";
import { EXPORT_FORMAT_AVAILABILITY, isExportFormat, type ExportFormat } from "@/lib/generation/export/formats";
import { generateDocxFile } from "@/lib/generation/export/generate-docx-file";
import { generateHtmlFile } from "@/lib/generation/export/generate-html-file";
import { generateJsonFile } from "@/lib/generation/export/generate-json-file";
import { generateMarkdownFile } from "@/lib/generation/export/generate-markdown-file";
import { resolveExportLineage } from "@/lib/generation/export/lineage";
import type { ExportMetadataTier } from "@/lib/generation/export/markdown-assembler";
import { deriveExportVerificationTier, type ExportData } from "@/lib/generation/export/snapshot";
import { createClient } from "@/lib/supabase/server";

/**
 * EXPORT-06 — the real Export server action. `authorizeExport()` is
 * the final authority (requirement 1): everything this function reads
 * to build the gate/authorization inputs is re-fetched fresh from the
 * database, right here, in this request — never trusted from whatever
 * the client's `exportData` prop happened to show at last render. A
 * stale client, a modified request payload, or a race with another
 * change to the project cannot bypass this re-check.
 *
 * No `generation_runs`/Generation Engine involvement (ED4, unchanged)
 * — `exports.status` is the lifecycle's own source of truth.
 */

async function assertCanRequestExport() {
  const profile = await requireProfile();
  if (!canManageProfiles(profile.role)) {
    throw new Error("You don't have permission to export this project.");
  }
  return profile;
}

export interface RequestExportFile {
  format: ExportFormat;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** A time-limited signed URL, generated once at request-completion time — never a permanent public link (matches the private `project-files` bucket convention used everywhere else in this pipeline). */
  downloadUrl: string;
}

export interface RequestExportResult {
  exportId: string;
  status: "done" | "failed";
  qaBypassed: boolean;
  verificationTier: ExportData["verificationTier"];
  files: RequestExportFile[];
  error: { type: string; message: string } | null;
}

export async function requestExport(
  projectId: string,
  selectedFormats: string[],
  bypassRequested: boolean,
): Promise<RequestExportResult> {
  const profile = await assertCanRequestExport();
  const supabase = await createClient();

  // --- Input validation only — no row created for genuinely malformed input (requirement 5) ---
  if (selectedFormats.length === 0) {
    throw new Error("Select at least one export format.");
  }
  const unknownFormats = selectedFormats.filter((f) => !isExportFormat(f));
  if (unknownFormats.length > 0) {
    throw new Error(`Unrecognized export format(s): ${unknownFormats.join(", ")}.`);
  }
  const formats = selectedFormats as ExportFormat[];

  // --- Re-derive lineage/QA state fresh, server-side (requirement 1) ---
  const lineage = await resolveExportLineage(supabase, projectId);
  if (!lineage.snapshotEligibility.eligible || !lineage.blueprintVersionId) {
    throw new Error(lineage.snapshotEligibility.reason ?? "Export snapshot is not ready.");
  }
  const blueprintVersionId = lineage.blueprintVersionId;

  // --- One gate computation, one authorization check (requirement 8, "one authorization evaluation") ---
  const gate = computeExportGate({
    latestQaReport: lineage.latestQaReport,
    currentBlueprintVersionId: lineage.blueprintVersionId,
    evaluatedContentVersionIds: lineage.evaluatedContentVersionIds,
    currentContentVersionIds: lineage.currentContentVersionIds,
  });
  const auth = authorizeExport(gate, bypassRequested);
  if (!auth.authorized) {
    // Requirement 2/5: a blocked/rejected authorization never creates an exports row, normal or bypass alike.
    throw new Error(auth.rejectionReason ?? "Export is not authorized.");
  }

  // --- Requirement 4: create the immutable snapshot BEFORE any generation attempt ---
  const { data: exportRow, error: insertError } = await supabase
    .from("exports")
    .insert({
      project_id: projectId,
      brief_version_id: lineage.briefVersionId,
      blueprint_version_id: lineage.blueprintVersionId,
      qa_report_id: auth.qaReportId ?? null,
      qa_bypassed: auth.qaBypassed ?? false,
      formats,
      status: "running",
      requested_by: profile.userId,
      requested_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);
  const exportId = exportRow.id;

  const verificationTier = deriveExportVerificationTier(gate);

  // Pin the exact content-version set this snapshot covers (requirement 4) —
  // from `lineage`, already resolved above, never re-resolved via a "current" pointer.
  const versionRows = lineage.contentVersions
    .filter((v): v is typeof v & { contentVersionId: string } => v.contentVersionId !== null)
    .map((v) => ({ export_id: exportId, content_version_id: v.contentVersionId }));

  if (versionRows.length > 0) {
    const { error: ecvError } = await supabase.from("export_content_versions").insert(versionRows);
    if (ecvError) {
      return await failExport(supabase, exportId, auth.qaBypassed ?? false, verificationTier, {
        type: "snapshot_persist_failed",
        message: ecvError.message,
      });
    }
  }

  // --- Requirement 6: format availability is re-checked server-side, never trusted from the UI ---
  const unavailable = formats.filter((f) => !EXPORT_FORMAT_AVAILABILITY[f]);
  if (unavailable.length > 0) {
    // Every requested format must be available, or none of them
    // generate — all-or-nothing (ED8), never a partial silent success.
    return await failExport(supabase, exportId, auth.qaBypassed ?? false, verificationTier, {
      type: "formatter_not_implemented",
      message: `Export generation is not yet implemented for: ${unavailable.join(", ")}.`,
    });
  }

  // --- Generate every requested (now confirmed-available) format ---
  const metadataTier = verificationTier as ExportMetadataTier;
  const evaluatedCategoryCount = lineage.latestQaReport?.evaluatedCategories.length ?? 0;

  const files: RequestExportFile[] = [];

  try {
    for (const format of formats) {
      // EXPORT-07/08/09/10B implement `markdown`/`html`/`json`/`docx` —
      // this loop is written so each new format only needs its own
      // `case`, not a rewrite of the surrounding lifecycle/error handling.
      let file;
      if (format === "markdown") {
        file = await generateMarkdownFile(supabase, projectId, exportId, blueprintVersionId, metadataTier, evaluatedCategoryCount);
      } else if (format === "html") {
        file = await generateHtmlFile(supabase, projectId, exportId, blueprintVersionId, metadataTier, evaluatedCategoryCount);
      } else if (format === "docx") {
        file = await generateDocxFile(supabase, projectId, exportId, blueprintVersionId, metadataTier, evaluatedCategoryCount);
      } else if (format === "json") {
        file = await generateJsonFile(supabase, {
          projectId,
          exportId,
          blueprintVersionId,
          briefVersionId: lineage.briefVersionId,
          qaReportId: auth.qaReportId ?? null,
          qaBypassed: auth.qaBypassed ?? false,
          verificationTier,
          evaluatedCategories: lineage.latestQaReport?.evaluatedCategories ?? [],
          skippedCategories: lineage.latestQaReport?.skippedCategories ?? [],
        });
      } else {
        throw new Error(`No generator wired for format "${format}" despite it being marked available.`);
      }
      const { error: fileError } = await supabase.from("export_files").insert({
        export_id: exportId,
        format,
        file_name: file.fileName,
        storage_path: file.storagePath,
        mime_type: file.mimeType,
        size_bytes: file.sizeBytes,
      });
      if (fileError) throw new Error(fileError.message);

      const { data: signed, error: signError } = await supabase.storage
        .from("project-files")
        .createSignedUrl(file.storagePath, 3600);
      if (signError || !signed) throw new Error(signError?.message ?? "Failed to create a download link.");

      files.push({ format, fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, downloadUrl: signed.signedUrl });
    }
  } catch (e) {
    return await failExport(supabase, exportId, auth.qaBypassed ?? false, verificationTier, {
      type: "generation_failed",
      message: e instanceof Error ? e.message : "Export generation failed.",
    });
  }

  await supabase.from("exports").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", exportId);
  revalidatePath(`/projects/${projectId}`);
  return { exportId, status: "done", qaBypassed: auth.qaBypassed ?? false, verificationTier, files, error: null };
}

async function failExport(
  supabase: Awaited<ReturnType<typeof createClient>>,
  exportId: string,
  qaBypassed: boolean,
  verificationTier: ExportData["verificationTier"],
  error: { type: string; message: string },
): Promise<RequestExportResult> {
  await supabase.from("exports").update({ status: "failed", error, completed_at: new Date().toISOString() }).eq("id", exportId);
  return { exportId, status: "failed", qaBypassed, verificationTier, files: [], error };
}
