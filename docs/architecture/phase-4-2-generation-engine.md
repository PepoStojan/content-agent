# Phase 4.2 — Generation Engine Architecture Review

Status: **architecture locked — no code, no migrations yet.** This challenges the architecture before the first real AI call is written, and the decisions below are now approved. Grounded in the actual schema that exists today: `generation_runs` (Phase 0, still unused), `generation_events` + `projects.generation_state` (Phase 4.1), the versioned artifact tables (`brief_versions`/`blueprint_versions`/`content_versions`, each already carrying `generation_run_id`, `model_id`, `prompt_version`), and the earlier Phase 4 design doc (`docs/architecture/phase-4-design.md`), whose conclusions on agents, providers, and streaming are reaffirmed, not relitigated, below.

The first thing worth challenging is the title of this exercise. "Generation Engine" invites building a framework — a pluggable, generic abstraction with hooks and lifecycle callbacks. **Resist that.** What follows is a specification for one small, boring, well-guarded table plus a handful of plain functions. If this document ever recommends a class hierarchy, that's a bug in the document.

---

## Decision Log

Approved architectural decisions for Phase 4.2. Each references the section that justifies it — this table is the summary, not the argument.

| # | Decision | Status | Section |
|---|---|---|---|
| D1 | `output_ref`-first persistence is the required architecture for every Generation: raw provider output is durably stored before any structured parse/insert is attempted. | **LOCKED** | §5, §5a |
| D2 | `generation_runs` must enforce **one active Generation per (project, stage[, section])** via a partial unique index (`WHERE status IN ('queued','running')`). This is the same mechanism that prevents both duplicate-click and simultaneous-user races — one guard, not two. | **LOCKED** | §3, §12 |
| D3 | Vercel Workflow is **explicitly deferred**. Phase 4.2's first real Generations are built on plain Server Actions. Workflow is revisited only on a demonstrated requirement (execution-time limits genuinely exceeded, or a real cross-request-resumability need) — not by default momentum. | **LOCKED** | §15 |
| D4 | No DB-stored/editable prompts; prompt versions stay file-based. | **LOCKED** (reaffirmed) | §6 |
| D5 | No multi-provider abstraction interface; the stage function is the only abstraction boundary. | **LOCKED** (reaffirmed) | §14 |
| D6 | No streaming, no agentic tool-use loops, no cost dashboard/budget/rate-limiting, no separate cost ledger table, in this phase. | **LOCKED** (reaffirmed) | §15 |
| D7 | **Generation Telemetry.** Every `generation_runs` row permanently records `provider`, `model`, `provider_request_id`, `input_tokens`, `output_tokens`, `total_tokens`, `estimated_cost_usd`, `started_at`, `provider_completed_at`, `artifact_persisted_at`, `completed_at`, `duration_ms`, `finish_reason`, `attempt_number`, `retry_of_generation_run`, `metadata`. Capture only — no dashboards, reporting, or billing designed here. | **LOCKED** | §8 |

---

## 1. What exactly is a Generation?

A **Generation** is one bounded attempt to produce a specific, versioned output for a project, represented by exactly one row in `generation_runs`. Precisely:

- One Generation = one call to a stage function (`generateBrief`, `generateBlueprint`, `generateContentSection`, `runAiQa`) that either succeeds and produces exactly one new version row (`brief_versions`/`blueprint_versions`/`content_versions`) or a QA/export result, or fails and produces nothing.
- A Generation is **not** the same thing as a `generation_state` transition. State transitions are the broader concept (they also cover human actions like "Approve," which involve no model call at all). A Generation is specifically the subset of transitions that involve calling the model — `strategy_generating`, `blueprint_generating`, `content_generating` (× N), `qa_running`.
- A Generation is **atomic from the caller's perspective**: it either fully succeeds (version row exists, `generation_runs.status = 'succeeded'`) or it fully fails (no version row, `status = 'failed'`). There is no "half-succeeded" Generation — see §5 for how that's enforced, not just assumed.

**Challenge:** why does `generation_events` exist separately from `generation_runs` — isn't that two sources of truth for the same thing? No: they answer different questions. `generation_runs` answers "what did this specific attempt cost, what model did it use, what was the input/output" — it's the job record, one per Generation. `generation_events` answers "what happened to this project's pipeline over time" — it's the timeline, and it also logs things that aren't Generations at all (a human clicking Approve, a manual test transition). Every real Generation's start/success/failure **also** emits a `generation_events` row referencing it, but the reverse isn't true. Keep both; do not merge them.

---

## 2. Lifecycle

