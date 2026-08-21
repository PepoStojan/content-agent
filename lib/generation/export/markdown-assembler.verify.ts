import assert from "node:assert/strict";

import { appendExportMetadata, assembleMarkdownArticle, type AssembledExportNode } from "./markdown-assembler";
import { exportFilename, slugifyTitle } from "./filename";

/**
 * Deterministic regression checks for the Markdown formatter
 * (EXPORT-07) — dependency-free (Node's built-in `assert`), same
 * pattern as every other `.verify.ts` in this codebase.
 *
 * Run with: npx tsx lib/generation/export/markdown-assembler.verify.ts
 */

let passed = 0;

function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

function node(partial: Partial<AssembledExportNode> & { id: string; parentId: string | null; level: number; position: number; title: string }): AssembledExportNode {
  return { isLeaf: false, body: null, ...partial };
}

// --- 1. Normal article: root + two leaf sections -------------------------

check("1. normal article: root heading (H1) + leaf headings (H2) + verbatim bodies, in order", () => {
  const nodes: AssembledExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "How to Make Spaghetti Bolognese" }),
    node({ id: "intro", parentId: "root", level: 1, position: 0, title: "Introduction", isLeaf: true, body: "This is the introduction paragraph." }),
    node({ id: "ingredients", parentId: "root", level: 1, position: 1, title: "Ingredients", isLeaf: true, body: "You will need ground beef and tomatoes." }),
  ];
  const article = assembleMarkdownArticle(nodes);
  assert.equal(
    article,
    "# How to Make Spaghetti Bolognese\n\n" +
      "## Introduction\n\nThis is the introduction paragraph.\n\n" +
      "## Ingredients\n\nYou will need ground beef and tomatoes.\n",
  );
});

// --- 2. Nested Blueprint structure: a structural node with leaf children --

check("2. nested structure: a structural (non-leaf) node contributes only its own heading, no body, children nest under it in document order", () => {
  const nodes: AssembledExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Guide" }),
    node({ id: "steps", parentId: "root", level: 1, position: 0, title: "Step-by-Step Instructions" }), // structural, no children content of its own
    node({ id: "step1", parentId: "steps", level: 2, position: 0, title: "Step 1: Prep", isLeaf: true, body: "Prep the ingredients." }),
    node({ id: "step2", parentId: "steps", level: 2, position: 1, title: "Step 2: Cook", isLeaf: true, body: "Cook everything together." }),
  ];
  const article = assembleMarkdownArticle(nodes);
  assert.equal(
    article,
    "# Guide\n\n" +
      "## Step-by-Step Instructions\n\n" +
      "### Step 1: Prep\n\nPrep the ingredients.\n\n" +
      "### Step 2: Cook\n\nCook everything together.\n",
  );
});

// --- 3/4/5/7. Body content passthrough: lists, bold/italic, links (byte-for-byte, no re-parsing) ---

check("3/4/5/7. ordered lists, unordered lists, bold/italic, and links pass through the leaf body verbatim, untouched", () => {
  const body =
    "Some **bold** and *italic* text with a [link](https://example.com).\n\n" +
    "- unordered one\n- unordered two\n\n" +
    "1. ordered one\n2. ordered two";
  const nodes: AssembledExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
    node({ id: "section", parentId: "root", level: 1, position: 0, title: "Formatting", isLeaf: true, body }),
  ];
  const article = assembleMarkdownArticle(nodes);
  assert.ok(article.includes(body), "the exact body text must appear verbatim, not re-serialized through a second parser");
  assert.ok(article.startsWith("# Article\n\n## Formatting\n\n"));
});

// --- 6. Existing Markdown heading inside the body: no duplicate heading --

check("6. a leaf body that already starts with a heading matching its own title is not duplicated", () => {
  const nodes: AssembledExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
    node({
      id: "section",
      parentId: "root",
      level: 1,
      position: 0,
      title: "Already Headed",
      isLeaf: true,
      body: "## Already Headed\n\nThis body already carries its own matching heading.",
    }),
  ];
  const article = assembleMarkdownArticle(nodes);
  // The heading appears exactly once, not twice.
  const occurrences = article.split("## Already Headed").length - 1;
  assert.equal(occurrences, 1);
});

check("6b. a leaf body whose first line is a heading that does NOT match its title still gets the real title heading inserted (no false-positive suppression)", () => {
  const nodes: AssembledExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
    node({
      id: "section",
      parentId: "root",
      level: 1,
      position: 0,
      title: "Real Title",
      isLeaf: true,
      body: "## A Different Inline Heading\n\nBody text.",
    }),
  ];
  const article = assembleMarkdownArticle(nodes);
  assert.ok(article.includes("## Real Title"));
  assert.ok(article.includes("## A Different Inline Heading"));
});

// --- 8/9. Verification metadata, kept separate from the article body -----

check("8. partially verified metadata: one trailing line, article body unchanged above it", () => {
  const article = "# Title\n\nBody.\n";
  const withMeta = appendExportMetadata(article, { tier: "partially_verified", evaluatedCount: 2 });
  assert.ok(withMeta.startsWith(article));
  assert.ok(withMeta.includes("Export status: Partially verified — 2 of 9 QA categories evaluated."));
});

check("9. unverified metadata: exactly the literal approved copy, nothing more", () => {
  const article = "# Title\n\nBody.\n";
  const withMeta = appendExportMetadata(article, { tier: "unverified" });
  assert.ok(withMeta.includes("Export status: Unverified"));
  assert.ok(!withMeta.includes("Export status: Unverified —"), "must be the exact literal approved copy, no appended dash-elaboration");
});

check("9b. verified tier: no metadata line inserted at all", () => {
  const article = "# Title\n\nBody.\n";
  const withMeta = appendExportMetadata(article, { tier: "verified" });
  assert.equal(withMeta, article);
});

// --- 10. Deterministic: identical input -> byte-identical output --------

check("10. identical input produces byte-identical output across repeated calls", () => {
  const nodes: AssembledExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
    node({ id: "a", parentId: "root", level: 1, position: 1, title: "Second", isLeaf: true, body: "Second body." }),
    node({ id: "b", parentId: "root", level: 1, position: 0, title: "First", isLeaf: true, body: "First body." }),
  ];
  const first = assembleMarkdownArticle(nodes);
  const second = assembleMarkdownArticle([...nodes]); // fresh array, same content
  assert.equal(first, second);
  // Document order (position-based), not array/DB-return order.
  assert.ok(first.indexOf("## First") < first.indexOf("## Second"));
});

// --- filename ------------------------------------------------------------

check("filename: slugified, safe, deterministic, no timestamp/random id, .md extension", () => {
  const name = exportFilename("How to Make Spaghetti Bolognese: A Guide!", "md");
  assert.equal(name, "how-to-make-spaghetti-bolognese-a-guide.md");
  assert.equal(exportFilename("How to Make Spaghetti Bolognese: A Guide!", "md"), name, "must be deterministic across calls");
});

check("filename: unsafe characters and repeated separators are collapsed, empty title falls back safely", () => {
  assert.equal(slugifyTitle("  Multiple   Spaces & Symbols!!  "), "multiple-spaces-symbols");
  assert.equal(slugifyTitle(""), "export");
});

console.log(`\n${passed} check(s) passed.`);
