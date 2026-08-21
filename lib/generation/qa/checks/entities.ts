import type { QaLeafTarget } from "../lineage";
import { evaluateEntityCoverage } from "../text";
import { finding, type DeterministicFinding } from "../types";

/**
 * `entities` (Phase 4.6 plan §2, deterministic) — are the specific
 * named entities/concepts the Blueprint assigned to this section
 * (`blueprint_nodes.entities`, already traceability-validated against
 * the Brief's own pool at Blueprint time, BD3) actually present in
 * the section's current body? A section may legitimately paraphrase,
 * but a wholesale absence of every assigned entity is a real
 * coverage gap. Matching is Markdown-formatting-insensitive
 * (`containsNormalized`, text.ts) — a manual edit's Bold/Italic
 * markup landing mid-phrase (e.g. `The **crowded** bar test`) must
 * not produce a false "missing entity" against `the crowded bar
 * test`; a genuinely absent entity still fails to match.
 *
 * LEAVES-01 fix (still in effect, unmodified): an entity may carry a
 * trailing parenthetical alias (`"Bolognese sauce (ragu alla
 * bolognese)"`, `parseEntity`, text.ts) — either the primary text or
 * an alias may satisfy coverage.
 *
 * QD10 (docs/architecture/phase-4-6-qa-plan.md, locked 2026-08-20,
 * QA-13): per-representation coverage is now normalized
 * significant-word coverage (`evaluateEntityCoverage`, text.ts), not
 * literal contiguous-phrase matching and not a ratio threshold — a
 * multi-word entity split across clauses, reordered, or missing only
 * a generic connective word can still score `full`, while a single
 * generic word alone can never produce a false `full` on its own.
 * `full` (every significant word of the best-covered representation
 * present) counts as satisfied; `partial` (some but not all of any
 * representation's words present) is a real but weaker signal, grouped
 * separately in the finding text rather than silently treated as
 * either a pass or a miss; `none` (no significant words of any
 * representation present) is a genuine gap. The section-level rollup
 * is unchanged in spirit: FAIL only when every assigned entity is
 * `none`; PASS only when every entity is `full`; anything mixed is
 * WARN, naming which entities are missing entirely vs. only partially
 * covered instead of conflating the two.
 */
export function checkEntities(leaves: QaLeafTarget[]): DeterministicFinding[] {
  const findings: DeterministicFinding[] = [];

  for (const leaf of leaves) {
    if (leaf.body === null || leaf.contentVersionId === null) continue;

    if (leaf.entities.length === 0) {
      findings.push(finding("entities", "pass", "No entities were assigned to this section by the Blueprint.", leaf.contentVersionId));
      continue;
    }

    const results = leaf.entities.map((entity) => ({ entity, ...evaluateEntityCoverage(leaf.body as string, entity) }));
    const missing = results.filter((r) => r.coverage === "none");
    const partial = results.filter((r) => r.coverage === "partial");

    if (missing.length === leaf.entities.length) {
      findings.push(
        finding(
          "entities",
          "fail",
          `None of this section's assigned entities appear in its body: ${missing.map((r) => r.entity).join(", ")}.`,
          leaf.contentVersionId,
        ),
      );
    } else if (missing.length > 0 || partial.length > 0) {
      const parts: string[] = [];
      if (missing.length > 0) parts.push(`${missing.length} missing entirely (${missing.map((r) => r.entity).join(", ")})`);
      if (partial.length > 0) {
        parts.push(
          `${partial.length} only partially present (${partial.map((r) => `${r.entity} — closest match "${r.matchedOn}"`).join("; ")})`,
        );
      }
      findings.push(
        finding(
          "entities",
          "warn",
          `${missing.length + partial.length}/${leaf.entities.length} assigned entities need attention: ${parts.join("; ")}.`,
          leaf.contentVersionId,
        ),
      );
    } else {
      findings.push(
        finding("entities", "pass", `All ${leaf.entities.length} assigned entities are present in this section's body.`, leaf.contentVersionId),
      );
    }
  }

  return findings;
}
