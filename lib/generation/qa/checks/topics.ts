import type { QaLeafTarget } from "../lineage";
import { containsNormalized, significantWords } from "../text";
import { finding, type DeterministicFinding } from "../types";

/**
 * `topics` (Phase 4.6 plan §2, deterministic) — does this section's
 * body actually engage with its assigned title/topic, at all? A
 * distinct question from `entities` (are the specific named
 * concepts present verbatim) — this checks the section's broader
 * subject, derived from the Blueprint node's own `title` (the same
 * field the reader sees as the heading), not from `entities`.
 *
 * Deterministic substring matching only, same discipline as every
 * other check in this pipeline — no semantic judgment, no LLM.
 * Matching is Markdown-formatting-insensitive (`containsNormalized`,
 * text.ts) so a Bold/Italic edit mid-phrase can't produce a false
 * negative — still a literal, not semantic, match.
 */
export function checkTopics(leaves: QaLeafTarget[]): DeterministicFinding[] {
  const findings: DeterministicFinding[] = [];

  for (const leaf of leaves) {
    if (leaf.body === null || leaf.contentVersionId === null) continue;

    const terms = significantWords(leaf.title);
    if (terms.length === 0) {
      findings.push(
        finding(
          "topics",
          "pass",
          `"${leaf.title}" has no substantive title terms to verify coverage against.`,
          leaf.contentVersionId,
        ),
      );
      continue;
    }

    const missing = terms.filter((term) => !containsNormalized(leaf.body as string, term));
    const matchedCount = terms.length - missing.length;
    const ratio = matchedCount / terms.length;

    if (ratio === 0) {
      findings.push(
        finding(
          "topics",
          "fail",
          `None of this section's title terms (${terms.join(", ")}) appear in its body — the text does not engage with "${leaf.title}".`,
          leaf.contentVersionId,
        ),
      );
    } else if (ratio < 0.5) {
      findings.push(
        finding(
          "topics",
          "warn",
          `Only ${matchedCount}/${terms.length} of this section's title terms appear in its body. Missing: ${missing.join(", ")}.`,
          leaf.contentVersionId,
        ),
      );
    } else {
      findings.push(
        finding("topics", "pass", `${matchedCount}/${terms.length} title terms for "${leaf.title}" are present in the body.`, leaf.contentVersionId),
      );
    }
  }

  return findings;
}
