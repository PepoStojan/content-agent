/**
 * Real parser for the Research Agent's Markdown output format, built
 * against the actual sample in samples/research/research_agent_example.md
 * (engineering spec §6 normalization fields). Deterministic text
 * parsing only — no AI involved, matches the spec's "deterministic
 * app logic" bucket.
 *
 * CSV and DOC/DOCX research formats have no real samples yet and are
 * NOT parsed by this module — those stay simulated elsewhere.
 */

export interface ParsedResearchSource {
  type:
    | "topic"
    | "primary_query"
    | "secondary_queries"
    | "location"
    | "organic_results"
    | "parsed_pages"
    | "failed_urls"
    | "content_gaps"
    | "serp_features"
    | "research_warnings";
  payload: unknown;
}

export interface ParsedResearchSummary {
  competitorCount: number;
  contentGapCount: number;
  serpFeatureCount: number;
  warningCount: number;
  topic: string | null;
  primaryQuery: string | null;
}

export interface MarkdownResearchParseResult {
  sources: ParsedResearchSource[];
  summary: ParsedResearchSummary;
}

function matchLine(markdown: string, label: string): string | null {
  const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`, "i");
  const match = markdown.match(re);
  return match ? match[1].trim() : null;
}

export function parseMarkdownResearch(markdown: string): MarkdownResearchParseResult {
  const sources: ParsedResearchSource[] = [];

  const topic = matchLine(markdown, "Topic");
  const otherKeywords = matchLine(markdown, "Other target keywords");
  const location = matchLine(markdown, "Location");

  if (topic) sources.push({ type: "topic", payload: topic });
  if (otherKeywords) {
    sources.push({
      type: "secondary_queries",
      payload: otherKeywords.split(",").map((s) => s.trim()).filter(Boolean),
    });
  }
  if (location) sources.push({ type: "location", payload: location });

  // "**Organic results returned:** 9 · **Pages parsed:** 7"
  const resultsMatch = markdown.match(
    /\*\*Organic results returned:\*\*\s*(\d+)[^\d]*\*\*Pages parsed:\*\*\s*(\d+)/i
  );
  const organicResults = resultsMatch ? Number(resultsMatch[1]) : null;
  const pagesParsed = resultsMatch ? Number(resultsMatch[2]) : null;
  if (organicResults !== null) sources.push({ type: "organic_results", payload: organicResults });

  // "**Not parsed:** rank 1 — url; rank 5 — url"
  const notParsedLine = matchLine(markdown, "Not parsed");
  const failedUrls: { rank: number; url: string }[] = [];
  if (notParsedLine) {
    for (const entry of notParsedLine.split(";")) {
      const m = entry.match(/rank\s*(\d+)\s*[—-]\s*(\S+)/i);
      if (m) failedUrls.push({ rank: Number(m[1]), url: m[2] });
    }
    sources.push({ type: "failed_urls", payload: failedUrls });
  }

  // Per-page competitor blocks: "# Result N — domain" ... metadata line.
  const resultBlocks = [...markdown.matchAll(/^# Result (\d+) — (.+)$/gm)];
  const parsedPages = resultBlocks.map((m) => ({ rank: Number(m[1]), source: m[2].trim() }));
  if (parsedPages.length > 0) sources.push({ type: "parsed_pages", payload: parsedPages });

  // Content gaps: any line flagging "Gap flag:" or "**gap**".
  const gapMatches = [...markdown.matchAll(/gap flag:/gi)];
  if (gapMatches.length > 0) {
    sources.push({ type: "content_gaps", payload: { count: gapMatches.length } });
  }

  // SERP features: presence-based, from known section headers.
  const serpFeatureNames = ["AI Overview", "People Also Ask", "Related Searches", "Video result"];
  const presentFeatures = serpFeatureNames.filter((name) =>
    new RegExp(`\\*\\*${name}`, "i").test(markdown)
  );
  if (presentFeatures.length > 0) {
    sources.push({ type: "serp_features", payload: presentFeatures });
  }

  // Warnings: failed/unparsed URLs, plus any explicit "research_warnings"-
  // style callouts the format doesn't formally separate from prose.
  const warningCount = failedUrls.length;
  if (warningCount > 0) {
    sources.push({
      type: "research_warnings",
      payload: failedUrls.map((f) => `Rank ${f.rank} (${f.url}) could not be parsed.`),
    });
  }

  const competitorCount = pagesParsed ?? parsedPages.length;

  return {
    sources,
    summary: {
      competitorCount,
      contentGapCount: gapMatches.length,
      serpFeatureCount: presentFeatures.length,
      warningCount,
      topic,
      primaryQuery: otherKeywords ? otherKeywords.split(",")[0]?.trim() ?? null : null,
    },
  };
}
