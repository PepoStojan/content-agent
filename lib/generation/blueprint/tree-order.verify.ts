import assert from "node:assert/strict";

import { orderNodesByDocumentPosition, type TreeOrderable } from "./tree-order";

/**
 * Deterministic regression checks for the shared Blueprint tree
 * document-order helper — dependency-free (Node's built-in `assert`),
 * same pattern as `lib/format/markdown.verify.ts`.
 *
 * Run with: npx tsx lib/generation/blueprint/tree-order.verify.ts
 *
 * Covers the real bug: `page.tsx` previously derived the Content
 * Editor's section order from a flat `(level, position)` sort, which
 * groups every node of the same depth together instead of
 * interleaving a section's own subsections immediately after it —
 * wrong for any mixed-depth Blueprint. Fixed by extracting the
 * already-correct DFS walk from `lib/generation/qa/lineage.ts` into
 * this one shared, reusable helper.
 */

let passed = 0;

function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

function node(id: string, parentId: string | null, position: number): TreeOrderable {
  return { id, parentId, position };
}

// --- flat document ----------------------------------------------------

check("flat document: order matches root's children position order", () => {
  const nodes = [
    node("root", null, 0),
    node("c", "root", 2),
    node("a", "root", 0),
    node("b", "root", 1),
  ];
  const ordered = orderNodesByDocumentPosition(nodes).map((n) => n.id);
  assert.deepEqual(ordered, ["root", "a", "b", "c"]);
});

// --- mixed-depth document, modeled on project 64f3a6aa-3090-457a-ae54-3a1d506a87d2 ---
//
// Real structure observed live: a root ("How to Name Your Business"),
// several level-1 top sections (some with no children — leaves
// themselves), and level-1 sections that DO have level-2 subsection
// children (leaves one level deeper). A flat (level, position) sort
// would list every level-1 node first, then every level-2 node after
// — grouping "Step 2" together with "Step 5" before either section's
// own subsections. True document order must interleave a section's
// subsections immediately after that section, before its next sibling.

check("REGRESSION: mixed-depth document interleaves subsections under their own parent, not grouped by depth", () => {
  const nodes = [
    node("root", null, 0),
    node("intro", "root", 0), // leaf, level 1
    node("step1", "root", 1), // leaf, level 1 (no children)
    node("step2", "root", 2), // has children -> not a leaf
    node("step2-sub-a", "step2", 0), // leaf, level 2
    node("step2-sub-b", "step2", 1), // leaf, level 2
    node("step3", "root", 3), // leaf, level 1
    node("step4", "root", 4), // has children
    node("step4-sub-a", "step4", 0), // leaf, level 2
    node("conclusion", "root", 5), // leaf, level 1
  ];
  const ordered = orderNodesByDocumentPosition(nodes).map((n) => n.id);

  assert.deepEqual(ordered, [
    "root",
    "intro",
    "step1",
    "step2",
    "step2-sub-a",
    "step2-sub-b",
    "step3",
    "step4",
    "step4-sub-a",
    "conclusion",
  ]);

  // The specific failure a flat (level, position) sort would have
  // produced: every level-1 node before every level-2 node, e.g.
  // "step3" appearing before "step2-sub-a" (wrong — step2's own
  // subsections belong immediately after step2, before step3).
  assert.ok(ordered.indexOf("step2-sub-a") < ordered.indexOf("step3"), "step2's subsection must come before step3");
  assert.ok(ordered.indexOf("step2-sub-b") < ordered.indexOf("step3"), "step2's subsection must come before step3");
});

check("leaf filtering after DFS ordering preserves document order (Content Editor's actual usage)", () => {
  const nodes = [
    node("root", null, 0),
    node("a", "root", 0),
    node("b", "root", 1),
    node("b-sub", "b", 0),
    node("c", "root", 2),
  ];
  const ordered = orderNodesByDocumentPosition(nodes);
  const parentIds = new Set(nodes.map((n) => n.parentId).filter((id): id is string => id !== null));
  const leafIds = ordered.filter((n) => !parentIds.has(n.id)).map((n) => n.id);
  // "b" is not a leaf (has "b-sub"); document order among leaves is a, b-sub, c.
  assert.deepEqual(leafIds, ["a", "b-sub", "c"]);
});

check("status/any non-tree field never influences order (order depends only on parentId/position)", () => {
  interface FakeSection extends TreeOrderable {
    status: "approved" | "not_generated";
  }
  const nodes: FakeSection[] = [
    { id: "root", parentId: null, position: 0, status: "approved" },
    { id: "a", parentId: "root", position: 0, status: "not_generated" },
    { id: "b", parentId: "root", position: 1, status: "approved" },
  ];
  const ordered = orderNodesByDocumentPosition(nodes).map((n) => n.id);
  assert.deepEqual(ordered, ["root", "a", "b"], "order must follow position regardless of status value");
});

console.log(`\n${passed} check(s) passed.`);