```
queued → running → succeeded
                  → failed
                  → cancelled
```

Same enum as today's unused `generation_run_status` — no schema change needed here, which is itself a signal the Phase 0 design got this right on the first pass. Mapped against `generation_state`:

| `generation_runs.status` | `projects.generation_state` |
|---|---|
| `queued` → `running` | `strategy_generating` / `blueprint_generating` / `content_generating` / `qa_running` |
| `succeeded` | `strategy_completed` / `blueprint_completed` / ... |
| `failed` | `failed` |
| `cancelled` | reverts to the stage's own `*_pending` (never `failed` — cancellation isn't an error) |

A `generation_runs` row is **write-once after creation for its terminal fields** — `status`, `finished_at`, `output_ref`, `error` are set exactly once, at the moment the attempt concludes. Nothing ever transitions a terminal run back to `queued`/`running` — a retry is a **new row** (§4), never a resurrection of an old one. This is the same "never overwrite, always insert" discipline already governing every versioned table in this schema; the Generation Engine doesn't get an exception.

---

## 3. Preventing duplicate generations — **LOCKED (D2)**

**Challenge the assumption that UI-disabled buttons are enough.** They aren't — this codebase has already relearned that lesson twice (RLS as the real boundary vs. a disabled button; server-side role checks vs. a hidden UI element). The real guard has to live in Postgres, and this is now the approved architecture, not just a recommendation:

> A **partial unique index** on `generation_runs (project_id, type) WHERE status IN ('queued', 'running')`.

This makes "two active generations of the same type for the same project" a constraint violation, not a race condition someone has to reason about. It's cheap, it's enforced regardless of which client or which user triggers the second attempt, and it's the same mechanism that answers §12 (simultaneous users) — there is no separate "multi-user" problem to solve, it's the same problem as "duplicate click," just with a different trigger.

One nuance: `content_generate` is one job **per section** (`blueprint_node_id`), not per project — the uniqueness key for that type needs to include the node, not just the project. So the constraint is really keyed on `(project_id, type, coalesce(blueprint_node_id, '00000000-...'))` or equivalent — worth designing precisely at migration time, flagging now so it isn't discovered as a bug later.

---

## 4. How retries work

Two genuinely different things share the word "retry" — keep them separate:

1. **In-flight transient retry** (a single 429/5xx/timeout during one attempt): handled *inside* the stage function with bounded backoff (2–3 tries), invisible to the user and to `generation_runs` — from the outside, it's still one Generation that eventually succeeded or failed.
2. **User-triggered regenerate**: always a **new** `generation_runs` row. The failed (or even succeeded — a plain "Regenerate" click) run is never mutated. The new row's `input_ref`/metadata can record `retried_from: <previous_run_id>` for traceability, but that's provenance, not identity — it's a distinct Generation, distinct version.

A failed run sitting in `failed` is not itself "retryable" as a stored action — retrying means calling the stage function again, which creates row #2 and is subject to the same uniqueness constraint as any other new Generation (so you can't retry while another attempt for the same type is still active, which is correct — you'd want to wait for or cancel that one first).

---

## 5. What happens if the provider fails halfway? — **LOCKED (D1)**

Two different "halfway" failures, requiring different mitigations — conflating them is the most likely design mistake here:

**(a) The request never completed (network drop, timeout, provider 5xx before any response).** From the caller's perspective this is indistinguishable from "never happened." Mitigation is atomicity by construction: the version row (`brief_versions` etc.) is only ever inserted **after** a complete, schema-valid response is received and parsed. There is no intermediate DB write to clean up, because none was made. `generation_runs.status = 'failed'`, `error` captures what's known, done.

