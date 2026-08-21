/**
 * The single source of truth for which export formats exist and
 * which are currently implemented (EXPORT-05/EXPORT-06). Design V1's
 * frozen four-format list, unchanged — `ALL_EXPORT_FORMATS` is never
 * shortened even while every entry in `EXPORT_FORMAT_AVAILABILITY` is
 * `false`. Imported by both the client UI (`export-review.tsx`, to
 * render "Not yet available") and the server action
 * (`export-actions.ts`, the actual authority — requirement 6's "do
 * not trust the UI's disabled state," enforced by re-checking this
 * same map server-side, not by trusting whatever the client sent).
 */
export type ExportFormat = "markdown" | "html" | "docx" | "json";

export const ALL_EXPORT_FORMATS: ExportFormat[] = ["markdown", "html", "docx", "json"];

export const FORMAT_LABEL: Record<ExportFormat, string> = {
  markdown: "Markdown",
  html: "HTML",
  docx: "DOCX",
  json: "Structured JSON",
};

/** Flipped to `true` one at a time as each format's generator ships: Markdown (EXPORT-07), HTML (EXPORT-08), Structured JSON (EXPORT-09), DOCX (EXPORT-10B) — all four Design V1 formats are now live. */
export const EXPORT_FORMAT_AVAILABILITY: Record<ExportFormat, boolean> = {
  markdown: true,
  html: true,
  docx: true,
  json: true,
};

export const EXPORT_FORMAT_MIME_TYPE: Record<ExportFormat, string> = {
  markdown: "text/markdown",
  html: "text/html",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  json: "application/json",
};

export function isExportFormat(value: string): value is ExportFormat {
  return (ALL_EXPORT_FORMATS as string[]).includes(value);
}
