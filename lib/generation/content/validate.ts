import { assertBrandCompliance } from "@/lib/generation/brief/brand-compliance";
import { assertNoEmDash } from "@/lib/generation/brief/em-dash";

import { validateEvidenceUsed } from "./evidence";
import type { ContentInputPackage } from "./input";
import { validateInternalLinksInBody } from "./links";
import { contentSectionOutputSchema, type ContentSectionOutput } from "./schema";

/**
 * Full pre-persistence validation pipeline for one section (Phase 4.5
 * data-contract item 7). The actual generation call is not
 * implemented yet — this is the reusable pipeline that call will run
 * before persist.ts is ever invoked, kept here so schema/em-dash/
 * brand/link/evidence checks have exactly one implementation each,
 * not one per future call site.
 */

export interface ValidatedContentSection {
  /** Sanitized body — any non-whitelisted internal link has already been stripped (links.ts). */
  body: string;
  /** Whitelist-filtered evidenceUsed (CD8) — only references to sources actually supplied in this section's evidence packet. */
  evidenceUsed: string[];
  /** Non-zero means one or more links were stripped — worth surfacing to a human, same as Blueprint's word-count warning. */
  linkStrippedCount: number;
}

/** Zod-validates the raw tool-use output against the locked schema (schema.ts). */
export function parseContentSectionOutput(raw: unknown): ContentSectionOutput {
  return contentSectionOutputSchema.parse(raw);
}

/**
 * Order matters: em-dash/brand-compliance are hard generation
 * failures (throw), checked on the model's raw `body` — a violation
 * here means the generation itself failed, matching Brief/Blueprint's
 * discipline exactly, never silently persisted or silently stripped.
 * Internal-link whitelisting and evidenceUsed whitelisting are soft,
 * deterministic sanitization steps that always run and never throw —
 * matching Blueprint's "strip, don't fail" treatment of the same
 * class of check (a stray link/reference is not itself a fabricated
 * fact; CD9's substantive grounding rule is enforced via the system
 * prompt, not by this pipeline — see grounding.ts).
 */
export function validateContentSection(output: ContentSectionOutput, input: ContentInputPackage): ValidatedContentSection {
  assertNoEmDash({ body: output.body });
  assertBrandCompliance(
    { body: output.body },
    input.brand?.forbiddenPhrases ?? [],
    input.business?.prohibitedClaims ?? null,
  );

  const { body, strippedCount } = validateInternalLinksInBody(output.body, input.internalLinkTargets);
  const evidenceUsed = validateEvidenceUsed(output.evidenceUsed, input.evidencePacket);

  return { body, evidenceUsed, linkStrippedCount: strippedCount };
}
