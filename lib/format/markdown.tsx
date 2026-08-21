import type { ReactNode } from "react";

/**
 * Lightweight, dependency-free Markdown renderer for Content Editor
 * *display* mode only. Canonical storage (`content_versions.body`)
 * stays plain Markdown text, completely unchanged by this module — it
 * only ever reads a body string and returns React elements to render;
 * nothing here writes, reformats, or converts the stored value. Edit
 * mode's textarea is untouched (still the raw Markdown string,
 * unaffected by this renderer).
 *
 * Safe by construction, not by sanitization: every piece of source
 * text becomes a React child (`{text}`), never `dangerouslySetInnerHTML`
 * and never an HTML string. React escapes all text children before
 * writing to the DOM, so literal `<script>`/HTML in a body can only
 * ever render as visible text — it can never execute or be
 * interpreted as markup. The one place this module emits a real DOM
 * attribute from user content is a link's `href`; that value is
 * whitelisted against a small safe-scheme pattern (§ SAFE_URL_PATTERN)
 * before being used, so a `javascript:`-scheme "link" renders as
 * plain, inert text instead of a clickable attribute.
 *
 * Deliberately minimal: covers exactly what the Content Editor's own
 * Markdown toolbar can produce (H2/H3, bold, italic, unordered/ordered
 * lists, links, paragraphs) — no tables, no blockquotes, no nested
 * lists, no raw HTML passthrough. Not a general-purpose Markdown
 * engine; a heavier one (remark/react-markdown) was deliberately not
 * added as a dependency for this small, fixed surface.
 */

export const SAFE_URL_PATTERN = /^(https?:|mailto:|\/|#)/i;

const INLINE_PATTERN = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;

/**
 * Pure inline-token representation, shared by every renderer of this
 * codebase's Markdown subset (the JSX renderer below and the HTML
 * export string-renderer, `lib/generation/export/html-assembler.ts`)
 * — one tokenizer, never two independently-maintained regex passes
 * over the same inline syntax. An unsafe-scheme link (`SAFE_URL_PATTERN`
 * fails) is intentionally emitted as a single `text` token containing
 * the literal `[label](url)` source, exactly matching this module's
 * pre-existing behavior — never a `link` token, so a consuming
 * renderer cannot accidentally make it clickable.
 */
export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "link"; label: string; url: string };

export function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: "text", text: text.slice(lastIndex, match.index) });
    }

    if (match[1] !== undefined) {
      const label = match[1];
      const url = match[2].trim();
      if (SAFE_URL_PATTERN.test(url)) {
        tokens.push({ kind: "link", label, url });
      } else {
        // Unsafe/unrecognized scheme (e.g. "javascript:") — plain,
        // inert text, never a clickable href.
        tokens.push({ kind: "text", text: `[${label}](${url})` });
      }
    } else if (match[3] !== undefined) {
      tokens.push({ kind: "bold", text: match[3] });
    } else if (match[4] !== undefined) {
      tokens.push({ kind: "italic", text: match[4] });
    }

    lastIndex = INLINE_PATTERN.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({ kind: "text", text: text.slice(lastIndex) });
  }

  return tokens;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return tokenizeInline(text).map((token, i) => {
    switch (token.kind) {
      case "link":
        return (
          <a
            key={`${keyPrefix}-a${i}`}
            href={token.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {token.label}
          </a>
        );
      case "bold":
        return <strong key={`${keyPrefix}-b${i}`}>{token.text}</strong>;
      case "italic":
        return <em key={`${keyPrefix}-i${i}`}>{token.text}</em>;
      default:
        return <span key={`${keyPrefix}-t${i}`}>{token.text}</span>;
    }
  });
}

export type Block =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "paragraph"; text: string };

const UL_ITEM_PATTERN = /^[-*+]\s+(.*)$/;
const OL_ITEM_PATTERN = /^\d+\.\s+(.*)$/;

