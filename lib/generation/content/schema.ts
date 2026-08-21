import { z } from "zod";

/**
 * Content Section — Claude-generated output contract (Phase 4.5 plan
 * §1/§4, item 4 of the data-contract task). Deliberately small: one
 * section's `body` plus its `evidenceUsed` provenance references
 * (CD8). No other field is invented here — everything else about a
 * section (title, target word count, entities, internal link
 * targets) is already authoritative on the Blueprint node (plan §2)
 * and is not re-emitted by the model. Persisting maps `body` onto
 * `content_versions.body`; `evidenceUsed` has no column of its own
 * (same non-schema-field treatment as Blueprint's `wordCountWarning`)
 * and is carried on the owning `generation_runs.metadata` instead —
 * see persist.ts.
 */

export const contentSectionOutputSchema = z.object({
  body: z.string().min(1),
  /** CD8: reference IDs only (`research_source:<id>`), never duplicated evidence text — validated/whitelisted post-response by evidence.ts's validateEvidenceUsed(), not trusted as emitted. */
  evidenceUsed: z.array(z.string()),
});

export type ContentSectionOutput = z.infer<typeof contentSectionOutputSchema>;
