import { findEmDashViolations } from "@/lib/generation/brief/em-dash";

import type { QaLeafTarget } from "../lineage";
import { finding, type DeterministicFinding } from "../types";

/**
 * `forbidden_chars` (Phase 4.6 plan §2, deterministic) — re-runs the
 * exact same em-dash check Brief/Blueprint/Content's own
 * generation-time guard already uses (`findEmDashViolations`, reused
 * unmodified), against the section's *current* body. Same QD2
 * rationale as `links`/`brand`: this is the only remaining checkpoint
 * for a manually-edited section, which never has this check run
 * against it otherwise.
 */
export function checkForbiddenChars(leaves: QaLeafTarget[]): DeterministicFinding[] {
  const findings: DeterministicFinding[] = [];

  for (const leaf of leaves) {
    if (leaf.body === null || leaf.contentVersionId === null) continue;

    const violations = findEmDashViolations({ body: leaf.body });
    if (violations.length > 0) {
      findings.push(finding("forbidden_chars", "fail", "This section's body contains an em dash (—), which is forbidden.", leaf.contentVersionId));
    } else {
      findings.push(finding("forbidden_chars", "pass", "No forbidden characters found in this section's body.", leaf.contentVersionId));
    }
  }

  return findings;
}
