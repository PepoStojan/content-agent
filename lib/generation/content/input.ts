import type { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";

import { filterRelevantEvidence, type ContentEvidenceItem, type ResearchSourceRow } from "./evidence";

/**
 * Builds the complete Content-generation input package for exactly
 * one leaf Blueprint node (Phase 4.5 plan §1). Read-only — no writes
 * happen here.
 *
 * Proves lineage end to end, exactly as locked: Research Package ->
 * Brief version -> Blueprint version -> Blueprint node -> Content.
 * Every link is read from the row that actually owns it
 * (`blueprint_nodes.blueprint_version_id`,
 * `blueprint_versions.brief_version_id`), never re-resolved via a
 * "current" pointer (`content_blueprints.current_version_id`,
 * `content_briefs.current_version_id`) — the same discipline
 * `lib/generation/blueprint/input.ts` already established one layer
 * up. The caller supplies only `blueprintNodeId`; every other lineage
 * id is derived from it, deterministically, never guessed.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface ContentProjectContext {
  contentType: Database["public"]["Enums"]["content_type"];
  market: string | null;
  /** Free text, treated as data — same "reference data, not instructions" boundary as Brief/Blueprint. */
  instructions: string | null;
}

/** Only the Brief fields that still matter at Content time — plan §3's deliberately narrow subset, not the whole `brief_versions` row. */
export interface ContentBriefContext {
  id: string;
  title: string | null;
  h1: string | null;
  targetAudience: string | null;
  contentObjective: string | null;
  uniqueValue: string | null;
  businessBrandAlignment: string | null;
  thingsToAvoid: string[];
}

export interface ContentAssignedInternalLink {
  candidateId: string;
  anchorText: string;
  reason: string;
}

/** The target leaf node's own authoritative fields (plan §2) — every one of `blueprint_nodes`' content columns, nothing invented. */
export interface ContentBlueprintNode {
  id: string;
  title: string;
  goal: string | null;
  researchSupport: string | null;
  uniqueContribution: string | null;
  entities: string[];
  internalLinkTargets: ContentAssignedInternalLink[];
  evidenceRequirement: string | null;
  writingNotes: string | null;
  targetWordCount: number | null;
}

/** Every sibling leaf/structural node's title+goal only (plan §1/§6) — the repetition-prevention document map, never full bodies. */
export interface ContentDocumentMapEntry {
  id: string;
  title: string;
  goal: string | null;
}

/** This node's assigned links, resolved to a real URL from the currently-supplied Website Knowledge (plan §8) — never re-selected, never expanded beyond what Blueprint already assigned. */
export interface ContentInternalLinkTarget extends ContentAssignedInternalLink {
  targetUrl: string;
}

export interface ContentBusinessContext {
  company: string;
  market: string | null;
  audience: string | null;
  services: string | null;
  conversionGoal: string | null;
  preferredCta: string | null;
  prohibitedClaims: string | null;
}

export interface ContentBrandContext {
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

/** The full, explicit lineage chain this input package proves — never partially resolved, never defaulted to "current." */
export interface ContentLineage {
  researchPackageId: string | null;
  briefVersionId: string;
  blueprintVersionId: string;
  blueprintNodeId: string;
}

export interface ContentInputPackage {
  projectId: string;
  project: ContentProjectContext;
  lineage: ContentLineage;
  brief: ContentBriefContext;
  node: ContentBlueprintNode;
  documentMap: ContentDocumentMapEntry[];
  internalLinkTargets: ContentInternalLinkTarget[];
  evidencePacket: ContentEvidenceItem[];
  business: ContentBusinessContext | null;
  brand: ContentBrandContext | null;
}

function asStringArray(value: Json | null): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asAssignedLinks(value: Json | null): ContentAssignedInternalLink[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (l) => typeof l === "object" && l !== null && "candidateId" in l && "anchorText" in l && "reason" in l,
  ) as unknown as ContentAssignedInternalLink[];
}

/**
 * @param blueprintNodeId Must be a leaf node (no children) of an
 * approved Blueprint version, whose exact source Brief version must
 * also still be approved. Never resolves "the current Blueprint" or
 * "the current Brief" — every lineage id below is read from the node
 * itself, outward.
 */
