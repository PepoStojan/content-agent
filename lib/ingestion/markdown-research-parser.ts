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

import type { Database } from "@/lib/supabase/types";

/**
 * `type` is the full DB `research_source_type` enum (18 members), not
 * hand-limited to the ~10 this parser currently emits — this parser
 * is a partial producer of a database-defined vocabulary, not the
 * owner of it.
 */
export interface ParsedResearchSource {
  type: Database["public"]["Enums"]["research_source_type"];
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

// --- Coverage Map extraction -------------------------------------------
//
// The Research Agent format's "COVERAGE MAP" (PART 1-3, see
// samples/research/research_agent_example.md) carries the actual
// competitive-analysis evidence — common-ground topics, per-competitor
// unique angles, PAA questions, AI Overview points, Related Searches,
// and named content gaps. Everything below is scoped strictly to
// those three PART sections (never the "# RAW CONTENT" dump that
// follows them) so nothing from a competitor's own scraped page text
// is ever mistaken for the Research Agent's own analysis. If a marker
// heading isn't present (a differently-shaped input), the relevant
// extractor simply returns nothing — never a guess.

export interface CompetitorUniqueSections {
  rank: number;
  source: string;
  sections: string[];
}

/** Slices out the text between `startMarker` and whichever `endMarkers` match first after it. Returns "" if `startMarker` isn't found. */
function extractSection(markdown: string, startMarker: RegExp, endMarkers: RegExp[]): string {
  const startMatch = startMarker.exec(markdown);
  if (!startMatch) return "";

  const startIndex = startMatch.index;
  let endIndex = markdown.length;
  for (const endMarker of endMarkers) {
    const endMatch = endMarker.exec(markdown);
    if (endMatch && endMatch.index > startIndex && endMatch.index < endIndex) {
      endIndex = endMatch.index;
    }
  }
  return markdown.slice(startIndex, endIndex);
}

/** The block of text immediately following a bold section label, up to the next blank-line-then-bold-label boundary (or end of `sectionText`). */
function extractLabeledBlock(sectionText: string, labelPattern: RegExp): string | null {
  const labelMatch = labelPattern.exec(sectionText);
  if (!labelMatch) return null;
  const afterLabel = sectionText.slice(labelMatch.index + labelMatch[0].length);
  const nextLabel = /\n\s*\n\*\*/.exec(afterLabel);
  return nextLabel ? afterLabel.slice(0, nextLabel.index) : afterLabel;
}

/** "**Title text**" inside a bullet line, else the text before an em-dash separator, else the whole line. Never invents a title the line doesn't contain. */
function extractBulletTitle(line: string): string {
  const bold = line.match(/\*\*(.+?)\*\*/);
  if (bold) return bold[1].trim();
  const [beforeDash] = line.split(/\s+—\s+/);
  return beforeDash.trim();
}

/** PART 1 — COMMON GROUND: numbered, bolded topic headers ("**1. Title**"). */
function extractCommonGroundTopics(partOneText: string): string[] {
  const matches = [...partOneText.matchAll(/^\*\*\d+\.\s+(.+?)\*\*\s*$/gm)];
  return matches.map((m) => m[1].trim()).filter(Boolean);
}

/** PART 2 — UNIQUE SECTIONS, PER COMPETITOR: one entry per "### Rank N — domain" block that has an explicit "Unique sections:" list. A competitor with no unique-sections list (e.g. a failed/error page) is skipped, never backfilled. */
function extractCompetitorUniqueSections(partTwoText: string): CompetitorUniqueSections[] {
  const headings = [...partTwoText.matchAll(/^### Rank (\d+) — (.+)$/gm)];
  const results: CompetitorUniqueSections[] = [];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const chunkStart = heading.index + heading[0].length;
    const chunkEnd = i + 1 < headings.length ? headings[i + 1].index : partTwoText.length;
    const chunk = partTwoText.slice(chunkStart, chunkEnd);

    if (!/unique sections/i.test(chunk)) continue;

    const sections = [...chunk.matchAll(/^- (.+)$/gm)].map((m) => extractBulletTitle(m[1])).filter(Boolean);
    if (sections.length === 0) continue;

    results.push({ rank: Number(heading[1]), source: heading[2].trim(), sections });
  }

  return results;
}

/** PART 3 — SERP FEATURE COVERAGE: the "**Gap flag:**" callout(s) — verbatim text, never just a count. */
function extractContentGapFlags(partThreeText: string): string[] {
  const matches = [...partThreeText.matchAll(/\*\*Gap flag:\*\*\s*(.+)/gi)];
  return matches.map((m) => m[1].trim()).filter(Boolean);
}

/** PART 3: the "**People Also Ask** questions:" bullet list — the quoted question text only. */
function extractPaaQuestions(partThreeText: string): string[] {
  const block = extractLabeledBlock(partThreeText, /\*\*People Also Ask\*\*[^\n]*/i);
  if (!block) return [];
  return [...block.matchAll(/^- "([^"]+)"/gm)].map((m) => m[1].trim()).filter(Boolean);
}

/** PART 3: the "**Related Searches**" line — every quoted phrase it lists, with a trailing list-comma (if the source punctuated it inside the quotes) stripped. */
function extractRelatedSearches(partThreeText: string): string[] {
  const line = /\*\*Related Searches\*\*[^\n]*/i.exec(partThreeText);
  if (!line) return [];
  return [...line[0].matchAll(/"([^"]+)"/g)]
    .map((m) => m[1].trim().replace(/,$/, "").trim())
    .filter(Boolean);
}

/** PART 3: the "**AI Overview** covers N points:" numbered list. */
function extractAiOverviewPoints(partThreeText: string): string[] {
  const block = extractLabeledBlock(partThreeText, /\*\*AI Overview\*\*[^\n]*/i);
  if (!block) return [];
  return [...block.matchAll(/^\d+\.\s+(.+)$/gm)].map((m) => m[1].trim()).filter(Boolean);
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

  // Coverage Map (PART 1-3) — scoped strictly to those sections, never
  // the "# RAW CONTENT" dump that follows them.
  const partOneText = extractSection(markdown, /^## PART 1\b.*$/m, [/^## PART 2\b.*$/m]);
  const partTwoText = extractSection(markdown, /^## PART 2\b.*$/m, [/^## PART 3\b.*$/m]);
  const partThreeText = extractSection(markdown, /^## PART 3\b.*$/m, [/^# RAW CONTENT\b.*$/m]);

  const commonGroundTopics = extractCommonGroundTopics(partOneText);
  if (commonGroundTopics.length > 0) {
    sources.push({ type: "common_ground_topics", payload: commonGroundTopics });
  }

  const competitorUniqueSections = extractCompetitorUniqueSections(partTwoText);
  if (competitorUniqueSections.length > 0) {
    sources.push({ type: "competitor_unique_sections", payload: competitorUniqueSections });
  }

  // Content gaps: the "**Gap flag:**" callout(s), verbatim — not a count.
  const gapFlags = extractContentGapFlags(partThreeText);
  if (gapFlags.length > 0) {
    sources.push({ type: "content_gaps", payload: gapFlags });
  }

  const paaQuestions = extractPaaQuestions(partThreeText);
  if (paaQuestions.length > 0) {
    sources.push({ type: "paa", payload: paaQuestions });
  }

  const relatedSearches = extractRelatedSearches(partThreeText);
  if (relatedSearches.length > 0) {
    sources.push({ type: "related_searches", payload: relatedSearches });
  }

  const aiOverviewPoints = extractAiOverviewPoints(partThreeText);
  if (aiOverviewPoints.length > 0) {
    sources.push({ type: "ai_overview", payload: aiOverviewPoints });
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
      contentGapCount: gapFlags.length,
      serpFeatureCount: presentFeatures.length,
      warningCount,
      topic,
      primaryQuery: otherKeywords ? otherKeywords.split(",")[0]?.trim() ?? null : null,
    },
  };
}
