import assert from "node:assert/strict";

import { assembleJsonDocument, serializeExportJson, type JsonExportMetadata, type JsonExportNode } from "./json-assembler";

/**
 * Deterministic regression checks for the Structured JSON formatter
 * (EXPORT-09) — dependency-free (Node's built-in `assert`), same
 * pattern as `markdown-assembler.verify.ts`/`html-assembler.verify.ts`.
 *
 * Run with: npx tsx lib/generation/export/json-assembler.verify.ts
 */

let passed = 0;

function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

function node(partial: Partial<JsonExportNode> & { id: string; parentId: string | null; level: number; position: number; title: string }): JsonExportNode {
  return {
    isLeaf: false,
    goal: null,
    targetWordCount: null,
    entities: [],
    contentVersionId: null,
    status: null,
    body: null,
    ...partial,
  };
}

function meta(partial: Partial<JsonExportMetadata> = {}): JsonExportMetadata {
  return {
    exportId: "export-1",
    projectId: "project-1",
    projectName: "Test Project",
    contentType: "blog_post",
    briefVersionId: "brief-1",
    blueprintVersionId: "blueprint-1",
    qaReportId: "qa-1",
    qaBypassed: false,
    verificationTier: "verified",
    evaluatedCategories: [],
    skippedCategories: [],
    ...partial,
  };
}

// --- 1. Basic document ------------------------------------------------------

check("1. basic document: root + two leaf sections, correct schemaVersion and document title", () => {
  const nodes: JsonExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "How to Make Spaghetti Bolognese" }),
    node({ id: "intro", parentId: "root", level: 1, position: 0, title: "Introduction", isLeaf: true, body: "Intro body.", contentVersionId: "cv-intro", status: "approved" }),
    node({ id: "ingredients", parentId: "root", level: 1, position: 1, title: "Ingredients", isLeaf: true, body: "You need beef.", contentVersionId: "cv-ing", status: "approved" }),
  ];
  const doc = assembleJsonDocument(nodes, meta());
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.document.title, "How to Make Spaghetti Bolognese");
  assert.equal(doc.document.sections.length, 3);
  assert.equal(doc.document.sections[0].title, "How to Make Spaghetti Bolognese");
  assert.equal(doc.document.sections[0].isLeaf, false);
});

// --- 2. Nested document order -----------------------------------------------

check("2. nested document order follows orderNodesByDocumentPosition(), not array/DB order", () => {
  const nodes: JsonExportNode[] = [
    node({ id: "step2", parentId: "steps", level: 2, position: 1, title: "Step 2: Cook", isLeaf: true, body: "Cook it." }),
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Guide" }),
    node({ id: "step1", parentId: "steps", level: 2, position: 0, title: "Step 1: Prep", isLeaf: true, body: "Prep it." }),
    node({ id: "steps", parentId: "root", level: 1, position: 0, title: "Steps" }),
  ];
  const doc = assembleJsonDocument(nodes, meta());
  const titles = doc.document.sections.map((s) => s.title);
  assert.deepEqual(titles, ["Guide", "Steps", "Step 1: Prep", "Step 2: Cook"]);
});

// --- 3. Exact content_version IDs -------------------------------------------

check("3. each leaf carries its exact pinned content_version_id, structural nodes carry null", () => {
  const nodes: JsonExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
    node({ id: "a", parentId: "root", level: 1, position: 0, title: "A", isLeaf: true, contentVersionId: "cv-aaa-111", body: "Body A" }),
  ];
  const doc = assembleJsonDocument(nodes, meta());
  assert.equal(doc.document.sections[0].contentVersionId, null);
  assert.equal(doc.document.sections[1].contentVersionId, "cv-aaa-111");
});

// --- 4. Lineage fields -------------------------------------------------------

