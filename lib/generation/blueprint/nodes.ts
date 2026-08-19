import { randomUUID } from "crypto";

import type { BlueprintNode } from "./schema";

/**
 * Flattens the model's recursive node tree (schema.ts) into the flat,
 * self-referencing row shape `blueprint_nodes` actually stores
 * (`parent_id`/`level`/`position`), assigning every node a
 * client-generated id up front so parent/child references are known
 * before any insert happens — a single batch insert can then contain
 * a child row referencing a parent row from the same statement
 * (Postgres checks NOT DEFERRABLE FK constraints at end-of-statement,
 * not per-row, so this is safe for one multi-row INSERT).
 *
 * Entities and internal links are carried through unvalidated here —
 * validation (entities.ts, internal-links.ts) is a separate pass over
 * this same flat array, run before persistence.
 */

export interface BlueprintNodeDraft {
  id: string;
  parentId: string | null;
  level: number;
  position: number;
  title: string;
  goal: string;
  researchSupport: string;
  uniqueContribution: string;
  entities: string[];
  internalLinks: BlueprintNode["internalLinks"];
  evidenceRequirement: string;
  writingNotes: string;
  targetWordCount: number;
}

export function flattenBlueprintTree(root: BlueprintNode): BlueprintNodeDraft[] {
  const drafts: BlueprintNodeDraft[] = [];

  function visit(node: BlueprintNode, parentId: string | null, level: number, position: number): void {
    const id = randomUUID();
    drafts.push({
      id,
      parentId,
      level,
      position,
      title: node.title,
      goal: node.goal,
      researchSupport: node.researchSupport,
      uniqueContribution: node.uniqueContribution,
      entities: node.entities,
      internalLinks: node.internalLinks,
      evidenceRequirement: node.evidenceRequirement,
      writingNotes: node.writingNotes,
      targetWordCount: node.targetWordCount,
    });
    node.children.forEach((child, index) => visit(child, id, level + 1, index));
  }

  visit(root, null, 0, 0);
  return drafts;
}

/** Leaf nodes are exactly the nodes future Content generation will produce one `content_documents` row per (plan §5). */
export function leafNodeIds(drafts: BlueprintNodeDraft[]): Set<string> {
  const parentIds = new Set(drafts.map((d) => d.parentId).filter((id): id is string => id !== null));
  return new Set(drafts.filter((d) => !parentIds.has(d.id)).map((d) => d.id));
}