**(b) The response was received successfully, but persisting it afterward fails** (a network blip between getting Claude's answer and writing to Postgres). This is the more dangerous case — **the call was already paid for**, and without care, the result is silently lost with no record it ever happened. Mitigation: write the raw provider response to `output_ref` (Storage, not the DB row itself — keep `generation_runs` rows small) as the very first thing after receiving it, *before* attempting the structured-output parse and the version-row insert. If the subsequent DB write fails, the run is left in a recoverable state: `status` still `running`, `output_ref` populated — a repair path can re-attempt just the persist step from the stored raw output, without re-calling (and re-paying) the model. This is the single most important resilience property in this whole document, it is now the **required** architecture (not optional hardening), and the schema already has the column (`output_ref`) to support it — it's just never been used for this purpose. See §5a for the precise phase model this implies.

---

## 5a. Provider response persistence — phases and recovery (dedicated section, D1)

§5b's mitigation, stated precisely: a single Generation's `running` state is not atomic internally — it passes through three distinct phases before it may be called `succeeded`. Naming them explicitly is what makes each phase's failure mode and recovery path unambiguous instead of folklore.

```
running
  │
  ▼
provider_completed   — the API call returned a full, valid HTTP response.
  │                     The model has been called and charged. Raw response
  │                     body has been written to output_ref (Storage).
  │                     Nothing about our own data model has been touched yet.
  ▼
artifact_persisted    — the raw response has been parsed against the stage's
  │                     structured-output schema and successfully inserted as
  │                     a new version row (brief_versions / blueprint_versions
  │                     / content_versions), referencing this generation_run.
  ▼
completed              — generation_runs.status flips to 'succeeded',
                          projects.generation_state advances to the stage's
                          *_completed value, and a generation_events row is
                          emitted. This is the only phase visible to the rest
                          of the system as "done."
```

**Recovery, phase by phase:**

- **Failure before `provider_completed`** (the call itself errored or timed out): nothing was received, nothing was written. This is §5(a) — mark `generation_runs.status = 'failed'` directly, no recovery needed beyond a normal retry (§4), because there is nothing to recover *from*.
- **Failure between `provider_completed` and `artifact_persisted`** (raw output safely durable in `output_ref`, but the parse or the version-row insert crashed): **recoverable without calling the provider again.** A repair operation reads the stored raw output from `output_ref`, re-attempts the parse and the version-row insert. This is the entire point of writing `output_ref` first — the expensive, billed step (the API call) never needs to be repeated to recover from a failure in the cheap step (our own parse/write).
- **Failure between `artifact_persisted` and `completed`** (the version row exists, but flipping `generation_runs.status`, advancing `projects.generation_state`, or emitting the `generation_events` row failed): **recoverable via idempotent reconciliation**, not reprocessing. A version row already exists and already references this `generation_run_id` — the repair path only needs to finish the remaining status/state-machine/event writes, each of which is safe to re-attempt (setting a status to `'succeeded'` twice is a no-op, not a double-charge).

Note for whoever implements this: today's schema has no explicit column recording *which* of these three phases a `running` run is currently in — `output_ref` being non-null is currently the only inferable signal that `provider_completed` has happened, and a version row's existence (join on `generation_run_id`) is the only signal `artifact_persisted` has happened. That's sufficient to build the recovery logic above without new columns, but if reconciliation logic ever needs to run as a scheduled sweep (rather than only client-triggered "retry"), an explicit phase marker would make that sweep's query trivial instead of inferred. Flagging as a future refinement, not a blocker — no migration proposed here.

---

## 6. How are prompt versions stored?

Reaffirming the earlier Phase 4 design doc's conclusion, unchanged: **file-based, not database-stored.** `lib/ai/prompts/<stage>/v1.ts`, each file exports a version constant (e.g. `"brief@2"`), stamped into `brief_versions.prompt_version` at generation time. A prompt file is never edited after it ships; a change is a new file. Rejecting DB-stored/dashboard-editable prompts again here, explicitly, because "Phase 4.2, first real AI feature" is exactly the moment someone might reach for "let's make this configurable" prematurely — nobody has asked for non-engineer prompt editing, and building it now is speculative generality this project has consistently (correctly) avoided elsewhere.

---

## 7. How are model versions stored?

`model_id` already exists on every relevant table. The precision worth adding: **prefer the model identifier the provider's response actually reports over the one requested**, if the two can differ (a version alias like `claude-latest` resolving to a specific dated snapshot server-side). Capture what *ran*, not what was *asked for* — the difference matters the day pricing or behavior is being reconstructed for a specific historical generation and "we requested the alias" isn't a precise enough answer.

---

## 8. Generation Telemetry — **LOCKED (D7)**

Formerly scoped as two separate questions ("how is cost recorded," "how is token usage recorded") — renamed and unified, because both were always the same answer: a fixed set of immutable fields captured once, at the end of every Generation, on `generation_runs`. This section is scope-limited on purpose: **it specifies what gets recorded, not what reads it.** No dashboard, no reporting view, no billing logic is designed here — that's deliberately out of scope for Phase 4.2 (see §15).

**Every `generation_runs` row must permanently record:**

| Field | Purpose |
|---|---|
| `provider` | Which vendor served this Generation (e.g. `"anthropic"`). Pure telemetry — recording this does **not** imply building the multi-provider abstraction rejected in §14/D5; it's one column, not a framework. |
| `model` | The exact model identifier that ran, preferring what the provider's response reports over what was requested (§7's existing conclusion, now a named column instead of prose). |
| `provider_request_id` | The provider's own request/trace id from its response, if it exposes one — the single most useful field for correlating a stored Generation with the vendor's own logs/support case when something goes wrong. |
| `input_tokens`, `output_tokens`, `total_tokens` | Straight from the provider response's `usage` object, never estimated. `total_tokens` stored explicitly rather than left as a derived `input + output` at read time — telemetry rows are immutable, so the sum is fixed at write time too. |
| `estimated_cost_usd` | Computed at write time from a static per-model pricing table in code (unchanged conclusion from the prior draft) — "estimated" because pricing tables can lag vendor changes; this is telemetry, not an invoice. |
| `started_at` | When this Generation attempt began (already exists as a concept; now a required, always-populated field). |
| `provider_completed_at` | When the provider's response was fully received — the moment §5a's `provider_completed` phase was reached. |
| `artifact_persisted_at` | When the version row was successfully inserted — the moment §5a's `artifact_persisted` phase was reached. |
| `completed_at` | When the Generation reached its final, externally-visible terminal state — §5a's `completed` phase. Distinct from `finished_at`-style fields used elsewhere in this schema only in that it's explicitly the *third* phase marker, not just "when the row stopped being active." |
| `duration_ms` | `completed_at − started_at`, stored rather than computed at read time, for the same immutability reason as `total_tokens`. |
| `finish_reason` | The provider's own stop reason (e.g. end-of-turn vs. hit a token limit vs. stopped on a sequence) — critical for distinguishing "the model finished normally" from "the model was cut off," which a raw success/failure status can't tell you. |
| `attempt_number` | Position of this row in a retry chain — `1` for an original Generation, `2+` for user-triggered regenerates of the same logical unit (§4.2). Distinct from the invisible in-call backoff (§4.1), which never produces multiple rows. |
| `retry_of_generation_run` | Formalizes the ad hoc `retried_from` metadata idea floated in §4 into a real, queryable self-reference — the full retry chain for a logical Generation becomes a simple recursive lookup instead of a jsonb scan. |
| `metadata` (jsonb) | The overflow field for anything stage-specific that doesn't warrant its own column — kept deliberately small in scope, not a second schema. |

