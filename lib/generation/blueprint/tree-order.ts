/**
 * The one canonical Blueprint tree document-order helper. A flat sort
 * by `(level, position)` — the shape this codebase used before this
 * fix — is NOT guaranteed to equal true document/DFS order for a
 * mixed-depth tree: it groups every node of the same depth together
 * regardless of which parent it belongs to, rather than interleaving
 * a section's own subsections immediately after it. `lib/generation/
 * qa/lineage.ts` already built a correct DFS walk for this exact
 * reason (CD6's article assembly, Phase 4.6 plan §18) — this module
 * extracts that same algorithm into one reusable, tested place so a
 * second call site (the Content Editor sidebar) can reuse it instead
 * of re-deriving its own.
 *
 * Pure, synchronous, no I/O — takes whatever node array the caller
 * already fetched and returns it re-ordered; never issues a query
 * itself.
 */

export interface TreeOrderable {
  id: string;
  parentId: string | null;
  position: number;
}

/**
 * Root-first DFS, children sorted by `position` within each parent.
 * Assumes a single root (`parentId === null`) and a well-formed tree
 * (every non-root node's `parentId` is some other node's `id`) — the
 * same shape Blueprint's own FK constraints already guarantee. A node
 * unreachable from the root (should never happen given those
 * constraints) is silently omitted, same as the original QA-lineage
 * implementation this was extracted from.
 */
export function orderNodesByDocumentPosition<T extends TreeOrderable>(nodes: T[]): T[] {
  const childrenByParent = new Map<string | null, T[]>();
  for (const node of nodes) {
    const key = node.parentId;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key)!.push(node);
  }
  for (const children of childrenByParent.values()) {
    children.sort((a, b) => a.position - b.position);
  }

  const ordered: T[] = [];
  function walk(parentId: string | null) {
    for (const node of childrenByParent.get(parentId) ?? []) {
      ordered.push(node);
      walk(node.id);
    }
  }
  walk(null);

  return ordered;
}
