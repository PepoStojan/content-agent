import type { QaLeafTarget } from "../lineage";
import { wordCount } from "../text";
import { finding, type DeterministicFinding } from "../types";

/** Same WARN-level band Blueprint's own word-count sanity check uses (BD4) and the Content Editor's live word counter already surfaces — reused as a QA-time re-check, not a new threshold invented here. */
const WORD_COUNT_TOLERANCE = 0.15;

/**
 * `structure` (Phase 4.6 plan §0/§2, deterministic) — two distinct
 * checks under one category:
 *
 * 1. Leaf coverage (whole-document, `contentVersionId: null`): does
 *    every leaf node of the pinned Blueprint version actually have
 *    generated content? A naive "loop over existing content_documents"
 *    implementation would silently miss an incomplete document — this
 *    is the direct fix (Phase 4.6 plan §0's named gap).
 * 2. Per-section word-count sanity: is each generated section's
 *    length within Blueprint's own target band? WARN-level only,
 *    mirroring BD4 exactly — a word-count deviation is a quality
 *    signal, never a trust violation.
 */
export function checkStructure(leaves: QaLeafTarget[]): DeterministicFinding[] {
  const findings: DeterministicFinding[] = [];

  const missing = leaves.filter((l) => l.contentVersionId === null);
  if (missing.length === 0) {
    findings.push(finding("structure", "pass", `All ${leaves.length} leaf section(s) of the approved Blueprint have generated content.`, null));
  } else if (missing.length === leaves.length) {
    findings.push(finding("structure", "fail", "No leaf sections have generated content yet.", null));
  } else {
    findings.push(
      finding(
        "structure",
        "warn",
        `${missing.length}/${leaves.length} leaf section(s) have no generated content yet: ${missing.map((l) => l.title).join(", ")}.`,
        null,
      ),
    );
  }

  for (const leaf of leaves) {
    if (leaf.body === null || leaf.contentVersionId === null) continue;
    if (leaf.targetWordCount === null || leaf.targetWordCount <= 0) continue;

    const actual = wordCount(leaf.body);
    const band = leaf.targetWordCount * WORD_COUNT_TOLERANCE;
    const deviation = Math.abs(actual - leaf.targetWordCount);

    if (deviation <= band) {
      findings.push(
        finding("structure", "pass", `"${leaf.title}" is ${actual} words, within target (${leaf.targetWordCount} ±15%).`, leaf.contentVersionId),
      );
    } else {
      findings.push(
        finding(
          "structure",
          "warn",
          `"${leaf.title}" is ${actual} words, outside its target band (${leaf.targetWordCount} ±15%).`,
          leaf.contentVersionId,
        ),
      );
    }
  }

  return findings;
}
