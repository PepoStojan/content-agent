import assert from "node:assert/strict";

import { assembleHtmlArticle, assembleHtmlDocument, renderExportMetadataHtml } from "./html-assembler";
import type { AssembledExportNode } from "./markdown-assembler";

/**
 * Deterministic regression checks for the HTML formatter (EXPORT-08)
 * — dependency-free (Node's built-in `assert`), same pattern as
 * `markdown-assembler.verify.ts`.
 *
 * Run with: npx tsx lib/generation/export/html-assembler.verify.ts
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

// --- 1. Basic article -----------------------------------------------------

check("1. basic article: root H1 + leaf H2s, paragraphs from bodies", () => {
  const nodes: AssembledExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "How to Make Spaghetti Bolognese" }),
    node({ id: "intro", parentId: "root", level: 1, position: 0, title: "Introduction", isLeaf: true, body: "This is the introduction paragraph." }),
    node({ id: "ingredients", parentId: "root", level: 1, position: 1, title: "Ingredients", isLeaf: true, body: "You will need ground beef and tomatoes." }),
  ];
  const html = assembleHtmlArticle(nodes);
  assert.equal(
    html,
    "<h1>How to Make Spaghetti Bolognese</h1>" +
      "<h2>Introduction</h2><p>This is the introduction paragraph.</p>" +
      "<h2>Ingredients</h2><p>You will need ground beef and tomatoes.</p>",
  );
});

// --- 2. Nested Blueprint hierarchy -----------------------------------------

check("2. nested hierarchy: structural node contributes only its heading, children nest under it in document order", () => {
  const nodes: AssembledExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Guide" }),
    node({ id: "steps", parentId: "root", level: 1, position: 0, title: "Step-by-Step Instructions" }),
    node({ id: "step1", parentId: "steps", level: 2, position: 0, title: "Step 1: Prep", isLeaf: true, body: "Prep the ingredients." }),
    node({ id: "step2", parentId: "steps", level: 2, position: 1, title: "Step 2: Cook", isLeaf: true, body: "Cook everything together." }),
  ];
  const html = assembleHtmlArticle(nodes);
  assert.equal(
    html,
    "<h1>Guide</h1>" +
      "<h2>Step-by-Step Instructions</h2>" +
      "<h3>Step 1: Prep</h3><p>Prep the ingredients.</p>" +
      "<h3>Step 2: Cook</h3><p>Cook everything together.</p>",
  );
});

// --- 3. H1/H2/H3 structural heading levels ---------------------------------

check("3. structural heading levels follow blueprint_nodes.level directly, capped at H6", () => {
  const nodes: AssembledExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Root" }),
    node({ id: "deep", parentId: "root", level: 6, position: 0, title: "Very Deep", isLeaf: true, body: "Deep body." }),
  ];
  const html = assembleHtmlArticle(nodes);
  assert.ok(html.includes("<h1>Root</h1>"));
  assert.ok(html.includes("<h6>Very Deep</h6>"), "level 6 should cap at h6, not overflow to h7");
});

// --- 4. Body headings (## / ###) inside content render as h2/h3 -----------

check("4. body Markdown headings (##/###) render as real <h2>/<h3> tags, distinct from structural headings", () => {
  const nodes: AssembledExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
    node({
      id: "section",
      parentId: "root",
      level: 1,
      position: 0,
      title: "Overview",
      isLeaf: true,
      body: "Intro text.\n\n## A Subheading\n\nMore text.\n\n### A Sub-subheading\n\nEven more.",
    }),
  ];
  const html = assembleHtmlArticle(nodes);
  assert.ok(html.includes("<h2>Overview</h2>"), "structural heading present");
  assert.ok(html.includes("<h2>A Subheading</h2>"), "body ## heading rendered as h2");
  assert.ok(html.includes("<h3>A Sub-subheading</h3>"), "body ### heading rendered as h3");
});

// --- 5. Exact heading deduplication ----------------------------------------

check("5. a leaf body that already starts with a heading matching its own title is not duplicated", () => {
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
  const html = assembleHtmlArticle(nodes);
  const occurrences = html.split("Already Headed").length - 1;
  assert.equal(occurrences, 1, "the heading text must appear exactly once, not twice");
  assert.equal(html.split("<h2>Already Headed</h2>").length - 1, 1);
});

// --- 6. Similar-but-not-identical heading must remain -----------------------

check("6. a leaf body whose first line is a heading that does NOT match its title keeps both headings", () => {
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
  const html = assembleHtmlArticle(nodes);
  assert.ok(html.includes("<h2>Real Title</h2>"), "the real structural title heading must still be inserted");
  assert.ok(html.includes("<h2>A Different Inline Heading</h2>"), "the body's own distinct heading must remain, unremoved");
});

// --- 7. Ordered list --------------------------------------------------------

check("7. ordered list renders as a real <ol><li> element", () => {
  const nodes: AssembledExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
    node({ id: "section", parentId: "root", level: 1, position: 0, title: "Steps", isLeaf: true, body: "1. First step\n2. Second step" }),
  ];
  const html = assembleHtmlArticle(nodes);
  assert.ok(html.includes("<ol><li>First step</li><li>Second step</li></ol>"));
  assert.ok(!html.includes("1. First step"), "raw markdown list syntax must not survive into the HTML");
});

// --- 8. Unordered list -------------------------------------------------------

check("8. unordered list renders as a real <ul><li> element", () => {
  const nodes: AssembledExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
    node({ id: "section", parentId: "root", level: 1, position: 0, title: "Notes", isLeaf: true, body: "- First note\n- Second note" }),
  ];
  const html = assembleHtmlArticle(nodes);
  assert.ok(html.includes("<ul><li>First note</li><li>Second note</li></ul>"));
  assert.ok(!html.includes("- First note"), "raw markdown list syntax must not survive into the HTML");
});

// --- 9. Loose lists (blank-line-separated) ----------------------------------

check("9. a loose list (blank line between items) still merges into one <ol>, not N separate lists", () => {
  const nodes: AssembledExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
    node({ id: "section", parentId: "root", level: 1, position: 0, title: "Steps", isLeaf: true, body: "1. First step\n\n2. Second step\n\n3. Third step" }),
  ];
  const html = assembleHtmlArticle(nodes);
  assert.equal((html.match(/<ol>/g) ?? []).length, 1, "expected exactly one <ol>, not one per item");
  assert.equal((html.match(/<li>/g) ?? []).length, 3);
});

// --- 10. Bold / italic -------------------------------------------------------

check("10. bold and italic render as real <strong>/<em> elements, not literal asterisks", () => {
  const nodes: AssembledExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
    node({ id: "section", parentId: "root", level: 1, position: 0, title: "Formatting", isLeaf: true, body: "Some **bold** and *italic* text." }),
  ];
  const html = assembleHtmlArticle(nodes);
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.ok(html.includes("<em>italic</em>"));
  assert.ok(!html.includes("**bold**"));
  assert.ok(!html.includes("*italic*"));
});

// --- 11. Safe links -----------------------------------------------------------

check("11. a safe-scheme link renders as a real, clickable <a href>", () => {
  const nodes: AssembledExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
    node({ id: "section", parentId: "root", level: 1, position: 0, title: "Links", isLeaf: true, body: "See [our guide](https://example.com/guide) for more." }),
  ];
  const html = assembleHtmlArticle(nodes);
  assert.ok(html.includes('<a href="https://example.com/guide" target="_blank" rel="noopener noreferrer">our guide</a>'));
});

// --- 12. Unsafe link schemes ---------------------------------------------------

check("12. an unsafe-scheme link (javascript:, data:, vbscript:) never becomes a clickable href", () => {
  const unsafeSchemes = ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)"];
  for (const url of unsafeSchemes) {
    const nodes: AssembledExportNode[] = [
      node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
      node({ id: "section", parentId: "root", level: 1, position: 0, title: "Links", isLeaf: true, body: `Click [here](${url}) now.` }),
    ];
    const html = assembleHtmlArticle(nodes);
    assert.ok(!html.includes("<a href"), `must not produce a clickable <a> for unsafe scheme: ${url}`);
    assert.ok(!/href\s*=/.test(html), `must not produce any href attribute for unsafe scheme: ${url}`);
  }
});

// --- 13. Paragraph escaping ------------------------------------------------

check("13. HTML-significant characters in body text are escaped, never interpreted as markup", () => {
  const nodes: AssembledExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
    node({
      id: "section",
      parentId: "root",
      level: 1,
      position: 0,
      title: "Safety",
      isLeaf: true,
      body: 'A <script>alert("xss")</script> tag & a "quoted" value.',
    }),
  ];
  const html = assembleHtmlArticle(nodes);
  assert.ok(!html.includes("<script>alert"), "a literal <script> in content must never survive unescaped into the HTML");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&amp;"));
  assert.ok(html.includes("&quot;quoted&quot;"));
});

check("13b. a title containing HTML-significant characters is escaped in both the heading and the <title> tag", () => {
  const nodes: AssembledExportNode[] = [node({ id: "root", parentId: null, level: 0, position: 0, title: 'A "Guide" <for> Everyone & Co' })];
  const articleHtml = assembleHtmlArticle(nodes);
  assert.ok(articleHtml.includes("&lt;for&gt;"));
  assert.ok(!articleHtml.includes("<for>"));

  const doc = assembleHtmlDocument(articleHtml, "", 'A "Guide" <for> Everyone & Co');
  assert.ok(doc.includes("<title>A &quot;Guide&quot; &lt;for&gt; Everyone &amp; Co</title>"));
});

// --- 14. Verified metadata ---------------------------------------------------

check("14. verified tier: no metadata footer emitted at all", () => {
  const footer = renderExportMetadataHtml({ tier: "verified" });
  assert.equal(footer, "");
});

// --- 15. Partial QA metadata --------------------------------------------------

check("15. partially verified tier: one footer line, exact approved wording, count included", () => {
  const footer = renderExportMetadataHtml({ tier: "partially_verified", evaluatedCount: 3 });
  assert.ok(footer.startsWith("<footer>") && footer.endsWith("</footer>"));
  assert.ok(footer.includes("Partially verified"));
  assert.ok(footer.includes("3 of 9 QA categories evaluated."));
});

// --- 16. Unverified metadata ---------------------------------------------------

check("16. unverified tier: exactly the literal approved copy, nothing more", () => {
  const footer = renderExportMetadataHtml({ tier: "unverified" });
  assert.ok(footer.includes("Export status: Unverified"));
  assert.ok(!footer.includes("Export status: Unverified &mdash;") && !footer.includes("Export status: Unverified—"), "must be the exact literal approved copy, no appended elaboration");
});

// --- 17. Deterministic: byte-identical output -------------------------------

check("17. identical input produces byte-identical output across repeated calls, document order not array order", () => {
  const nodes: AssembledExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
    node({ id: "a", parentId: "root", level: 1, position: 1, title: "Second", isLeaf: true, body: "Second body." }),
    node({ id: "b", parentId: "root", level: 1, position: 0, title: "First", isLeaf: true, body: "First body." }),
  ];
  const first = assembleHtmlArticle(nodes);
  const second = assembleHtmlArticle([...nodes]);
  assert.equal(first, second);
  assert.ok(first.indexOf("First") < first.indexOf("Second"));

  const doc1 = assembleHtmlDocument(first, renderExportMetadataHtml({ tier: "verified" }), "Article");
  const doc2 = assembleHtmlDocument(second, renderExportMetadataHtml({ tier: "verified" }), "Article");
  assert.equal(doc1, doc2, "full document assembly must be byte-identical for identical pinned input");
  assert.ok(!doc1.includes("<script"), "no scripts in the generated document");
});

console.log(`\n${passed} check(s) passed.`);
