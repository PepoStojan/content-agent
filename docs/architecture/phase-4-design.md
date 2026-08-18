# Phase 4 Design Document — AI Generation Pipeline

Status: **planning only — no code written**. Grounded in `docs/engineering/CLAUDE_CODE_SPEC.md`, `docs/design/README.md`, the frozen `docs/design/SEO Content Maker.dc.html` prototype, all 16 applied migrations, and the Phase 0–3 implementation actually in the repo (`lib/ai/client.ts`, `lib/projects/status.ts`, `lib/auth/session.ts`, the Phase 3 RLS pattern and its recursion bug/fix).

---

## 1. Objectives

Turn the static project shell (Phase 3: a project sits at `ready_for_brief` and goes nowhere) into the real pipeline the whole schema was already built for: **Brief → human approval → Blueprint → human approval → Content → QA → Export**. Every table this needs (`content_briefs`/`brief_versions`, `content_blueprints`/`blueprint_versions`/`blueprint_nodes`, `content_documents`/`content_versions`, `qa_reports`/`qa_findings`, `exports`/`export_files`, `generation_runs`) **already exists** from Phase 0 and has never been used. Phase 4's job is to make them real without violating three things that are already load-bearing: the provenance rules (Research finding / AI recommendation / User decision / System validation), the two mandatory approval gates, and the versioning model (nothing is ever overwritten, everything is a new row).

Non-objective, stated explicitly because it will be tempting: this is not a rebuild of the SERP Research Agent, not a multi-provider abstraction project, not a general-purpose agent framework. Scope creep here is the single biggest risk to this phase (see §19).

---

## 2. Complete AI pipeline

```
ready_for_brief
   │
   │  [generation_run: brief_generate]  — 1 Claude call, structured output
   ▼
brief_generated ──(human: Request changes)──► brief_changes_requested ──┐
   │ (human: Approve)                                                   │
   ▼                                                    (edit + regen) ◄┘
brief_approved
   │
   │  [generation_run: blueprint_generate] — 1 Claude call, structured output
   ▼
blueprint_generated ──(human: Request changes)──► blueprint_changes_requested
   │ (human: Approve)
   ▼
blueprint_approved
   │
   │  [generation_run: content_generate] × N — one per blueprint_node/leaf section,
   │  can run in parallel, each independently retryable
   ▼
generating_content → content_ready
   │
   │  [generation_run: qa_run] — deterministic pass (no LLM) + AI pass (1 Claude call)
   ▼
qa_failed / qa_warning / ready_for_export
   │  (human: reviews QA panel, no separate "approve QA" gate per Design V1 — export
   │   button itself is blocked while any category is FAIL)
   ▼
   │  [generation_run: export] — deterministic rendering, no LLM
   ▼
exported
```

Three things worth naming explicitly because the spec doesn't say them out loud:

- **Only the deterministic QA and Export stages have zero LLM involvement.** Brief, Blueprint, Content, and the AI-QA pass all call Claude. That's 4 LLM call sites, not a monolithic "generate everything" call.
- **Content generation is the only stage that's naturally parallel.** Brief and Blueprint are single-shot. Content is N independent jobs (already reflected in the approved "one job per section" decision from Phase 3 planning).
- **QA is two passes glued into one `qa_reports` row**, not two separate user-facing steps — matches Design V1's single QA tab showing 9 categories together, some `method: deterministic`, some `method: llm`.

---

## 3. Agent architecture

**Recommendation: no agents.** Each stage is a single-purpose function that makes one (or for content, one-per-section) Claude call with a fixed system prompt and structured context — not a tool-calling loop, not a ReAct-style agent, not multi-turn planning. Concretely:

```
lib/ai/stages/
  generate-brief.ts        (brief_generate)
  generate-blueprint.ts    (blueprint_generate)
  generate-content-section.ts (content_generate, called once per node)
  run-ai-qa.ts             (qa_run's LLM half)
```

