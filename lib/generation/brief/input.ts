import type { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";

/**
 * Builds the complete Strategy Brief input package (Phase 4.3 plan
 * §1): everything the AI call and the deterministic derivations need,
 * gathered once, up front. Read-only — no writes happen here.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface StrategyBriefProjectContext {
  id: string;
  name: string;
  contentType: Database["public"]["Enums"]["content_type"];
  primaryTopic: string | null;
  targetQuery: string | null;
  market: string | null;
  /** Free text, treated as data — delimited and never as instructions to the model about its own behavior (Phase 4.3 plan §1). */
  instructions: string | null;
}

export interface StrategyBriefResearchSource {
  id: string;
  type: Database["public"]["Enums"]["research_source_type"];
  payload: Json;
}

export interface StrategyBriefWebsiteUrl {
  url: string;
  title: string | null;
  h1: string | null;
  indexable: boolean | null;
}

export interface StrategyBriefInternalLinkCandidate {
  url: string;
  anchorTextSuggestion: string | null;
  reason: string | null;
  confidence: number | null;
}

export interface StrategyBriefBusinessContext {
  company: string;
  market: string | null;
  audience: string | null;
  services: string | null;
  conversionGoal: string | null;
  preferredCta: string | null;
  prohibitedClaims: string | null;
}

export interface StrategyBriefBrandContext {
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

export interface StrategyBriefInputPackage {
  project: StrategyBriefProjectContext;
  researchPackageId: string | null;
  /** Only guaranteed non-empty for Markdown-sourced packages (Phase 4.3 plan §1) — CSV/DOCX packages insert zero rows today. */
  researchSources: StrategyBriefResearchSource[];
  websiteDatasetId: string | null;
  /** Realistically empty for every project today — Website Knowledge ingestion is simulated. */
  websiteUrls: StrategyBriefWebsiteUrl[];
  /** Always empty today — nothing populates internal_link_candidates yet. */
  internalLinkCandidates: StrategyBriefInternalLinkCandidate[];
  /** Every target_url an AI-recommended internal link is allowed to reference — the exact union of websiteUrls/internalLinkCandidates actually supplied, nothing else (Phase 4.3 plan §0.3/§7). */
  availableInternalLinkUrls: Set<string>;
  business: StrategyBriefBusinessContext | null;
  brand: StrategyBriefBrandContext | null;
}

export async function buildStrategyBriefInput(
  supabase: SupabaseServerClient,
  projectId: string,
): Promise<StrategyBriefInputPackage> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select(
      "id, name, content_type, primary_topic, target_query, market, instructions, business_profile_id, brand_profile_id, current_research_package_id, current_website_dataset_id",
    )
    .eq("id", projectId)
    .single();
  if (projectError) throw new Error(projectError.message);

  const [researchSourcesResult, websiteUrlsResult, internalLinkCandidatesResult, businessResult, brandResult] =
    await Promise.all([
      project.current_research_package_id
        ? supabase
            .from("research_sources")
            .select("id, type, payload")
            .eq("research_package_id", project.current_research_package_id)
        : Promise.resolve({ data: [], error: null }),
      project.current_website_dataset_id
        ? supabase
            .from("website_urls")
            .select("url, title, h1, indexable")
            .eq("website_dataset_id", project.current_website_dataset_id)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("internal_link_candidates")
        .select("url, anchor_text_suggestion, reason, confidence")
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

  if (researchSourcesResult.error) throw new Error(researchSourcesResult.error.message);
  if (websiteUrlsResult.error) throw new Error(websiteUrlsResult.error.message);
  if (internalLinkCandidatesResult.error) throw new Error(internalLinkCandidatesResult.error.message);
  if (businessResult.error) throw new Error(businessResult.error.message);
  if (brandResult.error) throw new Error(brandResult.error.message);

  const researchSources = researchSourcesResult.data ?? [];
  const websiteUrls = websiteUrlsResult.data ?? [];
  const internalLinkCandidates = internalLinkCandidatesResult.data ?? [];
  const business = businessResult.data;
  const brand = brandResult.data;

  const availableInternalLinkUrls = new Set<string>([
    ...websiteUrls.map((u) => u.url),
    ...internalLinkCandidates.map((c) => c.url),
  ]);

  return {
    project: {
      id: project.id,
      name: project.name,
      contentType: project.content_type,
      primaryTopic: project.primary_topic,
      targetQuery: project.target_query,
      market: project.market,
      instructions: project.instructions,
    },
    researchPackageId: project.current_research_package_id,
    researchSources: researchSources.map((s) => ({ id: s.id, type: s.type, payload: s.payload })),
    websiteDatasetId: project.current_website_dataset_id,
    websiteUrls: websiteUrls.map((u) => ({ url: u.url, title: u.title, h1: u.h1, indexable: u.indexable })),
    internalLinkCandidates: internalLinkCandidates.map((c) => ({
      url: c.url,
      anchorTextSuggestion: c.anchor_text_suggestion,
      reason: c.reason,
      confidence: c.confidence,
    })),
    availableInternalLinkUrls,
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
