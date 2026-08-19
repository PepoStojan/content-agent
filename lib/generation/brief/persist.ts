import type { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

import type { BriefInternalLinkDraft } from "./internal-links";
import type { StrategyBriefAiOutput } from "./schema";
import type { BriefTopicDraft } from "./topics";

/**
 * The artifact_persisted write sequence, exactly as specified in
 * Phase 4.3 plan §3: content_briefs head (fetch-or-create) ->
 * brief_versions (anchor row) -> brief_topics children ->
 * brief_internal_links children -> content_briefs.current_version_id
 * flip, done last. No existing version is ever mutated or deleted —
 * the locked head+version pattern.
 *
 * No multi-statement transaction primitive is available at this
 * client layer (plan §0.4) — if a later step fails, the version row
 * already exists but isn't yet current, a safe, recoverable
 * intermediate state that maps directly onto "not yet
 * artifact_persisted".
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface PersistBriefVersionInput {
  projectId: string;
  generationRunId: string;
  createdBy: string;
  researchPackageId: string | null;
  output: StrategyBriefAiOutput;
  topics: BriefTopicDraft[];
  internalLinks: BriefInternalLinkDraft[];
  model: string;
  promptVersion: string;
}

export interface PersistBriefVersionResult {
  contentBriefId: string;
  briefVersionId: string;
  version: number;
}

export async function persistBriefVersion(
  supabase: SupabaseServerClient,
  input: PersistBriefVersionInput,
): Promise<PersistBriefVersionResult> {
  const { data: existingBrief, error: fetchBriefError } = await supabase
    .from("content_briefs")
    .select("id")
    .eq("project_id", input.projectId)
    .maybeSingle();
  if (fetchBriefError) throw new Error(fetchBriefError.message);

  let contentBriefId = existingBrief?.id ?? null;
  if (!contentBriefId) {
    const { data: createdBrief, error: createBriefError } = await supabase
      .from("content_briefs")
      .insert({ project_id: input.projectId })
      .select("id")
      .single();
    if (createBriefError) throw new Error(createBriefError.message);
    contentBriefId = createdBrief.id;
  }

  const { data: latestVersion, error: latestVersionError } = await supabase
    .from("brief_versions")
    .select("version")
    .eq("project_id", input.projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestVersionError) throw new Error(latestVersionError.message);

  const nextVersion = (latestVersion?.version ?? 0) + 1;

  const { data: briefVersion, error: insertVersionError } = await supabase
    .from("brief_versions")
    .insert({
      content_brief_id: contentBriefId,
      project_id: input.projectId,
      version: nextVersion,
      research_package_id: input.researchPackageId,
      search_intent_label: input.output.searchIntentLabel,
      search_intent_confidence: input.output.searchIntentConfidence,
      search_intent_rationale: input.output.searchIntentRationale,
      target_audience: input.output.targetAudience,
      content_objective: input.output.contentObjective,
      secondary_topics: input.output.secondaryTopics as Json,
      serp_interpretation: input.output.serpInterpretation,
      common_competitor_expectations: input.output.commonCompetitorExpectations,
      unique_value: input.output.uniqueValue,
      title: input.output.title,
      h1: input.output.h1,
      meta_description: input.output.metaDescription,
      entities_concepts: input.output.entitiesConcepts as Json,
      questions: input.output.questions as Json,
      evidence_requirements: input.output.evidenceRequirements as Json,
      things_to_avoid: input.output.thingsToAvoid as Json,
      business_brand_alignment: input.output.businessBrandAlignment,
      research_limitations: input.output.researchLimitations,
      status: "draft",
      generated_at: new Date().toISOString(),
      generation_run_id: input.generationRunId,
      model_id: input.model,
      prompt_version: input.promptVersion,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (insertVersionError) throw new Error(insertVersionError.message);

  const briefVersionId = briefVersion.id;

  if (input.topics.length > 0) {
    const { error: topicsError } = await supabase
      .from("brief_topics")
      .insert(input.topics.map((t) => ({ brief_version_id: briefVersionId, label: t.label })));
    if (topicsError) throw new Error(topicsError.message);
  }

  if (input.internalLinks.length > 0) {
    const { error: linksError } = await supabase.from("brief_internal_links").insert(
      input.internalLinks.map((l) => ({
        brief_version_id: briefVersionId,
        anchor_text: l.anchorText,
        target_url: l.targetUrl,
      })),
    );
    if (linksError) throw new Error(linksError.message);
  }

  const { error: flipError } = await supabase
    .from("content_briefs")
    .update({ current_version_id: briefVersionId })
    .eq("id", contentBriefId);
  if (flipError) throw new Error(flipError.message);

  return { contentBriefId, briefVersionId, version: nextVersion };
}
