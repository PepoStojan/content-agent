import type { QaStatus } from "./types";

/**
 * QD7 (locked, docs/architecture/phase-4-6-qa-plan.md) — the one
 * validation gate every LLM-sourced finding must pass before it is
 * ever persisted: any finding above PASS must carry a literal,
 * locatable quote from the text it was actually evaluating. A finding
 * that fails this check is dropped entirely — never stored with a
 * placeholder, never "fixed up," never silently downgraded to PASS.
 */

export interface RawLlmFinding {
  status: QaStatus;
  quote?: string;
  note: string;
}

export interface LlmFindingCandidate {
  contentVersionId: string | null;
  body: string;
}

export interface ValidatedLlmFinding {
  status: QaStatus;
  note: string;
  /** The literal, locatable excerpt this finding was validated against — stored in `qa_findings.quote` (QU3/QD7), never embedded into `note`. `null` for PASS (no quote required or expected). */
  quote: string | null;
  /** Resolved by literal quote-in-body lookup against `candidates` — never trusted from the model's own output (QD7/§13's anti-hallucination discipline). `null` only for a whole-document PASS with no quote to anchor. */
  contentVersionId: string | null;
}

/**
 * @param candidates The exact, known-good set of (contentVersionId, body) pairs this finding is allowed to be about. For `factual`, this is always exactly one section (index-resolved, never search-across-all). For `intent`, this is every leaf section's body — the quote's location determines which section anchors the finding.
 * @returns `null` if the finding is invalid and must be rejected (no quote on a WARN/FAIL, or a quote that doesn't literally appear in any candidate body).
 */
export function validateLlmFinding(raw: RawLlmFinding, candidates: LlmFindingCandidate[]): ValidatedLlmFinding | null {
  if (raw.status === "pass") {
    return { status: "pass", note: raw.note, quote: null, contentVersionId: null };
  }

  const quote = raw.quote?.trim();
  if (!quote) return null;

  const match = candidates.find((c) => c.body.includes(quote));
  if (!match) return null;

  return {
    status: raw.status,
    note: raw.note,
    quote,
    contentVersionId: match.contentVersionId,
  };
}
