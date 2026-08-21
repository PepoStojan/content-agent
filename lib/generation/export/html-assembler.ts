import { orderNodesByDocumentPosition } from "@/lib/generation/blueprint/tree-order";
import { parseBlocks, tokenizeInline, type Block, type InlineToken } from "@/lib/format/markdown";

import { bodyStartsWithMatchingHeading, exportMetadataLine, type AssembledExportNode, type ExportMetadataInput } from "./markdown-assembler";

/**
 * EXPORT-08 — the HTML formatter's pure assembly step.
 *
 * Same pinned snapshot, same ordering, same heading-ownership and
 * dedup rule as the Markdown formatter (`markdown-assembler.ts`) —
 * this module assembles the identical document, only serialized to an
 * HTML string instead of Markdown text. It reuses, never re-derives:
 * `orderNodesByDocumentPosition()` (document order), and
 * `bodyStartsWithMatchingHeading()` (dedup rule) from
 * `markdown-assembler.ts` — there is exactly one document-assembly
 * algorithm in this codebase, not two.
 *
 * Body Markdown (`content_versions.body`) is parsed with the exact
 * same `parseBlocks()`/`tokenizeInline()` this application already
 * uses to render Markdown on-screen in the Content Editor
 * (`lib/format/markdown.tsx`) — the proven source of truth for how
 * this app's Markdown subset is interpreted, reused here as a pure
 * parser feeding a second (HTML string) renderer, rather than a
 * second, independently-written Markdown parser.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineTokensToHtml(tokens: InlineToken[]): string {
  return tokens
    .map((token) => {
      switch (token.kind) {
        case "link":
          // `tokenizeInline()` has already applied SAFE_URL_PATTERN —
          // an unsafe-scheme link never reaches this branch as a
          // `link` token (it arrives as a literal `text` token
          // instead, per that module's own documented behavior).
          return `<a href="${escapeHtml(token.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(token.label)}</a>`;
        case "bold":
          return `<strong>${escapeHtml(token.text)}</strong>`;
        case "italic":
          return `<em>${escapeHtml(token.text)}</em>`;
        default:
          return escapeHtml(token.text);
      }
    })
    .join("");
}

function renderBlockToHtml(block: Block): string {
  if (block.kind === "heading") {
    const tag = block.level === 2 ? "h2" : "h3";
    return `<${tag}>${renderInlineTokensToHtml(tokenizeInline(block.text))}</${tag}>`;
  }
  if (block.kind === "list") {
    const tag = block.ordered ? "ol" : "ul";
    const items = block.items.map((item) => `<li>${renderInlineTokensToHtml(tokenizeInline(item))}</li>`).join("");
    return `<${tag}>${items}</${tag}>`;
  }
  // Paragraph — preserve internal newlines exactly as the Content
  // Editor's own `whitespace-pre-wrap` display does, via <br>, rather
  // than collapsing them (HTML's own whitespace-collapse behavior
  // would otherwise silently join the original body's line breaks).
  const lines = block.text.split("\n");
  const html = lines.map((line) => renderInlineTokensToHtml(tokenizeInline(line))).join("<br>");
  return `<p>${html}</p>`;
}

/** Body Markdown -> an array of HTML block strings, in source order. */
function renderBodyToHtml(body: string): string[] {
  return parseBlocks(body).map(renderBlockToHtml);
}

function structuralHeadingTag(level: number): string {
  return `h${Math.min(level + 1, 6)}`;
}

/**
 * Builds the assembled article's `<article>` inner HTML — headings +
 * rendered leaf bodies — from the exact pinned node set, in true
 * document order. Mirrors `assembleMarkdownArticle()`'s own structure
 * and dedup decision precisely: a leaf whose body already starts with
 * a heading matching its own title is rendered via its own parsed
 * body headings only (no separately-inserted structural heading), the
 * identical rule `markdown-assembler.ts` already implements — reused,
 * not reimplemented.
 */
export function assembleHtmlArticle(nodes: AssembledExportNode[]): string {
  const ordered = orderNodesByDocumentPosition(nodes);

  const sections = ordered.map((node) => {
    const dedup = node.isLeaf && node.body ? bodyStartsWithMatchingHeading(node.body, node.title) : false;

    if (dedup && node.body) {
      // The body's own leading heading already matches the node's
      // title — render the body as-is (its own heading included),
      // exactly like the Markdown formatter's identical dedup branch.
      return renderBodyToHtml(node.body).join("");
    }

    const heading = `<${structuralHeadingTag(node.level)}>${escapeHtml(node.title)}</${structuralHeadingTag(node.level)}>`;
    if (!node.isLeaf) return heading;
    if (!node.body) return heading; // A pinned leaf with no body should not occur in practice; emit the heading alone rather than fabricating placeholder prose.
    return heading + renderBodyToHtml(node.body).join("");
  });

  return sections.join("");
}

/**
 * Verification metadata, structurally separate from the article
 * content — a `<footer>` after the `<article>`, never interleaved
 * with or prepended to it, mirroring Markdown's own trailing-block
 * separation (`appendExportMetadata()`). Reuses `exportMetadataLine()`
 * for the exact approved copy — one source of truth for the text,
 * never a second wording per format.
 */
export function renderExportMetadataHtml(input: ExportMetadataInput): string {
  const line = exportMetadataLine(input);
  if (line === null) return "";
  return `<footer><p>${escapeHtml(line)}</p></footer>`;
}

const DOCUMENT_STYLE = `body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:2.5rem auto;padding:0 1.25rem;color:#1A202C;line-height:1.6}h1,h2,h3{line-height:1.3}h1{font-size:1.75rem}h2{font-size:1.35rem;margin-top:2rem}h3{font-size:1.1rem;margin-top:1.5rem}p{margin:0.75rem 0}ul,ol{margin:0.75rem 0;padding-left:1.5rem}a{color:#00A886}footer{margin-top:2.5rem;padding-top:1rem;border-top:1px solid #D1DCE8;color:#4A5568;font-size:0.85rem}`;

/**
 * Wraps the assembled `<article>` + `<footer>` in a complete,
 * deterministic HTML document — no scripts, no external resources, no
 * timestamps or random values in the article content (only the
 * already-approved, verification-state-derived metadata line varies).
 */
export function assembleHtmlDocument(articleHtml: string, metadataHtml: string, title: string): string {
  const safeTitle = escapeHtml(title);
  return (
    "<!doctype html>\n" +
    '<html lang="en">\n' +
    "<head>\n" +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    `<title>${safeTitle}</title>\n` +
    `<style>${DOCUMENT_STYLE}</style>\n` +
    "</head>\n" +
    "<body>\n" +
    `<article>${articleHtml}</article>\n` +
    (metadataHtml ? `${metadataHtml}\n` : "") +
    "</body>\n" +
    "</html>\n"
  );
}
