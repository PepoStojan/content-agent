/**
 * The grounding rule — CD9, locked (docs/architecture/phase-4-5-content-generation-plan.md).
 * Content must never invent a specific claim, statistic, price,
 * competitor fact, business fact, or other factual assertion the
 * supplied evidence packet does not support. When evidence is
 * insufficient for what a section's `evidence_requirement` calls for:
 * omit the unsupported claim, or make only a safe, non-specific
 * statement — never fill the gap with a plausible-sounding invented
 * detail.
 *
 * This module is the ONE canonical source for that rule's exact
 * wording, so the future prompt module (not built yet — the Content
 * prompt is explicitly out of scope for this task) embeds it
 * verbatim instead of re-describing it slightly differently.
 *
 * What is and isn't mechanically enforceable, stated honestly (plan
 * §7): there is no deterministic way to verify an arbitrary sentence's
 * factual claim against a research payload. Of the rule's clauses,
 * exactly one is fully, mechanically enforceable today —
 * "never invent a URL" — via links.ts's whitelist stripping. The rest
 * (statistics, prices, competitor facts, business facts) rely on the
 * system prompt instruction (below) plus the `evidenceUsed` signal
 * (evidence.ts) for human review; no fake "claim verifier" is
 * implemented here, because building one would misrepresent what this
 * system can actually check.
 */

export const GROUNDING_RULES: readonly string[] = [
  "Never invent a specific statistic, number, or percentage that is not present in the supplied evidence.",
  "Never invent a price, cost figure, or pricing claim that is not present in the supplied evidence.",
  "Never invent a competitor fact, product claim, or comparison that is not present in the supplied evidence.",
  "Never invent a business fact (about this project's own company) beyond what the Business Profile and Brief explicitly state.",
  "Never invent a URL. Only use the internal link targets explicitly supplied for this section, exactly as given.",
  "When the supplied evidence does not support a specific claim this section's evidence requirement calls for, omit that claim, or state it only in a safe, non-specific way — never fill the gap with a plausible-sounding invented detail.",
] as const;

/** A single, prompt-ready paragraph combining every rule above — for the future Content prompt module to embed verbatim rather than re-authoring. */
export function groundingRulesAsPromptText(): string {
  return GROUNDING_RULES.map((rule, i) => `${i + 1}. ${rule}`).join("\n");
}
