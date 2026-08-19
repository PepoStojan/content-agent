import type { Database } from "@/lib/supabase/types";

import type { BlueprintNodeDraft } from "./nodes";
import { leafNodeIds } from "./nodes";

/**
 * Word-count sanity validator — locked decision BD4 (Phase 4.4 plan
 * §13). WARN-level only, not a hard generation failure: an
 * out-of-range total persists with a warning, it does not block
 * persistence. Only a genuinely invalid response shape (the Zod/
 * tool-use parse itself failing, handled elsewhere) fails the
 * generation outright. This is a deliberate asymmetry with the
 * entity-traceability and internal-link validators — those guard
 * against fabrication (a hard trust boundary), this guards against a
 * plausible-but-suboptimal outline (a quality signal).
 *
 * Bounds are an implementation-time product choice, not specified by
 * the locked architecture decisions — adjust freely without treating
 * this as a relitigation of BD4 itself (only the WARN-not-FAIL
 * behavior is locked, not these specific numbers).
 */

type ContentType = Database["public"]["Enums"]["content_type"];

const SANE_WORD_COUNT_RANGE: Record<ContentType, { min: number; max: number }> = {
  blog_post: { min: 800, max: 3000 },
  landing_page: { min: 300, max: 1500 },
  comparison_page: { min: 1500, max: 5000 },
  guide: { min: 2000, max: 6000 },
};

export interface WordCountSanityResult {
  totalWords: number;
  expectedMin: number;
  expectedMax: number;
  withinRange: boolean;
}

/** Sums target_word_count across leaf nodes only — non-leaf/structural nodes don't carry their own prose body. */
export function checkWordCountSanity(nodes: BlueprintNodeDraft[], contentType: ContentType): WordCountSanityResult {
  const leafIds = leafNodeIds(nodes);
  const totalWords = nodes.filter((n) => leafIds.has(n.id)).reduce((sum, n) => sum + n.targetWordCount, 0);
  const { min, max } = SANE_WORD_COUNT_RANGE[contentType];
  return { totalWords, expectedMin: min, expectedMax: max, withinRange: totalWords >= min && totalWords <= max };
}
