import { orderNodesByDocumentPosition, type TreeOrderable } from "@/lib/generation/blueprint/tree-order";

/**
 * EXPORT-07 — the Markdown formatter's pure assembly step.
 *
 * §1 (locked, this task): the canonical content is already Markdown
 * (`content_versions.body`, CD5/CD6). This module never re-parses or
 * re-serializes a leaf's body through a second Markdown parser (it is
 * not `lib/format/markdown.tsx`, which exists to render Markdown as
 * React JSX for on-screen display, a different job entirely) — a
 * leaf's body is emitted byte-for-byte as stored, the only thing this
 * module ever adds is a heading line before it.
 *
 * §2: ordering is `orderNodesByDocumentPosition()`, unmodified,
 * applied to the exact node set the caller supplies — never DB row
 * order, a flat level/position sort, or a status sort. The caller is
 * responsible for supplying nodes already resolved from the export's
 * own pinned `blueprint_version_id` and pinned `content_versions`
 * (via `export_content_versions`), never a "current" pointer —
 * this module itself does no I/O and cannot enforce that; it is pure.
 *
 * §3 (documented decision, required by this task): section titles are
 * INSERTED BY THE ASSEMBLER, not expected to already exist inside a
 * leaf's body. Confirmed empirically against real, live content
 * (Phase 4.5/4.6 sessions) and by the existing canonical convention
 * this codebase already established for whole-document assembly
 * (`lib/ai/prompts/qa/v1.ts`'s `assembleArticleText()`, CD6): a leaf's
 * `content_versions.body` never contains its own heading — the
 * Blueprint node's `title` is the section heading, stored separately.
 * A structural (non-leaf) node contributes only its title as a
 * heading, exactly as CD6 already specifies, with no body of its own
 * (Content is only ever generated for leaves, CD1). To guard against
 * an unexpected future case where a body genuinely does start with a
 * heading that already matches the node's own title (e.g., a
 * hand-edited section), `bodyStartsWithMatchingHeading()` skips
 * inserting a second, duplicate heading — this is defensive, not the
 * expected case with today's real data.
 *
 * Heading depth follows `blueprint_nodes.level` directly and
 * deterministically: level 0 (root) -> H1, level 1 -> H2, level 2 ->
 * H3, capped at H6 for any deeper nesting — confirmed against real
 * Blueprint data (root at level 0, top sections at level 1, sub-steps
 * at level 2).
 */

export interface AssembledExportNode extends TreeOrderable {
  id: string;
  parentId: string | null;
  level: number;
  position: number;
  title: string;
  isLeaf: boolean;
  /** The pinned `content_versions.body` for this leaf — `null` for structural nodes and for a leaf with no pinned content (should not occur for a node actually included in the export snapshot, but handled honestly rather than assumed). */
  body: string | null;
}

function headingPrefix(level: number): string {
  return "#".repeat(Math.min(level + 1, 6));
}

/** Normalizes only for the duplicate-heading comparison — never mutates what actually gets emitted into the document. */
function normalizeForHeadingComparison(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Exported for reuse by the HTML formatter (EXPORT-08) — the exact same dedup rule, never a second heading-comparison algorithm. */
export function bodyStartsWithMatchingHeading(body: string, title: string): boolean {
  const firstLine = body.split("\n").find((line) => line.trim().length > 0) ?? "";
  const match = firstLine.match(/^#{1,6}\s+(.*)$/);
  if (!match) return false;
  return normalizeForHeadingComparison(match[1]) === normalizeForHeadingComparison(title);
}

/**
 * Builds the assembled article body — headings + verbatim leaf bodies
 * — from the exact pinned node set, in true document order. Does not
 * include any verification/QA metadata (kept separate, §4 — see
 * `appendExportMetadata()` below); this function's output is the
 * publishable article content only.
 */
export function assembleMarkdownArticle(nodes: AssembledExportNode[]): string {
  const ordered = orderNodesByDocumentPosition(nodes);

  const blocks = ordered.map((node) => {
    const heading = `${headingPrefix(node.level)} ${node.title}`;
    if (!node.isLeaf) return heading;
    if (!node.body) return heading; // A pinned leaf with no body should not occur in practice; emit the heading alone rather than fabricating placeholder prose.
    if (bodyStartsWithMatchingHeading(node.body, node.title)) return node.body;
    return `${heading}\n\n${node.body}`;
  });

  return blocks.join("\n\n").trim() + "\n";
}

export type ExportMetadataTier = "verified" | "partially_verified" | "unverified";

export interface ExportMetadataInput {
  tier: ExportMetadataTier;
  /** Only meaningful for `partially_verified`. */
  evaluatedCount?: number;
}

/**
 * §4 (locked, this task) — verification metadata, kept structurally
 * separate from the article body (a trailing block after a `---`
 * horizontal rule, never interleaved with or prepended to the
 * article's own content):
 * - Verified: no metadata line at all — "do not insert unnecessary QA
 *   messaging into the publishable article."
 * - Partially verified: ED13's approved one-line treatment.
 * - Unverified: exactly "Export status: Unverified" — this task's own
 *   literal, verbatim copy, superseding the longer draft wording in
 *   the original ED13 planning section.
 */
/**
 * The one-line verification-status text, shared by every format's
 * metadata treatment (Markdown's own trailing block below, and HTML's
 * `<footer>` block, `html-assembler.ts`) — a single source of truth
 * for the exact approved copy, never reworded per format. `null` for
 * `verified`, matching every format's "no line added when nothing
 * needs disclosing" rule.
 */
export function exportMetadataLine(input: ExportMetadataInput): string | null {
  if (input.tier === "verified") return null;
  if (input.tier === "unverified") return "Export status: Unverified";
  return `Export status: Partially verified — ${input.evaluatedCount ?? 0} of 9 QA categories evaluated.`;
}

export function appendExportMetadata(article: string, input: ExportMetadataInput): string {
  const line = exportMetadataLine(input);
  if (line === null) return article;
  return `${article}\n---\n\n${line}\n`;
}
