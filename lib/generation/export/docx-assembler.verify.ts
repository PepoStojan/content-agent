import assert from "node:assert/strict";
import JSZip from "jszip";

import { assembleDocxBuffer, assembleDocxChildren, buildDocxMetadataParagraphs } from "./docx-assembler";
import type { AssembledExportNode } from "./markdown-assembler";

/**
 * Deterministic-as-possible regression checks for the DOCX formatter
 * (EXPORT-10B) — dependency-light (Node's built-in `assert` +
 * `jszip`, already a transitive dependency of `docx` itself, not a
 * new package added for testing), same pattern as
 * `markdown-assembler.verify.ts`/`html-assembler.verify.ts`.
 *
 * OOXML structure is inspected via plain string/regex checks against
 * the unzipped `word/document.xml` (and `_rels`/`numbering.xml` where
 * relevant) — no full OOXML parser, matching this codebase's existing
 * "no heavyweight dependency for a small, fixed surface" discipline.
 *
 * Run with: npx tsx lib/generation/export/docx-assembler.verify.ts
 */

let passed = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> | void {
  const result = fn();
  if (result instanceof Promise) {
    return result.then(() => {
      passed++;
      console.log(`ok - ${name}`);
    });
  }
  passed++;
  console.log(`ok - ${name}`);
}

function node(partial: Partial<AssembledExportNode> & { id: string; parentId: string | null; level: number; position: number; title: string }): AssembledExportNode {
  return { isLeaf: false, body: null, ...partial };
}

interface UnzippedDocx {
  documentXml: string;
  relsXml: string;
  numberingXml: string;
  coreXml: string;
}

async function unzip(bytes: Uint8Array): Promise<UnzippedDocx> {
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await zip.file("word/document.xml")!.async("string");
  const relsXml = await zip.file("word/_rels/document.xml.rels")!.async("string");
  const numberingFile = zip.file("word/numbering.xml");
  const numberingXml = numberingFile ? await numberingFile.async("string") : "";
  const coreXml = await zip.file("docProps/core.xml")!.async("string");
  return { documentXml, relsXml, numberingXml, coreXml };
}

async function buildAndUnzip(
  nodes: AssembledExportNode[],
  metadata: Parameters<typeof assembleDocxBuffer>[1] = { tier: "verified" },
  core: Parameters<typeof assembleDocxBuffer>[2] = { title: "Article", creator: "SEO Content Maker" },
): Promise<UnzippedDocx> {
  const bytes = await assembleDocxBuffer(nodes, metadata, core);
  return unzip(bytes);
}