check("4. metadata carries the exact pinned lineage fields, verbatim, not re-derived", () => {
  const doc = assembleJsonDocument([node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" })], meta({
    briefVersionId: "brief-xyz",
    blueprintVersionId: "blueprint-xyz",
    qaReportId: "qa-xyz",
  }));
  assert.equal(doc.metadata.briefVersionId, "brief-xyz");
  assert.equal(doc.metadata.blueprintVersionId, "blueprint-xyz");
  assert.equal(doc.metadata.qaReportId, "qa-xyz");
  // Every section's blueprintVersionId matches the metadata's pinned value.
  assert.ok(doc.document.sections.every((s) => s.blueprintVersionId === "blueprint-xyz"));
});

// --- 5. Entities / section metadata -----------------------------------------

check("5. section-level goal/targetWordCount/entities are preserved from the Blueprint node", () => {
  const nodes: JsonExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
    node({
      id: "a",
      parentId: "root",
      level: 1,
      position: 0,
      title: "A",
      isLeaf: true,
      body: "Body A",
      goal: "Explain the soffritto.",
      targetWordCount: 220,
      entities: ["soffritto", "ragu alla bolognese"],
    }),
  ];
  const doc = assembleJsonDocument(nodes, meta());
  const section = doc.document.sections[1];
  assert.equal(section.goal, "Explain the soffritto.");
  assert.equal(section.targetWordCount, 220);
  assert.deepEqual(section.entities, ["soffritto", "ragu alla bolognese"]);
});

// --- 6. Full QA (verified) ---------------------------------------------------

check("6. full QA / verified tier: qaBypassed false, verificationTier verified", () => {
  const doc = assembleJsonDocument([node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" })], meta({
    verificationTier: "verified",
    qaBypassed: false,
    evaluatedCategories: ["topics", "entities", "structure", "links", "brand", "style", "forbidden_chars", "intent", "factual"],
    skippedCategories: [],
  }));
  assert.equal(doc.metadata.verificationTier, "verified");
  assert.equal(doc.metadata.qaBypassed, false);
  assert.equal(doc.metadata.evaluatedCategories.length, 9);
  assert.equal(doc.metadata.skippedCategories.length, 0);
});

// --- 7. Partial QA -----------------------------------------------------------

check("7. partial QA / partially_verified tier: evaluatedCategories and skippedCategories both explicit, never inferred", () => {
  const doc = assembleJsonDocument([node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" })], meta({
    verificationTier: "partially_verified",
    qaBypassed: false,
    evaluatedCategories: ["topics", "entities", "structure"],
    skippedCategories: ["links", "brand", "style", "forbidden_chars", "intent", "factual"],
  }));
  assert.equal(doc.metadata.verificationTier, "partially_verified");
  assert.equal(doc.metadata.qaBypassed, false);
  assert.deepEqual(doc.metadata.evaluatedCategories, ["topics", "entities", "structure"]);
  assert.deepEqual(doc.metadata.skippedCategories, ["links", "brand", "style", "forbidden_chars", "intent", "factual"]);
});

// --- 8. Unverified (ED12 bypass) --------------------------------------------

check("8. unverified export (ED12 bypass): qaBypassed true, verificationTier unverified", () => {
  const doc = assembleJsonDocument([node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" })], meta({
    verificationTier: "unverified",
    qaBypassed: true,
    qaReportId: "qa-fail-1",
  }));
  assert.equal(doc.metadata.qaBypassed, true);
  assert.equal(doc.metadata.verificationTier, "unverified");
  assert.equal(doc.metadata.qaReportId, "qa-fail-1", "qa_report_id stays populated even for a bypassed export, per ED1/ED12");
});

// --- 9. Skipped category persistence (never inferred from empty findings) ---

check("9. skippedCategories is an explicit, independent field from evaluatedCategories — never the complement of a 'findings present' check", () => {
  const doc = assembleJsonDocument([node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" })], meta({
    verificationTier: "partially_verified",
    evaluatedCategories: ["topics"],
    skippedCategories: ["entities"],
  }));
  // Both arrays are stored verbatim from the caller — this module performs
  // no set-complement/derivation logic between them.
  assert.deepEqual(doc.metadata.evaluatedCategories, ["topics"]);
  assert.deepEqual(doc.metadata.skippedCategories, ["entities"]);
});