export async function buildContentInput(
  supabase: SupabaseServerClient,
  projectId: string,
  blueprintNodeId: string,
): Promise<ContentInputPackage> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select(
      "content_type, market, instructions, business_profile_id, brand_profile_id, current_website_dataset_id, current_research_package_id",
    )
    .eq("id", projectId)
    .single();
  if (projectError) throw new Error(projectError.message);

  const { data: node, error: nodeError } = await supabase
    .from("blueprint_nodes")
    .select("*")
    .eq("id", blueprintNodeId)
    .single();
  if (nodeError) throw new Error(nodeError.message);

  // Leaf check (plan §1/§14, CD1) — structural/non-leaf nodes never get content.
  const { count: childCount, error: childError } = await supabase
    .from("blueprint_nodes")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", blueprintNodeId);
  if (childError) throw new Error(childError.message);
  if ((childCount ?? 0) > 0) {
    throw new Error("Content generation requires a leaf Blueprint node; this node has children.");
  }

  const { data: blueprintVersion, error: blueprintVersionError } = await supabase
    .from("blueprint_versions")
    .select("id, project_id, status, brief_version_id")
    .eq("id", node.blueprint_version_id)
    .single();
  if (blueprintVersionError) throw new Error(blueprintVersionError.message);
  if (blueprintVersion.project_id !== projectId) {
    throw new Error("The supplied Blueprint node does not belong to this project.");
  }
  if (blueprintVersion.status !== "approved") {
    throw new Error("Content generation requires an approved Blueprint version.");
  }

  // Read from the exact brief_version_id the Blueprint was generated
  // against (Phase 4.4 BD1) — never content_briefs.current_version_id.
  const { data: brief, error: briefError } = await supabase
    .from("brief_versions")
    .select("*")
    .eq("id", blueprintVersion.brief_version_id)
    .single();
  if (briefError) throw new Error(briefError.message);
  if (brief.status !== "approved") {
    throw new Error("Content generation requires the Blueprint's exact source Brief version to still be approved.");
  }

  const [
    siblingNodesResult,
    websiteUrlsResult,
    internalLinkCandidatesResult,
    researchSourcesResult,
    businessResult,
    brandResult,
  ] = await Promise.all([
    supabase
      .from("blueprint_nodes")
      .select("id, title, goal")
      .eq("blueprint_version_id", node.blueprint_version_id)
      .order("level", { ascending: true })
      .order("position", { ascending: true }),
    project.current_website_dataset_id
      ? supabase.from("website_urls").select("id, url").eq("website_dataset_id", project.current_website_dataset_id)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("internal_link_candidates").select("id, url").eq("project_id", projectId),
    project.current_research_package_id
      ? supabase
          .from("research_sources")
          .select("id, type, payload")
          .eq("research_package_id", project.current_research_package_id)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
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

  if (siblingNodesResult.error) throw new Error(siblingNodesResult.error.message);
  if (websiteUrlsResult.error) throw new Error(websiteUrlsResult.error.message);
  if (internalLinkCandidatesResult.error) throw new Error(internalLinkCandidatesResult.error.message);
  if (researchSourcesResult.error) throw new Error(researchSourcesResult.error.message);
  if (businessResult.error) throw new Error(businessResult.error.message);
  if (brandResult.error) throw new Error(brandResult.error.message);

  const websiteUrls = websiteUrlsResult.data ?? [];
  const internalLinkCandidates = internalLinkCandidatesResult.data ?? [];
  const researchSources = (researchSourcesResult.data ?? []) as ResearchSourceRow[];
  const business = businessResult.data;
  const brand = brandResult.data;

  const urlById = new Map<string, string>();
  for (const u of websiteUrls) urlById.set(u.id, u.url);
  for (const c of internalLinkCandidates) urlById.set(c.id, c.url);

  const nodeEntities = asStringArray(node.entities);
  const assignedLinks = asAssignedLinks(node.internal_link_targets);

  // Only links whose candidate is still present in the currently
  // supplied Website Knowledge are resolved for the writer — a stale
  // reference (dataset changed since Blueprint time) is dropped, never
  // guessed at (same whitelist discipline as links.ts).
  const internalLinkTargets: ContentInternalLinkTarget[] = assignedLinks
    .map((l) => ({ ...l, targetUrl: urlById.get(l.candidateId) ?? "" }))
    .filter((l) => l.targetUrl !== "");

  const evidencePacket = filterRelevantEvidence(
    { entities: nodeEntities, evidenceRequirement: node.evidence_requirement, title: node.title },
    researchSources,
  );

  return {
    projectId,
    project: {
      contentType: project.content_type,
      market: project.market,
      instructions: project.instructions,
    },
    lineage: {
      researchPackageId: project.current_research_package_id,
      briefVersionId: brief.id,
      blueprintVersionId: blueprintVersion.id,
      blueprintNodeId: node.id,
    },
    brief: {
      id: brief.id,
      title: brief.title,
      h1: brief.h1,
      targetAudience: brief.target_audience,
      contentObjective: brief.content_objective,
      uniqueValue: brief.unique_value,
      businessBrandAlignment: brief.business_brand_alignment,
      thingsToAvoid: asStringArray(brief.things_to_avoid),
    },
    node: {
      id: node.id,
      title: node.title,
      goal: node.goal,
      researchSupport: node.research_support,
      uniqueContribution: node.unique_contribution,
      entities: nodeEntities,
      internalLinkTargets: assignedLinks,
      evidenceRequirement: node.evidence_requirement,
      writingNotes: node.writing_notes,
      targetWordCount: node.target_word_count,
    },
    documentMap: (siblingNodesResult.data ?? []).map((n) => ({ id: n.id, title: n.title, goal: n.goal })),
    internalLinkTargets,
    evidencePacket,
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
