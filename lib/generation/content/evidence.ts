import type { Database, Json } from "@/lib/supabase/types";

/**
 * Deterministic, capped, per-section relevance filter over
 * `research_sources` — CD2 (docs/architecture/phase-4-5-content-generation-plan.md).
 * No LLM call. This is the mechanism that lets Content generation
 * read raw research at all (a deliberate, narrow exception to
 * Blueprint's "don't re-touch raw research" rule, §0 of that plan):
 * Blueprint only ever needed to know evidence existed, Content needs
 * the actual evidence text to write grounded prose with.
 *
 * Hard rules enforced here, matching the locked decisions exactly:
 * - never returns the full Research Package — always capped (CD2).
 * - never rewrites/summarizes a candidate's text — every returned
 *   item's `text` is either a literal string already present in a
 *   `research_sources.payload`, or a plain, non-lossy concatenation
 *   of two already-literal fields (competitor attribution — see
 *   `flattenPayload`), never a paraphrase.
 * - deterministic: same node + same `research_sources` rows always
 *   produce the same ordered output (score, then a fixed tie-break).
 */

export type ResearchSourceType = Database["public"]["Enums"]["research_source_type"];

export interface ResearchSourceRow {
  id: string;
  type: ResearchSourceType;
  payload: Json;
}

export interface ContentEvidenceItem {
  /** The exact `research_sources.id` this text came from — the only thing `evidenceUsed` (CD8) is ever allowed to reference. */
  sourceId: string;
  type: ResearchSourceType;
  /** Literal text, never invented or summarized (see module doc comment). */
  text: string;
}

/** Total evidence items handed to one section's generation call, regardless of Research Package size or document length (plan §5's flat-cost property). */
export const MAX_EVIDENCE_ITEMS = 12;

/**
 * Only these `research_source_type` values carry citable, fact-bearing
 * text (plan §4's exact list). Everything else (`topic`,
 * `secondary_queries`, `location`, `organic_results`, `parsed_pages`,
 * `failed_urls`, `field_averages`, `format_signals`,
 * `external_source_signals`, `raw_competitor_content`,
 * `research_warnings`, ...) is metadata about the research run itself,
 * not evidence a section could ground a claim in — deliberately
 * excluded from matching, not merely unhandled.
 */
const EVIDENCE_BEARING_TYPES: ReadonlySet<ResearchSourceType> = new Set([
  "common_ground_topics",
  "competitor_unique_sections",
  "content_gaps",
  "paa",
  "related_searches",
  "ai_overview",
  "serp_features",
]);

interface CompetitorUniqueSectionsPayloadEntry {
  rank?: unknown;
  source?: unknown;
  sections?: unknown;
}

/**
 * Flattens one `research_sources` row's payload into atomic candidate
 * strings, matching the exact shapes the real parser
 * (`lib/ingestion/markdown-research-parser.ts`) produces. Never
 * invents text: string[] payloads are used verbatim one item per
 * candidate; `competitor_unique_sections` (the one non-flat shape)
 * concatenates two already-literal fields (`source`, one of its own
 * `sections` entries) with a fixed separator — attribution, not
 * synthesis. A payload shape that doesn't match what's expected is
 * skipped, never guessed at.
 */
function flattenPayload(type: ResearchSourceType, payload: Json): string[] {
  if (type === "competitor_unique_sections") {
    if (!Array.isArray(payload)) return [];
    const out: string[] = [];
    for (const entry of payload as CompetitorUniqueSectionsPayloadEntry[]) {
      if (typeof entry !== "object" || entry === null) continue;
      const source = typeof entry.source === "string" ? entry.source : null;
      const sections = Array.isArray(entry.sections) ? entry.sections : [];
      for (const section of sections) {
        if (typeof section !== "string" || !section.trim()) continue;
        out.push(source ? `${source}: ${section}` : section);
      }
    }
    return out;
  }

  if (Array.isArray(payload)) {
    return payload.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  }

  return [];
}

const TOKEN_PATTERN = /[a-z0-9]+/g;
const STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "you", "are", "that", "this", "from", "how", "what", "why",
  "can", "will", "when", "who", "does", "into", "about", "not", "have", "has",
]);

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(TOKEN_PATTERN) ?? [];
  return matches.filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

