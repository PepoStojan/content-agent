/**
 * Post-response, pre-persistence brand/business compliance checks —
 * defense in depth alongside the system prompt's instructions, not a
 * replacement for them (same pattern as em-dash.ts). A violation is
 * treated as a failed generation, never silently persisted or
 * silently stripped.
 */

export interface ForbiddenPhraseViolation {
  field: string;
  phrase: string;
}

/** brand_profiles.forbidden_phrases is a literal keyword/phrase list — fully, deterministically checkable via case-insensitive substring match. */
export function findForbiddenPhraseViolations(
  fields: Record<string, string | string[]>,
  forbiddenPhrases: string[],
): ForbiddenPhraseViolation[] {
  const phrases = forbiddenPhrases.map((p) => p.trim()).filter(Boolean);
  if (phrases.length === 0) return [];

  const violations: ForbiddenPhraseViolation[] = [];
  for (const [field, value] of Object.entries(fields)) {
    const values = Array.isArray(value) ? value : [value];
    for (const text of values) {
      const lower = text.toLowerCase();
      for (const phrase of phrases) {
        if (lower.includes(phrase.toLowerCase())) {
          violations.push({ field, phrase });
        }
      }
    }
  }
  return violations;
}

export interface ProhibitedClaimViolation {
  field: string;
  clause: string;
}

const MIN_CLAUSE_LENGTH = 12;

function splitIntoClauses(text: string): string[] {
  return text
    .split(/[\n;]|(?<=\.)\s+/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length >= MIN_CLAUSE_LENGTH);
}

/**
 * business_profiles.prohibited_claims is free-text policy prose, not
 * a keyword list — unlike forbidden phrases, this cannot be checked
 * exhaustively by string matching, because a violation can be
 * paraphrased. This is a best-effort backstop only: it catches the
 * model quoting or lifting a clause of the policy verbatim into the
 * output. The system prompt instruction (never state anything
 * described here) is the primary defense; this only guards the
 * verbatim-leakage case.
 */
export function findProhibitedClaimViolations(
  fields: Record<string, string | string[]>,
  prohibitedClaims: string | null,
): ProhibitedClaimViolation[] {
  if (!prohibitedClaims) return [];
  const clauses = splitIntoClauses(prohibitedClaims);
  if (clauses.length === 0) return [];

  const violations: ProhibitedClaimViolation[] = [];
  for (const [field, value] of Object.entries(fields)) {
    const values = Array.isArray(value) ? value : [value];
    for (const text of values) {
      const lower = text.toLowerCase();
      for (const clause of clauses) {
        if (lower.includes(clause.toLowerCase())) {
          violations.push({ field, clause });
        }
      }
    }
  }
  return violations;
}

export function assertBrandCompliance(
  fields: Record<string, string | string[]>,
  forbiddenPhrases: string[],
  prohibitedClaims: string | null,
): void {
  const forbidden = findForbiddenPhraseViolations(fields, forbiddenPhrases);
  if (forbidden.length > 0) {
    const detail = forbidden.map((v) => `${v.field}: "${v.phrase}"`).join("; ");
    throw new Error(`Forbidden phrase found in generated field(s): ${detail}.`);
  }

  const prohibited = findProhibitedClaimViolations(fields, prohibitedClaims);
  if (prohibited.length > 0) {
    const detail = prohibited.map((v) => `${v.field}: "${v.clause}"`).join("; ");
    throw new Error(`Prohibited claim language found in generated field(s): ${detail}.`);
  }
}
