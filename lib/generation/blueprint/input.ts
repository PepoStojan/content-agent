import type { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

/**
 * Builds the complete Blueprint generation input package (Phase 4.4
 * plan §1/§2/§3). Read-only — no writes happen here.
 *
 * Deliberately does NOT re-read `research_sources` (plan §3 — no
 * direct research re-read; Blueprint consumes only the approved
 * Brief's already-synthesized fields) and does NOT accept a
 * `projectId` alone to resolve "the current Brief" dynamically — the
 * caller must supply the exact `brief_versions.id` to build against
 * (plan §0/§2), which becomes `blueprint_versions.brief_version_id`
 * verbatim at persist time (see persist.ts). There is no fallback
 * that resolves this from `content_briefs.current_version_id` inside
 * this module.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface BlueprintProjectContext {
  contentType: Database["public"]["Enums"]["content_type"];
  market: string | null;
  /** Free text, treated as data — same "reference data, not instructions" boundary as Phase 4.3. */
  instructions: string | null;
}

/**
 * The exact approved Brief version Blueprint is built from — every
 * field in `brief_versions`, mapped 1:1 (plan §2's "authoritative
 * fields" list). Exposed as its own type (not the raw DB row) so
 * downstream code reads named, documented fields rather than
 * snake_case columns directly.
 */
export interface BlueprintBriefContext {
  id: string;
  status: Database["public"]["Enums"]["artifact_version_status"];
  searchIntentLabel: string | null;
  searchIntentRationale: string | null;
  targetAudience: string | null;
  contentObjective: string | null;
  secondaryTopics: string[];
  serpInterpretation: string | null;
  commonCompetitorExpectations: string | null;
  uniqueValue: string | null;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  entitiesConcepts: string[];
  questions: string[];
  evidenceRequirements: string[];
  thingsToAvoid: string[];
  businessBrandAlignment: string | null;
  researchLimitations: string | null;
}

export interface BlueprintBriefTopic {
  label: string;
}

export interface BlueprintBriefInternalLink {
  anchorText: string;
  targetUrl: string;
}

export interface BlueprintWebsiteUrl {
  /** Row id — carried through so a selected link can be traced back to its source row (plan §7). */
  id: string;
  url: string;
  title: string | null;
  h1: string | null;
  indexable: boolean | null;
}

export interface BlueprintInternalLinkCandidate {
  id: string;
  url: string;
  anchorTextSuggestion: string | null;
  reason: string | null;
  confidence: number | null;
}

export interface BlueprintBusinessContext {
  company: string;
  market: string | null;
  audience: string | null;
  services: string | null;
  conversionGoal: string | null;
  preferredCta: string | null;
  prohibitedClaims: string | null;
}

export interface BlueprintBrandContext {
  name: string;
  tone: string | null;
  readingLevel: string | null;
  spellingLocale: string | null;
  sentencePreferences: string | null;
  formattingPreferences: string | null;
  preferredTerminology: string | null;
  forbiddenPhrases: string[];
  emDashForbidden: boolean;
}

export interface BlueprintInputPackage {
  projectId: string;
  project: BlueprintProjectContext;
  brief: BlueprintBriefContext;
  briefTopics: BlueprintBriefTopic[];
  briefInternalLinks: BlueprintBriefInternalLink[];
  websiteUrls: BlueprintWebsiteUrl[];
  internalLinkCandidates: BlueprintInternalLinkCandidate[];
  /** Every target_url a proposed internal link may reference, mapped to the source row id for traceability — the exact union of websiteUrls/internalLinkCandidates actually supplied, nothing else (plan §7). */
  availableInternalLinks: Map<string, string>;
  business: BlueprintBusinessContext | null;
  brand: BlueprintBrandContext | null;
}

