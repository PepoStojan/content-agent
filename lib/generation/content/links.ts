import type { ContentInternalLinkTarget } from "./input";

/**
 * Internal-link whitelist enforcement for one section's rendered
 * Markdown body (Phase 4.5 plan §8). Generalizes the exact whitelist
 * pattern already used at Brief (whole-document) and Blueprint
 * (per-node) one layer further: per-node-body-text. Content does not
 * select or invent links — it only decides *where in the prose* an
 * already-assigned link belongs; this is the deterministic,
 * post-generation check that a returned link actually is one of the
 * node's assigned targets, never trusted as emitted.
 *
 * This is also the concrete, deterministic half of CD9's "never
 * invent a URL" rule — the one grounding-rule clause that *can* be
 * fully, mechanically enforced (unlike statistics/prices/facts, which
 * cannot — see grounding.ts).
 */

const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;

export interface LinkValidationResult {
  /** The body with every non-whitelisted link's Markdown syntax removed, its anchor text kept as plain prose. */
  body: string;
  /** How many links were stripped — a non-zero count is worth surfacing to a human, same as Blueprint's word-count warning. */
  strippedCount: number;
}

/**
 * Strips any Markdown link in `body` whose target URL is not one of
 * this node's own `internalLinkTargets` (already resolved/whitelisted
 * at input-assembly time, input.ts). A section may legitimately use
 * zero, some, or all of its assigned links — this only ever removes,
 * never adds or rewrites a link's destination.
 */
export function validateInternalLinksInBody(body: string, allowedTargets: ContentInternalLinkTarget[]): LinkValidationResult {
  const allowedUrls = new Set(allowedTargets.map((t) => t.targetUrl));
  let strippedCount = 0;

  const sanitized = body.replace(MARKDOWN_LINK_PATTERN, (match, anchorText: string, url: string) => {
    if (allowedUrls.has(url.trim())) {
      return match;
    }
    strippedCount += 1;
    return anchorText;
  });

  return { body: sanitized, strippedCount };
}