**This directly resolves the one open gap §5a flagged** ("today's schema has no explicit column recording which persistence phase a run is in") — `provider_completed_at`/`artifact_persisted_at`/`completed_at` being non-null, in order, *is* the phase marker; no separate status enum is needed for that purpose after all.

**Still explicitly out of scope, per this decision's own boundary:** no cost dashboard, no usage reporting UI, no budget/rate-limiting, no billing reconciliation against a vendor invoice, no separate cost ledger table (unchanged rejection from the prior draft — this remains a 1:1 relationship, one row of telemetry per Generation). This section governs *capture only*.

---

## 10. How are partial generations resumed?

**Challenge: for three of the four stages, there is no such thing as a "partial" generation to resume.** Brief, Blueprint, and AI QA are single-shot calls — a Generation for them is either done or it isn't; "resuming" one is meaningless, the only operation is re-running it (§4, a new Generation).

**Content generation is the real case**, because it's architected as N independent per-section jobs. "Resuming" content generation means: don't re-run sections that already have a succeeded `content_generate` run and a `content_versions` row — only dispatch Generations for sections still missing one. This falls directly out of the "one job per section" decision already made; it needs no new mechanism, just discipline at the orchestration layer (check each `content_document.current_version_id` before dispatching, skip if populated) rather than naively re-triggering all N sections on every "continue" action.

---

## 11. How does cancellation work?

`generation_runs.status` already has `cancelled`, unused. Two levels, and the distinction matters for cost (§8):

- **Soft cancel** (cheap, always available): mark the row `cancelled`, stop the UI from waiting on it. If the provider response arrives afterward anyway, the persist step must check the run's current status before writing the version row — a late response for an already-cancelled run is discarded, not resurrected. This alone gives correct UX but **does not save any cost** — the call was already made.
- **Hard cancel** (saves cost, only if triggered early enough): actually abort the in-flight HTTP request via the provider SDK's abort/cancellation support, tied to a "Cancel" button through the server action. Only meaningfully useful for the one stage where a Generation might run long enough to be worth interrupting — content generation, potentially, once real usage data shows call durations worth cancelling. Brief/Blueprint/AI-QA calls are short enough that by the time a user decides to cancel, the call has likely already finished — building cancel UI for those three is probably wasted effort (see §15).

---

## 12. Preventing two users generating simultaneously — **LOCKED (D2)**

