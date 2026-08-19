import type { Database } from "@/lib/supabase/types";

import type { StrategyBriefResearchSource } from "./input";

/**
 * Deterministic brief_topics derivation (Phase 4.3 plan §2B/§0.2).
 * `brief_topics` is labeled "Research finding" — it must never be
 * synthesized by the model, only extracted from `research_sources`
 * that already exist for the project's current research package.
 *
 * Provenance mapping, decided explicitly against the real parsed
 * shape of every research_source_type this parser can emit today
 * (lib/ingestion/markdown-research-parser.ts):
 *
 *  INCLUDED (short, clean, string[] payloads — genuinely "topics,
 *  entities & questions to cover"):
 *   - secondary_queries          keyword variants from the project's own research request.
 *   - common_ground_topics       the canonical cross-competitor topic list — the strongest source.
 *   - paa                        real People Also Ask questions.
 *   - related_searches           short, topic-adjacent search phrases.
 *
 *  EXCLUDED (not a topic label — belongs as raw evidence for the AI
 *  synthesis fields in schema.ts, never flattened into a topic chip):
 *   - topic                      a single restatement of the research file's OWN topic
 *                                 assertion — can conflict with the project's authoritative
 *                                 primary_topic/target_query (confirmed by the real sample,
 *                                 where the two disagree). Surfacing it as a verified "topic to
 *                                 cover" chip would risk presenting a possibly-wrong topic as
 *                                 fact. Stays available to the AI stage as conflict evidence for
 *                                 researchLimitations, never as a brief_topics row.
 *   - competitor_unique_sections  payload is structured per-competitor objects
 *                                 ({rank, source, sections}), not a topic label — feeds
 *                                 serpInterpretation/uniqueValue/commonCompetitorExpectations.
 *   - content_gaps                full-sentence gap-flag prose, not a topic label — feeds
 *                                 evidenceRequirements/thingsToAvoid/researchLimitations.
 *   - ai_overview                  full-sentence analytical points, not topic labels — feeds
 *                                 serpInterpretation.
 *
 * Only string[] payloads are handled — this matches the four included
 * types' real shape exactly. Anything else (a malformed row, or a
 * type not in this list) is skipped, never guessed at.
 */

const TOPICAL_SOURCE_TYPES: ReadonlySet<Database["public"]["Enums"]["research_source_type"]> = new Set([
  "secondary_queries",
  "common_ground_topics",
  "paa",
  "related_searches",
]);

export interface BriefTopicDraft {
  label: string;
}

export function deriveBriefTopics(sources: StrategyBriefResearchSource[]): BriefTopicDraft[] {
  const labels = new Set<string>();

  for (const source of sources) {
    if (!TOPICAL_SOURCE_TYPES.has(source.type)) continue;
    if (!Array.isArray(source.payload)) continue;

    for (const entry of source.payload) {
      if (typeof entry === "string") {
        const label = entry.trim();
        if (label) labels.add(label);
      }
    }
  }

  // Sorted for deterministic output order — research_sources rows
  // carry no defined ordering from the database, so relying on
  // insertion order would make the same data produce a
  // differently-ordered result across runs.
  return [...labels].sort().map((label) => ({ label }));
}
