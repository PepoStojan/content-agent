const EM_DASH = "—";

/**
 * Defense-in-depth enforcement of the no-em-dash rule
 * (`brand_profiles.em_dash_forbidden`, defaults true) directly on the
 * Brief's own generated text fields — not deferred to Content/QA,
 * since these fields are shown to and can be copied by users
 * immediately on Brief approval (Phase 4.3 plan §7). The prompt-level
 * instruction (once built) is the first line of defense; this is the
 * one that actually blocks persistence.
 */

export function findEmDashViolations(fields: Record<string, string | string[]>): string[] {
  const violations: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const values = Array.isArray(value) ? value : [value];
    if (values.some((v) => v.includes(EM_DASH))) {
      violations.push(key);
    }
  }
  return violations;
}

/**
 * A violation is treated as a failed generation (retryable), never
 * silently persisted or silently stripped (Phase 4.3 plan §7).
 */
export function assertNoEmDash(fields: Record<string, string | string[]>): void {
  const violations = findEmDashViolations(fields);
  if (violations.length > 0) {
    throw new Error(`Em dash found in generated field(s): ${violations.join(", ")}.`);
  }
}
