# Phase 4.4 — Content Blueprint Generation: Implementation Plan

Status (2026-08-19): **implemented, migrated, and live-verified with a real Anthropic call.** Originally written as planning-only (below, unchanged as the historical design record); everything it specifies has since been built. See "Implementation status" immediately below for what's actually shipped versus what remains.
Provider: Anthropic, via the existing centralized `lib/ai/client.ts` (`getAnthropicClient()`/`getModelId()`), same pattern as Phase 4.3. Prompt implemented at `lib/ai/prompts/blueprint/v1.ts`.

This document assumes and reuses everything already proven in Phase 4.3 (`lib/generation/brief/*`, `lib/generation/engine.ts`'s three-phase lifecycle, the RLS migration pattern) rather than re-deriving it. Where Blueprint's answer to a question is "same as Brief," that's stated explicitly and not re-argued.

---

## Implementation status (2026-08-19)

**Infrastructure — done, applied, verified live:**
- `blueprint_versions.brief_version_id` (`uuid not null references brief_versions(id)`), migration `20260824000001_phase4_4_blueprint_lineage.sql`, applied to the live database. The accompanying `before update` trigger's immutability was confirmed by directly attempting an `UPDATE` against a real row — correctly rejected with `"blueprint_versions.brief_version_id is immutable and cannot be changed after creation"`.
- RLS policies for `content_blueprints`/`blueprint_versions`/`blueprint_nodes`, migration `20260824000002_phase4_4_blueprint_rls.sql`, applied, reusing `can_access_project`/`current_app_role` only.
- `lib/supabase/types.ts` regenerated from the live schema; `brief_version_id` confirmed present in `Row`/`Insert`/`Update`/`Relationships`.

**Data contract — done, typechecked/linted/built clean:** `lib/generation/blueprint/{input,schema,nodes,entities,word-count,internal-links,persist,generate-blueprint}.ts`, plus `lib/ai/prompts/blueprint/v1.ts`.

**Real generation — done, proven against project `64f3a6aa-3090-457a-ae54-3a1d506a87d2`, Brief version `c7d88c1b-69cf-485a-a54f-8b4dad04c3ec` (latest approved), model `claude-sonnet-4-6`.** Result: 22 `blueprint_nodes`, coherent 3-level hierarchy, 0 fabricated internal links, entity traceability passed (36-entry pool), word-count sanity passed (1815 words in blog_post's 800–3000 range), root H1 correctly overridden to the Brief's exact approved H1, `brief_version_id` lineage exact, full accurate telemetry.

**Three real bugs found and fixed during live testing** (not caught by planning or by typecheck/lint/build — only surfaced by an actual Anthropic call):
1. `max_tokens: 8192` (Brief's value, reused unchanged) truncated Blueprint's larger tree output mid-JSON, failing schema validation with `stop_reason: max_tokens`. Fixed: raised to `16000`.
2. Even under forced tool-use with a schema matching `blueprintOutputSchema` exactly, Claude returned the recursive `root` value as a JSON-*encoded string* rather than a nested object on one attempt — a real interaction between tool-use and `$ref`/`$defs`-based recursive JSON Schemas, not a prompt-wording problem. Fixed: `normalizeBlueprintToolOutput()` in `schema.ts` detects and unstringifies `root` before Zod validation; if parsing fails, the original value passes through unchanged and Zod's own error is what the caller sees.
3. `writingNotes`/`evidenceRequirement` legitimately contain instructions like "do not mention pricing or costs" and were false-flagged by the forbidden-phrase check as if they were brand-facing copy violating the rule they were actually enforcing. Fixed: excluded both fields from `assertBrandCompliance` (kept in the em-dash check) — same fix class as Brief's `thingsToAvoid` exclusion in Phase 4.3.

**Not yet built: the Blueprint Review UI.** No render, no Approve/Request Changes/Regenerate actions, no version history — the Blueprint tab remains hardcoded `locked` in `app/(app)/projects/[id]/page.tsx`, unchanged since Phase 4.3. This is the next action (see `docs/PROJECT-TAKEOVER.md`).

**One wording correction to BD3 below, made now to match what was actually built:** the original locked-decisions table entry said untraceable entities are "stripped." As implemented, `assertEntityTraceability()` throws (a hard-failing generation, matching em-dash/brand-compliance's assert-style enforcement) rather than silently stripping the untraceable entries and persisting the rest — this was always the design intent stated in §13 below ("a violation is a failed generation, not a silent pass-through"), the locked-table summary line was just worded imprecisely. No behavior changed from what was designed; only the summary sentence is corrected here.

---

## Locked decisions (final, this pass)

The four previously-open decisions from §0, §11, and §13 are now resolved and locked. Nothing below is subject to further relitigation absent a demonstrated need.

| # | Decision | Status |
|---|---|---|
| BD1 | **Lineage.** `blueprint_versions.brief_version_id` is added as a required (`not null`) FK to the exact source `brief_versions` row. Lineage is immutable end to end: Research Package → Brief Version → Blueprint Version → Content Versions. A Blueprint must never depend on whatever Brief happens to be current later — only on the exact version it was generated from. | **LOCKED** |
| BD2 | **No AI per-node regeneration.** Blueprint regeneration is always whole-document: `blueprint_changes_requested` → explicit "Regenerate Blueprint" → new `blueprint_versions` row → new `blueprint_nodes` set. Previous Blueprint versions remain immutable. Design V1's per-node "Regenerate section" AI action is rejected outright, not deferred. Manual editing of individual nodes may exist where Design V1 already supports it (see BD2 note below) — that is a distinct, non-AI action and is unaffected by this decision. | **LOCKED** |
| BD3 | **Entity traceability validator.** Approved exactly as proposed in §13: every string in a node's `entities` array must be traceable to the Brief's `entities_concepts`/`questions`/`secondary_topics` pool; a violation is a hard, generation-failing check (as built: `assertEntityTraceability()` throws), matching the em-dash/brand-compliance enforcement discipline. | **LOCKED** |
| BD4 | **Word-count sanity validator.** Approved as a **WARN-level** validation, not a hard generation failure — reversing this document's original §13 recommendation. A generation only fails outright on schema invalidity (the Zod/tool-use shape itself doesn't parse); an out-of-range word-count total persists with a warning, it does not block persistence. | **LOCKED** |

---

## 0. Architecture challenge — the version lineage gap

This is the most important finding in this document, surfaced by reading the actual schema rather than assuming it already does what the pipeline needs.

**`brief_versions` correctly links to its Research Package** (`brief_versions.research_package_id`, confirmed in `20260817000007_brief.sql`) — a Brief version's evidence lineage is already traceable.

**`blueprint_versions` has no equivalent link to the Brief version that produced it.** Reading `20260817000008_blueprint.sql` directly: `blueprint_versions` has `content_blueprint_id`, `project_id`, `generation_run_id`, `model_id`, `prompt_version` — no `brief_version_id` column, no FK to `brief_versions` at all. As shipped, a Blueprint version's only connection to "which Brief it was built from" is *implicit and mutable*: whatever `content_briefs.current_version_id` happened to point at, at the moment generation ran. Once that pointer moves (a later Brief regeneration), a previously-generated Blueprint version has no durable record of which Brief version it actually reflects.

This directly contradicts the requirement stated for this phase: *"Do not allow a Blueprint to become detached from the exact Brief version that produced it."* As shipped, every existing Blueprint version already would be, silently, the moment someone regenerates the Brief.

**Approved — see BD1 in "Locked decisions" above.** Required schema change (not created in this planning pass, flagged for the implementation migration):

```sql
alter table blueprint_versions
  add column brief_version_id uuid not null references brief_versions(id);
```

Populated once, at generation time, from the `brief_versions.id` actually read as input (see §1) — never from `content_briefs.current_version_id` re-read later. This makes the full lineage `research_packages → brief_versions → blueprint_versions → blueprint_nodes → content_documents/content_versions` durably queryable end to end, matching the version-history discipline already used for Brief (Phase 4.3 L3) and for the head+version pattern generally.

**No migration is created by this document** — per the planning constraint. This is the single required schema change implementation must make before Blueprint generation can be built correctly; everything else in this document works with the schema exactly as it stands today.

---

## 1. Exact inputs to Blueprint generation

| Source | Fields used | Notes |
|---|---|---|
| **The specific `brief_versions` row Blueprint is generated from** | Every field in `brief_versions` (§2) | Read once, its `id` captured immediately as `brief_version_id` for §0's lineage column — never re-resolved via `content_briefs.current_version_id` mid-generation. |
| `brief_topics` (children of that exact `brief_version_id`) | `label` | Research finding, unchanged provenance. |
| `brief_internal_links` (children of that exact `brief_version_id`) | `anchor_text`, `target_url` | The Brief's own AI-recommended, already-whitelist-validated internal links — a starting candidate pool, not re-validated against raw Website Knowledge a second time (see §7). |
| `projects` | `content_type`, `market`, `instructions` | Same "data, not directive" treatment as Phase 4.3 — `instructions` is still user-authored free text. `primary_topic`/`target_query` are **not** re-read here; the approved Brief (§2) is what Blueprint builds from, not the raw project fields a second time — see §2. |
| `business_profiles` / `brand_profiles` (via `projects.business_profile_id`/`brand_profile_id`) | Same fields as Phase 4.3 §1 | Same nullable handling, same "don't fabricate if absent" rule. |
| `website_urls` / `internal_link_candidates` (current dataset) | Same fields as Phase 4.3 §1 | Supplied again at Blueprint time (not just inherited from the Brief's already-chosen links) so Blueprint can propose *additional* section-level internal links the Brief didn't surface — see §7. Realistically empty today, same as Phase 4.3. |

**Explicitly not re-read from `research_sources` directly.** Blueprint does not go back to raw research evidence — see §3.

---

## 2. Which approved Brief fields are authoritative

**Precondition, not just an input detail: Blueprint generation is only ever run against an `approved` Brief version.** This is the actual meaning of the "Brief → human approval → Blueprint" gate (already true in `projects.status` terms — `brief_approved` is the trigger state) — Blueprint must never be generated from a `draft` Brief version, even if one exists as `content_briefs.current_version_id`. Enforce this the same way Phase 4.3's L1 request-changes gate is enforced: a server-side check inside the Blueprint generation action, not just a UI affordance (Phase 4.3 precedent: `generateStrategyBrief`'s `project.status !== 'brief_changes_requested'` guard).

Authoritative (Blueprint must structurally reflect these, not silently diverge):
- `search_intent_label` / `search_intent_rationale` — drives what kind of structure (listicle, guide, comparison) actually serves the intent.
- `title` / `h1` — the approved H1 is the blueprint root node's `title` verbatim, not re-derived.
- `target_audience`, `content_objective`, `unique_value` — every node's `goal` must trace back to one of these, not invent a new objective.
- `secondary_topics`, `entities_concepts`, `questions` — the working pool blueprint nodes are built from; every node's `title`/`goal` should map to something in this pool or be a structural node (intro/FAQ/conclusion) that doesn't require topical grounding.
- `evidence_requirements`, `things_to_avoid` — carried down to relevant nodes' `evidence_requirement` field, not just held at the Brief level and ignored at Blueprint time.
- `business_brand_alignment` — informs whether/where a CTA-bearing node exists structurally, without Blueprint inventing new business claims (see §4).

**Not re-litigated by Blueprint:** `research_limitations` is Brief-level context (informs *how confidently* Blueprint can claim research support per node — see §3) but Blueprint does not restate or re-decide it.

---

## 3. Which Research evidence may still be consulted

**None, directly.** This is a deliberate architectural choice, not an oversight: Blueprint consumes the Brief's already-synthesized `serp_interpretation` / `common_competitor_expectations` / `secondary_topics` / `entities_concepts` / `questions`, plus the deterministic `brief_topics` — **not** raw `research_sources` rows a second time.

**Why, explicitly:** if Blueprint re-read raw research independently of the Brief, it could reach conclusions the approved Brief didn't (a structural drift risk — the whole point of an approval gate is that everything downstream is grounded in what was actually approved, not in a fresh reinterpretation of the same evidence). The Brief is the single synthesis checkpoint; Blueprint's job is to structure what the Brief already concluded, not to re-derive strategy from scratch. This is consistent with the Phase 4-design doc's own framing (§2 of `phase-4-design.md`): "Blueprint generation: small context (approved brief + trimmed research) — low risk" is revised here to **no direct research re-read** — the approved Brief's synthesis fields already are the trimmed, relevant distillation Blueprint needs; going back to `research_sources` would be redundant token spend and a re-litigation risk.

`research_support` (a per-node output field, §6) is therefore populated by Blueprint *attributing a node's grounding to Brief-level fields* (e.g., "derived from Brief's `common_competitor_expectations`"), not by independently citing raw competitor pages the model wasn't given.

---

## 4. What Blueprint is allowed to infer vs. what it must not invent

**Allowed to infer (its actual job):**
- Section structure and hierarchy (H1/H2/H3 nesting, ordering) — this is the one thing that doesn't already exist anywhere and is exactly what Blueprint is for.
- Per-node `goal` phrasing — a specific articulation of purpose, provided it's traceable to an authoritative Brief field (§2), not free invention.
- Per-node `writing_notes` — tone/structure guidance for the future Content stage, derived from Brand Voice constraints and the node's own goal.
- `target_word_count` per node — a reasonable allocation, informed by `field_averages`-style competitor format signals *as already summarized in the Brief*, not by Blueprint re-deriving averages itself.
- Which `entities_concepts`/`questions` from the Brief's pool belong under which node.

**Must not invent (mirrors Phase 4.3's no-fabrication rule exactly, extended to structure):**
- New competitor facts, statistics, or claims not present in the Brief's own fields.
- New business/brand claims not present in `business_brand_alignment` or the Business Profile.
- New internal link targets not present in supplied Website Knowledge (§7 — same hard rule as Phase 4.3).
- A `research_support` claim stronger than what the Brief actually says — e.g., if the Brief's `research_limitations` already flags evidence as thin, Blueprint must not assign a confident-sounding `research_support` string to a node built on that weak evidence; it should say so plainly (mirrors the Brief's own `researchLimitations` honesty rule, applied per-node instead of Brief-wide).
- A different search intent, title, or H1 than the approved Brief specifies.

---

## 5. Blueprint output schema and node structure

Two distinct outputs, same provenance split discipline as Phase 4.3 (though Blueprint has no deterministic-derivation half — see below):

**A. Claude-generated (one structured tool-use call, forced tool-use, D6 non-streaming):** an ordered tree of blueprint nodes, each matching `blueprint_nodes` columns 1:1 (§6). The call returns the *entire* tree in one shot — not one call per node (matches the Phase 4-design doc's "Blueprint: single-shot" classification, §2/§10 of `phase-4-design.md`) — because inter-node consistency (no duplicate topics across sections, sensible word-count allocation across the whole outline) requires the model to see the whole structure at once, not build it incrementally.

**B. Deterministic, app-derived: none for Blueprint.** Unlike Brief's `brief_topics` (derived from `research_sources`, no LLM), Blueprint has no equivalent deterministic half — there's no raw evidence table for it to derive structure from without an LLM. This is a real, intentional asymmetry with Phase 4.3, not an oversight: flagged explicitly so nobody goes looking for a "deterministic blueprint nodes" derivation that doesn't exist and shouldn't be invented as busywork.

**Node structure**, matching `blueprint_nodes` exactly (`parent_id`, `level`, `position` for tree shape):
- Root node (`level: 0` or `1`, `parent_id: null`) is the H1 — its `title` is the Brief's approved `h1` verbatim (§2), not regenerated.
- Child nodes nest via `parent_id`, `level` increasing with depth, `position` giving sibling order.
- Leaf nodes are exactly the nodes Content generation will later produce one `content_documents` row per (§8's forward-looking note) — non-leaf/structural nodes (a level-2 heading that's purely organizational, with only child sections carrying real content) are legitimate and already supported by the schema's self-referencing `parent_id`.

---

## 6. Per-section fields — decided meaning for each

| Field | Meaning, decided | Provenance |
|---|---|---|
| `title` | The heading text as it will appear in the published document (H1/H2/H3 depending on `level`). | AI recommendation |
| `goal` | One sentence: what this section accomplishes for the reader, traceable to an authoritative Brief field (§2). | AI recommendation |
| `research_support` | Attribution back to the *Brief's* synthesis (not raw research) that grounds this section — e.g. "Addresses common_competitor_expectations point 3" or "Covers Brief's flagged content gap." Must be honest about weak grounding per §4. | AI recommendation, but structurally an **Evidence** sub-label in the UI (matches Design V1's frozen inspector panel, which already renders this field under a distinct "Evidence" chip, not just plain AI-recommendation styling — see §11). |
| `unique_contribution` | What this section adds beyond generic competitor coverage — mirrors the Brief's own `unique_value` field, applied per-node. | AI recommendation |
| `entities` (jsonb) | The subset of the Brief's `entities_concepts`/`questions` this section is responsible for covering — not new entities invented at Blueprint time. | AI recommendation, but every entity in this array must be traceable to the Brief's own `entities_concepts`/`questions`/`secondary_topics` — validated post-response (§13), same pattern as internal-link whitelisting. |
| `internal_link_targets` (jsonb) | Section-specific internal link proposals — see §7 for the exact shape and validation. | AI recommendation, internal-link-whitelist-validated. |
| `evidence_requirement` | What must be verified/cited before this section can be considered content-complete — mirrors the Brief's `evidence_requirements`, scoped to what's relevant for this specific section. | AI recommendation |
| `writing_notes` | Tone/structure guidance for the future Content stage — derived from Brand Voice (§12 of Phase 4.3 plan's business/brand constraints, reapplied here) plus this node's specific goal. | AI recommendation |
| `target_word_count` | An integer word budget for this section. Sum across all leaf nodes should be a sane total for the Brief's `content_type` (a blog post and a guide have different expected totals) — Blueprint should self-check this internally as part of its own output, not require a separate deterministic validator for a first pass. | AI recommendation |

---

## 7. How internal links are selected and validated

Same hard rule as Phase 4.3, reapplied per-node instead of Brief-wide: **a node's `internal_link_targets` may only reference a `target_url` that appears verbatim in the Website Knowledge supplied at Blueprint generation time** (§1 — `website_urls`/`internal_link_candidates`, re-supplied fresh, not just inherited from the Brief's already-chosen links). Anything else is stripped post-response, never trusted as-is — direct reuse of `lib/generation/brief/internal-links.ts`'s `validateInternalLinks()` pattern, generalized to operate per-node rather than once for the whole document.

**Relationship to the Brief's own `brief_internal_links`:** the Brief's internal link plan is a *document-level* recommendation (this article should link to these pages, generally). Blueprint's job is to decide *which section* each of those links (plus any newly-proposed ones from the same Website Knowledge pool) belongs under. A link present in `brief_internal_links` is not required to appear in Blueprint's output verbatim — Blueprint may reasonably drop one that doesn't fit any section, or split one Brief-level suggestion's anchor text differently per section — but it may not add a URL that isn't in the supplied Website Knowledge pool, matching the exact whitelist already enforced at Brief time.

Recorded shape (matches the `phase-4-design.md` §6.3 recommendation, adopted here without change): `{ candidate_id: uuid, anchor_text: string, reason: string }[]`, where `candidate_id` references the specific `website_urls` or `internal_link_candidates` row the link came from — making a Blueprint's link plan traceable back to its source, not just a bare URL string. (Confidence is optional/omittable since `internal_link_candidates.confidence` is nullable upstream.)

---

## 8. How Blueprint versions relate to Brief versions

**Exactly one Brief version per Blueprint version, permanently, via the new `brief_version_id` column (§0).** Not a range, not "the currently-approved one" resolved dynamically — a fixed, immutable pointer captured at generation time.

**Blueprint versions do not relate to Research Package versions directly.** The chain is `research_packages → brief_versions → blueprint_versions`, not a shortcut `research_packages → blueprint_versions` — Blueprint only ever sees the Brief's synthesis (§3), so its only upstream lineage pointer needs to be the Brief version, from which the Research Package is already reachable by one more join (`brief_versions.research_package_id`) if ever needed for an audit trail.

**Forward lineage (not built in this phase, but the schema already supports it correctly, confirmed by reading `20260817000009_content.sql`):** `content_documents.blueprint_node_id` is a direct FK to a specific `blueprint_nodes` row — which belongs to exactly one `blueprint_versions` row. This means Content, once built, is already correctly pinned to one specific Blueprint version by construction, with zero schema change needed for that half of the lineage. Only the Brief→Blueprint link (§0) was actually missing.

---

## 9. What happens if a Brief is regenerated after a Blueprint exists

**The existing Blueprint version is left completely alone.** It keeps pointing (via the new `brief_version_id`, §0) at the exact Brief version it was generated from — which still exists, unmutated, per Phase 4.3's immutability guarantee (L3). Regenerating the Brief creates Brief version N+1; it does not touch, invalidate, or cascade into any existing Blueprint version.

**What the product does need to surface (a UI/UX decision for Blueprint's own implementation, not this document's job to design in full, but the underlying data fact must be stated now):** a Blueprint version now visibly reflects a Brief version that may no longer be the project's *current* one. This is knowable and honest, not silently wrong, precisely because of §0's fix — without it, this staleness would be undetectable. Recommend (not designed further here): the Blueprint Review tab should be able to show "Built from Brief version N" and flag if `N` is not `content_briefs.current_version_id`'s version, so a human can judge whether the Blueprint needs a fresh regeneration against the newer Brief. This is analogous to, and should reuse the same visual language as, Phase 4.3's own version-history card.

**No automatic Blueprint regeneration is triggered by a Brief regeneration**, consistent with the Phase 4.3 L1 principle (no stage auto-regenerates as a side effect of an upstream change) — a human decides whether staleness matters enough to act on.

---

## 10. Regeneration and versioning rules

Directly mirrors Phase 4.3's locked decisions (L1–L3), restated for Blueprint:

- **Regeneration is allowed after approval** (Phase 4.3 L3's equivalent) — a "Request changes" on an approved Blueprint moves it to `needs_revision` (same `blueprint_changes_requested` project-status-level representation as Brief's L1, since `artifact_version_status` still only has `draft`/`approved` — reuse, don't add a schema-level enum value).
- **Request changes never auto-regenerates** (L1) — the human must act (typically: request a Brief revision or adjust instructions, since Blueprint has no independent "input" of its own beyond the Brief — see §1) before clicking Regenerate.
- **Every regeneration creates a new `blueprint_versions` row** (new `version = max+1`) with a fresh set of `blueprint_nodes` — never edits an existing version's nodes in place. The new version's `brief_version_id` is captured fresh at that regeneration's generation time — if the Brief was also regenerated in between, the new Blueprint version correctly points at the newer Brief version, not the stale one.
- **The prior Blueprint version, its nodes, and anything built on them stay fully intact** — already guaranteed by the schema's own comment in `20260817000008_blueprint.sql" ("content is never inherited across blueprint versions... by construction"), reconfirmed here as the correct behavior, not something this phase needs to change.
- **Server-side gate, not just UI-level** (Phase 4.3 precedent): Blueprint regeneration is only permitted when the project is in a Blueprint-changes-requested state (or no Blueprint exists yet) — mirrors `generateStrategyBrief`'s existing `project.status` check exactly.

---

## 11. Approval and Request Changes behavior

Directly mirrors Phase 4.3's `brief-actions.ts` pattern, applied to Blueprint:

- **Approve**: sets the current `blueprint_versions.status = 'approved'`, `approved_by`, `approved_at` — only that one version row, never touching prior versions (same immutability guarantee). Advances `projects.status` to `blueprint_approved`. This is the trigger that (in a later phase, not built here) unlocks Content generation — see §17.
- **Request changes**: sets `projects.status` to `blueprint_changes_requested` (reusing the existing `project_status` enum value — already defined in `20260817000001_extensions_and_enums.sql`, unused until now, no schema change needed). Never mutates the Blueprint version itself. Never auto-regenerates.
- **Per-node AI regeneration — resolved, see BD2.** Design V1's frozen Blueprint tab (`docs/design/SEO Content Maker.dc.html`, `tabBlueprint` block) shows a "Regenerate section" button per node; this AI action is rejected outright, not built. Blueprint regeneration is always whole-document (§10): `blueprint_changes_requested` → explicit "Regenerate Blueprint" → new `blueprint_versions` row → new `blueprint_nodes` set, mirroring Brief's pattern exactly, because a node's structure is only coherent in relation to its siblings (word-count budget, topic coverage across the whole outline) — partial AI regeneration would risk exactly the incoherent-whole problem whole-document regeneration exists to avoid.
- **Manual node editing is a separate, distinct concern and is unaffected by BD2.** Where Design V1 already supports directly editing an individual node's fields by hand (no model call involved — the user typing a different `title`/`goal`/etc. directly into the inspector panel), that remains available if/when implementation wires it up; BD2 only rejects an *AI-driven* per-node "Regenerate" action, not human editing of a node's own fields. Whether/how manual node edits are versioned (e.g., as an in-place update to the current draft version, vs. requiring their own version bump) is an implementation-time UI decision, not resolved further by this document.

---

## 12. Generation Engine integration

Identical shape to Phase 4.3 §6, substituting Blueprint's tables:

1. New server action `generateBlueprint(projectId)`, structurally parallel to `generateStrategyBrief`.
2. Role-gated (`team_lead`/`seo_manager` only, via the existing `assertCanRunGenerations()`/`canManageProfiles()` pattern).
3. Precondition check (§2): current Brief version must be `approved`. Then the existing `startGeneration({ projectId, type: 'blueprint_generate' })` — `blueprint_generate` already exists in the `generation_run_type` enum (`20260817000001_extensions_and_enums.sql`), no schema change needed there.
4. Gather inputs (§1), build prompt (not designed here — implementation task), call Claude.
5. Write raw response to Storage → `output_ref` (same `project-files` bucket, `{projectId}/generation/{generationRunId}.json` path convention, unchanged).
6. `recordProviderCompleted(...)`.
7. Parse/validate response (§13). No deterministic derivation step (§5B — none exists for Blueprint, unlike Brief's `brief_topics`).
8. Persist artifact (§5, §8): `content_blueprints` head row (fetch-or-create) → `blueprint_versions` insert (**with `brief_version_id` populated**, §0) → `blueprint_nodes` insert (all nodes, preserving `parent_id`/`level`/`position` tree shape) → `content_blueprints.current_version_id` flip, done last — identical head+version+children+flip-last sequence as `lib/generation/brief/persist.ts`.
9. `recordArtifactPersisted(...)` then `completeGeneration(...)`.
10. Advance `projects.status` to `blueprint_generated` on success (mirrors Phase 4.3's `generateStrategyBrief` explicit status-advance, added after the original Phase 4.3 build to fix the "stuck in changes-requested" bug — apply that same fix from day one here, not as a follow-up patch).
11. On any failure: `failGeneration(...)`, same shape as Phase 4.3.

**No engine.ts changes required.** The three-phase lifecycle (`recordProviderCompleted → recordArtifactPersisted → completeGeneration`) is already generic across generation types — Phase 4.3's L2 split was built exactly so a second real stage could reuse it without modification. This document does not propose touching `lib/generation/engine.ts`.

---

## 13. Validation

- **Schema validation via Zod**, same pattern as `lib/generation/brief/schema.ts` — a `blueprintOutputSchema` covering the node tree shape, forced tool-use.
- **Em-dash check**, reusing `lib/generation/brief/em-dash.ts`'s `assertNoEmDash()` unmodified — applied to every node's `title`/`goal`/`research_support`/`unique_contribution`/`writing_notes` text fields.
- **Brand compliance check**, reusing `lib/generation/brief/brand-compliance.ts`'s `assertBrandCompliance()` unmodified — same `forbiddenPhrases`/`prohibitedClaims` treatment, same exclusion logic for any field whose job is to *name* something to avoid (if Blueprint ever has such a field; today it doesn't, so this exclusion carve-out is moot but the function itself is directly reusable).
- **Internal-link whitelist**, generalizing `lib/generation/brief/internal-links.ts`'s `validateInternalLinks()` to run per-node (§7) rather than once — small, mechanical extension, not new logic.
- **Entity/topic traceability validator — approved, see BD3** (§4/§6): every string in a node's `entities` array must exist in the Brief's `entities_concepts`/`questions`/`secondary_topics` pool; anything that doesn't is stripped (mirrors the internal-link whitelist pattern exactly, applied to a different field). This is genuinely new code (Phase 4.3 has no equivalent), not a reuse. A hard, generation-failing check, same discipline as em-dash/brand-compliance — traceability is a fabrication guard, not a soft quality signal.
- **Word-count sanity validator — approved as WARN-level, see BD4** (reverses this document's original recommendation): sum of `target_word_count` across leaf nodes is checked against a sane range for the Brief's `content_type` (exact bounds are an implementation-time product decision, not specified here), but an out-of-range total does **not** fail the generation — it persists with a warning recorded (e.g., in `generation_runs.metadata` or surfaced in the Blueprint Review UI, implementation's choice) for a human to judge. Only a genuinely invalid response shape (the Zod/tool-use parse itself failing) fails the generation outright. This is a deliberate asymmetry with the entity-traceability and internal-link validators: those guard against fabrication (a hard correctness/trust boundary), word-count sanity guards against a plausible-but-suboptimal outline (a quality signal, not a trust violation) — treating it as WARN-level respects that distinction rather than blocking a usable Blueprint over a word-count total a human might find perfectly acceptable.

---

## 14. What happens if evidence is insufficient

Mirrors Phase 4.3's `researchLimitations` handling, one level removed: Blueprint has no `researchLimitations` field of its own (§3 — it doesn't re-touch raw evidence), but it must **honestly propagate weak grounding** from the Brief. If the Brief's `research_limitations` already flags thin evidence, nodes whose `research_support` would otherwise claim strong grounding must instead say so honestly (§4's rule) — there is no separate "insufficient evidence" escape hatch field at the Blueprint level; honesty is enforced per-node, in the `research_support` string itself, not in a dedicated column. Adding a Blueprint-level `blueprint_versions.research_limitations` column purely to mirror Brief's shape is explicitly **not recommended** — it would duplicate information the Brief already owns and risk the two disagreeing over time; Blueprint should reference, not restate.

---

## 15. Token/context strategy

Confirmed low-risk, matching `phase-4-design.md` §10's original assessment: input is one Brief version's already-synthesized fields (not raw research, per §3) plus optionally-empty Website Knowledge — small, bounded, no context-budget trimming system needed for a first implementation, same conclusion as Phase 4.3 reached for Brief generation and for the same reason (today's real payload is thin). Revisit only if Website Knowledge ingestion becomes real (currently simulated) and grows the input meaningfully — not a concern to design around speculatively now.

Output size is the one thing to watch: a full node tree for a long guide (many leaf sections) could be a large single structured response. No streaming (D6, unchanged) — `max_tokens` for this call should be set generously (implementation detail) since truncating a tree mid-generation would produce an unparseable/incomplete structure, unlike Brief's flatter, smaller output shape.

---

## 16. Provenance rules

No new provenance category — reuses the existing four-value model (Research finding / AI recommendation / User decision / System validation) exactly, per the explicit instruction not to invent a new one. Applied to Blueprint's fields:

- **AI recommendation**: every Blueprint node field (`title`, `goal`, `research_support`, `unique_contribution`, `entities`, `internal_link_targets`, `evidence_requirement`, `writing_notes`, `target_word_count`) — all editable, none deterministic (§5's asymmetry with Brief means Blueprint has no "Research finding"-labeled field of its own at all).
- **Research finding**: not directly present in Blueprint's own output — the closest analog, `research_support`, is still AI-synthesized text (an *attribution* to Brief-level research findings, not itself a raw finding), so it stays labeled AI recommendation, matching Design V1's frozen prototype (§11 — the inspector panel already renders `research_support` under a distinct "Evidence" sub-badge, visually distinguishing it from plain AI-recommendation text without reclassifying its actual provenance category).
- **User decision**: not directly present at the node level; Business/Brand profile influence on `writing_notes` is indirect (mediated through the AI's synthesis, same as Brief's `businessBrandAlignment`), so individual nodes don't carry a separate "User decision" badge — matches how Brief's own per-field badges work today (no field on `brief_versions` itself is badged "User decision"; only the Brief's overall `business_brand_alignment` field is, at the whole-Brief level). Blueprint should follow the same pattern rather than inventing a new per-node breakdown.
- **System validation**: the word-count-sanity and entity-traceability checks (§13) are System validation in nature (deterministic, code-computed), but per the locked rule they are pass/fail *generation validators*, not a rendered UI badge on a passing node — same as how Brief's em-dash/brand-compliance checks aren't shown as a per-field badge, only surfaced as a failed-generation error if violated.

---

## 17. What must remain locked until Blueprint approval

**Content Editor, QA, and Export tabs remain locked** until `projects.status` reaches `blueprint_approved` — this is the second of the two protected mandatory approval gates (`docs/design/README.md`, "Approval & Provenance Rules" #1). No change to this rule; Phase 4.4 is what *reaches* `blueprint_approved` for the first time, but does not itself unlock Content generation — that's Phase 4.5's job (Content generation doesn't exist yet, matching this project's own precedent of not unlocking a tab before its generation stage is real, confirmed by the current `LockedTab` hardcoding for Blueprint/Content Editor/QA/Export in `app/(app)/projects/[id]/page.tsx`).

Concretely, for this phase's own build: the Blueprint tab itself becomes real and unlockable (moving from Phase 4.3's hardcoded `locked` to a real state-driven lock, gated on `brief_approved`), but Content Editor/QA/Export stay hardcoded locked exactly as they are today — Phase 4.4 does not touch their lock state, only Blueprint's.

---

## 18. Explicitly out of scope

- Content generation itself (Phase 4.5+) — this document only reaches the point where Content generation *could* begin, per §17.
- Per-node AI Blueprint regeneration (§11, BD2) — locked as rejected, not built. Manual (non-AI) node editing remains a separate, unresolved implementation-time question (§11).
- A `blueprint_versions.research_limitations` column (§14) — deliberately rejected, not deferred-as-a-maybe.
- Context-budget trimming infrastructure (§15) — not needed yet, same reasoning as Phase 4.3.
- Multi-provider abstraction, DB-stored/editable prompts, agentic tool-use loops, streaming, cost dashboards (D3–D6, reaffirmed, unchanged from Phase 4.2/4.3).
- Real Website Knowledge ingestion (sitemap/Screaming Frog parsing) — Blueprint's internal-link behavior is correct *given* that this stays simulated (empty pool → empty `internal_link_targets`, same honest-empty-state pattern as Brief), but building real ingestion is unrelated to this phase.
- Any UI beyond what's needed to render/approve/request-changes a Blueprint — no new design system components beyond what Phase 4.3 already built (`ProvenanceBadge`, `Card`, `StatusBadge`, `StickyApprovalFooter`, `LockedTab` all reused unchanged).

---

This document was originally written planning-only (no code, migrations, or API calls made producing it). That plan has since been fully implemented — see "Implementation status" near the top for what's actually shipped, migrated, and live-verified as of 2026-08-19. The one required schema change (§0, `blueprint_versions.brief_version_id`) has been applied via `20260824000001_phase4_4_blueprint_lineage.sql`, not merely flagged.
