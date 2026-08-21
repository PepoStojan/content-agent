import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  type ParagraphChild,
} from "docx";

import { orderNodesByDocumentPosition } from "@/lib/generation/blueprint/tree-order";
import { parseBlocks, tokenizeInline, type Block, type InlineToken } from "@/lib/format/markdown";

import { bodyStartsWithMatchingHeading, exportMetadataLine, type AssembledExportNode, type ExportMetadataInput } from "./markdown-assembler";

/**
 * EXPORT-10B — the DOCX formatter's pure assembly step. Same
 * architecture as `markdown-assembler.ts`/`html-assembler.ts`: reuses
 * the export's own pinned node set (never re-resolved), the same
 * `orderNodesByDocumentPosition()` for document order, the same
 * `bodyStartsWithMatchingHeading()` heading-dedup rule, and the same
 * `parseBlocks()`/`tokenizeInline()` primitives the Content Editor and
 * HTML formatter already use to interpret this app's Markdown subset
 * — a third consumer of one shared parser, never a fourth
 * implementation. `SAFE_URL_PATTERN` is reused transitively:
 * `tokenizeInline()` already applies it internally (an unsafe-scheme
 * link is returned as a literal `text` token, never a `link` token),
 * so this module never emits a clickable hyperlink for an unsafe
 * scheme without needing a second copy of the pattern.
 *
 * No `"server-only"` import — matching this exact file family's own
 * established convention (`markdown-assembler.ts`/`html-assembler.ts`/
 * `json-assembler.ts` none use it either): safety comes from these
 * modules only ever being imported by a `"use server"` action
 * (`export-actions.ts`), never by a Client Component, the same
 * transitive-safety discipline already proven for the other three
 * formatters.
 */

function structuralHeadingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  const levels = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ];
  return levels[Math.min(level, levels.length - 1)];
}

/** Body headings (`##`/`###`, `parseBlocks()`'s own fixed 2/3 mapping) always render as H2/H3 — the same convention already proven by the HTML formatter, independent of the structural node's own depth. */
function bodyHeadingLevel(level: 2 | 3): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  return level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
}

/** Splits inline text on literal `\n` (a paragraph block's own multi-line join, `parseBlocks()`) into DOCX-native line breaks — a raw `\n` inside a single `TextRun` does not otherwise render as a line break in Word. */
function buildInlineRuns(text: string): ParagraphChild[] {
  const lines = text.split("\n");
  const children: ParagraphChild[] = [];
  lines.forEach((line, i) => {
    children.push(...tokenizeInline(line).map(inlineTokenToRun));
    if (i < lines.length - 1) children.push(new TextRun({ text: "", break: 1 }));
  });
  return children;
}

function inlineTokenToRun(token: InlineToken): ParagraphChild {
  switch (token.kind) {
    case "bold":
      return new TextRun({ text: token.text, bold: true });
    case "italic":
      return new TextRun({ text: token.text, italics: true });
    case "link":
      // `tokenizeInline()` has already applied SAFE_URL_PATTERN — an
      // unsafe-scheme link never reaches this branch as a `link`
      // token (it arrives as a literal `text` token instead, per
      // that module's own documented behavior), so no second safety
      // check is needed here.
      return new ExternalHyperlink({
        link: token.url,
        children: [new TextRun({ text: token.label, style: "Hyperlink" })],
      });
    default:
      return new TextRun(token.text);
  }
}

/** The one shared numbering reference every ordered-list block in the document reuses — a fresh `instance` per block (assigned by the caller) is what makes each separate ordered list restart its own count at 1, per docx's own numbering model. */
const ORDERED_LIST_REFERENCE = "export-ordered-list";

export const DOCX_NUMBERING_CONFIG = {
  config: [
    {
      reference: ORDERED_LIST_REFERENCE,
      levels: [
        {
          level: 0,
          format: LevelFormat.DECIMAL,
          text: "%1.",
          alignment: AlignmentType.START,
        },
      ],
    },
  ],
} as const;

function renderBlock(block: Block, nextOrderedListInstance: () => number): Paragraph[] {
  if (block.kind === "heading") {
    return [new Paragraph({ heading: bodyHeadingLevel(block.level), children: buildInlineRuns(block.text) })];
  }
  if (block.kind === "list") {
    if (block.ordered) {
      const instance = nextOrderedListInstance();
      return block.items.map(
        (item) =>
          new Paragraph({
            numbering: { reference: ORDERED_LIST_REFERENCE, level: 0, instance },
            children: buildInlineRuns(item),
          }),
      );
    }
    // Native DOCX bullet list — docx's own `bullet` shorthand, backed
    // by its built-in default bullet numbering. Bullets have no
    // counter to reset between lists, so no explicit reference/
    // instance bookkeeping is needed here (unlike ordered lists).
    return block.items.map((item) => new Paragraph({ bullet: { level: 0 }, children: buildInlineRuns(item) }));
  }
  // paragraph
  return [new Paragraph({ children: buildInlineRuns(block.text) })];
}

