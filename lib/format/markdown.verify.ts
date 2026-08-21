import assert from "node:assert/strict";

import { parseBlocks } from "./markdown";

/**
 * Deterministic regression checks for the Markdown block parser —
 * dependency-free (Node's built-in `assert`), since no test runner
 * (vitest/jest) exists in this project yet and this small, fixed
 * surface doesn't warrant adding one (same "no heavyweight
 * dependency for a small surface" discipline as the renderer itself).
 *
 * Run with: npx tsx lib/format/markdown.verify.ts
 *
 * Covers the real bug found in production content (project
 * `ce718b4d-25e1-40f6-9af5-9716c7ce1aa0`, content_version
 * `6869a7b8-ebfd-481f-b069-7680c82c7333`): a genuinely ordered list
 * whose items are separated by blank lines (a "loose list") was being
 * split into N separate single-item `<ol>` blocks, each restarting its
 * own counter at 1 — visually indistinguishable from every item
 * reading "1." Fixed by `collectListItems()` tolerating a single
 * blank line between same-type list items.
 */

let passed = 0;

function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// --- unordered list -------------------------------------------------------

check("tight unordered list ('- item') parses as one list block", () => {
  const blocks = parseBlocks("- Rushing the soffritto.\n- Not browning the meat properly.\n- Skipping the tomato paste.");
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0], {
    kind: "list",
    ordered: false,
    items: ["Rushing the soffritto.", "Not browning the meat properly.", "Skipping the tomato paste."],
  });
});

check("unordered list with '*' marker parses as one list block", () => {
  const blocks = parseBlocks("* first item\n* second item");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "list");
  assert.equal((blocks[0] as { ordered: boolean }).ordered, false);
});

check("loose unordered list (blank line between items) still merges into one list, not N", () => {
  const blocks = parseBlocks("- Rushing the soffritto.\n\n- Not browning the meat properly.\n\n- Skipping the tomato paste.");
  assert.equal(blocks.length, 1, "expected exactly one list block, not one per item");
  assert.equal(blocks[0].kind, "list");
  const list = blocks[0] as { ordered: boolean; items: string[] };
  assert.equal(list.ordered, false);
  assert.deepEqual(list.items, ["Rushing the soffritto.", "Not browning the meat properly.", "Skipping the tomato paste."]);
});

// --- ordered list -----------------------------------------------------

check("tight ordered list ('1. item') parses as one ordered list block", () => {
  const blocks = parseBlocks("1. Start with a proper soffritto.\n2. Brown the meat.\n3. Use tomato paste early.");
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0], {
    kind: "list",
    ordered: true,
    items: ["Start with a proper soffritto.", "Brown the meat.", "Use tomato paste early."],
  });
});

check("REGRESSION: loose ordered list (blank line between items) merges into ONE <ol>, not six single-item lists", () => {
  const body = [
    "1. **Rushing the soffritto.** Cooking onion too quickly leads to a raw flavor.",
    "",
    "2. **Not browning the meat properly.** Crowding the pan causes steaming.",
    "",
    "3. **Skipping the tomato paste.** Tomato paste adds richness.",
  ].join("\n");
  const blocks = parseBlocks(body);
  assert.equal(blocks.length, 1, "the real bug: this used to produce 3 separate single-item list blocks");
  assert.equal(blocks[0].kind, "list");
  const list = blocks[0] as { ordered: boolean; items: string[] };
  assert.equal(list.ordered, true);
  assert.equal(list.items.length, 3);
  assert.ok(list.items[0].startsWith("**Rushing the soffritto.**"));
  assert.ok(list.items[2].startsWith("**Skipping the tomato paste.**"));
});

// --- mixed paragraphs around lists -------------------------------------

check("paragraph, then list, then paragraph — list stays a single block, paragraphs stay separate", () => {
  const body = ["Here is the intro paragraph.", "", "1. First step.", "2. Second step.", "", "Here is the closing paragraph."].join("\n");
  const blocks = parseBlocks(body);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].kind, "paragraph");
  assert.equal(blocks[1].kind, "list");
  assert.equal((blocks[1] as { items: string[] }).items.length, 2);
  assert.equal(blocks[2].kind, "paragraph");
});

check("a loose list followed by a real new paragraph (blank line, then non-list text) ends the list correctly", () => {
  const body = ["1. First step.", "", "2. Second step.", "", "This is not a list item, just a closing paragraph."].join("\n");
  const blocks = parseBlocks(body);
  assert.equal(blocks.length, 2, "the list must end at the real paragraph, not swallow it");
  assert.equal(blocks[0].kind, "list");
  assert.equal((blocks[0] as { items: string[] }).items.length, 2);
  assert.equal(blocks[1].kind, "paragraph");
  assert.equal((blocks[1] as { text: string }).text, "This is not a list item, just a closing paragraph.");
});

check("headings, bold/italic markers, and links inside list items are preserved as raw item text (rendering is renderMarkdown's job)", () => {
  const blocks = parseBlocks("## A heading\n\n- **bold** item with a [link](https://example.com)\n- *italic* item");
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].kind, "heading");
  assert.equal(blocks[1].kind, "list");
  const list = blocks[1] as { items: string[] };
  assert.equal(list.items[0], "**bold** item with a [link](https://example.com)");
  assert.equal(list.items[1], "*italic* item");
});

console.log(`\n${passed} check(s) passed.`);
