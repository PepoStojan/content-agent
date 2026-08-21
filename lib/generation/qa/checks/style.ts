import type { QaLeafTarget } from "../lineage";
import { shingles, splitSentences, wordCount } from "../text";
import { finding, type DeterministicFinding } from "../types";

/** Above this average words/sentence, prose reads as run-on — a plain heuristic, not a claim of true readability scoring. */
const LONG_SENTENCE_AVG_THRESHOLD = 30;

/** Literal 8-word shingle match is specific enough to flag real repeated prose, short enough to still catch a repeated sentence fragment. */
const SHINGLE_LENGTH = 8;

/**
 * `style` (Phase 4.6 plan §2, deterministic) — readability/repetition
 * heuristics only, deliberately not an LLM "does this sound good"
 * judgment (that would be exactly the vague AI quality score this
 * system is told to avoid). Two checks:
 *
 * 1. Per-section average sentence length — a plain run-on-prose
 *    heuristic.
 * 2. Whole-document literal cross-section repetition — the
 *    deterministic near-duplicate check Phase 4.5 §6/§21 explicitly
 *    deferred as "a real future QA-category candidate," arriving on
 *    schedule here.
 *
 * Both WARN-only (never FAIL) — a stylistic wobble is a quality
 * signal, not a trust violation (mirrors BD4's word-count-sanity
 * reasoning).
 */
export function checkStyle(leaves: QaLeafTarget[]): DeterministicFinding[] {
  const findings: DeterministicFinding[] = [];

  // --- Whole-document repetition check first (fixed placement rule: whole-document findings precede per-leaf findings within a category). ---
  const shingleToLeafTitles = new Map<string, Set<string>>();
  for (const leaf of leaves) {
    if (leaf.body === null) continue;
    const seenInThisLeaf = new Set(shingles(leaf.body, SHINGLE_LENGTH));
    for (const shingle of seenInThisLeaf) {
      if (!shingleToLeafTitles.has(shingle)) shingleToLeafTitles.set(shingle, new Set());
      shingleToLeafTitles.get(shingle)?.add(leaf.title);
    }
  }

  const repeatedAcrossSections = new Set<string>();
  for (const [, titles] of shingleToLeafTitles) {
    if (titles.size > 1) for (const t of titles) repeatedAcrossSections.add(t);
  }

  if (repeatedAcrossSections.size > 0) {
    findings.push(
      finding(
        "style",
        "warn",
        `Identical ${SHINGLE_LENGTH}-word phrase(s) appear in more than one section: ${[...repeatedAcrossSections].sort().join(", ")}.`,
        null,
      ),
    );
  } else {
    findings.push(finding("style", "pass", "No literal phrase repetition found across sections.", null));
  }

  // --- Per-section sentence-length check. ---
  for (const leaf of leaves) {
    if (leaf.body === null || leaf.contentVersionId === null) continue;

    const sentences = splitSentences(leaf.body);
    if (sentences.length === 0) continue;

    const totalWords = sentences.reduce((sum, s) => sum + wordCount(s), 0);
    const avg = totalWords / sentences.length;

    if (avg > LONG_SENTENCE_AVG_THRESHOLD) {
      findings.push(
        finding("style", "warn", `Average sentence length is ${avg.toFixed(1)} words, above the ${LONG_SENTENCE_AVG_THRESHOLD}-word run-on threshold.`, leaf.contentVersionId),
      );
    } else {
      findings.push(finding("style", "pass", `Average sentence length is ${avg.toFixed(1)} words.`, leaf.contentVersionId));
    }
  }

  return findings;
}
