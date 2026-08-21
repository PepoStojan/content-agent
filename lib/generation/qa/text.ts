/**
 * Small, self-contained deterministic text helpers for the QA
 * checks. Deliberately not shared with
 * `lib/generation/content/evidence.ts` — that module's tokenizer/IDF
 * machinery is tuned for research-evidence relevance matching, a
 * different problem with different tuning; QA's checks need only
 * plain, stable word/sentence primitives.
 */

const WORD_PATTERN = /[a-z0-9']+/g;

/** Lowercase word list, in order of appearance (not deduplicated) — used for word counts and case-insensitive containment checks. */
export function extractWords(text: string): string[] {
  return text.toLowerCase().match(WORD_PATTERN) ?? [];
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

const QA_STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "you", "are", "that", "this", "from", "how", "what", "why", "into",
  "about", "not", "have", "has", "will", "can", "when", "who", "does", "a", "an", "of", "to", "in", "on",
  "is", "it", "be", "as", "at", "by", "or", "if", "so", "we", "our", "us",
]);

/** Words worth checking for topical presence — length-4+, stripped of generic connective words. Deterministic, no external vocabulary. */
export function significantWords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of extractWords(text)) {
    if (word.length < 4 || QA_STOPWORDS.has(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

/** Case-insensitive substring containment — same "literal, not semantic" matching discipline as the rest of this deterministic pipeline. Exact/raw: used where formatting must NOT be normalized away (e.g. link-URL and em-dash checks stay on the untouched body). */
export function containsCaseInsensitive(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Strips Markdown formatting syntax for matching purposes only — never
 * applied to the stored or rendered body, only to a throwaway copy
 * used for substring comparison. Fixes a real, confirmed false
 * negative (Phase 4.6 QA audit, 2026-08-20): the Content Editor's own
 * Markdown toolbar can wrap a single word mid-phrase (`The
 * **crowded** bar test`), which breaks a literal substring match
 * against the unformatted entity/topic term (`the crowded bar test`)
 * even though the phrase is fully present and correctly covered.
 *
 * Deliberately narrow — this removes Markdown *syntax* only
 * (emphasis/strikethrough/inline-code delimiters, link/image
 * brackets, heading/list-item markers), not semantic normalization:
 * no stemming, no synonym handling, no fuzzy/embedding matching. A
 * genuinely absent term still fails to match after normalization,
 * same as before.
 */
export function normalizeForMatching(text: string): string {
  let result = text;
  // Markdown images/links: ![alt](url) / [text](url) -> alt / text.
  result = result.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Emphasis/strikethrough/inline-code delimiters: drop the marker
  // characters, keep the wrapped text — handles markers with no
  // surrounding whitespace ("**crowded**") without merging adjacent
  // words incorrectly, since only the delimiter characters themselves
  // are removed, not the text between them.
  result = result.replace(/[*_~`]/g, "");
  // Heading markers at line start ("## Title" -> "Title").
  result = result.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  // List-item markers at line start ("- item" / "1. item" -> "item").
  result = result.replace(/^\s*(?:[-+]\s+|\d+\.\s+)/gm, "");
  // Collapse whitespace left behind by the removals above.
  result = result.replace(/\s+/g, " ").trim();
  return result.toLowerCase();
}

/**
 * Case-insensitive, Markdown-formatting-insensitive substring
 * containment — the matching primitive for topic/entity coverage
 * checks specifically (reused by both, per this task's requirement).
 * Not used by any check that needs the raw, unformatted body (links,
 * forbidden_chars, brand) — those stay on `containsCaseInsensitive`
 * or their own exact-match logic, unchanged.
 */
export function containsNormalized(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizeForMatching(needle);
  if (!normalizedNeedle) return false;
  return normalizeForMatching(haystack).includes(normalizedNeedle);
}

/** Splits body text into sentences on `.`/`!`/`?` followed by whitespace — a plain heuristic, not a full sentence-boundary parser. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface ParsedEntity {
  /** The entity exactly as assigned by the Blueprint, unmodified. */
  raw: string;
  /** The entity's own text with any trailing parenthetical alias removed. */
  primary: string;
  /** Comma/semicolon-separated alternate terms extracted from a trailing `(...)` on the entity string, if present. */
  aliases: string[];
}

const TRAILING_PARENTHETICAL = /^(.*?)\s*\(([^()]+)\)\s*$/;

/**
 * Splits a Blueprint-assigned entity string like `"Bolognese sauce
 * (ragu alla bolognese)"` into its primary term and alias list. Fixes
 * a real, confirmed QA false positive (LEAVES-01): the previous
 * matcher treated the entire label — including the parenthetical
 * alias — as one literal string to search for, so a body that
 * genuinely covers "Bolognese sauce" was reported as missing the
 * entity because it never repeats the Italian alias verbatim.
 *
 * Deliberately narrow: recognizes exactly one trailing `(...)` group
 * at the end of the string (Blueprint's own entity-authoring
 * convention, matching the example in the finding this fixes) — not
 * a general parenthetical-stripping pass over arbitrary text, and not
 * applied anywhere except this one parsing step. An entity with no
 * trailing parenthetical is returned unchanged, `aliases: []`,
 * preserving today's exact-primary-match behavior for every entity
 * that isn't of this shape.
 */
export function parseEntity(entity: string): ParsedEntity {
  const trimmed = entity.trim();
  const match = trimmed.match(TRAILING_PARENTHETICAL);
  if (!match) return { raw: entity, primary: trimmed, aliases: [] };

  const primary = match[1].trim();
  if (!primary) return { raw: entity, primary: trimmed, aliases: [] };

  const aliases = match[2]
    .split(/[,;]/)
    .map((a) => a.trim())
    .filter(Boolean);

  return { raw: entity, primary, aliases };
}

export type EntityCoverage = "full" | "partial" | "none";

export interface EntityCoverageResult {
  coverage: EntityCoverage;
  /** The representation (primary or an alias) that produced the best coverage, or null if nothing matched at all. */
  matchedOn: string | null;
}

function rankCoverage(c: EntityCoverage): number {
  return c === "full" ? 2 : c === "partial" ? 1 : 0;
}

/**
 * QD10 (docs/architecture/phase-4-6-qa-plan.md, locked 2026-08-20,
 * QA-13) — scores one candidate representation (the entity's primary
 * text, or one of its aliases) against the body using normalized
 * significant-word coverage, not literal contiguous-phrase matching
 * and not a ratio threshold:
 *
 * - `full`    — every one of the representation's own significant
 *   words (`significantWords()`) is found somewhere in the body
 *   (order-independent — this is what fixes the real, audited
 *   false-negative bug where a multi-word entity is split across
 *   clauses/sentences or reordered in natural prose, QA-10).
 * - `partial` — at least one significant word is present, but not
 *   all. A single generic token can never produce `full` on its own
 *   (QA-11's audited false-positive fix) — anything short of full
 *   lexical coverage is capped at `partial`.
 * - `none`    — zero significant words are present.
 *
 * A representation with no significant words (too short/generic to
 * tokenize, a real but rare shape) falls back to the pre-QD10 exact
 * literal `containsNormalized()` check, preserving today's behavior
 * for that edge case rather than vacuously treating it as covered.
 */
function scoreRepresentation(body: string, phrase: string): { coverage: EntityCoverage; matchedWordCount: number; totalWordCount: number } {
  const words = significantWords(phrase);
  if (words.length === 0) {
    const hit = containsNormalized(body, phrase);
    return { coverage: hit ? "full" : "none", matchedWordCount: hit ? 1 : 0, totalWordCount: 1 };
  }
  const matchedWordCount = words.filter((w) => containsNormalized(body, w)).length;
  const coverage: EntityCoverage = matchedWordCount === 0 ? "none" : matchedWordCount === words.length ? "full" : "partial";
  return { coverage, matchedWordCount, totalWordCount: words.length };
}

/**
 * Deterministic, Markdown-formatting-insensitive coverage check for
 * one Blueprint-assigned entity against a section's body. Reuses,
 * unmodified: `parseEntity()`'s primary/alias split (LEAVES-01) and
 * `containsNormalized()`'s Markdown-syntax normalization (the earlier
 * Phase 4.6 fix) — QD10 changes only *how many of a representation's
 * own words* must be found, never *how* "found" is determined or
 * *whether* aliases are considered.
 *
 * Each candidate representation (the primary text, then each alias
 * independently) is scored via `scoreRepresentation()`; the entity's
 * overall coverage is the best (highest-ranked) result across all
 * candidates — the same "primary or alias, whichever is stronger"
 * precedent LEAVES-01 established, generalized from a single
 * literal-phrase check to a word-set check per representation.
 *
 * No LLM, no embeddings, no fuzzy-matching library, no external API —
 * pure, synchronous, local word-membership counting.
 */
export function evaluateEntityCoverage(body: string, entity: string): EntityCoverageResult {
  const { primary, aliases } = parseEntity(entity);
  const candidates = [primary, ...aliases];

  let best: { coverage: EntityCoverage; text: string } = { coverage: "none", text: primary };

  for (const candidate of candidates) {
    const score = scoreRepresentation(body, candidate);
    if (rankCoverage(score.coverage) > rankCoverage(best.coverage)) {
      best = { coverage: score.coverage, text: candidate };
    }
  }

  return { coverage: best.coverage, matchedOn: best.coverage === "none" ? null : best.text };
}

/** Contiguous `n`-word shingles (lowercase words, in order) — used for literal cross-section repetition detection. */
export function shingles(text: string, n: number): string[] {
  const words = extractWords(text);
  const out: string[] = [];
  for (let i = 0; i + n <= words.length; i++) {
    out.push(words.slice(i, i + n).join(" "));
  }
  return out;
}
