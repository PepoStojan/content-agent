# Phase 4.5 — Content Generation: Implementation Plan

Status: **COMPLETE and live-verified end to end (2026-08-20).** Architecture locked 2026-08-19 (CD1–CD10, all still binding, none relitigated during implementation); backend and Content Editor UI both built, and both proven against real data: the section-level Generation Engine support (CD3) is live in the schema, the evidence relevance filter was tuned and re-verified against a real Research Package, one real Anthropic call (`claude-sonnet-4-6`) was made and fully persisted (real `content_documents`/`content_versions` rows, correct lineage, correct telemetry), and a real manual Edit (including the Markdown toolbar) was verified to insert a new immutable version, create no `generation_runs` row, and persist correctly across a page refresh. See `docs/PROJECT-TAKEOVER.md`'s NEXT ACTION section for the full closeout summary. Appendix A (added 2026-08-20) documents a future Image Suggestion Layer — architecture only, not implemented. Provider: Anthropic, via the existing centralized `lib/ai/client.ts`, same pattern as Brief/Blueprint. This document assumes and reuses everything already proven in Phase 4.2/4.3/4.4 (`lib/generation/engine.ts`'s three-phase lifecycle, the RLS migration pattern, the whitelist/traceability validation pattern, the head+version+flip persistence pattern) rather than re-deriving it. Where Content's answer to a question is "same as Brief/Blueprint," that's stated explicitly and not re-argued.

Grounded directly in the schema as it exists today (read from the actual migration files, not assumed): `content_documents`/`content_versions` (`20260817000009_content.sql`, unused since Phase 0), `qa_reports`/`qa_report_content_versions`/`qa_findings` (`20260817000010_qa.sql`, unused), `blueprint_nodes`/`blueprint_versions` (built and live, Phase 4.4), `generation_runs` (built and live, Phase 4.2, **no `blueprint_node_id` column** — flagged in §0), and the completed Brief/Blueprint pipelines (`lib/generation/brief/*`, `lib/generation/blueprint/*`).

---

## Locked decisions (final, this pass)

Mirrors the Decision Log format of the three prior phase docs. All decisions below are **LOCKED** (approved 2026-08-19) — implementation must follow them as written; changing one requires an explicit new decision, not a quiet drift during implementation. Each references the section that argues it.

| # | Decision | Status | Section |
|---|---|---|---|
| CD1 | **Content generation is per-section (per-`blueprint_node`), not per-document.** One `content_documents` row per **leaf** Blueprint node; structural/non-leaf nodes never get a `content_documents` row. Already implied by the existing schema (`content_documents.blueprint_node_id unique`) — this decision makes it explicit and binding. | **LOCKED** | §1, §10 |
| CD2 | **Evidence packet: deterministic, capped, per-section relevance-filtered `research_sources` subset — never the full Research Package sent to every section.** Content generation is the first stage allowed to read raw `research_sources` again at all, via this narrow filter — a deliberate, bounded exception to Blueprint's "don't re-touch raw research" rule (reasoning in §0), not a reopening of it. | **LOCKED** | §0, §4 |
| CD3 | **`generation_runs.blueprint_node_id` (new, nullable, FK to `blueprint_nodes`) is approved.** The database uniqueness guard for active generations must distinguish by **project + generation type + blueprint node**, re-scoping the existing D2 partial-unique-index mechanism from `(project_id, type)` to `(project_id, type, blueprint_node_id)` for `content_generate` rows — this is the section-level generation identity. No migration created by this document — flagged as the required implementation-time schema change, same treatment as Blueprint's `brief_version_id` (Phase 4.4 §0). | **LOCKED** | §17 |
| CD4 | **Section-level "Request Changes" is rejected as a separate UI concept.** Content uses **Edit** (direct, non-AI) or **Regenerate with user instructions** (AI, whole-section). A regeneration instruction is free-text supplied by the user at Regenerate time and stored with the generation/run metadata (`generation_runs.metadata`, no new column) — not a distinct state gating a later action, the instruction *is* the regenerate call's input. | **LOCKED** | §12 |
| CD5 | **Manual Edit and AI Regenerate both insert a new `content_versions` row; neither ever mutates an existing row.** Already stated as the intended design in the migration file's own header comment — this decision confirms it's binding, not just a comment. | **LOCKED** | §11, §13 |
| CD6 | **The assembled article is computed on read, not persisted as its own table/blob.** Concatenating all leaf `content_documents.current_version` bodies in document order (via the approved Blueprint's tree) is a deterministic, cheap, pure function — a new "compiled document" table would be a second source of truth for something trivially derivable. Revisit only if Export (Phase 4.7) demonstrates a real need for a persisted snapshot. | **LOCKED** | §18 |
| CD7 | **Content generation performs its own generation-time guards (em-dash, brand compliance, internal-link whitelist) but does not run the 9-category QA report.** The `qa_reports`/`qa_findings` schema exists and is reused unchanged in Phase 4.6, not this one. Content's own guards are a *subset* of what QA will later check, run as hard-fail generation validators — same discipline as Blueprint's BD3/BD4, not a duplicate implementation of QA. | **LOCKED** | §19 |
| CD8 | **`evidenceUsed` (the model's required per-section provenance output) must contain source IDs/references only, never duplicated evidence text.** Shape: `research_source:<id>` (or equivalent stable reference into the supplied evidence packet's item identifiers). Provenance without prompt-size cost — the field exists so a human reviewer (or a later automated check) can tell *which supplied item* backs a claim, not to re-embed the evidence itself a second time. | **LOCKED** | §7 |
| CD9 | **Grounding rule (hard):** Content must never invent a specific claim, statistic, price, competitor fact, business fact, or other factual assertion the supplied evidence packet does not support. When evidence is insufficient for what a section's `evidence_requirement` calls for: **omit the unsupported claim, or make only a safe, non-specific statement** — never fill the gap with plausible-sounding invented detail, regardless of how confidently a general-knowledge-trained model might otherwise phrase it. Enforced via system-prompt instruction + the `evidenceUsed` signal (CD8); no deterministic fact-checker is claimed or required (§7 explains why one isn't feasible here). | **LOCKED** | §0, §7, §20 |
| CD10 | **Out of scope, explicitly reconfirmed:** QA implementation, Export implementation, multi-provider abstraction, agent frameworks, streaming, and **whole-article generation in a single AI call** (generation stays strictly per-section/per-leaf-node — CD1 — never a single call producing the entire document). | **LOCKED** | §21 |

