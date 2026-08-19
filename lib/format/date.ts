/**
 * Deterministic date formatting for UI rendered in both SSR and the
 * browser (any "use client" component, or anything hydrated). Plain
 * `toLocaleDateString()` with no arguments resolves locale from the
 * runtime's environment — Node's server locale and the browser's
 * `navigator.language` can differ (confirmed: server "8/19/2026" vs.
 * client "19/08/2026" for the same date), which is a hydration
 * mismatch, not a display preference. Pinning both locale and
 * timeZone here removes the ambiguity that causes it — this is the
 * one place application UI should format a date; do not call
 * `toLocaleDateString()`/`toLocaleString()` directly in a component
 * that renders on both server and client.
 */

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  timeZone: "UTC",
});

/** Formats an ISO timestamp (or Date) as M/D/YYYY, identically on server and client. */
export function formatDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return DATE_FORMATTER.format(date);
}