Not a separate problem — solved by the same partial unique index as §3. Two users clicking "Generate Blueprint" on the same project within the same moment produce two `INSERT` attempts against `generation_runs`; the second fails the constraint, and the UI for the second user should read that failure as "someone already started this" rather than a generic error. No locking, no distributed coordination — a unique index is enough because the unit of concurrency (one project's one stage-type at a time) is small and well-scoped.

---

## 13. How do regeneration/versioning work?

Already correctly designed and built (Phase 0's head + version pattern, reaffirmed across every prior phase). The only new wrinkle Phase 4.2 adds: the regenerate action must respect §3's uniqueness constraint — a "Regenerate" click while a Generation for that same stage is already active should be rejected (or better, the button disabled based on a live check against `generation_runs`) rather than racing the constraint at insert time and showing a raw DB error.

---

## 14. How do future providers plug in without touching business logic?

Reaffirming the earlier design doc: the abstraction boundary is the **stage function**, not a generic provider interface. Worth stating explicitly now, with the real schema in front of us, why this holds up: **`generation_runs.model_id` is already just a string.** Nothing in the schema — not this table, not the versioned artifact tables — has any Anthropic-specific shape. A second provider changes exactly two things: the inside of each stage function's API call, and the pricing lookup table in §8. Zero schema migration, zero change to `generation_events`, zero change to the state machine. That's the abstraction actually paying off, and it's a property of *not* building a premature interface — a hand-rolled `LLMProvider.complete()` interface designed today, without a second provider's real constraints to design against, would be more likely to need reshaping later than today's "just a string" is.

---

## 15. What should NOT be built yet

The most important section, stated plainly:

- **No generic Generation Engine framework** — no base class, no plugin/hook system, no lifecycle middleware. Plain functions, one table, one constraint.
- **No multi-provider abstraction** (§14) until a second provider is real.
- **No streaming** — still true from the earlier design doc; content-generation streaming is a UX nicety, not a correctness requirement, and it complicates §5's atomicity story for no benefit to the other three stages.
- **No DB-stored/editable prompts** (§6).
- **No agentic tool-use loops** — every stage remains one bounded call in, one structured result out.
- **Vercel Workflow — explicitly deferred (LOCKED, D3).** It is *still* an unused dependency as of Phase 4.1, with the same unresolved beta-dependency risk flagged in the original architecture review. This is no longer an open question: the first real Generations are built on plain Server Actions (proven through Phases 3–4.1). Workflow is revisited only if a concrete need appears (a stage genuinely exceeding serverless execution limits, or a real cross-request-resumability requirement) — not by default momentum.
- **No hard-cancel UI for Brief/Blueprint/AI QA** — too short-lived to be worth it (§11).
- **No cost dashboard, budget, or rate-limiting** — capture the data (§8/9), don't build what consumes it yet. Nobody has asked for it, and building it now is exactly the kind of scope creep the first Phase 4 review already warned against.
- **No separate cost ledger table** (§8) — the 1:1 relationship doesn't justify it yet.
- **No automatic resurrection/retry-queue infrastructure** — retries are a bounded in-call backoff (§4.1) plus an explicit human regenerate click (§4.2), not a background job scheduler.

---

## Key risks, ranked

1. **The "response received but not persisted" gap (§5/§5a)** is the sharpest correctness risk in this design. It's now a locked architectural requirement (D1) rather than an open question, but it's still unimplemented — the risk moves from "might we design this wrong" to "we must not skip building it when Phase 4.2 code starts."
2. **Generation Telemetry (§8, D7)** — resolved as a locked decision this pass. Residual risk is now purely about implementation discipline: every one of the 16 fields must be populated on every code path that creates a `generation_runs` row (including failure paths, which still owe `provider`/`model`/`attempt_number`/timestamps up to the point of failure) — a partially-populated telemetry row silently defeats the point of locking this now.
3. **Vercel Workflow adoption by default** — resolved by D3 (explicitly deferred). Residual risk is only in not re-litigating this under time pressure later.
4. **AI QA re-run cost** — Design V1's "Re-run validation" button has no cooldown or guard; a user iterating on edits could trigger repeated whole-document AI QA calls (the largest single call in the pipeline) with no visibility into the accumulating cost until §8 ships.
5. **Building a "Generation Engine" as a framework rather than a table and some functions** — the framing risk named at the top of this document. The temptation is real precisely because this is being designed carefully; careful design is not the same as abstraction.

---

No code, migrations, or implementation performed as part of this review. Decisions D1–D7 above are locked for Phase 4.2 planning purposes; nothing in this document has been built yet.