// --- IDF weighting (deterministic, corpus-only — no embeddings) ---------
//
// Generic tokens ("business", "name", "company", "website", ...) must
// contribute little or no score by themselves. A fixed stopword list
// can't know which words are generic *for this Research Package* —
// "business"/"name" are exactly the words a naming-topic package is
// saturated with, so a hardcoded list would either miss them or have
// to be re-tuned per topic. Standard IDF solves this without any
// hardcoded vocabulary: a token that appears in most of this
// package's own evidence-bearing candidates gets weighted near zero;
// a token that appears in only a few gets weighted highly. Computed
// once per Research Package, independent of any one node's query —
// exactly "calculated from the current Research Package only."

/**
 * Smoothed IDF: log((N+1)/(df+1)) — always >= 0, never divides by
 * zero, and reaches exactly 0 for a token present in every candidate
 * (correctly contributing nothing). Deliberately no additive "+1"
 * floor: a floor would let a token still clear MIN_SPECIFIC_TOKEN_IDF
 * purely from the floor once df is small relative to N, even for
 * words that are common within THIS Research Package (confirmed
 * empirically against the real "how to name your business" package —
 * "business" reaches df=23/65, idf floored at +1 = 2.01, which
 * incorrectly cleared a threshold of 2; unfloored it's 1.01, well
 * below it). Without the floor, genuinely common topic words score
 * near zero exactly as required, while rare/specific words
 * ("crowded", df=2/65) still score highly (~3).
 */
function computeIdf(candidateTexts: string[]): Map<string, number> {
  const documentFrequency = new Map<string, number>();
  for (const text of candidateTexts) {
    for (const token of tokenSet(text)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const n = candidateTexts.length;
  const idf = new Map<string, number>();
  for (const [token, df] of documentFrequency) {
    idf.set(token, Math.log((n + 1) / (df + 1)));
  }
  return idf;
}

// --- Phrase matching (item 3: exact multi-word phrases score strongly) --

const PHRASE_MATCH_BONUS = 5;
/** 2- and 3-word windows only — long enough to be a real concept ("crowded bar test"), short enough to stay a literal phrase, not a whole sentence. */
const PHRASE_LENGTHS = [3, 2];

/** Extracts every contiguous 2- and 3-word phrase from `text`'s own words (not the stopword-filtered token set — a phrase like "crowded bar test" needs its real words in order, not a bag of tokens). */
function extractPhrases(text: string): string[] {
  const words = text.toLowerCase().match(TOKEN_PATTERN) ?? [];
  const phrases: string[] = [];
  for (const len of PHRASE_LENGTHS) {
    for (let i = 0; i + len <= words.length; i++) {
      phrases.push(words.slice(i, i + len).join(" "));
    }
  }
  return phrases;
}

/**
 * Phrase candidates come ONLY from `entities` — each one is already a
 * short, curated, specific multi-word concept (Blueprint's own
 * traceability guarantee, BD3), unlike `title`/`evidenceRequirement`,
 * which are free-flowing prose. Extracting n-grams from prose was
 * tried and rejected: it turns any two adjacent words into a
 * "phrase," including boring ones ("business name", "put your"),
 * defeating the entire point of a *strong* phrase-match bonus
 * (confirmed empirically — it was the actual cause of generic
 * "Business name generator" noise still qualifying in an earlier
 * version of this function).
 */
function buildQueryPhrases(query: EvidenceFilterQuery): Set<string> {
  const phrases = new Set<string>();
  for (const entity of query.entities) {
    if (entity.trim().includes(" ")) phrases.add(entity.trim().toLowerCase());
    for (const p of extractPhrases(entity)) phrases.add(p);
  }
  return phrases;
}

// --- Relevance gate (item 2: minimum threshold, no cap-filling with weak evidence) --

/** Floor on the combined (token-overlap + phrase-bonus) score. */
const MIN_RELEVANCE_SCORE = 2;
/**
 * A candidate must contain either a phrase match OR at least one
 * overlapping token whose IDF clears this bar — i.e. genuinely
 * specific to this query, not just an accumulation of several
 * generic tokens. This is what makes "generic tokens contribute
 * little or nothing BY THEMSELVES" a real gate, not just a lower
 * weight: summing many weak-generic matches can still cross
 * MIN_RELEVANCE_SCORE, but it can never satisfy this specificity
 * requirement on its own.
 */
const MIN_SPECIFIC_TOKEN_IDF = 1.5;

export interface EvidenceFilterQuery {
  entities: string[];
  evidenceRequirement: string | null;
  title: string;
}

interface ScoredCandidate extends ContentEvidenceItem {
  score: number;
}

/**
 * Deterministic keyword/entity-overlap matching against structured
 * metadata, weighted by IDF computed from this same Research Package
 * (no embeddings, no external model — plan §4/§21, given today's real
 * research payload is lightweight structured metadata, not raw
 * prose), plus a strong bonus for literal multi-word phrase matches.
 * Below-threshold candidates are excluded outright — the cap
 * (MAX_EVIDENCE_ITEMS) is a ceiling, never a target to fill with weak
 * matches; returning fewer than the cap, including zero, is the
 * correct, honest result when nothing genuinely relevant exists (plan
 * §4's "honesty on a miss" / §20) — never backfilled with something
 * "close enough."
 */
export function filterRelevantEvidence(
  query: EvidenceFilterQuery,
  researchSources: ResearchSourceRow[],
): ContentEvidenceItem[] {
  const queryTokens = tokenSet([...query.entities, query.evidenceRequirement ?? "", query.title].join(" "));
  const queryPhrases = buildQueryPhrases(query);
  if (queryTokens.size === 0 && queryPhrases.size === 0) return [];

  // Corpus for IDF = every evidence-bearing candidate text in this
  // Research Package, regardless of this node's query — a property of
  // the package alone, computed once.
  const corpusTexts: string[] = [];
  const rawCandidates: { sourceId: string; type: ResearchSourceType; text: string }[] = [];
  for (const source of researchSources) {
    if (!EVIDENCE_BEARING_TYPES.has(source.type)) continue;
    for (const text of flattenPayload(source.type, source.payload)) {
      corpusTexts.push(text);
      rawCandidates.push({ sourceId: source.id, type: source.type, text });
    }
  }
  const idf = computeIdf(corpusTexts);

  const candidates: ScoredCandidate[] = [];
  for (const candidate of rawCandidates) {
    const candidateTokens = tokenSet(candidate.text);
    const candidateLower = candidate.text.toLowerCase();

    let tokenScore = 0;
    let maxTokenIdf = 0;
    for (const token of candidateTokens) {
      if (!queryTokens.has(token)) continue;
      const weight = idf.get(token) ?? 0;
      tokenScore += weight;
      if (weight > maxTokenIdf) maxTokenIdf = weight;
    }

    let phraseMatches = 0;
    for (const phrase of queryPhrases) {
      if (phrase.length > 0 && candidateLower.includes(phrase)) phraseMatches += 1;
    }
    const phraseScore = phraseMatches * PHRASE_MATCH_BONUS;

    const score = tokenScore + phraseScore;
    const isSpecific = phraseMatches > 0 || maxTokenIdf >= MIN_SPECIFIC_TOKEN_IDF;

    if (score >= MIN_RELEVANCE_SCORE && isSpecific) {
      candidates.push({ ...candidate, score });
    }
  }

  // Deterministic regardless of input row order: score desc, then a
  // fixed lexicographic tie-break that depends only on the candidate's
  // own content (sourceId, then text) — never on discovery order.
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.sourceId !== b.sourceId) return a.sourceId < b.sourceId ? -1 : 1;
    return a.text < b.text ? -1 : a.text > b.text ? 1 : 0;
  });

  return candidates.slice(0, MAX_EVIDENCE_ITEMS).map(({ sourceId, type, text }) => ({ sourceId, type, text }));
}

