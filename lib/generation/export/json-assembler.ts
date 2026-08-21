import { orderNodesByDocumentPosition, type TreeOrderable } from "@/lib/generation/blueprint/tree-order";

import type { ExportVerificationTier } from "./gate";

/**
 * EXPORT-09 — the Structured JSON formatter's pure assembly step.
 *
 * Same source of truth as Markdown/HTML (`markdown-assembler.ts`,
 * `html-assembler.ts`): the export's own pinned node set (already
 * resolved from the pinned `blueprint_version_id`) and pinned
 * `export_content_versions` bodies, ordered via
 * `orderNodesByDocumentPosition()` — never a "current" pointer, never
 * database row order, never a second document-assembly algorithm.
 * This module adds no new resolution logic of its own; the caller
 * (`generate-json-file.ts`) supplies nodes already resolved exactly
 * like the other two formatters' own I/O wrappers do.
 *
 * §3/§4/§7 (this task, locked): Structured JSON is a **deliberate
 * public export contract**, not a serialized Supabase response — only
 * the fields explicitly listed below are emitted, never a wholesale
 * table dump. A leaf's `body` is the canonical Markdown text,
 * verbatim, byte-for-byte — never re-rendered to HTML, never
 * re-parsed, exactly like Markdown's own passthrough rule. Real
 * `JSON.stringify` is the only serialization mechanism used — never
 * manual string concatenation — so arbitrary Unicode, quotes,
 * backslashes, and newlines in any field are always safely encoded.
 *
 * §6 (this task, locked): `schemaVersion: 1` is a first-class,
 * required field — any future change to this contract's shape must
 * bump it, never silently reshape the same version number. No
 * timestamp or random field is embedded in the document body itself
 * (this task's own explicit determinism requirement, §6/§13) — the
 * one exception is `metadata.exportId`, which is not a "generated at
 * serialization time" value but the fixed, already-created identity
 * of the specific `exports` row this file is being generated *for*
 * (passed in by the caller, already an immutable snapshot pin by the
 * time this function runs, ED8) — re-serializing the same export at
 * any later time reproduces byte-identical JSON.
 */

export interface JsonExportNode extends TreeOrderable {
  id: string;
  parentId: string | null;
  level: number;
  position: number;
  title: string;
  isLeaf: boolean;
  goal: string | null;
  targetWordCount: number | null;
  /** `blueprint_nodes.entities`, already normalized to `string[]` by the caller — never the raw `Json` column type. */
  entities: string[];
  /** The pinned `content_versions.id` for this leaf (`export_content_versions`) — `null` for structural nodes and for a pinned leaf with no content (handled honestly, never fabricated). */
  contentVersionId: string | null;
  /** `content_versions.status` for the pinned version — `null` for structural nodes. */
  status: string | null;
  /** The pinned `content_versions.body`, canonical Markdown, verbatim — `null` for structural nodes and for a leaf with no pinned content. */
  body: string | null;
}

export interface JsonExportSection {
  blueprintNodeId: string;
  blueprintVersionId: string;
  parentId: string | null;
  level: number;
  position: number;
  title: string;
  isLeaf: boolean;
  goal: string | null;
  targetWordCount: number | null;
  entities: string[];
  contentVersionId: string | null;
  status: string | null;
  body: string | null;
}

export interface JsonExportMetadata {
  exportId: string;
  projectId: string;
  projectName: string;
  contentType: string;
  briefVersionId: string | null;
  blueprintVersionId: string;
  qaReportId: string | null;
  qaBypassed: boolean;
  verificationTier: ExportVerificationTier;
  evaluatedCategories: string[];
  skippedCategories: string[];
}

export interface ExportJsonDocument {
  schemaVersion: 1;
  metadata: JsonExportMetadata;
  document: {
    title: string;
    sections: JsonExportSection[];
  };
}

/**
 * Builds the full Structured JSON export document — metadata block
 * (§3/§5) + ordered sections (§2/§4) — from the exact pinned node set,
 * in true document order. Pure; no I/O, no randomness, no
 * wall-clock-dependent values.
 */
export function assembleJsonDocument(nodes: JsonExportNode[], metadata: JsonExportMetadata): ExportJsonDocument {
  const ordered = orderNodesByDocumentPosition(nodes);
  const rootNode = ordered.find((n) => n.parentId === null);

  const sections: JsonExportSection[] = ordered.map((node) => ({
    blueprintNodeId: node.id,
    blueprintVersionId: metadata.blueprintVersionId,
    parentId: node.parentId,
    level: node.level,
    position: node.position,
    title: node.title,
    isLeaf: node.isLeaf,
    goal: node.goal,
    targetWordCount: node.targetWordCount,
    entities: node.entities,
    contentVersionId: node.contentVersionId,
    status: node.status,
    body: node.body,
  }));

  return {
    schemaVersion: 1,
    metadata,
    document: {
      title: rootNode?.title ?? "export",
      sections,
    },
  };
}

/**
 * Real `JSON.stringify`-based serialization (§7, locked) — never
 * manual string concatenation. A trailing newline matches this
 * codebase's other text-format outputs (Markdown/HTML); 2-space
 * indentation is a readability choice with no effect on validity or
 * determinism (`JSON.stringify` with a fixed `space` argument and no
 * key-order variance — this module always constructs keys in the same
 * literal order — is itself deterministic).
 */
export function serializeExportJson(doc: ExportJsonDocument): string {
  return JSON.stringify(doc, null, 2) + "\n";
}