/**
 * Collects consecutive list-item lines matching `itemPattern` starting
 * at `lines[startIndex]`, tolerating a single blank line between two
 * items of the *same* type ("loose list," a legal, common Markdown
 * shape — confirmed present in real generated content, e.g. AI output
 * that puts a blank line between each numbered point for readability).
 * A blank line is only consumed when the line after it is itself a
 * matching list item; a blank line followed by anything else (a new
 * paragraph, end of body) ends the list normally. Without this, each
 * blank-line-separated item became its own single-item list, and every
 * single-item `<ol>` independently restarts its counter at 1 — the
 * exact bug this fixes (a real numbered list rendering as "1." reported
 * six times over instead of "1."–"6.").
 */
function collectListItems(lines: string[], startIndex: number, itemPattern: RegExp): { items: string[]; nextIndex: number } {
  const items: string[] = [];
  let i = startIndex;
  while (i < lines.length) {
    const match = itemPattern.exec(lines[i]);
    if (match) {
      items.push(match[1]);
      i++;
      continue;
    }
    if (lines[i].trim() === "" && i + 1 < lines.length && itemPattern.test(lines[i + 1])) {
      i++;
      continue;
    }
    break;
  }
  return { items, nextIndex: i };
}

/** Exported for `markdown.verify.ts` (deterministic block-parsing regression checks) — not used anywhere else outside this module. */
export function parseBlocks(body: string): Block[] {
  const lines = body.split("\n");
  const blocks: Block[] = [];
  let paragraphLines: string[] = [];

  function flushParagraph() {
    if (paragraphLines.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraphLines.join("\n") });
      paragraphLines = [];
    }
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const h3 = /^###\s+(.*)$/.exec(line);
    const h2 = !h3 ? /^##\s+(.*)$/.exec(line) : null;
    const ul = UL_ITEM_PATTERN.exec(line);
    const ol = OL_ITEM_PATTERN.exec(line);

    if (h3) {
      flushParagraph();
      blocks.push({ kind: "heading", level: 3, text: h3[1] });
      i++;
    } else if (h2) {
      flushParagraph();
      blocks.push({ kind: "heading", level: 2, text: h2[1] });
      i++;
    } else if (ul) {
      flushParagraph();
      const { items, nextIndex } = collectListItems(lines, i, UL_ITEM_PATTERN);
      blocks.push({ kind: "list", ordered: false, items });
      i = nextIndex;
    } else if (ol) {
      flushParagraph();
      const { items, nextIndex } = collectListItems(lines, i, OL_ITEM_PATTERN);
      blocks.push({ kind: "list", ordered: true, items });
      i = nextIndex;
    } else if (line.trim() === "") {
      flushParagraph();
      i++;
    } else {
      paragraphLines.push(line);
      i++;
    }
  }
  flushParagraph();

  return blocks;
}

/**
 * Renders a plain-Markdown body string as React elements for display
 * (view) mode. Does not affect edit mode, storage, or versioning in
 * any way.
 */
export function renderMarkdown(body: string): ReactNode {
  const blocks = parseBlocks(body);

  return (
    <>
      {blocks.map((block, idx) => {
        const key = `block-${idx}`;

        if (block.kind === "heading") {
          const className =
            block.level === 2
              ? "mt-4 mb-1.5 text-[15.5px] font-semibold text-text-primary first:mt-0"
              : "mt-3 mb-1 text-[14px] font-semibold text-text-primary first:mt-0";
          return block.level === 2 ? (
            <h2 key={key} className={className}>
              {renderInline(block.text, key)}
            </h2>
          ) : (
            <h3 key={key} className={className}>
              {renderInline(block.text, key)}
            </h3>
          );
        }

        if (block.kind === "list") {
          const items = block.items.map((item, i) => <li key={`${key}-li${i}`}>{renderInline(item, `${key}-li${i}`)}</li>);
          return block.ordered ? (
            <ol key={key} className="mb-2 ml-5 list-decimal space-y-0.5 last:mb-0">
              {items}
            </ol>
          ) : (
            <ul key={key} className="mb-2 ml-5 list-disc space-y-0.5 last:mb-0">
              {items}
            </ul>
          );
        }

        return (
          <p key={key} className="mb-2 whitespace-pre-wrap last:mb-0">
            {renderInline(block.text, key)}
          </p>
        );
      })}
    </>
  );
}
