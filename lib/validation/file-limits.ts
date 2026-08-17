/**
 * Configurable upload validation limits (Architecture V1 §4).
 * Extension + MIME type are both checked where applicable — neither
 * alone is trusted, since uploaded content is untrusted input
 * (engineering spec §19).
 */
export const FILE_LIMITS = {
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
} as const;

export type ProjectFileType = keyof typeof FILE_LIMITS;
