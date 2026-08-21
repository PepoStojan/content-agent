import type { QaLeafTarget } from "../lineage";
import { finding, type DeterministicFinding } from "../types";

/** Same Markdown-link shape `lib/generation/content/links.ts` already parses — duplicated locally (not imported) because this check only ever reads, never strips, and the two modules' jobs are genuinely different (generation-time sanitization vs. QA-time re-detection, QD2). */
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * `links` (Phase 4.6 plan §2, deterministic) — re-validates the
 * internal-link whitelist against the section's *current* body,
 * regardless of how that body was produced. This closes QD2's real
 * gap directly: `lib/generation/content/links.ts` only ever strips a
 * non-whitelisted link at AI-generation time; a manually-edited
 * section (CD5) has never had this check run against it at all. QA is
 * the first and only re-check.
 */
export function checkLinks(leaves: QaLeafTarget[]): DeterministicFinding[] {
  const findings: DeterministicFinding[] = [];

  for (const leaf of leaves) {
    if (leaf.body === null || leaf.contentVersionId === null) continue;

    const allowedUrls = new Set(leaf.internalLinkTargets.map((t) => t.targetUrl));
    const offending: string[] = [];

    for (const match of leaf.body.matchAll(MARKDOWN_LINK_PATTERN)) {
      const url = match[2]?.trim();
      if (url && !allowedUrls.has(url)) offending.push(url);
    }

    if (offending.length > 0) {
      findings.push(
        finding(
          "links",
          "fail",
          `${offending.length} internal link(s) in this section's body are not in its Blueprint-assigned whitelist: ${offending.join(", ")}.`,
          leaf.contentVersionId,
        ),
      );
    } else {
      findings.push(finding("links", "pass", "Every internal link in this section's body resolves to its Blueprint-assigned whitelist.", leaf.contentVersionId));
    }
  }

  return findings;
}