/**
 * Builds the assembled article's DOCX paragraph sequence — headings +
 * rendered leaf bodies — from the exact pinned node set, in true
 * document order. Mirrors `assembleMarkdownArticle()`/
 * `assembleHtmlArticle()`'s own structure and dedup decision
 * precisely: a leaf whose body already starts with a heading matching
 * its own title is rendered via its own parsed body blocks only (no
 * separately-inserted structural heading) — the identical rule those
 * two formatters already implement, reused here, not reimplemented.
 *
 * Note on lists: `parseBlocks()` (the one shared Markdown parser)
 * represents list items as a flat `string[]` — it has no nested-list
 * representation today (matching the Content Editor's own Markdown
 * toolbar, which cannot author a nested list either). There is
 * therefore nothing to preserve as "nested" here; if `parseBlocks()`
 * ever gains nested-list support, this function's own per-item
 * mapping is the one place that would need to grow indent levels —
 * no second document-assembly path to update.
 */
export function assembleDocxChildren(nodes: AssembledExportNode[]): Paragraph[] {
  const ordered = orderNodesByDocumentPosition(nodes);
  let orderedListCounter = 0;
  const nextOrderedListInstance = () => ++orderedListCounter;

  const children: Paragraph[] = [];

  for (const node of ordered) {
    const dedup = node.isLeaf && node.body ? bodyStartsWithMatchingHeading(node.body, node.title) : false;

    if (dedup && node.body) {
      for (const block of parseBlocks(node.body)) children.push(...renderBlock(block, nextOrderedListInstance));
      continue;
    }

    children.push(new Paragraph({ heading: structuralHeadingLevel(node.level), children: [new TextRun(node.title)] }));

    if (node.isLeaf && node.body) {
      for (const block of parseBlocks(node.body)) children.push(...renderBlock(block, nextOrderedListInstance));
    }
    // A pinned leaf with no body should not occur in practice; emit
    // the heading alone rather than fabricating placeholder prose —
    // the identical honesty rule Markdown/HTML already follow.
  }

  return children;
}

/**
 * Verification metadata (ED12/ED13) — a trailing paragraph, kept
 * structurally separate from the article's own content (never
 * interleaved, never prepended), mirroring Markdown's trailing block
 * and HTML's `<footer>`. Reuses `exportMetadataLine()` verbatim —
 * the exact same approved wording as every other format, no new
 * text, no new metadata model.
 */
export function buildDocxMetadataParagraphs(input: ExportMetadataInput): Paragraph[] {
  const line = exportMetadataLine(input);
  if (line === null) return [];
  return [new Paragraph({ text: "" }), new Paragraph({ children: [new TextRun({ text: line, italics: true })] })];
}

export interface DocxCoreProperties {
  title: string;
  /** Application/creator identity only — never a secret, never an internal auth value (this task's own explicit requirement). */
  creator: string;
}

/**
 * Assembles the full `docx.Document` and serializes it to a Buffer
 * via `Packer.toBuffer()` (Node-native, no browser Blob dependency —
 * the I/O wrapper, `generate-docx-file.ts`, uploads this Buffer
 * directly to Storage).
 *
 * Core properties are set explicitly (`title`, `creator`,
 * `lastModifiedBy`) rather than left to the library's own defaults —
 * confirmed empirically that `docx` otherwise embeds the literal,
 * misleading string `"Un-named"` for both `creator` and
 * `lastModifiedBy` when left unset. `created`/`modified`/`revision`
 * are NOT exposed by this library's own properties API — they are
 * always set to the real wall-clock time at generation, outside this
 * module's control; treated the same as relationship/docPr IDs for
 * determinism purposes (§ determinism, not asserted byte-identical).
 */
export async function assembleDocxBuffer(
  nodes: AssembledExportNode[],
  metadata: ExportMetadataInput,
  core: DocxCoreProperties,
): Promise<Uint8Array> {
  const children = [...assembleDocxChildren(nodes), ...buildDocxMetadataParagraphs(metadata)];

  const doc = new Document({
    title: core.title,
    creator: core.creator,
    lastModifiedBy: core.creator,
    numbering: DOCX_NUMBERING_CONFIG,
    sections: [{ children }],
  });

  return Packer.toBuffer(doc);
}