// --- evidenceUsed reference shape (CD8) ---------------------------------

const EVIDENCE_REFERENCE_PREFIX = "research_source:";

/** The exact, locked `evidenceUsed` reference shape (CD8) — an ID reference, never the evidence text itself. */
export function evidenceReference(sourceId: string): string {
  return `${EVIDENCE_REFERENCE_PREFIX}${sourceId}`;
}

export function parseEvidenceReference(reference: string): string | null {
  return reference.startsWith(EVIDENCE_REFERENCE_PREFIX) ? reference.slice(EVIDENCE_REFERENCE_PREFIX.length) : null;
}

/**
 * Whitelist-strips any `evidenceUsed` entry that isn't a well-formed
 * reference to a source actually supplied in this section's evidence
 * packet — same pattern as internal-link whitelisting (links.ts),
 * applied to provenance references instead of URLs. A stripped entry
 * is not itself a fabricated fact (CD9 is enforced separately, see
 * grounding.ts) — this only guards the reference field's own
 * integrity, per CD8's "cheap signal for human review" framing.
 */
export function validateEvidenceUsed(evidenceUsed: string[], suppliedEvidence: ContentEvidenceItem[]): string[] {
  const suppliedIds = new Set(suppliedEvidence.map((e) => e.sourceId));
  const valid: string[] = [];
  for (const reference of evidenceUsed) {
    const sourceId = parseEvidenceReference(reference);
    if (sourceId && suppliedIds.has(sourceId)) {
      valid.push(reference);
    }
  }
  return valid;
}
