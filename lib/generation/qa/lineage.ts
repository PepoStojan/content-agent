import type { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

import { orderNodesByDocumentPosition } from "../blueprint/tree-order";

/**
 * Resolves the exact, pinned lineage a QA run evaluates against
 * (docs/architecture/phase-4-6-qa-plan.md §0, QD6). Read-only, no
 * writes.
 *
 * Pinning discipline, matching `lib/generation/content/input.ts`'s
 * established pattern exactly: the Blueprint version is the project's
 * current *approved* one (`content_blueprints.current_version_id` —
 * legitimate here because this is a fresh QA run evaluating the
 * project's current state, not content generation reading a
 * specific historical node). The Brief version is then read from
 * *that* Blueprint version's own `brief_version_id` column — never
 * from `content_briefs.current_version_id` a second, independent way.
 * If the Brief was regenerated after this Blueprint was built, the
 * Blueprint's own pinned Brief (the one it actually reflects) is what
 * QA evaluates against, not whatever Brief happens to be current now
 * (Phase 4.4 BD1's immutable-lineage guarantee, reused unchanged).
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface QaInternalLinkTarget {
  anchorText: string;
  targetUrl: string;
}

export interface QaLeafTarget {
  blueprintNodeId: string;
  title: string;
  level: number;
  position: number;
  entities: string[];
  internalLinkTargets: QaInternalLinkTarget[];
  targetWordCount: number | null;
  /** `null` when no content has been generated for this leaf yet — a real, expected state (Phase 4.6 plan §0). */
  contentVersionId: string | null;
  body: string | null;
  /** True when the current body has no generation provenance (`generation_run_id IS NULL`) — a manual Edit (CD5), not an AI generation. Informs the `factual` LLM check that no self-reported `evidenceUsed` exists for this section (Phase 4.6 plan §2). */
  manuallyEdited: boolean;
}

export interface QaBrandContext {
  forbiddenPhrases: string[];
}

export interface QaBusinessContext {
  prohibitedClaims: string | null;
}

/** Only the Brief fields the `intent` LLM check needs (Phase 4.6 plan — whole-document intent match) — mirrors Content's own deliberately-narrow Brief subset (Phase 4.5 §3), not the whole `brief_versions` row. */
export interface QaBriefContext {
  title: string | null;
  h1: string | null;
  targetAudience: string | null;
  contentObjective: string | null;
  uniqueValue: string | null;
  searchIntentLabel: string | null;
}

/** One node in true document order (root-first DFS, children sorted by `position`) — used for the `intent` call's whole-article assembly (CD6's computed-on-read shape, reused here). Structural/non-leaf nodes carry `isLeaf: false` and no body (their title alone becomes a heading, per CD6). */
export interface QaDocumentNode {
  id: string;
  title: string;
  isLeaf: boolean;
  contentVersionId: string | null;
  body: string | null;
}

export interface QaLineage {
  projectId: string;
  blueprintVersionId: string;
  briefVersionId: string;
  brief: QaBriefContext;
  /** Leaf Blueprint nodes of the pinned Blueprint version, in deterministic document order (level, then position, then id — never DB-return order). */
  leaves: QaLeafTarget[];
  /** The full node tree (leaf + structural) in true document order — see QaDocumentNode. */
  documentNodes: QaDocumentNode[];
  brand: QaBrandContext | null;
  business: QaBusinessContext | null;
}

function asStringArray(value: Json | null): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

interface RawAssignedLink {
  candidateId?: unknown;
  anchorText?: unknown;
}

