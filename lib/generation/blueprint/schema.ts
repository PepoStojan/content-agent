import { z } from "zod";

/**
 * Content Blueprint — Claude-generated output contract (Phase 4.4 plan
 * §5). Unlike Brief, Blueprint has no deterministic-derivation half —
 * there is no raw evidence table to derive structure from without an
 * LLM (plan §5B) — so this schema governs the entire AI response, not
 * just an AI-provenance subset.
 *
 * The model returns one recursive node tree (a single root node with
 * nested `children`), not a flat list — inter-node consistency (no
 * duplicate topic coverage across sections, a sensible word-count
 * allocation across the whole outline) requires the model to see and
 * produce the whole structure at once (plan §5).
 */

export const blueprintInternalLinkProposalSchema = z.object({
  targetUrl: z.string().min(1),
  anchorText: z.string().min(1),
  reason: z.string().min(1),
});

export type BlueprintInternalLinkProposal = z.infer<typeof blueprintInternalLinkProposalSchema>;

export interface BlueprintNodeOutput {
  title: string;
  goal: string;
  researchSupport: string;
  uniqueContribution: string;
  entities: string[];
  internalLinks: BlueprintInternalLinkProposal[];
  evidenceRequirement: string;
  writingNotes: string;
  targetWordCount: number;
  children: BlueprintNodeOutput[];
}

/** Recursive schema requires z.lazy() + an explicit type annotation — Zod cannot infer a self-referencing shape. */
export const blueprintNodeSchema: z.ZodType<BlueprintNodeOutput> = z.lazy(() =>
  z.object({
    title: z.string().min(1),
    goal: z.string().min(1),
    researchSupport: z.string().min(1),
    uniqueContribution: z.string().min(1),
    entities: z.array(z.string().min(1)),
    internalLinks: z.array(blueprintInternalLinkProposalSchema),
    evidenceRequirement: z.string().min(1),
    writingNotes: z.string().min(1),
    targetWordCount: z.number().int().positive(),
    children: z.array(blueprintNodeSchema),
  }),
);

export const blueprintOutputSchema = z.object({
  root: blueprintNodeSchema,
});

export type BlueprintOutput = z.infer<typeof blueprintOutputSchema>;
export type BlueprintNode = z.infer<typeof blueprintNodeSchema>;

/**
 * Defensive normalization of the raw tool-use response, before Zod
 * validation. Confirmed live against a real Anthropic response: even
 * under forced tool-use with a schema matching this file exactly,
 * Claude can serialize the recursive `root` value as a JSON *string*
 * (a full, valid JSON-encoded tree) rather than as a nested object —
 * a known interaction between tool-use and `$ref`/`$defs`-based
 * recursive JSON Schemas, not a data-contract change. If `root` comes
 * back as a string, it is parsed once; if parsing fails or the shape
 * doesn't match, the original value is returned unchanged and Zod's
 * own validation error is what the caller sees (never silently
 * papering over a genuinely malformed response).
 */
export function normalizeBlueprintToolOutput(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "root" in raw) {
    const value = (raw as { root: unknown }).root;
    if (typeof value === "string") {
      try {
        return { ...raw, root: JSON.parse(value) };
      } catch {
        return raw;
      }
    }
  }
  return raw;
}
