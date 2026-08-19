import type { StrategyBriefInternalLink } from "./schema";

/**
 * Strips any AI-proposed internal link whose target_url wasn't
 * actually supplied as real Website Knowledge context (website_urls
 * or internal_link_candidates rows passed into the prompt) — the
 * model is never trusted to invent a plausible-looking URL (Phase
 * 4.3 plan §0.3/§7). `availableUrls` must be exactly the set of URLs
 * the model was actually given, never a broader lookup.
 */

export interface BriefInternalLinkDraft {
  anchorText: string;
  targetUrl: string;
}

export function validateInternalLinks(
  proposed: StrategyBriefInternalLink[],
  availableUrls: ReadonlySet<string>,
): BriefInternalLinkDraft[] {
  return proposed
    .filter((link) => availableUrls.has(link.targetUrl))
    .map((link) => ({ anchorText: link.anchorText, targetUrl: link.targetUrl }));
}