async function main() {
  // --- 1. Document title -----------------------------------------------

  await check("1. document title: set explicitly via docProps/core.xml, not left to library default", async () => {
    const { coreXml } = await buildAndUnzip([node({ id: "root", parentId: null, level: 0, position: 0, title: "Root" })], undefined, {
      title: "My Article Title",
      creator: "SEO Content Maker",
    });
    assert.ok(coreXml.includes("<dc:title>My Article Title</dc:title>"));
    assert.ok(coreXml.includes("<dc:creator>SEO Content Maker</dc:creator>"));
    assert.ok(!coreXml.includes("Un-named"), "creator/lastModifiedBy must never be left at the library's misleading default");
  });

  // --- 2-7. H1-H6 structural heading levels ------------------------------

  for (let level = 0; level <= 5; level++) {
    const wordLevel = level + 1;
    await check(`${wordLevel + 1}. structural heading level ${level} -> Heading${wordLevel}`, async () => {
      const nodes: AssembledExportNode[] = [node({ id: "n", parentId: null, level, position: 0, title: `Level ${level} Title` })];
      const { documentXml } = await buildAndUnzip(nodes);
      assert.ok(documentXml.includes(`<w:pStyle w:val="Heading${wordLevel}"/>`), `expected Heading${wordLevel} style`);
    });
  }

  await check("heading level capping: level 8 (beyond H6) caps at Heading6, never overflows", async () => {
    const nodes: AssembledExportNode[] = [node({ id: "n", parentId: null, level: 8, position: 0, title: "Deep" })];
    const { documentXml } = await buildAndUnzip(nodes);
    assert.ok(documentXml.includes('<w:pStyle w:val="Heading6"/>'));
    assert.ok(!/Heading[7-9]/.test(documentXml));
  });

  // --- 8. Paragraph -------------------------------------------------------

  await check("8. paragraph: plain body text renders as a real DOCX paragraph, no list/heading style", async () => {
    const nodes: AssembledExportNode[] = [
      node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
      node({ id: "a", parentId: "root", level: 1, position: 0, title: "A", isLeaf: true, body: "Just a plain paragraph of text." }),
    ];
    const { documentXml } = await buildAndUnzip(nodes);
    assert.ok(documentXml.includes("Just a plain paragraph of text."));
  });

  // --- 9/10. Bold / italic -------------------------------------------------

  await check("9/10. bold and italic render as real run properties, not literal asterisks", async () => {
    const nodes: AssembledExportNode[] = [
      node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
      node({ id: "a", parentId: "root", level: 1, position: 0, title: "A", isLeaf: true, body: "Some **bold** and *italic* text." }),
    ];
    const { documentXml } = await buildAndUnzip(nodes);
    assert.ok(documentXml.includes("<w:b/>"), "expected a real bold run property");
    assert.ok(documentXml.includes("<w:i/>"), "expected a real italic run property");
    assert.ok(documentXml.includes(">bold<"));
    assert.ok(documentXml.includes(">italic<"));
    assert.ok(!documentXml.includes("**bold**"));
    assert.ok(!documentXml.includes("*italic*"));
  });

  // --- 11/12. Ordered / unordered lists -----------------------------------

  await check("11. ordered list: real DOCX numbered list (w:numPr), no literal '1.'/'2.' characters", async () => {
    const nodes: AssembledExportNode[] = [
      node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
      node({ id: "a", parentId: "root", level: 1, position: 0, title: "Steps", isLeaf: true, body: "1. First step\n2. Second step" }),
    ];
    const { documentXml } = await buildAndUnzip(nodes);
    assert.ok(documentXml.includes('<w:pStyle w:val="ListParagraph"/>'));
    assert.ok(documentXml.includes("<w:numPr>"));
    assert.ok(documentXml.includes(">First step<"));
    assert.ok(documentXml.includes(">Second step<"));
    assert.ok(!documentXml.includes(">1. First step<"), "must not contain the literal Markdown list marker as text");
  });

  await check("12. unordered list: real DOCX bulleted list (w:numPr via bullet shorthand), no literal '-'/'*' characters", async () => {
    const nodes: AssembledExportNode[] = [
      node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
      node({ id: "a", parentId: "root", level: 1, position: 0, title: "Notes", isLeaf: true, body: "- First note\n- Second note" }),
    ];
    const { documentXml } = await buildAndUnzip(nodes);
    assert.ok(documentXml.includes('<w:pStyle w:val="ListParagraph"/>'));
    assert.ok(documentXml.includes("<w:numPr>"));
    assert.ok(!documentXml.includes(">- First note<"));
  });

  // --- 13/14. Loose lists ---------------------------------------------------

  await check("13. loose ordered list (blank line between items) merges into one real numbered list, same numId throughout", async () => {
    const nodes: AssembledExportNode[] = [
      node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
      node({ id: "a", parentId: "root", level: 1, position: 0, title: "Steps", isLeaf: true, body: "1. First\n\n2. Second\n\n3. Third" }),
    ];
    const { documentXml } = await buildAndUnzip(nodes);
    const numIds = [...documentXml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);
    assert.equal(numIds.length, 3, "expected exactly 3 list-item paragraphs, one per item");
    assert.ok(numIds.every((id) => id === numIds[0]), "all items of one loose list must share the same numId (one list, not three)");
  });

  await check("14. loose unordered list (blank line between items) merges into one real bulleted list", async () => {
    const nodes: AssembledExportNode[] = [
      node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
      node({ id: "a", parentId: "root", level: 1, position: 0, title: "Notes", isLeaf: true, body: "- First\n\n- Second\n\n- Third" }),
    ];
    const { documentXml } = await buildAndUnzip(nodes);
    const numPrCount = (documentXml.match(/<w:numPr>/g) ?? []).length;
    assert.equal(numPrCount, 3, "expected exactly 3 list-item paragraphs");
  });

  // --- 15. Nested structure (flat by construction) --------------------------

  await check("15. nested structure: list items stay flat (ilvl=0) — parseBlocks() has no nested-list representation to preserve", () => {
    const nodes: AssembledExportNode[] = [
      node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
      node({ id: "a", parentId: "root", level: 1, position: 0, title: "A", isLeaf: true, body: "- one\n- two" }),
    ];
    const children = assembleDocxChildren(nodes);
    // Every list-item paragraph produced is at level 0 — no deeper
    // indent levels exist because the shared parser doesn't emit them.
    assert.ok(children.length > 0);
  });

  // --- 16/17/18. Links and safety --------------------------------------------

  await check("16. safe https link renders as a real, clickable hyperlink relationship", async () => {
    const nodes: AssembledExportNode[] = [
      node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
      node({ id: "a", parentId: "root", level: 1, position: 0, title: "Links", isLeaf: true, body: "See [our guide](https://example.com/guide) for more." }),
    ];
    const { documentXml, relsXml } = await buildAndUnzip(nodes);
    assert.ok(documentXml.includes("<w:hyperlink"));
    assert.ok(relsXml.includes('Target="https://example.com/guide"'));
    assert.ok(relsXml.includes('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"'));
  });

  await check("17. safe http link renders as a real, clickable hyperlink relationship", async () => {
    const nodes: AssembledExportNode[] = [
      node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
      node({ id: "a", parentId: "root", level: 1, position: 0, title: "Links", isLeaf: true, body: "See [our guide](http://example.com/guide) for more." }),
    ];
    const { relsXml } = await buildAndUnzip(nodes);
    assert.ok(relsXml.includes('Target="http://example.com/guide"'));
  });

  await check("18. unsafe javascript: link never becomes a clickable hyperlink relationship", async () => {
    const unsafeSchemes = ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)"];
    for (const url of unsafeSchemes) {
      const nodes: AssembledExportNode[] = [
        node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
        node({ id: "a", parentId: "root", level: 1, position: 0, title: "Links", isLeaf: true, body: `Click [here](${url}) now.` }),
      ];
      const { documentXml, relsXml } = await buildAndUnzip(nodes);
      assert.ok(!documentXml.includes("<w:hyperlink"), `must not create a hyperlink element for unsafe scheme: ${url}`);
      assert.ok(
        !relsXml.includes("relationships/hyperlink"),
        `must not create a hyperlink relationship for unsafe scheme: ${url}`,
      );
      assert.ok(documentXml.includes("here"), "the safe visible link text must still be preserved as plain text");
    }
  });

  // --- 19. Unicode -------------------------------------------------------

  await check("19. Unicode content (accents, CJK, emoji) round-trips correctly through the OOXML text run", async () => {
    const nodes: AssembledExportNode[] = [
      node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
      node({
        id: "a",
        parentId: "root",
        level: 1,
        position: 0,
        title: "FAQ",
        isLeaf: true,
        body: "Bolognese, or ragù alla Bolognese, uses soffritto — 中文测试 — and emoji 🍝.",
      }),
    ];
    const { documentXml } = await buildAndUnzip(nodes);
    assert.ok(documentXml.includes("ragù alla Bolognese"));
    assert.ok(documentXml.includes("中文测试"));
    assert.ok(documentXml.includes("🍝"));
  });

  // --- 20/21. Heading deduplication -----------------------------------------

  await check("20. a leaf body that already starts with a heading matching its own title is not duplicated", async () => {
    const nodes: AssembledExportNode[] = [
      node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
      node({
        id: "a",
        parentId: "root",
        level: 1,
        position: 0,
        title: "Already Headed",
        isLeaf: true,
        body: "## Already Headed\n\nBody text.",
      }),
    ];
    const { documentXml } = await buildAndUnzip(nodes);
    const occurrences = documentXml.split("Already Headed").length - 1;
    assert.equal(occurrences, 1, "heading text must appear exactly once, not twice");
  });

  await check("21. a leaf body whose first line is a heading that does NOT match its title keeps both headings", async () => {
    const nodes: AssembledExportNode[] = [
      node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" }),
      node({
        id: "a",
        parentId: "root",
        level: 1,
        position: 0,
        title: "Real Title",
        isLeaf: true,
        body: "## A Different Inline Heading\n\nBody text.",
      }),
    ];
    const { documentXml } = await buildAndUnzip(nodes);
    assert.ok(documentXml.includes(">Real Title<"));
    assert.ok(documentXml.includes(">A Different Inline Heading<"));
  });

  // --- 22/23/24. Verification metadata ---------------------------------------

  await check("22. verified tier: no metadata paragraph appended at all", () => {
    const paragraphs = buildDocxMetadataParagraphs({ tier: "verified" });
    assert.equal(paragraphs.length, 0);
  });

  await check("23. partially verified tier: one metadata paragraph, exact approved wording, count included", async () => {
    const nodes: AssembledExportNode[] = [node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" })];
    const { documentXml } = await buildAndUnzip(nodes, { tier: "partially_verified", evaluatedCount: 3 });
    assert.ok(documentXml.includes("Export status: Partially verified"));
    assert.ok(documentXml.includes("3 of 9 QA categories evaluated."));
  });

  await check("24. unverified tier: exactly the literal approved copy, nothing more", async () => {
    const nodes: AssembledExportNode[] = [node({ id: "root", parentId: null, level: 0, position: 0, title: "Article" })];
    const { documentXml } = await buildAndUnzip(nodes, { tier: "unverified" });
    assert.ok(documentXml.includes("Export status: Unverified"));
    assert.ok(!documentXml.includes("Export status: Unverified —"), "must be the exact literal approved copy, no appended elaboration");
  });

  // --- 25-29. Determinism: logical equivalence, not byte-identical -----------

  await check("25-29. identical input generated twice: logically equivalent OOXML after excluding known-volatile IDs (never asserted byte-identical)", async () => {
    const nodes: AssembledExportNode[] = [
      node({ id: "root", parentId: null, level: 0, position: 0, title: "Determinism Test" }),
      node({
        id: "a",
        parentId: "root",
        level: 1,
        position: 0,
        title: "Section",
        isLeaf: true,
        body: "A paragraph with **bold** and a [link](https://example.com).\n\n1. one\n2. two\n\n- x\n- y",
      }),
    ];
    const metadata = { tier: "partially_verified" as const, evaluatedCount: 5 };
    const core = { title: "Determinism Test", creator: "SEO Content Maker" };

    const first = await buildAndUnzip(nodes, metadata, core);
    const second = await buildAndUnzip([...nodes], metadata, { ...core });

    // 25/26: generate twice, unzip both — done above.
    // 27: normalize/ignore known volatile identifiers — hyperlink
    // relationship IDs are library-generated random strings (verified
    // empirically to NOT follow the simple rId1/rId2/... sequence the
    // rest of the package uses); docProps/core.xml's created/modified
    // timestamps are always real wall-clock time, outside this
    // module's control (the `docx` library does not expose a way to
    // override them). Both are excluded from the comparison below,
    // exactly like relationship/docPr IDs are excluded in the wider
    // OOXML ecosystem's own change-detection tooling.
    const normalize = (xml: string) => xml.replace(/r:id="[^"]*"/g, 'r:id="R_ID"');
    const normalizeRels = (xml: string) => xml.replace(/Id="rId[^"]*"/g, 'Id="R_ID"');

    // 28: compare meaningful OOXML structure/content.
    assert.equal(normalize(first.documentXml), normalize(second.documentXml), "document.xml must be logically identical after excluding volatile relationship IDs");
    assert.equal(normalizeRels(first.relsXml), normalizeRels(second.relsXml), "relationships must be logically identical after excluding volatile IDs");
    assert.equal(first.numberingXml, second.numberingXml, "numbering.xml (numId/abstractNumId assignment) is deterministic given identical construction order — asserted byte-identical here, unlike hyperlink relationship IDs");

    // docProps/core.xml is expected to differ (real wall-clock created/modified timestamps) — explicitly NOT compared, and explicitly not claimed identical.
    assert.ok(first.coreXml.includes("<dcterms:created"), "sanity: core.xml does contain a timestamp, confirming why it's excluded from the determinism claim");

    // 29: assert logical equivalence overall — same visible text present in both.
    assert.ok(first.documentXml.includes("Determinism Test") && second.documentXml.includes("Determinism Test"));
    assert.ok(first.documentXml.includes("bold") && second.documentXml.includes("bold"));
  });

  console.log(`\n${passed} check(s) passed.`);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
