/**
 * EXPORT-07 §5 — deterministic export filenames, no timestamp, no
 * random ID. The `exports`/`export_files` rows are the actual unique
 * identity (ED8); the filename only needs to be a safe, readable slug
 * of the article's own title. Uniqueness across exports comes from
 * the Storage *path* (`{projectId}/exports/{exportId}/...`), not from
 * anything embedded in the filename itself — this function is pure
 * and format-agnostic, reusable by every future formatter (HTML,
 * DOCX, Structured JSON), not Markdown-specific.
 */
export function slugifyTitle(title: string, maxLength = 80): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const trimmed = slug.slice(0, maxLength).replace(/-+$/g, "");
  return trimmed || "export";
}

export function exportFilename(title: string, extension: string): string {
  return `${slugifyTitle(title)}.${extension}`;
}
