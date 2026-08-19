import type { BlueprintBriefContext } from "./input";
import type { BlueprintNodeDraft } from "./nodes";

/**
 * Entity traceability validator — locked decision BD3 (Phase 4.4
 * plan §13). A hard, generation-failing check, not a soft quality
 * signal: every string in a node's `entities` array must be
 * traceable to the Brief's own `entities_concepts`/`questions`/
 * `secondary_topics` pool. This is a fabrication guard, matching the
 * discipline already applied to internal links — the model is never
 * trusted to invent an entity the approved Brief never surfaced.
 *
 * Matching is exact-string, case-insensitive, trimmed — the model is
 * expected to copy pool entries verbatim (it was given them as
 * context), not paraphrase them; a near-miss is treated as
 * untraceable, not fuzzy-matched, to keep the guarantee meaningful.
 */

export function buildEntityPool(brief: BlueprintBriefContext): Set<string> {
  const pool = new Set<string>();
  for (const value of [...brief.entitiesConcepts, ...brief.questions, ...brief.secondaryTopics]) {
    const normalized = value.trim().toLowerCase();
    if (normalized) pool.add(normalized);
  }
  return pool;
}

export interface EntityTraceabilityViolation {
  nodeId: string;
  entity: string;
}

/** Returns every (node, entity) pair that failed traceability — callers decide whether that means "fail the generation" (BD3) or something else. */
export function findEntityTraceabilityViolations(
  nodes: BlueprintNodeDraft[],
  pool: ReadonlySet<string>,
): EntityTraceabilityViolation[] {
  const violations: EntityTraceabilityViolation[] = [];
  for (const node of nodes) {
    for (const entity of node.entities) {
      if (!pool.has(entity.trim().toLowerCase())) {
        violations.push({ nodeId: node.id, entity });
      }
    }
  }
  return violations;
}

/** BD3: a violation is a failed generation, not a silent strip — mirrors em-dash/brand-compliance's assert-style enforcement. */
export function assertEntityTraceability(nodes: BlueprintNodeDraft[], pool: ReadonlySet<string>): void {
  const violations = findEntityTraceabilityViolations(nodes, pool);
  if (violations.length > 0) {
    const detail = violations.map((v) => `node ${v.nodeId}: "${v.entity}"`).join("; ");
    throw new Error(`Untraceable entit${violations.length === 1 ? "y" : "ies"} found in generated Blueprint: ${detail}.`);
  }
}
