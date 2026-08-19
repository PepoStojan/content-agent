import { z } from "zod";

/**
 * Strategy Brief — Claude-generated output contract (Phase 4.3 plan
 * §2A). Maps 1:1 onto brief_versions columns, plus a distinct
 * internalLinks block (AI-recommended candidates, §0.3) that is
 * validated separately against real Website Knowledge before
 * persistence (see internal-links.ts) — never trusted as-is.
 *
 * This schema governs AI-provenance fields only. brief_topics is
 * deliberately NOT part of it — it is derived deterministically from
 * research_sources (see topics.ts), never from the model's own
 * output, per the locked provenance rules.
 */

export const strategyBriefInternalLinkSchema = z.object({
  anchorText: z.string().min(1),
  targetUrl: z.string().min(1),
});

export const strategyBriefAiOutputSchema = z.object({
  searchIntentLabel: z.string().min(1),
  searchIntentConfidence: z.number().min(0).max(1),
  searchIntentRationale: z.string().min(1),
  targetAudience: z.string().min(1),
  contentObjective: z.string().min(1),
  secondaryTopics: z.array(z.string().min(1)),
  serpInterpretation: z.string().min(1),
  commonCompetitorExpectations: z.string().min(1),
  uniqueValue: z.string().min(1),
  title: z.string().min(1),
  h1: z.string().min(1),
  metaDescription: z.string().min(1),
  entitiesConcepts: z.array(z.string().min(1)),
  questions: z.array(z.string().min(1)),
  evidenceRequirements: z.array(z.string().min(1)),
  thingsToAvoid: z.array(z.string().min(1)),
  businessBrandAlignment: z.string().min(1),
  /** Must honestly reflect gaps (e.g. no research_sources rows, no website knowledge) rather than fabricate confidence — Phase 4.3 plan §1/§2A. */
  researchLimitations: z.string().min(1),
  internalLinks: z.array(strategyBriefInternalLinkSchema),
});

export type StrategyBriefAiOutput = z.infer<typeof strategyBriefAiOutputSchema>;
export type StrategyBriefInternalLink = z.infer<typeof strategyBriefInternalLinkSchema>;
