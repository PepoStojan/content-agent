import { findForbiddenPhraseViolations, findProhibitedClaimViolations } from "@/lib/generation/brief/brand-compliance";

import type { QaBrandContext, QaBusinessContext, QaLeafTarget } from "../lineage";
import { finding, type DeterministicFinding } from "../types";

/**
 * `brand` (Phase 4.6 plan §2, deterministic) — re-runs the exact same
 * forbidden-phrase/prohibited-claim checks Brief/Blueprint/Content's
 * own generation-time guards already use (`findForbiddenPhraseViolations`/
 * `findProhibitedClaimViolations`, reused unmodified, not
 * reimplemented), against the section's *current* body. Same QD2
 * rationale as `links`: a manually-edited section has never had this
 * check run against it. FAIL for either violation type, matching the
 * severity `assertBrandCompliance` already applies at generation time
 * (both throw there) — re-running the same guard should be exactly as
 * strict, not softer, for content that reaches QA by a different path.
 */
export function checkBrand(leaves: QaLeafTarget[], brand: QaBrandContext | null, business: QaBusinessContext | null): DeterministicFinding[] {
  const findings: DeterministicFinding[] = [];
  const forbiddenPhrases = brand?.forbiddenPhrases ?? [];
  const prohibitedClaims = business?.prohibitedClaims ?? null;

  for (const leaf of leaves) {
    if (leaf.body === null || leaf.contentVersionId === null) continue;

    const fields = { body: leaf.body };
    const forbidden = findForbiddenPhraseViolations(fields, forbiddenPhrases);
    const prohibited = findProhibitedClaimViolations(fields, prohibitedClaims);

    if (forbidden.length === 0 && prohibited.length === 0) {
      findings.push(finding("brand", "pass", "No forbidden phrases or prohibited-claim language found in this section's body.", leaf.contentVersionId));
      continue;
    }

    const parts: string[] = [];
    if (forbidden.length > 0) parts.push(`forbidden phrase(s): ${forbidden.map((v) => `"${v.phrase}"`).join(", ")}`);
    if (prohibited.length > 0) parts.push(`prohibited-claim language: ${prohibited.map((v) => `"${v.clause}"`).join(", ")}`);

    findings.push(finding("brand", "fail", `This section's body contains ${parts.join("; ")}.`, leaf.contentVersionId));
  }

  return findings;
}