---

## 0. The central architecture challenge: where do the facts come from?

This is the most important finding in this document, and it directly contradicts the pattern Blueprint just established — worth confronting head-on rather than silently reversing it.

**Phase 4.4's Blueprint plan (§3) locked a "no direct research re-read" rule**, reasoning that re-deriving strategy from raw evidence independently of the approved Brief risks structural drift — the Brief is the one synthesis checkpoint, and every downstream stage should build on what was actually approved, not reinterpret the same evidence fresh.

That reasoning is correct **for structure** (search intent, section ordering, word-count allocation — things that must not silently diverge from the approved Brief). It does **not hold for prose content.** A Blueprint node's `research_support` field is, by Phase 4.4's own design (§3, §16), an *attribution string* — "Addresses common_competitor_expectations point 3" — not the actual competitive fact, statistic, or specific claim itself. Neither `brief_versions` nor `blueprint_nodes` stores verbatim research findings; `brief_topics` stores only topic *labels* (a `label` column, nothing more). If Content generation is handed only Blueprint node fields and Brief fields, it has been given a *shape* to write into (a goal, a word budget, a tone) but **no actual evidence to write with** — every specific, checkable detail in the resulting prose (a competitor's exact approach, a concrete number, a named PAA question) would have to be invented, because nothing upstream carried the real content of the research forward.

This is a correctness risk, not a style preference: the whole point of an SEO content pipeline built on a Research Package is that the output is grounded in real competitive/SERP evidence. A pipeline that structures beautifully but writes generically-or-fabricated prose has silently failed at its actual job.

**Resolution (CD2):** Content generation is the one stage explicitly permitted to read `research_sources` again — but narrowly, deterministically, and per-section, not as a repeat of Blueprint's Brief-level synthesis. See §4 for the exact mechanism. This is not "relitigating" Blueprint's structural decision; it's recognizing that "don't re-derive strategy" and "don't supply real evidence to the writer" are different rules that happened to look identical at the Blueprint layer only because Blueprint never needed raw evidence content in the first place (it only needed to know *that* evidence existed, to allocate space and write an honest `research_support` attribution).

---

## 1. Exact input package for one content section

One content-generation call = one `blueprint_node_id` (a **leaf** node, CD1) + one already-approved Blueprint version. The input package, assembled fresh per section (never cached/reused across sections):

| Source | Fields | Why |
|---|---|---|
| **The target `blueprint_nodes` row** | `title`, `goal`, `research_support`, `unique_contribution`, `entities`, `internal_link_targets`, `evidence_requirement`, `writing_notes`, `target_word_count` | Authoritative structural directive for this section — see §2. |
| **Document map (sibling `blueprint_nodes`, same `blueprint_version_id`)** | `title` + `goal` only, for every *other* node in the tree, in document order | Lets the writer avoid restating what another section already covers, without paying for their full bodies (§6). |
| **The approved Brief version** (`brief_versions`, via `blueprint_versions.brief_version_id`) | `title`, `h1`, `target_audience`, `content_objective`, `unique_value`, `business_brand_alignment`, `things_to_avoid` | Whole-document continuity context — see §3 for exactly why this subset and not more. |
| **Relevance-filtered `research_sources`** | A capped, per-section subset — see §4 | The actual evidence the section's claims must be grounded in (§0, §7). |
| **`business_profiles`** (via `projects.business_profile_id`) | `company`, `audience`, `services`, `conversion_goal`, `preferred_cta`, `prohibited_claims` | Same nullable/no-fabrication handling as Brief/Blueprint. |
| **`brand_profiles`** (via `projects.brand_profile_id`) | `tone`, `reading_level`, `spelling_locale`, `sentence_preferences`, `formatting_preferences`, `preferred_terminology`, `forbidden_phrases`, `em_dash_forbidden` | Same as Brief/Blueprint, unchanged. |
| **Internal link candidate pool** | `website_urls` / `internal_link_candidates` rows whose `id` appears in this node's own `internal_link_targets` (already resolved at Blueprint time) | Content does not re-select links — see §8. |

**Explicitly not included:** other sections' `content_versions` bodies (§6), the full Blueprint node tree beyond title/goal (§5), `projects.instructions` re-read a third time (already fully absorbed into the Brief's synthesis; re-passing it a third time is redundant token spend with no new information), raw `research_sources` outside the relevance filter (§4/§5).

---

## 2. Which Blueprint node fields are authoritative

All nine fields listed in §1's first row are authoritative and must not be silently reinterpreted:

- `title` → the section's heading, verbatim (matches the root-node precedent already set in `generate-blueprint.ts`, which overrides the root title to the Brief's exact H1 rather than trusting the model to reproduce it).
- `target_word_count` → a hard target, not a suggestion; validated post-generation the same WARN-level way Blueprint validates its own total (BD4 precedent), scoped to one section instead of the whole document.
- `entities` → the section's assigned topical scope. The writer should cover these; it should **not** introduce entities absent from this list (that's Blueprint's traceability job already done — Content just respects the boundary Blueprint drew, it doesn't re-validate against the Brief's whole pool a second time).
- `internal_link_targets` → the exact, pre-validated set of links this section may use (§8) — never re-selected or expanded at Content time.
- `evidence_requirement` → drives §4's relevance filter directly: it's the closest thing to a query for "what evidence does this section actually need."
- `research_support`, `unique_contribution`, `writing_notes`, `goal` → prose-shaping directives, passed through as-is.

---

## 3. Which Brief fields flow into the writer, and why only that subset

Deliberately narrow, for the same reason Blueprint narrowed what it read from the Brief (Phase 4.4 §2): passing the *whole* `brief_versions` row into every one of N section-generation calls is pure repetition — `search_intent_rationale`, `serp_interpretation`, and `common_competitor_expectations` were already fully absorbed into the Blueprint's structural decisions (which section exists, in what order, with what `research_support` attribution). Re-supplying them at Content time either (a) does nothing, because the section-level `research_support`/`goal` already carry the distilled conclusion, or (b) actively risks the writer second-guessing the Blueprint's structure mid-section, which is exactly the drift Phase 4.4 §3 warned against one layer down.