// --- 10. Unicode -------------------------------------------------------------

check("10. Unicode content round-trips exactly through JSON.stringify/JSON.parse", () => {
  const nodes: JsonExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
    node({ id: "a", parentId: "root", level: 1, position: 0, title: "FAQ", isLeaf: true, body: "Bolognese, or ragù alla Bolognese, uses soffritto — 中文测试 — and emoji 🍝." }),
  ];
  const doc = assembleJsonDocument(nodes, meta());
  const text = serializeExportJson(doc);
  const parsed = JSON.parse(text);
  assert.equal(parsed.document.sections[1].body, "Bolognese, or ragù alla Bolognese, uses soffritto — 中文测试 — and emoji 🍝.");
});

// --- 11. Markdown characters preserved, never re-rendered -------------------

check("11. Markdown syntax in body (bold, lists, links, headings, blockquote) is preserved verbatim, never re-rendered", () => {
  const body =
    "## A Subheading\n\n" +
    "Some **bold** and *italic* text with a [link](https://example.com).\n\n" +
    "- item one\n- item two\n\n" +
    "> a quoted line\n\n" +
    "1. first\n2. second";
  const nodes: JsonExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
    node({ id: "a", parentId: "root", level: 1, position: 0, title: "Formatting", isLeaf: true, body }),
  ];
  const doc = assembleJsonDocument(nodes, meta());
  assert.equal(doc.document.sections[1].body, body, "body must be byte-identical Markdown text, not HTML and not re-serialized");
});

// --- 12. Quotes / newlines / backslashes ------------------------------------

check("12. quotes, newlines, and backslashes are safely encoded via real JSON.stringify, not manual concatenation", () => {
  const body = 'A line with "quotes", a backslash \\ and a\nnewline.';
  const nodes: JsonExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
    node({ id: "a", parentId: "root", level: 1, position: 0, title: "Safety", isLeaf: true, body }),
  ];
  const doc = assembleJsonDocument(nodes, meta());
  const text = serializeExportJson(doc);
  // Must be valid JSON (throws if not).
  const parsed = JSON.parse(text);
  assert.equal(parsed.document.sections[1].body, body);
});

// --- 13. Deterministic byte-identical output --------------------------------

check("13. identical input produces byte-identical serialized output across repeated calls", () => {
  const nodes: JsonExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
    node({ id: "b", parentId: "root", level: 1, position: 1, title: "Second", isLeaf: true, body: "Second body.", contentVersionId: "cv-2" }),
    node({ id: "a", parentId: "root", level: 1, position: 0, title: "First", isLeaf: true, body: "First body.", contentVersionId: "cv-1" }),
  ];
  const m = meta();
  const first = serializeExportJson(assembleJsonDocument(nodes, m));
  const second = serializeExportJson(assembleJsonDocument([...nodes], { ...m }));
  assert.equal(first, second);
  assert.ok(first.indexOf('"First"') < first.indexOf('"Second"'), "document order, not array order");
});

// --- 14. schemaVersion --------------------------------------------------------

check("14. schemaVersion is present, equal to 1, and survives a JSON round-trip", () => {
  const doc = assembleJsonDocument([node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" })], meta());
  const text = serializeExportJson(doc);
  const parsed = JSON.parse(text);
  assert.equal(parsed.schemaVersion, 1);
});

// --- Extra: valid JSON overall, no dangling/duplicate keys, ends with newline ---

check("extra: the full serialized document is valid, parseable JSON ending in a single trailing newline", () => {
  const nodes: JsonExportNode[] = [
    node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
    node({ id: "a", parentId: "root", level: 1, position: 0, title: "A", isLeaf: true, body: "Body." }),
  ];
  const text = serializeExportJson(assembleJsonDocument(nodes, meta()));
  assert.doesNotThrow(() => JSON.parse(text));
  assert.ok(text.endsWith("\n"));
  assert.ok(!text.endsWith("\n\n"));
});

console.log(`\n${passed} check(s) passed.`);