export async function buildBlueprintInput(
  supabase: SupabaseServerClient,
  projectId: string,
  briefVersionId: string,
): Promise<BlueprintInputPackage> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("content_type, market, instructions, business_profile_id, brand_profile_id, current_website_dataset_id")
    .eq("id", projectId)
    .single();
  if (projectError) throw new Error(projectError.message);

  const { data: brief, error: briefError } = await supabase
    .from("brief_versions")
    .select("*")
    .eq("id", briefVersionId)
    .single();
  if (briefError) throw new Error(briefError.message);
  if (brief.project_id !== projectId) {
    throw new Error("The supplied Brief version does not belong to this project.");
  }
  if (brief.status !== "approved") {
    throw new Error("Blueprint generation requires an approved Brief version.");
  }

  const [briefTopicsResult, briefInternalLinksResult, websiteUrlsResult, internalLinkCandidatesResult, businessResult, brandResult] =
    await Promise.all([
      supabase.from("brief_topics").select("label").eq("brief_version_id", briefVersionId),
      supabase.from("brief_internal_links").select("anchor_text, target_url").eq("brief_version_id", briefVersionId),
      project.current_website_dataset_id
        ? supabase
            .from("website_urls")
            .select("id, url, title, h1, indexable")
            .eq("website_dataset_id", project.current_website_dataset_id)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("internal_link_candidates")
        .select("id, url, anchor_text_suggestion, reason, confidence")
        .eq("project_id", projectId),
      project.business_profile_id
        ? supabase
            .from("business_profiles")
            .select("company, market, audience, services, conversion_goal, preferred_cta, prohibited_claims")
            .eq("id", project.business_profile_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      project.brand_profile_id
        ? supabase
            .from("brand_profiles")
            .select(
              "name, tone, reading_level, spelling_locale, sentence_preferences, formatting_preferences, preferred_terminology, forbidden_phrases, em_dash_forbidden",
            )
            .eq("id", project.brand_profile_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

  if (briefTopicsResult.error) throw new Error(briefTopicsResult.error.message);
  if (briefInternalLinksResult.error) throw new Error(briefInternalLinksResult.error.message);
  if (websiteUrlsResult.error) throw new Error(websiteUrlsResult.error.message);
  if (internalLinkCandidatesResult.error) throw new Error(internalLinkCandidatesResult.error.message);
  if (businessResult.error) throw new Error(businessResult.error.message);
  if (brandResult.error) throw new Error(brandResult.error.message);

  const websiteUrls = websiteUrlsResult.data ?? [];
  const internalLinkCandidates = internalLinkCandidatesResult.data ?? [];
  const business = businessResult.data;
  const brand = brandResult.data;

  const availableInternalLinks = new Map<string, string>();
  for (const u of websiteUrls) availableInternalLinks.set(u.url, u.id);
  for (const c of internalLinkCandidates) availableInternalLinks.set(c.url, c.id);

  return {
    projectId,
    project: {
      contentType: project.content_type,
      market: project.market,
      instructions: project.instructions,
    },
    brief: {
      id: brief.id,
      status: brief.status,
      searchIntentLabel: brief.search_intent_label,
      searchIntentRationale: brief.search_intent_rationale,
      targetAudience: brief.target_audience,
      contentObjective: brief.content_objective,
      secondaryTopics: Array.isArray(brief.secondary_topics)
        ? brief.secondary_topics.filter((v): v is string => typeof v === "string")
        : [],
      serpInterpretation: brief.serp_interpretation,
      commonCompetitorExpectations: brief.common_competitor_expectations,
      uniqueValue: brief.unique_value,
      title: brief.title,
      h1: brief.h1,
      metaDescription: brief.meta_description,
      entitiesConcepts: Array.isArray(brief.entities_concepts)
        ? brief.entities_concepts.filter((v): v is string => typeof v === "string")
        : [],
      questions: Array.isArray(brief.questions) ? brief.questions.filter((v): v is string => typeof v === "string") : [],
      evidenceRequirements: Array.isArray(brief.evidence_requirements)
        ? brief.evidence_requirements.filter((v): v is string => typeof v === "string")
        : [],
      thingsToAvoid: Array.isArray(brief.things_to_avoid)
        ? brief.things_to_avoid.filter((v): v is string => typeof v === "string")
        : [],
      businessBrandAlignment: brief.business_brand_alignment,
      researchLimitations: brief.research_limitations,
    },
    briefTopics: (briefTopicsResult.data ?? []).map((t) => ({ label: t.label })),
    briefInternalLinks: (briefInternalLinksResult.data ?? []).map((l) => ({
      anchorText: l.anchor_text,
      targetUrl: l.target_url,
    })),
    websiteUrls: websiteUrls.map((u) => ({ id: u.id, url: u.url, title: u.title, h1: u.h1, indexable: u.indexable })),
    internalLinkCandidates: internalLinkCandidates.map((c) => ({
      id: c.id,
      url: c.url,
      anchorTextSuggestion: c.anchor_text_suggestion,
      reason: c.reason,
      confidence: c.confidence,
    })),
    availableInternalLinks,
    business: business
      ? {
          company: business.company,
          market: business.market,
          audience: business.audience,
          services: business.services,
          conversionGoal: business.conversion_goal,
          preferredCta: business.preferred_cta,
          prohibitedClaims: business.prohibited_claims,
        }
      : null,
    brand: brand
      ? {
          name: brand.name,
          tone: brand.tone,
          readingLevel: brand.reading_level,
          spellingLocale: brand.spelling_locale,
          sentencePreferences: brand.sentence_preferences,
          formattingPreferences: brand.formatting_preferences,
          preferredTerminology: brand.preferred_terminology,
          forbiddenPhrases: brand.forbidden_phrases,
          emDashForbidden: brand.em_dash_forbidden,
        }
      : null,
  };
}