Each is a plain async function: `(project, context) => structuredResult`. No shared "agent" abstraction, no tool registry, no autonomous multi-step reasoning inside a single call.

**Why not agents:** the engineering spec is explicit that "Application code: file parsing, validation, normalization... Claude: interpretation, synthesis, strategy, outline, content generation, qualitative QA" — a deliberate split between deterministic app logic and single-purpose model calls. An agentic loop (model decides what to do next, calls tools, iterates) would blur that line, make output non-deterministic in ways hard to version/test, and multiply cost unpredictably (§13/§19). If a future stage genuinely needs multi-step reasoning (e.g., "research the SERP live" — explicitly out of scope, spec §1), that's the moment to reconsider, not now.

**Weakness to flag:** the AI-QA stage ("competitor imitation too close?", "any strategy drift?") is the one place a single call might not be enough — it's grading 10 different qualities at once. Alternative worth considering: one call returning a structured list of findings across all 10 AI-QA questions (cheaper, matches the "no blended score, category-level PASS/WARN/FAIL" rule) rather than 10 separate calls (10x cost for marginal gain). Recommend starting with one call, splitting only if output quality proves the single-call approach can't reliably cover all 10 questions.

---

## 4. Prompt architecture

Each stage prompt is composed of three fixed parts, always in this order:

1. **System instructions** — role, hard constraints (no em dash — though that's enforced deterministically too, not trusted to the model; provenance framing; "do not materially change the approved strategy without surfacing a warning" for content generation per spec §13).
2. **Injected structured context** — never raw file dumps. Research findings, business/brand profile fields, the approved brief/blueprint, already-generated sibling section headings (not bodies) — all as compact, labeled JSON, trimmed to a token budget (§10).
3. **Output contract** — Claude's structured output / tool-use forced-schema feature, not free-text-then-regex-parse. Every stage's output shape already exists as a table schema (`brief_versions` columns, `blueprint_nodes` columns, etc.) — the tool schema should mirror those columns 1:1 so parsing is a direct mapping, not a translation layer.

**Weakness in the current codebase:** `lib/ai/client.ts` only exposes a raw Anthropic client + a model-id getter — there's no shared "call a stage with a schema and get validated structured output back" helper yet. That's the one piece of infrastructure every stage needs and none of them should duplicate.

**Untrusted content boundary:** research file content is user-uploaded and — per spec §19 — must be treated as untrusted input. It gets embedded in prompts (Brief generation especially). Recommend explicit delimiting (e.g., wrapping injected research text in a clearly-labeled block with an instruction to treat its contents as data, never as instructions to follow) to reduce prompt-injection risk from a malicious or corrupted research file. This is a real, not theoretical, risk: nothing currently in the ingestion pipeline sanitizes research content for instruction-like text before it reaches a prompt.

---

## 5. Prompt versioning

Every versioned artifact table already has a `prompt_version text` column (`brief_versions`, `blueprint_versions`, `content_versions`) — this was anticipated in Phase 0 and never used. Recommendation: **prompts live as versioned files in the repo**, not in the database.

```
lib/ai/prompts/
  brief/v1.ts
  blueprint/v1.ts
  content-section/v1.ts
  qa-ai/v1.ts
```

A prompt file is never edited after it ships — a change is a new file (`v2.ts`) and the stage function bumps which version it imports. `prompt_version` gets stamped from a constant exported by that file (e.g. `"brief@1"`), not typed by hand at each call site. This makes every historical `brief_versions` row reproducible against the exact prompt that generated it, which matters because versioning is the whole point of this schema (regeneration must be traceable, not just re-runnable).

**Alternative considered and rejected for V1:** DB-stored, dashboard-editable prompts (lets a non-engineer tune prompts without a deploy). Rejected because: (a) it reintroduces exactly the kind of un-reviewed, un-tested change surface the file-based approach avoids, (b) nobody has asked for it, (c) it's trivial to migrate to later if genuinely needed — starting file-based is the reversible choice, starting DB-based is not (once prompts are dashboard-edited in production, someone has already hand-tuned prompts, which are now the source of truth to migrate back). Revisit only if there's a real non-engineer prompt-iteration workflow requested.

---

## 6. Database changes required

**Already sufficient, no change needed:** `content_briefs`/`brief_versions`, `content_blueprints`/`blueprint_versions`/`blueprint_nodes`, `content_documents`/`content_versions`, `qa_reports`/`qa_findings`, `exports`/`export_files`, `generation_runs`. This is the pleasant surprise of this review — Phase 0 built the full schema for Phase 4 before Phase 4 was even planned, and it holds up.

**Genuinely missing, needs a new migration:**

1. **Token/cost columns on `generation_runs`.** Currently: `progress numeric, input_ref jsonb, output_ref jsonb, error jsonb, model_id text` — no token counts, no cost. Add `input_tokens integer`, `output_tokens integer`, `cost_usd numeric`. Cheap to add now, expensive to backfill later (historical runs would have no cost data). See §13.
2. **RLS policies for every Phase 4 table.** All of them have RLS *enabled* (from the Phase 0 blanket-enable migration) but **zero policies** — same starting state `projects` was in before Phase 3, including the same trap: any new helper function that queries a table it's also used to protect must be `SECURITY DEFINER` with a fixed `search_path` from the very first migration, not discovered the hard way again. This is not optional polish — it's a repeat of a bug already paid for once.
3. **A defined shape for `blueprint_nodes.internal_link_targets` and `entities` jsonb columns.** They exist but nothing has ever wired a real shape into them. Recommend documenting (not necessarily enforcing via a DB constraint) `internal_link_targets: { candidate_id: uuid, anchor_text: string, reason: string, confidence: number }[]`, referencing `internal_link_candidates.id` so the Blueprint's internal-link plan is traceable back to where the suggestion came from.

**Open question, not a schema gap:** does deterministic/AI QA evaluate the *assembled whole document* (concatenated approved sections, in blueprint order) or check content-versions independently? Spec §14 items ("check heading hierarchy," "check word count against requested range") only make sense against the assembled document. `qa_report_content_versions` already supports pinning which per-section version fed into a given report — but the assembly step itself (concatenate N `content_versions` bodies in blueprint order into one document for QA/export) has no code and no dedicated storage. Recommend: assembly is computed on demand (a pure function over already-approved `content_versions`), not stored — storing it would be a second source of truth for something fully derivable.

---

## 7. API/provider abstraction

**Recommendation: don't build one.** `lib/ai/client.ts` today is a thin Anthropic wrapper plus a model-id getter — that's the right amount of abstraction for a single-provider product. The correct abstraction boundary is at the **stage function** level (`generateBrief(project)`, `generateBlueprint(project)`), not a generic `LLMProvider` interface with `.complete()`/`.stream()`/`.tool_use()` methods that OpenAI and Anthropic would both have to satisfy.

Building a provider abstraction now, before there is a second provider, is speculative generality — exactly the "don't add features/abstractions beyond what's needed" pattern this project has consistently avoided elsewhere (see: the deliberate choice not to build a generic multi-tenant org model in V1, the deliberate choice to reject DB-stored prompts above). A provider interface designed today, without a second real provider's constraints to design against, will almost certainly need reshaping the first time a second provider is actually added — better to pay that cost once, for real, later.

---

## 8. OpenAI vs Anthropic strategy

**Stay Anthropic-only.** This was already an explicit architecture decision (single configurable model, `ANTHROPIC_MODEL` env var, `lib/ai/client.ts` server-only). Nothing in Phase 4's requirements changes that calculus — there's no cost-arbitrage need, no capability gap Claude can't cover (structured output, long context, strong instruction-following for the "no em dash" / provenance-respecting constraints this product leans on).

If multi-provider ever becomes a real requirement (redundancy against an outage, cost optimization at scale, a capability only one vendor has), the trigger for that work is the requirement showing up, not building it preemptively. Flagging this explicitly because "OpenAI vs Anthropic strategy" as a section title invites building a strategy for a decision that was already made — the strategy is: revisit if and when there's a concrete reason to.

---

## 9. Retry strategy

Two different kinds of retry, don't conflate them:

- **Transient failure within one attempt** (429 rate limit, 5xx, network timeout): bounded exponential backoff *inside* the stage function, 2–3 attempts, before the `generation_run` is marked `failed`. This is invisible to the user — it's just "the call eventually succeeded."
- **User-triggered regenerate** (Design V1's "Regenerate section" / "Regenerate blueprint" buttons, already specified): creates a **new** `generation_run` and a **new** version row. Never retried automatically, never silently — it's an explicit human action, and it's already how the versioning model is designed to work (nothing overwritten, always a new row).

Distinguish retryable from non-retryable errors: rate limits/timeouts/5xx are retryable; a malformed-request or content-policy rejection is not (retrying a request Claude will reject the same way every time just burns quota and delays the user hitting a real error message). `generation_runs.error jsonb` should record enough to tell these apart later (status code / error type), not just a message string.

**Weakness to flag:** nothing in the current schema distinguishes "failed after retries, needs a human regenerate click" from "failed instantly on a non-retryable error" at the `generation_runs.status` level — both just land on `failed`. That's probably fine for V1 (the UI shows a Retry/Regenerate button either way), but if this ever needs different UI treatment (e.g., "this failed for a content-policy reason, editing your instructions first" vs "transient, just try again"), `error.type` inside the jsonb column is where that distinction would need to live — plan for it now in the error shape even without building the differentiated UI yet.

---

## 10. Token management

This is the sharpest technical risk in the whole phase, and it's not addressed anywhere in the spec or existing schema.

- **Brief generation**: research package content can be large (the one real sample in this repo, a single Markdown research file, is over 1,500 lines / tens of thousands of tokens raw). Sending it raw to every Brief generation is both expensive and likely to blow past useful context relevance. Recommend a **context budget function** (`lib/ai/context-budget.ts`, not built yet) that selects/trims `research_sources` rows to the most relevant N per type (competitors, gaps, SERP features) rather than dumping everything — the normalized `research_sources` table (typed rows, not raw text) already makes this tractable, since it's structured data to rank/filter, not prose to summarize with another LLM call.
- **Blueprint generation**: small context (approved brief + trimmed research) — low risk.
- **Content-section generation — the real growth risk.** Naively including "everything generated so far" as context for each subsequent section makes total tokens-per-article grow roughly quadratically with section count (section 10 of 10 would include the full text of sections 1–9). Recommend: each section's context includes sibling section **headings and one-line goals only** (already present on `blueprint_nodes` — `title`, `goal`), not full bodies, plus the specific evidence/entities for *that* node. This keeps per-section context roughly constant regardless of article length.
- **AI QA**: needs the assembled document (§6) — this is inherently the largest single call in the pipeline and doesn't have a cheaper alternative; budget for it explicitly rather than being surprised by it.

**Something that could become expensive later, called out explicitly per the ask:** if content generation context isn't capped as above, a 10-section guide could cost meaningfully more per generation than a 5-section blog post in a non-linear way, and nobody would notice until a bill does. This is worth a deliberate token-budget ceiling per stage, enforced in code, not just assumed.

---

## 11. Streaming

**Recommendation: not in Phase 4's first pass.** Two different needs hide under "streaming":

- **Structured-output stages (Brief, Blueprint, AI QA)**: streaming provides little value — the client needs a complete, valid structured object before it can do anything with it (populate `brief_versions` columns, render the Blueprint tree). Non-streaming, single-shot calls are simpler and match how the UI already works (a spinner, then a result — Design V1's existing "Generating strategy brief…" pattern).
- **Content-section generation (prose)**: streaming *would* improve perceived latency in the Content Editor (watching text appear vs. staring at a spinner). But it adds real complexity — partial-render UI state, cancellation handling if a user navigates away mid-stream, and reconciling a streamed-then-possibly-edited draft with the versioning model (is a still-streaming response a version yet, or not until it completes?).

Recommend shipping the polling-based pattern already proven in Phase 3 (`generation_runs.status` transitions, client polls or subscribes, same as the upload/parse flow) for all of Phase 4's first pass, and treating streaming as a clearly-scoped later enhancement to content generation specifically — not a Phase 4 requirement.

---

## 12. Progress tracking

`generation_runs.progress numeric` already exists. Use it honestly, not decoratively:

- Brief/Blueprint/AI-QA: single Claude call each — progress is binary (0 → 100 on completion), shown as a spinner, not a fake intermediate percentage. Don't invent progress ticks for a single atomic call.
- Content generation: **real, meaningful progress** — `(sections with a generation_run in a terminal state) / (total sections)`, since it's already architected as one job per section. This is the one stage where a progress bar is honest rather than theatrical.
- Export: single deterministic render per format — binary, same as Brief/Blueprint.

---

## 13. Cost tracking

**Not currently possible — genuinely missing, not just unused.** Nothing in the schema captures token counts or cost anywhere. Every Claude API response includes exact `usage.input_tokens`/`usage.output_tokens` — capturing those into the new `generation_runs` columns from §6 at every call site is close to free to add now and costs real backfill pain to add after the fact (historical runs would forever have no cost data).

Recommend: `cost_usd` computed at write time from the model's known per-token pricing (a small constant lookup keyed by `model_id`, kept in code — not fetched live, pricing doesn't change fast enough to justify that). This is data-capture only for Phase 4 — a cost dashboard/reporting UI is explicitly out of scope (nothing in Design V1 shows one), just don't foreclose building one later by failing to capture the numbers now.

---

## 14. Error handling

- `generation_runs.error jsonb` is the single place a failure gets recorded — already exists, needs a consistent shape (`{ type: "rate_limit" | "invalid_request" | "provider_error" | "validation_error", message: string, retryable: boolean }`) decided now so every stage writes errors the same way.
- **Never surface raw provider error text directly to end users**, especially not to the `content_writer` role — it can leak prompt/schema internals and is rarely actionable for a non-engineer. Map to a human-legible message (same pattern already used for auth errors in Phase 1's sign-in flow: specific known error codes get a friendly message, everything else gets a generic fallback), log the raw detail server-side only.
- **QA failure is not an error.** A `qa_findings` row with `status: fail` is a normal, expected outcome of a successful `qa_run` — don't conflate it with `generation_runs.status = 'failed'`, which means the *run itself* broke (API error, timeout), not that QA found a problem. Keep these two failure concepts (job failed vs. content failed a check) structurally separate, which the schema already does correctly — just don't blur it in the application code that consumes both.

---

## 15. Background jobs

**This needs a real decision, not a rubber-stamp of the earlier architecture choice.** Vercel Workflow was selected during the original architecture phase as the async orchestrator, but as of this review it has **never been used anywhere in the codebase** — `workflow` is a listed dependency with zero imports across Phases 0–3, and it's still a beta package (`4.x`) whose transitive dependencies (`nanoid`, `undici`) carried unresolved security advisories even at the newest available beta, last checked during Phase 0. All async work actually shipped so far (research parsing, file uploads) uses plain awaited Next.js Server Actions — synchronous from the request's perspective, no durable workflow engine involved — and it has worked fine.

Worth challenging directly: **does Phase 4 actually need a durable workflow engine?** The pipeline's individual steps are short (a handful of Claude calls per project, seconds to low tens-of-seconds each, not hours), don't need to survive a server restart mid-step, and are already modeled as independently-retryable `generation_runs` rows keyed by type — which is most of what a workflow engine buys you, already built into the schema without one.

Recommendation: **build Phase 4 on plain awaited Server Actions first** (matching Phase 3's proven pattern), and only reach for Vercel Workflow if a concrete need appears that Server Actions can't satisfy — e.g., content generation for a long article genuinely exceeding a serverless function's execution time limit, or a real need for cross-request resumability. This defers the beta-package risk indefinitely rather than accepting it now for a durability guarantee nothing in the current usage pattern actually needs.

---

## 16. State transitions

Only human approval actions may advance `projects.status` past a gate — never automatic, this is a protected rule (Architecture V1, engineering spec §11). Concretely, per state:

| From | Trigger | To |
|---|---|---|
| `ready_for_brief` | `brief_generate` run succeeds | `brief_generated` |
| `brief_generated` | human clicks "Request changes" | `brief_changes_requested` |
| `brief_changes_requested` | `brief_generate` run succeeds again (new version) | `brief_generated` |
| `brief_generated` | human clicks "Approve brief" | `brief_approved` |
| `brief_approved` | `blueprint_generate` run succeeds | `blueprint_generated` |
| `blueprint_generated` | human "Request changes" / "Approve" | `blueprint_changes_requested` / `blueprint_approved` |
| `blueprint_approved` | first `content_generate` run starts | `generating_content` |
| `generating_content` | all section `content_generate` runs reach a terminal state | `content_ready` |
| `content_ready` | `qa_run` completes with any FAIL | `qa_failed` |
| `content_ready` | `qa_run` completes with WARN, no FAIL | `qa_warning` |
| `content_ready` | `qa_run` completes clean | `ready_for_export` |
| `qa_failed`/`qa_warning` | human re-runs QA after edits, clean result | `ready_for_export` |
| `ready_for_export` | `export` run succeeds | `exported` |

`failed` is reachable from any state on an unrecoverable `generation_run` failure (not a QA fail — see §14) and should be treated as needing human intervention (retry the failing stage), not a dead end requiring project recreation.

---

## 17. Future extensibility

Deliberately deferred, not designed now, but worth naming so later work knows where the seams are:

- **Multi-provider** — the stage-function boundary (§3/§7) is where a provider swap would happen; no interface needed until then.
- **DB-stored/editable prompts** — the file-based `prompt_version` convention (§5) is a straightforward migration path if a non-engineer prompt-editing workflow is ever actually requested.
- **Streaming content generation** — §11, deferred but not precluded by anything in this design.
- **Custom/pluggable QA rules** — `qa_category` is a frozen enum by explicit product decision (Design V1 "Assumptions"); if that ever needs to change, it's a product conversation first, not a schema afterthought.
- **Org-level model selection** — `settings.ai_model_id` already exists and is unused; wiring it in instead of the env-var fallback is a small, contained change whenever multi-org or per-org model choice matters.
- **Cost dashboard/reporting** — unlocked for free once §13's data capture ships, no schema change needed later.

---

## 18. Security considerations

- **API key**: already server-only (`lib/ai/client.ts` imports `server-only`), correct, no change needed.
- **Prompt injection via untrusted research content** — real risk, not yet mitigated anywhere (§4). Needs explicit content-boundary framing in every prompt that injects research text.
- **RLS on every new table** — currently enabled-but-policy-less (same as `projects` was pre-Phase-3), and the exact recursion bug Phase 3 hit (a non-`SECURITY DEFINER` helper querying the table it protects) is trivially repeatable if new helper functions are written the same naive way for Brief/Blueprint/Content access checks. Write them `SECURITY DEFINER` with fixed `search_path` from the first migration — this is now a known, paid-for lesson, not a hypothetical.
- **Role enforcement**: per the existing matrix, Content Writer has narrower access (assigned projects, content editing/regeneration/QA, no Brief/Blueprint approval, no research editing). Every new Server Action for Phase 4 needs the same double-enforcement pattern already established in Phase 2/3 (RLS as the hard boundary + an explicit server-side role check before the DB call) — not RLS alone.
- **Export output**: exported files (MD/HTML/DOCX/JSON) are user-facing deliverables built from LLM output — no injected/templated content should allow script execution if HTML export is ever rendered anywhere other than as a downloaded file (not a current risk since it's a static file download, but worth remembering if an in-app HTML preview is ever added).

---

## 19. Risks

Ranked by how likely they are to actually bite, not by severity alone:

1. **Token-cost runaway in content generation** (§10) if per-section context isn't capped — the most likely to silently happen and be expensive before anyone notices.
2. **Repeating the Phase 3 RLS recursion bug** on new tables — cheap to prevent (§18), expensive in debugging time if repeated (it cost multiple diagnostic rounds last time).
3. **Building infrastructure nothing asked for** — a provider abstraction, streaming, or DB-editable prompts, none of which are required for Phase 4 to work, all of which are tempting given the section list in this doc's own brief. The existing project's discipline about not doing this (documented repeatedly across prior phase reports) is the thing most worth protecting here.
4. **Adopting Vercel Workflow under momentum rather than need** — it's "the architecture," but it's never been exercised, and its beta-dependency risk is real and unresolved as of the last check. Committing to it now, for a workload that doesn't clearly need it, trades a known simple pattern (Server Actions) for an unproven one.
5. **AI QA grading AI-generated content** — an LLM judging its own family of model's output has correlated blind spots (won't catch the kinds of errors it wouldn't have made itself). Deterministic QA is the more trustworthy layer; AI QA should be positioned as advisory, and the existing "no blended score" rule is doing real work here — don't let AI QA's PASS/WARN/FAIL be treated as more authoritative than it is.
6. **Prompt injection from research uploads** — lower probability (requires a maliciously or accidentally instruction-laced research file) but currently fully unmitigated.

---

## 20. Recommended implementation order

1. **RLS migration** for every Phase 4 table (`content_briefs`/`brief_versions`/`brief_topics`/`brief_internal_links`, `content_blueprints`/`blueprint_versions`/`blueprint_nodes`, `content_documents`/`content_versions`, `qa_reports`/`qa_report_content_versions`/`qa_findings`, `exports`/`export_content_versions`/`export_files`) using `SECURITY DEFINER` helpers from the start, plus the `generation_runs` cost/token columns migration. Zero LLM code yet — this is pure plumbing, and getting it right first avoids the Phase 3 detour repeating.
2. **Shared stage-calling infrastructure** in `lib/ai/`: the structured-output helper (§4), the context-budget trimmer (§10), the prompt-file convention (§5). Still no real stage logic — this is the shared foundation every stage needs.
3. **Brief generation** end to end: prompt, generation, `brief_versions` write, Brief Review tab wired to real data, Approve/Request-changes gate.
4. **Blueprint generation**, same shape, reusing everything proven in step 3.
5. **Deterministic QA** — build this before AI QA and before Content generation is even wired to the UI, because it's pure code (no LLM, no cost, fastest to get right and test) and several of its checks (heading hierarchy, word count) are needed to validate content once that exists.
6. **Content generation** — one job per section, synchronous Server Actions (§15) to start, wired to the section-level edit/regenerate/approve UI Design V1 already specifies.
7. **AI QA** — layered on top of deterministic QA once real generated content exists to test it against.
8. **Export** — deterministic rendering, last because it depends on everything upstream being real.
9. **Revisit background-job mechanism** only if real usage shows Server Actions are inadequate — not before.
10. **Streaming** — explicitly last, explicitly optional, explicitly not required for Phase 4 to be considered complete.

No code has been written as part of this document. Waiting for direction on which section(s), if any, to challenge further or revise before implementation planning begins.