What *does* still matter at Content time and isn't captured anywhere in the Blueprint node: `title`/`h1` (so the writer knows the document's overall subject, useful for natural cross-section phrasing like "as we covered in choosing a name" without literally seeing that section), `target_audience`/`content_objective`/`unique_value` (tone/purpose anchors that a single node's `goal` field doesn't fully restate), `business_brand_alignment` (needed at prose level for CTA phrasing, not just at Blueprint's structural "does a CTA-bearing node exist" level), and `things_to_avoid` (a direct, section-agnostic forbidden-content list — cheap to include, meaningfully risky to omit).

---

## 4. Which Research evidence is included for a specific section — the relevance filter (CD2, locked)

**Locked, with an explicit constraint: each section receives a deterministic, capped, relevance-filtered evidence packet. The full Research Package must never be sent to every section.** The mechanism resolving §0's central challenge. Deterministic, no LLM call, same "app logic, not model judgment" discipline as Brief's `brief_topics` derivation (Phase 4.3 §0.2) and Blueprint's internal-link whitelist.

**Input to the filter:** the target node's `entities` array (already a validated subset of the Brief's own entity pool, per Blueprint's BD3) plus its `evidence_requirement` and `title` text, matched against every `research_sources` row for the project's current Research Package.

**Matching:** case-insensitive substring/keyword overlap between the node's entity strings + title words and each `research_sources` row's own text fields (`common_ground_topics` labels, `competitor_unique_sections` section titles, `content_gaps`, `paa` questions, `related_searches`, `ai_overview` points, `serp_features`). No semantic/embedding matching in V1 — this is deliberately the same class of "plain deterministic app logic" already proven sufficient for `brief_topics` derivation; a real research payload today is lightweight, structured metadata (confirmed directly in Phase 4.3's inspection: "no raw competitor page bodies are extracted or stored"), so keyword overlap over structured labels is a reasonable match quality for V1, not a corner cut under time pressure.

**Bounding (directly answers §5):** cap the total supplied evidence items per section at a fixed ceiling (e.g. 10–15 items total across all matched types) regardless of Research Package size or document length. This means the per-section context cost is **flat**, not proportional to the number of sections or the size of the research corpus — the opposite of naively passing the whole Research Package to every one of N calls.

**Honesty on a miss:** if the filter matches zero items for a section (a real possibility — a structural/organizational node, or a genuinely under-researched topic), the section is generated with **no evidence block at all**, and the system prompt must explicitly instruct: write from the Brief's synthesis and Business/Brand context only, do not invent specifics, and prefer generically-true, non-fabricated framing over a confident-sounding but ungrounded claim. Same honesty discipline as Brief's `research_limitations` field and Blueprint's per-node grounding-honesty rule (Phase 4.4 §4), applied one layer further down, where it now actually has teeth (§0, §7).

---

## 5. Preventing unnecessary context/token growth

Four separate mechanisms, each closing a different growth vector:

1. **Evidence is capped and per-section relevance-filtered, not proportional to corpus size** (§4) — the single biggest lever, since raw research would otherwise be the largest input by far.
2. **The Blueprint tree is trimmed to title+goal for the document map** (§1, §6) — an N-node document costs O(N) *short lines*, not O(N) *full node objects*, let alone O(N) full section bodies.
3. **The Brief contributes a fixed, small field subset** (§3) regardless of how many sections exist — this cost does not scale with document length at all.
4. **No sibling section bodies are ever included** (§6) — the single largest possible growth vector (an already-written 3,000-word article's worth of prior sections) is categorically excluded, not merely trimmed.

Net effect: per-section input cost is roughly flat with respect to document size, growing only mildly with Research Package size (bounded by the §4 cap) and Blueprint tree size (bounded by §1's title+goal-only map). This is the direct fix for the "N×full-context" anti-pattern that a naive "just pass everything Blueprint/Brief/Research has" design would produce.

---

## 6. Preventing repetition between sections

Two complementary mechanisms — one cheap and prompt-level, one deterministic and post-hoc:

- **The document map (§1)** is the primary prevention mechanism: every section-generation call sees every sibling's `title` + `goal`, so the model has structural awareness of what's "someone else's job" without needing to see their prose. The system prompt instructs: cover only this section's assigned entities/goal; do not restate content whose title/goal clearly belongs to another listed section.
- **Deterministic near-duplicate detection is explicitly out of scope for V1** (§21) — a real cross-section similarity check (e.g. n-gram overlap or embedding similarity between this section's draft and previously-approved sections' bodies) is a legitimate future QA category, but building it now, before a single real Content generation has been observed, risks the same "framework before the second data point exists" mistake Phase 4.2 explicitly warned against (§14 of that doc). Flag as a candidate for a future QA finding category (`qa_category` already has room under `topics`/`structure`), not a Phase 4.5 requirement.

---

## 7. Ensuring facts/claims are grounded in supplied evidence

No single mechanism fully solves this — stated plainly, because pretending otherwise would be dishonest about a real, structural limitation of LLM-generated prose. Three layered mitigations, in order of strength:

1. **Narrow, relevant evidence supply is the primary mitigation** (§0, §4) — a model given the actual competitive facts to work from is dramatically less likely to fabricate than one given none.
2. **Explicit no-fabrication instruction + honesty-on-a-miss framing** (§4's last paragraph), matching the same discipline already proven at Brief and Blueprint (`research_limitations`, per-node grounding honesty).
3. **A required, structured `evidenceUsed` field per section in the tool-use output (CD8, locked) — reference IDs only, never duplicated evidence text.** Shape: an array of stable identifiers into the supplied evidence packet, e.g. `research_source:<id>` — not the evidence content itself re-embedded a second time, and not a full citation system. This is a forced acknowledgment that grounds the model's own attention on "did I actually use what I was given," at effectively zero prompt-size cost (an ID string, not a quote). It is defensive, not a proof of correctness: a model can still write a fabricated claim and leave `evidenceUsed` empty or point it at something unrelated. **What this buys is a cheap, real signal for human review** — a section whose `evidenceUsed` is empty despite evidence having been supplied is worth a closer look before Approve, surfaced in the Content Editor UI (not designed in this document — a Phase 4.5-UI-build-time detail) similarly to how Blueprint's word-count warning surfaces today.

**The grounding rule itself is locked (CD9):** Content must never invent a specific claim, statistic, price, competitor fact, or business fact the supplied evidence does not support. When evidence is insufficient for what a section's `evidence_requirement` calls for, the writer must omit the unsupported claim or make only a safe, non-specific statement — never fill the gap with a plausible-sounding invented detail. This is enforced as a system-prompt instruction (defense in depth, matching every prior stage's "reference data, not instructions" prompt-injection framing) plus the `evidenceUsed` signal above; it is **not** enforced by a deterministic post-hoc validator, because none is feasible — see below.

**What this does not claim to do:** there is no deterministic way to verify an arbitrary English sentence's factual claim against a research payload — that's an open NLP problem, not something this system should pretend to solve with a regex. The real backstop remains what it already is everywhere else in this pipeline: **human approval is the actual grounding check.** This document does not propose automated fact-verification as a Phase 4.5 requirement (§21) — surfacing the signal for a human is the honest, buildable version of this requirement.

---

## 8. How internal links are handled

Content does not select or invent links — it **renders** the exact, pre-validated set Blueprint already assigned to this node (`blueprint_nodes.internal_link_targets`, itself already whitelist-validated against real Website Knowledge at Blueprint time, Phase 4.4 §7). The writer's job is narrower: decide *where in the section's prose* each assigned anchor text naturally belongs, and emit it as a real Markdown link (`[anchor text](target url)`), using the exact `anchorText` Blueprint assigned or a close natural variant — not a new URL.

**Post-generation validation** (deterministic, no LLM call, same class as Brief/Blueprint's whitelist checks): parse the returned body for Markdown links; any `href` that isn't one of this node's own `internal_link_targets` resolved URLs is stripped from the body before persistence, never trusted as emitted. This generalizes the exact whitelist pattern one more layer (whole-document → per-node → per-node-body-text), rather than inventing a new validation shape.

A section may legitimately use zero, some, or all of its assigned links depending on natural prose flow — Content is not required to force every assigned link into the text if it doesn't fit naturally; forcing it would produce worse content than the internal-linking goal is worth.

---

## 9. Enforcing Business Profile + Brand Voice rules

Fully reused, unmodified, from Brief/Blueprint — no new logic:

- `assertNoEmDash` (`lib/generation/brief/em-dash.ts`) applied to the section's rendered body text.
- `assertBrandCompliance` (`lib/generation/brief/brand-compliance.ts`) applied to the body, with the same exclusion discipline already established (a field whose *job* is to name something to avoid gets excluded from the forbidden-phrase check; Content's `evidenceUsed`/internal metadata fields, if any resemble Blueprint's `writingNotes`/`evidenceRequirement` false-positive class, get the same treatment) — reused unmodified, not reimplemented.
- Both checks are hard generation failures (`failGeneration`, retryable), matching the existing discipline exactly.

---

## 10. How one section is generated independently

A section-generation call requires exactly: `projectId`, `blueprintNodeId` (must be a **leaf** node of the project's currently-**approved** Blueprint version — CD1, checked server-side, not just UI-gated, mirroring `generateBlueprint`'s own `brief_versions.status === 'approved'` precondition check pattern), and nothing else. It does not require any other section to exist, be generated, or be approved first — sections are independent generation units by construction (separate `content_documents` rows, separate `generation_runs` rows once CD3 lands).

**Orchestration is explicitly out of scope for this phase's core design** (§21): a "Generate All Sections" convenience action that loops over every leaf node and dispatches N independent `generateContentSection` calls is a thin, obvious wrapper over the per-section primitive — worth building for UX, but it introduces no new architecture; it's N calls to the same function this section already fully specifies, sequenced or lightly parallelized at the UI/action layer, not a new generation type or engine concept. Precedent: Phase 4.2's own §10 already anticipated this exact shape ("Resuming content generation... only dispatch Generations for sections still missing one... needs no new mechanism, just discipline at the orchestration layer").

---

## 11. How section-level Edit works (CD5)

Direct, non-AI action: the user edits the current version's body text in the Content Editor UI (a textarea in V1, per Design V1's frozen interaction — Save/Cancel, no rich-text editor). **Save inserts a new `content_versions` row** (`version = max+1`, `status = 'ai_generated'`, `blueprint_node_id`/`content_document_id` unchanged, `generation_run_id = null`, `model_id = null`, `prompt_version = null` — an edit has no generation provenance, which is itself the honest signal that this version's body did not come from a model call), then flips `content_documents.current_version_id` to it — the exact head+version+flip-last discipline already used everywhere else in this schema. **Cancel** discards the local textarea change; nothing is written.

**Why `status = 'ai_generated'` and not some new "user_edited" value:** `content_version_status` (as it exists today, unchanged by this document per the "no schema change" instruction) has exactly two values — `ai_generated` and `approved`. That enum genuinely encodes *approval state*, not *authorship* — "ai_generated" is really "not yet approved by a human," which remains true whether the current text came from a model or a manual edit. This is consistent with the same status meaning after a manual edit as before: **any edit to an already-approved section's body should be treated as needing re-approval** (the edit is inserted as a fresh `ai_generated` version, the previously-approved version is untouched and remains permanently retrievable, exactly like Brief/Blueprint's regeneration-after-approval rule, L3/BD1). No proposal to add an authorship column in this phase (§21) — the version's own `generation_run_id` (present vs. `null`) is already sufficient to answer "was this AI or human" for anyone who needs it, without a redundant status value.

---

## 12. How section-level Request Changes works — locked answer: it doesn't exist, replaced by Regenerate-with-instructions (CD4)

**Locked (CD4): no per-section Request Changes state.** Design V1's Content Editor never shows one — only Edit / Regenerate / Approve, per-section (confirmed against `docs/design/README.md`'s "Content Editor — per section" states). Brief and Blueprint need Request Changes because they are *whole-document, single-shot AI outputs* — the only way to change one field is a full AI regenerate, so a deliberate human gate ("yes, I actually want to trigger that") is valuable friction before an expensive whole-document call. A Content section has no equivalent problem: the two paths to "this needs to be different" — Edit (direct, human, free) and Regenerate (AI, single-section) — are already one click away.

**What replaces it (locked, CD4):** Regenerate accepts an optional, free-text **user instruction** at the moment it's triggered — "make this more concrete about pricing tiers," "shorten the intro," "cover X instead of Y" — instead of a separate Request-Changes state that would gate a *later* regenerate action. The instruction is not a new artifact-level status; it is simply an input to that one regenerate call, stored on the resulting `generation_runs` row's existing `metadata` jsonb column (no new column, no new table) so it remains part of that Generation's permanent record — the same place Blueprint already stores its own generation-time signal (`wordCountWarning`, Phase 4.4). The instruction is treated the same as `projects.instructions` elsewhere in this pipeline: **user-authored free text, delimited and framed as data in the prompt, never as an instruction to the model about its own behavior** (the same prompt-injection boundary already established at Brief/Blueprint).

**Why this is not "Request Changes with extra steps":** Request Changes elsewhere in this schema is a *state* (`brief_changes_requested`/`blueprint_changes_requested` on `projects.status`) that exists independently of any regenerate call, precisely so a human can flag "this needs work" now and regenerate later, possibly after editing upstream inputs. A per-section regenerate instruction has no such gap to fill — there is no meaningful "flagged but not yet regenerated" limbo state worth persisting for a single section, because acting on the instruction *is* the same click that supplies it. Adding a stored, standalone "changes requested" state here would be introducing structure Design V1 never asked for, for no matching benefit — the "unnecessary abstraction" this document was explicitly asked to watch for.

---

## 13. How section-level Regenerate works (CD4, CD5)

Whole-section AI regenerate, optionally carrying a user instruction (§12, CD4): creates a new `content_versions` row (`version+1`, `status='ai_generated'`, real `generation_run_id`/`model_id`/`prompt_version`), flips `content_documents.current_version_id`, and — per Design V1's explicit interaction rule — **discards any unsaved local edit and resets approval for that section only** (already true by construction: a fresh `ai_generated` version simply becomes current; there is no "un-approve" step needed because the new version was never approved in the first place). The previous version, approved or not, is left permanently intact and retrievable — same immutability guarantee as every other versioned artifact in this schema.

Regeneration re-runs the full §1 input-assembly + generation pipeline fresh (a new relevance filter pass, a new document-map snapshot reflecting the Blueprint as it stands now), with the optional user instruction (if supplied) added to the prompt as an explicit, delimited directive alongside — not replacing — the node's own `goal`/`writing_notes` (the Blueprint's structural intent is still authoritative; the instruction refines the prose within it, it does not override §2's authoritative fields). This is not a "retry with the same inputs" — it's a new independent Generation, matching Brief/Blueprint's `attempt_number=1, retry_of_generation_run=null` semantics for a deliberate regenerate (Phase 4.3 §8) vs. an in-call transient retry. The instruction itself is persisted on the new `generation_runs` row's `metadata` (CD4), so the "why was this regenerated" record survives even after the version becomes current.

---

## 14. How a regenerated section preserves the rest of the document

Trivially, by construction, not by any special-cased logic: **each leaf Blueprint node owns exactly one `content_documents` row** (CD1, enforced today by the existing `unique` constraint on `content_documents.blueprint_node_id`). Regenerating section B's content touches only section B's `content_documents`/`content_versions` rows. Section A and section C's rows are different rows entirely — there is no shared "document" row to accidentally overwrite, no locking or coordination needed between sibling sections' regeneration. This is the direct payoff of CD1's per-section-row design, worth stating explicitly because a naive "one `content_documents` row per project, containing an ordered array of sections" design (which this schema deliberately does *not* use) would have made this a real hazard requiring careful partial-update logic; the schema as built sidesteps the problem entirely.

---

## 15. How content versions are linked to exact Blueprint versions/nodes

Already correctly designed by the existing schema, confirmed by direct inspection — no change needed, same conclusion Phase 4.4 §8 already reached about this exact question: `content_versions.blueprint_node_id` (and `content_documents.blueprint_node_id`) is a direct FK to one specific `blueprint_nodes` row, which itself belongs to exactly one `blueprint_versions` row (immutable, never mutated by a later Blueprint regenerate — Blueprint regeneration always creates an entirely *new* set of `blueprint_nodes` rows, BD2). This means content lineage to an exact Blueprint version is pinned **by construction**, with zero additional lineage column needed (unlike Blueprint's own `brief_version_id` gap, which genuinely required a new column in Phase 4.4 — Content has no equivalent gap).

**Consequence worth naming explicitly:** if a Blueprint is regenerated *after* Content already exists for the prior Blueprint version's nodes, that Content is now pointing at Blueprint nodes that are no longer part of the *current* Blueprint version — analogous to Phase 4.4 §9's "a Blueprint version now visibly reflects a Brief version that may no longer current." The same honest-staleness pattern applies: this is knowable (join `content_documents.blueprint_node_id → blueprint_nodes.blueprint_version_id`, compare against `content_blueprints.current_version_id`'s version), not silently wrong, and the product decision of exactly how to surface it in the Content Editor UI is deferred to implementation time, not designed further here — consistent with how Phase 4.4 treated the analogous Brief-staleness surfacing question.

**Precondition, mirroring Blueprint's own gate:** Content generation for a section should only be permitted while the project's Blueprint is `approved` (checked server-side, not just via `projects.status`, exactly like `generateBlueprint`'s `brief_versions.status === 'approved'` check) — generating content against a Blueprint still in draft, or against a stale/superseded Blueprint version, is out of scope for a well-formed generation request and should fail closed rather than silently proceeding.

---

## 16. How partial failure/retry works

Fully reused from the Generation Engine (`lib/generation/engine.ts`), unmodified, per-section instead of per-document — no new recovery logic, same three-phase lifecycle (`recordProviderCompleted → recordArtifactPersisted → completeGeneration`) already proven twice:

- Failure before the provider responds → `failGeneration`, retryable, nothing was written (§5a class (a) from Phase 4.2).
- Failure between provider response and persisted version (parse/insert crash) → recoverable from the stored `output_ref` without re-calling the model, same stage-level repair-path pattern Brief/Blueprint already established (not built inside `engine.ts` — a small section-scoped repair function alongside `generateContentSection`, same shape as Brief/Blueprint's own repair paths).
- A user-triggered Regenerate (§13) is always a new `generation_runs` row, never a resurrection of a failed one (§4 of Phase 4.2, unchanged).

**No new engine code is required** — this is the same validating signal Phase 4.3 §12 already noted about Blueprint reusing the engine unmodified: the three-phase split was built generically enough that a third real stage (Content) needs zero changes to `engine.ts` itself, only a schema addition (CD3) to correctly scope the *uniqueness* guard, which is a different concern from the *recovery* logic (recovery already works per-`generation_runs`-row regardless of what that row is scoped to).

---

## 17. Preventing two generations of the same section running simultaneously (CD3, locked, APPROVED)

**This is a real, concrete gap in the schema as it stands today** — flagged directly, not assumed away. Phase 4.2 §3 already anticipated this exact problem in advance ("`content_generate` is one job per section, not per project — the uniqueness key needs to include the node... worth designing precisely at migration time, flagging now so it isn't discovered as a bug later"). It was flagged and then never built, because no stage needing it existed yet. It's needed now.

**Confirmed by direct inspection:** `generation_runs` has no `blueprint_node_id` column today. The existing partial unique index (`(project_id, type) WHERE status IN (...)`, D2) would, as it stands, treat *any* two concurrent `content_generate` runs for the same project as a conflict — including two different sections' legitimate simultaneous generations, which is exactly the multi-section-parallelism a "Generate All Sections" convenience action (§10) would want to do.

**Required implementation-time schema change (CD3, not created by this document):** add `generation_runs.blueprint_node_id uuid references blueprint_nodes(id)` (nullable — only meaningful for `content_generate` rows) and change the partial index's key to `(project_id, type, coalesce(blueprint_node_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status IN (...)` (or an equivalent formulation), exactly matching the shape Phase 4.2 already sketched. This is a small, additive migration (new column + index replacement, never editing an already-applied migration) — flagged here as a precise requirement for whoever implements this phase, same treatment as Blueprint's `brief_version_id` addition in Phase 4.4.

---

## 18. How the finished article is assembled from section versions (CD6, locked, APPROVED)

A deterministic, pure read-time function, not a generation type and not a persisted table: given the project's approved Blueprint version, flatten its node tree in document order (the same `level`/`position` ordering already used to render the Blueprint tree in the Review UI), and for each node: if it's a **leaf** node, look up its `content_documents.current_version_id`'s body (Markdown, per the schema's own comment: "V1 stores body as Markdown/plain text... keep this column swappable for a future rich-text format"); if it's a **structural/non-leaf** node, its `title` alone becomes a heading with no body of its own (matching §1/§14's leaf-only content-generation scope).

**Why not a persisted table (CD6):** nothing downstream currently consumes an "assembled document" — QA (Phase 4.6) and Export (Phase 4.7) don't exist yet, and it's not this phase's job to guess their exact needs. A computed-on-read function is trivially cheap (a handful of indexed row lookups, no AI call, no heavy computation) and can be memoized or persisted later *if* a real requirement demonstrates the read cost matters — building the persistence now would be exactly the kind of premature abstraction this document was asked to watch for, mirroring Phase 4.2's own explicit rejection of building ahead of a demonstrated need (§15 of that doc).

---

## 19. How deterministic QA and AI QA fit into the process (CD7)

**Not built in this phase.** The `qa_reports`/`qa_report_content_versions`/`qa_findings` schema already exists (Phase 0, unused) and is explicitly Phase 4.6's job to activate — this document does not touch it, does not add a `qa_run` code path, and does not decide the 9 categories' exact pass/warn/fail logic.

What Content generation *does* do, which is easy to conflate with QA but is a different thing: it runs its own **generation-time guards** (em-dash §9, brand-compliance §9, internal-link whitelist §8) as hard-fail validators on the model's own output, before persistence — exactly like Brief and Blueprint already do. These guards happen to overlap conceptually with two of QA's nine frozen categories (`forbidden_chars`, `brand`, `links`) but they are not QA runs: they gate whether a *single generation attempt* is allowed to succeed at all, they never produce a `qa_reports` row, and they have no `qa_method`/`qa_status` values — a category-level PASS/WARN/FAIL report spanning the whole document (or even one section) evaluated independently of generation is a distinct, later concern (Phase 4.6), reusing the *existing untouched* QA schema rather than reinventing a parallel one now.

---

## 20. What happens when evidence is insufficient

Directly extends the honesty discipline already established at every prior stage, one level further down where it now has real teeth (§0, §7): if §4's relevance filter matches no `research_sources` for a section, or matches items too thin to substantiate a specific claim the section's `evidence_requirement` calls for, the writer must **say less, not invent more** — write from the Brief/Blueprint's already-approved synthesis and the Business/Brand context alone, using generically-true framing rather than a confident, unsupported specific. This mirrors Brief's `research_limitations` field and Blueprint's per-node grounding-honesty rule (§4 of the Blueprint plan) — there is no new escape-hatch field proposed here either, for the same reason Blueprint rejected adding its own `research_limitations` column (Phase 4.4 §14): it would duplicate information already knowable from the (empty or thin) `evidenceUsed` signal (§7) rather than needing its own column.

---

## 21. Explicitly out of scope (CD10, locked)

- **Whole-article generation in a single AI call** — generation stays strictly per-section/per-leaf-node (CD1); no code path should ever ask the model to produce the entire document in one response, regardless of how small a document gets.
- **QA implementation** — the 9-category QA report (§19, CD7) is Phase 4.6's job; schema already exists and is left untouched.
- **Export implementation in any form** — Phase 4.7.
- **Multi-provider abstraction, agent frameworks, streaming** — reaffirmed unchanged from every prior phase (D3/D5/D6).
- **Automated fact-verification of arbitrary prose claims against evidence** (§7) — a genuinely open problem, not solvable with a Phase 4.5-sized deterministic check; `evidenceUsed` (CD8) is the honest, buildable substitute.
- **Deterministic cross-section near-duplicate/repetition detection** (§6) — a real future QA-category candidate, not built until real Content generations exist to observe the actual failure mode against.
- **A per-section "Request Changes" state** (§12, CD4) — rejected, not merely deferred; replaced by Regenerate-with-instructions.
- **A `blueprint_node_id`-scoped repair/orchestration framework** beyond the small, obvious "loop over leaf nodes" wrapper (§10) — no new engine abstraction, no job queue, no scheduler (D3, reaffirmed).
- **A persisted "assembled article" table** (§18, CD6) — computed on read until a real downstream consumer demonstrates otherwise.
- **Rich-text (TipTap/ProseMirror) body storage** — `content_versions.body` stays plain Markdown/text in V1, per the migration's own stated intent; swapping formats later is a column-content change, not a schema change.
- **Semantic/embedding-based evidence matching** (§4) — keyword/entity overlap over structured metadata is the V1 mechanism; embeddings are a real future upgrade, not a Phase 4.5 requirement, given today's research payload is lightweight structured metadata, not raw prose needing semantic search.
- **Multi-provider abstraction, DB-stored/editable prompts, agentic tool-use loops, streaming, cost dashboards** (D3–D6, reaffirmed unchanged from every prior phase).
- **Real Website Knowledge ingestion, CSV/DOCX research parsing** — unrelated to this phase, unchanged simulated status.
- **Content generation for non-leaf/structural Blueprint nodes** (§1, §14) — they contribute a heading only, never a `content_documents` row.

---

## Appendix A — Image Suggestion Layer (architecture only, not implemented)

Status: **architecture preparation only, added 2026-08-20.** No image generation, no image tables, no migrations — this section exists so the eventual build has a real design to follow instead of being invented ad hoc once Content generation is otherwise finished. Nothing in this appendix is scheduled for Phase 4.5; it documents where this layer sits in the pipeline and what it must guarantee once built, most likely as its own phase (4.6 or later, after or alongside QA — sequencing not decided here).

**Where it sits, restated as the locked separation of concerns (requirement 6):**

```
Content (approved content_versions)
  → Image Suggestion Engine   (deterministic orchestration + one AI call per suggestion set)
  → Image Brief               (the persisted, human-reviewable output of that engine)
  → External/Image Generation Tool   (out of scope — whatever tool a human chooses)
  → Human approval
  → Asset
```

The Image Suggestion Engine's job ends at producing Image Briefs — structured, reviewable suggestions. It never calls an image-generation API itself and is never coupled to one (requirement 6) — same "the stage function is the abstraction boundary" discipline already governing Anthropic access everywhere else in this pipeline (D5), just extended to a second, entirely different kind of provider (image generation, not text) that this system doesn't talk to directly at all in V1.

### A.1 Trigger and version-awareness (requirement 7)

An Image Brief set is generated **per content version**, not per section in the abstract and not per project once. The natural trigger is a specific, already-persisted `content_versions` row reaching `approved` (mirroring the existing approval-gates-the-next-stage pattern used everywhere else: Brief approval gates Blueprint, Blueprint approval gates Content) — most plausibly evaluated at the whole-article level (§18/CD6's existing computed-on-read article assembly is the natural input: an Image Brief set considers the assembled article's sections together, not one section in isolation, since a featured image and inline-image placement decisions are inherently document-level, not section-level, decisions).

Every Image Brief must record the exact `content_versions.id` (or ids, if generated once per fully-approved article) it was generated from — same immutable-lineage discipline as every other artifact in this schema (Research → Brief version → Blueprint version → Blueprint node → Content version → **Image Brief**). If the content is later edited or regenerated (CD5 — a new `content_versions` row), existing Image Briefs are not retroactively invalidated or silently rewritten; they remain a truthful record of what they were generated against, and whether to regenerate them is a human decision, not an automatic cascade — same "no silent cascade" principle already established for Blueprint-after-Brief-regeneration (Phase 4.4 §9) and reaffirmed for Content-after-Blueprint-regeneration in this document's own §15.

### A.2 Dynamic image count (requirement 1)

The Image Suggestion Engine recommends however many images the content actually warrants — never a fixed number. The count is a model judgment call informed by document length, structural variety (how many genuinely distinct visual concepts the article's sections contain), and content type (a short landing page may warrant only a featured image; a long guide may warrant several inline images at natural conceptual breaks). No hardcoded minimum or maximum is proposed here beyond a sane upper bound to cap cost/prompt size the same way `MAX_EVIDENCE_ITEMS` caps Content's evidence packet (§4) — the exact number is an implementation-time tuning question, not an architectural one; the requirement this locks is only that the number is never forced to a fixed constant like four.

### A.3 Two suggestion roles (requirements 2, 3)

Every suggestion carries an explicit `role: "featured" | "inline"` (requirement's own vocabulary, not renamed):

- **`featured`** — exactly the kind of image a blog/article card or hero placement needs: simpler composition, low visual noise, one dominant concept, strong negative space so text/UI can overlay it cleanly. An article should have at most one `featured` suggestion (a document has one "cover"); the engine should not propose competing featured candidates.
- **`inline`** — placed within the article body at a specific point, each with a distinct purpose. The engine must actively avoid redundant visuals: two inline images illustrating the same concept from the same angle is a failure of this layer's actual job, the same way Content's own document-map mechanism (§6) exists to prevent redundant prose between sections — an analogous "what's already been visually said" check belongs here, not designed further in this appendix beyond naming the requirement.

### A.4 Per-suggestion fields (requirement 4)

Every Image Brief item eventually carries:

| Field | Meaning |
|---|---|
| `role` | `featured` \| `inline` (§A.3). |
| `placement` | For `inline`: where in the assembled article this belongs — most naturally a reference to the exact `blueprint_node_id`/section it illustrates (reusing existing lineage, not inventing a new positioning scheme), plus before/after-this-paragraph granularity if warranted. For `featured`: implicitly "the article's own card/hero," no further placement needed. |
| `concept` | The specific visual idea in plain language — what the image actually depicts. |
| `rationale` | Why this image belongs here — what it adds that the surrounding text doesn't already convey, tying back to the section's own goal (same "trace back to an authoritative source" discipline as Blueprint's node fields, Phase 4.4 §2). |
| `image-generation prompt` | The actual prompt text a human would hand to whatever image tool they choose — provider-agnostic wording (no tool-specific syntax baked in), consistent with requirement 6's decoupling. |
| `visual/brand guidance` | Tone, style, composition notes — see §A.5 for where this comes from. |
| `SEO filename` | A descriptive, hyphenated filename suggestion (e.g. `crowded-bar-test-business-naming.png`) — deterministic-in-spirit, generated from the concept/section topic, not arbitrary. |
| `alt text` | Accessibility/SEO alt text — grounded in the concept and the section's own entities, same no-fabrication discipline as everywhere else (never claim the image shows something it doesn't). |
| `suggested dimensions/aspect ratio` | Informed by `role` (`featured` implies card/hero-appropriate ratios; `inline` implies in-content-appropriate ratios) — exact values are an implementation-time convention, not fixed here. |
| `status` | A review-state field, analogous to `content_version_status`/`artifact_version_status` — e.g. suggested vs. approved vs. rejected by a human. Exact enum values are a schema-design question for whoever implements this (out of scope to lock here, since no schema is being written yet), not resolved further in this appendix. |

Every field above is **AI recommendation** provenance (matching the existing four-value provenance model, no fifth category invented) — none of it is a "Research finding" (there's no image-specific evidence source), none is "System validation" (nothing here is deterministically computed), and none is "User decision" beyond the Business/Brand-profile-derived brand guidance, which follows the same indirect-mediation precedent already established for `writingNotes` (Phase 4.4 §16) rather than getting its own badge.

### A.5 Brand consistency, without inventing colors (requirement 5)

Image prompts must be informed by the existing `business_profiles`/`brand_profiles` fields already available to every other stage (company, audience, tone, preferred terminology) — the same no-fabrication discipline as text generation applies here unchanged: **the engine must never invent a brand color, logo treatment, or visual style the Business/Brand Profile doesn't specify.** Today's `brand_profiles` schema has no visual-brand columns (no palette, no logo reference, no style-guide field) — this appendix does not propose adding one yet (no migration, per this task's own constraint), but explicitly designs for one: whenever a future `brand_profiles` (or a new, dedicated visual-brand-settings table) gains explicit palette/style-constraint fields, the Image Suggestion Engine should consume them exactly the way it already consumes `tone`/`forbiddenPhrases` today — additively, not as a redesign. Until that exists, image prompts stay deliberately generic on brand-specific visual details (no specific hex codes, no invented logo placement) rather than guessing.

### A.6 Explicitly out of scope (requirement 8)

- **Actual image generation** — no call to any image-generation API, in this phase or designed for a specific one here.
- **Image editing** (cropping, retouching, variant generation).
- **An asset library** — no table for storing/versioning generated image files; Image Briefs are suggestions, not assets.
- **Automatic image insertion into `content_versions.body`** — a human places the generated asset; this layer never rewrites Content's own Markdown body to embed an image reference itself, keeping Content's own insert-only versioning (CD5) untouched by an unrelated concern.
- **WordPress (or any CMS) media publishing** — a distinct, later integration question, not this layer's job.
- **Image tables or migrations of any kind** — this entire appendix is deliberately schema-free; when implementation begins, the exact table shape (most likely an `image_briefs` head+version-ish table, or a simpler per-content-version array, TBD at that time) is a fresh design decision informed by this appendix, not dictated by it.

---

## Key risks, ranked

1. **§0/§7 — grounding is the sharpest correctness risk in this whole phase.** Unlike Brief/Blueprint (where "don't fabricate" mostly guards against inventing *structure* or *attribution strings*), Content is the first stage where the model is actually writing checkable prose. The mitigations in §4/§7 reduce but do not eliminate this risk — flagged as the single most important thing to watch once real generations start, mirroring how Phase 4.2 flagged its own §5/§5a persistence gap as "the sharpest correctness risk," which later proved out exactly as predicted.
2. **CD3 (§17) is a required schema change, not optional hardening** — without it, a "Generate All Sections" convenience action would either have to serialize (defeating the point) or hit a false "already active" conflict between unrelated sections. This should land before any orchestration UI is built on top of section generation, not after.
3. **Token-growth discipline (§5) depends on the relevance filter actually staying capped** — if implementation time relaxes the cap "just to be safe" or the entity-matching logic degrades into "include everything that vaguely matches," the flat-cost property this document argues for silently disappears. Worth a concrete, tested cap value and a regression check once real Research Packages are available to test against.
4. **CD4's "don't build Request Changes" is a judgment call, not a schema constraint** — if implementation-time UX testing finds users genuinely want a distinct "flag this for later, don't act now" state at section granularity (different from Edit-now or Regenerate-now), that's a legitimate reason to revisit, not a design the schema forecloses (nothing here removes headroom for it later).
5. **The document-map repetition mitigation (§6) is prompt-level only** — it reduces but does not guarantee no repetition; if it proves insufficient in practice, the honest next step is the explicitly-deferred deterministic check (§6, §21), not tightening the prompt further indefinitely.

---

This document was originally planning-only; it now also serves as the as-built record. All decisions above (CD1–CD10) are **locked** as of 2026-08-19 and were implemented exactly as written, with no relitigation during the build: CD3's schema change (`generation_runs.blueprint_node_id`) landed via migration `20260825000001_phase4_5_content_generation_lock.sql`, the Content RLS gap was closed via `20260825000002_phase4_5_content_rls.sql`, and every other locked decision (CD1–CD2, CD4–CD10) is reflected unchanged in the shipped `lib/generation/content/` data-contract layer, `lib/ai/prompts/content/v1.ts`, `generate-content-section.ts`, and the Content Editor UI. Phase 4.5 is complete. Appendix A (Image Suggestion Layer) remains architecture-only — no image tables, migrations, or generation calls exist. Next: Phase 4.6 QA architecture planning (see `docs/PROJECT-TAKEOVER.md`).