function asAssignedLinks(value: Json | null): { candidateId: string; anchorText: string }[] {
  if (!Array.isArray(value)) return [];
  const out: { candidateId: string; anchorText: string }[] = [];
  for (const entry of value as RawAssignedLink[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidateId = entry.candidateId;
    const anchorText = entry.anchorText;
    if (typeof candidateId === "string" && typeof anchorText === "string") {
      out.push({ candidateId, anchorText });
    }
  }
  return out;
}

/**
 * @throws if no approved Blueprint (and, transitively, no approved
 * source Brief) exists for the project — QA has nothing well-formed
 * to evaluate without one, the same precondition Content generation
 * itself enforces (Phase 4.5 plan §15).
 */
export async function resolveQaLineage(supabase: SupabaseServerClient, projectId: string): Promise<QaLineage> {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("business_profile_id, brand_profile_id, current_website_dataset_id")
    .eq("id", projectId)
    .single();
  if (projectError) throw new Error(projectError.message);

  const { data: contentBlueprint, error: contentBlueprintError } = await supabase
    .from("content_blueprints")
    .select("current_version_id")
    .eq("project_id", projectId)
    .maybeSingle();
  if (contentBlueprintError) throw new Error(contentBlueprintError.message);
  if (!contentBlueprint?.current_version_id) {
    throw new Error("QA requires an approved Blueprint version; none exists for this project yet.");
  }

  const { data: blueprintVersion, error: blueprintVersionError } = await supabase
    .from("blueprint_versions")
    .select("id, project_id, status, brief_version_id")
    .eq("id", contentBlueprint.current_version_id)
    .single();
  if (blueprintVersionError) throw new Error(blueprintVersionError.message);
  if (blueprintVersion.project_id !== projectId) {
    throw new Error("The project's current Blueprint version does not belong to this project.");
  }
  if (blueprintVersion.status !== "approved") {
    throw new Error("QA requires the project's current Blueprint version to be approved.");
  }

  // Pinned via the Blueprint's own FK, never content_briefs.current_version_id
  // (the exact discipline this task requires — QD-plan §0/§5).
  const { data: briefVersion, error: briefVersionError } = await supabase
    .from("brief_versions")
    .select("id, status, title, h1, target_audience, content_objective, unique_value, search_intent_label")
    .eq("id", blueprintVersion.brief_version_id)
    .single();
  if (briefVersionError) throw new Error(briefVersionError.message);
  if (briefVersion.status !== "approved") {
    throw new Error("QA requires the Blueprint's exact pinned source Brief version to still be approved.");
  }

  const { data: allNodes, error: nodesError } = await supabase
    .from("blueprint_nodes")
    .select("id, parent_id, level, position, title, entities, internal_link_targets, target_word_count")
    .eq("blueprint_version_id", blueprintVersion.id)
    .order("level", { ascending: true })
    .order("position", { ascending: true });
  if (nodesError) throw new Error(nodesError.message);

  const nodes = allNodes ?? [];
  const parentIds = new Set(nodes.map((n) => n.parent_id).filter((id): id is string => id !== null));
  const leafNodes = nodes.filter((n) => !parentIds.has(n.id));

  // Deterministic order regardless of DB return order: level, then
  // position, then id as a final stable tie-break.
  leafNodes.sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    if (a.position !== b.position) return a.position - b.position;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const leafIds = leafNodes.map((n) => n.id);

  const [
    contentDocumentsResult,
    websiteUrlsResult,
    internalLinkCandidatesResult,
    businessResult,
    brandResult,
  ] = await Promise.all([
    leafIds.length > 0
      ? supabase.from("content_documents").select("id, blueprint_node_id, current_version_id").in("blueprint_node_id", leafIds)
      : Promise.resolve({ data: [], error: null }),
    project.current_website_dataset_id
      ? supabase.from("website_urls").select("id, url").eq("website_dataset_id", project.current_website_dataset_id)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("internal_link_candidates").select("id, url").eq("project_id", projectId),
    project.business_profile_id
      ? supabase.from("business_profiles").select("prohibited_claims").eq("id", project.business_profile_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    project.brand_profile_id
      ? supabase.from("brand_profiles").select("forbidden_phrases").eq("id", project.brand_profile_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (contentDocumentsResult.error) throw new Error(contentDocumentsResult.error.message);
  if (websiteUrlsResult.error) throw new Error(websiteUrlsResult.error.message);
  if (internalLinkCandidatesResult.error) throw new Error(internalLinkCandidatesResult.error.message);
  if (businessResult.error) throw new Error(businessResult.error.message);
  if (brandResult.error) throw new Error(brandResult.error.message);

  const urlById = new Map<string, string>();
  for (const u of websiteUrlsResult.data ?? []) urlById.set(u.id, u.url);
  for (const c of internalLinkCandidatesResult.data ?? []) urlById.set(c.id, c.url);

  const currentVersionIdByLeaf = new Map<string, string>();
  for (const doc of contentDocumentsResult.data ?? []) {
    if (doc.current_version_id) currentVersionIdByLeaf.set(doc.blueprint_node_id, doc.current_version_id);
  }

  const currentVersionIds = [...currentVersionIdByLeaf.values()];
  const { data: contentVersions, error: contentVersionsError } =
    currentVersionIds.length > 0
      ? await supabase.from("content_versions").select("id, body, generation_run_id").in("id", currentVersionIds)
      : { data: [], error: null };
  if (contentVersionsError) throw new Error(contentVersionsError.message);

  const bodyByVersionId = new Map<string, string>();
  const manuallyEditedByVersionId = new Map<string, boolean>();
  for (const v of contentVersions ?? []) {
    bodyByVersionId.set(v.id, v.body);
    manuallyEditedByVersionId.set(v.id, v.generation_run_id === null);
  }

  const leaves: QaLeafTarget[] = leafNodes.map((node) => {
    const contentVersionId = currentVersionIdByLeaf.get(node.id) ?? null;
    const assignedLinks = asAssignedLinks(node.internal_link_targets);
    return {
      blueprintNodeId: node.id,
      title: node.title,
      level: node.level,
      position: node.position,
      entities: asStringArray(node.entities),
      internalLinkTargets: assignedLinks
        .map((l) => ({ anchorText: l.anchorText, targetUrl: urlById.get(l.candidateId) ?? "" }))
        .filter((l) => l.targetUrl !== ""),
      targetWordCount: node.target_word_count,
      contentVersionId,
      body: contentVersionId ? (bodyByVersionId.get(contentVersionId) ?? null) : null,
      manuallyEdited: contentVersionId ? (manuallyEditedByVersionId.get(contentVersionId) ?? false) : false,
    };
  });

  // True document order (root-first DFS, siblings by `position`) — the
  // same tree-walk shape CD6 defines for the read-time article
  // assembly (Phase 4.5 plan §18), reused here for the `intent` LLM
  // check's whole-article input. Flat level/position sorting (used
  // above for `leaves`) is sufficient for that per-leaf list, but not
  // for reconstructing real document order across branches — a DFS is
  // required for that. The walk itself now lives in the shared
  // `orderNodesByDocumentPosition()` helper (also reused by the
  // Content Editor sidebar, `app/(app)/projects/[id]/page.tsx`) — one
  // canonical implementation, not two.
  const documentOrderedNodes = orderNodesByDocumentPosition(
    nodes.map((n) => ({ id: n.id, parentId: n.parent_id, position: n.position, title: n.title })),
  );
  const documentNodes: QaDocumentNode[] = documentOrderedNodes.map((node) => {
    const isLeaf = !parentIds.has(node.id);
    const contentVersionId = isLeaf ? (currentVersionIdByLeaf.get(node.id) ?? null) : null;
    return {
      id: node.id,
      title: node.title,
      isLeaf,
      contentVersionId,
      body: contentVersionId ? (bodyByVersionId.get(contentVersionId) ?? null) : null,
    };
  });

  return {
    projectId,
    blueprintVersionId: blueprintVersion.id,
    briefVersionId: briefVersion.id,
    brief: {
      title: briefVersion.title,
      h1: briefVersion.h1,
      targetAudience: briefVersion.target_audience,
      contentObjective: briefVersion.content_objective,
      uniqueValue: briefVersion.unique_value,
      searchIntentLabel: briefVersion.search_intent_label,
    },
    leaves,
    documentNodes,
    brand: brandResult.data ? { forbiddenPhrases: brandResult.data.forbidden_phrases } : null,
    business: businessResult.data ? { prohibitedClaims: businessResult.data.prohibited_claims } : null,
  };
}
