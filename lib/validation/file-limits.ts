import type { Database } from "@/lib/supabase/types";

/**
 * Configurable upload validation limits (Architecture V1 §4).
 * Extension + MIME type are both checked where applicable — neither
 * alone is trusted, since uploaded content is untrusted input
 * (engineering spec §19).
 */

export type ProjectFileType = Database["public"]["Enums"]["project_file_type"];

interface FileLimit {
  maxBytes: number;
  extensions: string[];
  mimeTypes: string[];
}

/**
 * Typed as Record<ProjectFileType, ...> (DB enum → app), not the
 * reverse — the compiler requires this object to have exactly one
 * entry per real project_file_type value, so an enum addition/removal
 * is a compile error here instead of a silent gap.
 */
export const FILE_LIMITS: Record<ProjectFileType, FileLimit> = {
  research_csv: {
    maxBytes: 25 * 1024 * 1024,
    extensions: [".csv"],
    mimeTypes: ["text/csv", "application/vnd.ms-excel"],
  },
  research_markdown: {
    maxBytes: 10 * 1024 * 1024,
    extensions: [".md", ".markdown"],
    mimeTypes: ["text/markdown", "text/plain"],
  },
  research_docx: {
    maxBytes: 25 * 1024 * 1024,
    extensions: [".doc", ".docx"],
    mimeTypes: [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  },
  sitemap_xml: {
    maxBytes: 25 * 1024 * 1024,
    extensions: [".xml"],
    mimeTypes: ["application/xml", "text/xml"],
  },
  screaming_frog_csv: {
    maxBytes: 25 * 1024 * 1024,
    extensions: [".csv"],
    mimeTypes: ["text/csv", "application/vnd.ms-excel"],
  },
};
