import type { BlueprintNodeDraft } from "./nodes";

/**
 * Generalizes lib/generation/brief/internal-links.ts's whitelist rule
 * to run per-node instead of once for the whole document (plan §7): a
 * node's internal link proposals may only reference a `targetUrl`
 * that appears verbatim in the Website Knowledge actually supplied at
 * Blueprint generation time — anything else is stripped, never
 * trusted as-is.
 *
 * `availableLinks` maps url -> source row id (from `website_urls` or
 * `internal_link_candidates`, whichever supplied it), so a validated
 * link carries a real `candidateId` for traceability into
 * `blueprint_nodes.internal_link_targets` (plan §7's stored shape),
 * without requiring the model to fabricate-proof reference an opaque
 * database id directly — the model only ever deals in URLs, same
 * contract already proven for Brief.
 */

export interface BlueprintInternalLinkDraft {
  candidateId: string;
  anchorText: string;
  reason: string;
}

export function validateNodeInternalLinks(
  nodes: BlueprintNodeDraft[],
  availableLinks: ReadonlyMap<string, string>,
): Map<string, BlueprintInternalLinkDraft[]> {
  const validated = new Map<string, BlueprintInternalLinkDraft[]>();
  for (const node of nodes) {
    const links = node.internalLinks
      .filter((link) => availableLinks.has(link.targetUrl))
      .map((link) => ({
        candidateId: availableLinks.get(link.targetUrl)!,
        anchorText: link.anchorText,
        reason: link.reason,
      }));
    validated.set(node.id, links);
  }
  return validated;
}
