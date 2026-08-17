# Handoff: SEO Content Maker — Design V1 (frozen)

## About this bundle
`SEO Content Maker.dc.html` is a **design reference**, not production code — a single-file HTML/React prototype built to show intended screens, flows, states, and copy. Recreate it in the target codebase's real stack (Next.js + Supabase per the connected repo `PepoStojan/content-agent`) using that stack's own component/data patterns. Do not port the HTML/inline-style markup directly.

**Fidelity:** High-fidelity for layout, copy, states, and interaction logic. Colors/type/spacing values below are final. Treat all sample content (the "Best Project Management Software for Remote Teams" project, the two seed profiles, QA notes, blueprint text) as **placeholder data illustrating the schema**, not real copy to ship.

This is Design V1, frozen. Any visual or flow change from what's documented here is a new decision — flag it, don't silently change it.

---

## Screens

1. **Dashboard** — project cards grid, "needs your review" callout, entry point to New Content.
2. **New Content** — 5-step wizard: Basics → Research upload → Website knowledge → Profiles & instructions → Review & generate.
3. **Business Profiles** — reusable business-context profiles (list + create form).
4. **Brand Voice** — reusable brand/tone profiles (list + create form).
5. **Settings** — Users & roles, Integrations (Research Agent, read-only), Feature flags.
6. **Project Workspace** — tabbed: Brief Review, Blueprint, Content Editor, QA, Export. This is the core product surface.

No screens beyond these were designed. Do not invent additional screens (e.g. a standalone analytics view) without asking.

---

## Flows

**Primary flow:**
Dashboard → New Content wizard → generate Strategy Brief → **human approves Brief** → Blueprint auto-generated → **human approves Blueprint** → Content auto-generated → QA → Export.

**Wizard flow (New Content):**
1. Basics: content type (chip select), topic (required to advance), primary query, market.
2. Research upload: drag-drop → "Simulate upload" → parsing spinner → parsed summary (competitors/gaps/SERP features/warnings) OR failure banner with Retry. Must reach "parsed" to advance.
3. Website knowledge (optional): sitemap.xml + internal_all.csv → parsed summary (URL counts, indexable count, link candidates). Not required to advance.
4. Profiles & instructions: pick one Business Profile chip, one Brand Voice chip (or jump to create one), optional free-text instructions. If research is parsed, a note states audience/competitors won't be re-asked.
5. Review: read-only summary of all prior steps → "Generate strategy brief" → loading state (~1s) → lands in Project Workspace, Brief Review tab.

**Approval gating (protected decision — see below):** Blueprint/Content/QA/Export tabs are locked (padlock icon, click no-ops, tooltip "Locked until the previous step is approved") until the prior gate is approved. Brief tab is always open.

---

## Components & Tokens

**Typography:** Poppins (400/500/600/700), loaded from Google Fonts. Monospace (`ui-monospace, SFMono-Regular, Menlo, monospace`) used ONLY for technical values: file names, URLs, prices, word counts, statuses.

**Colors:**
- Background `#F0F4F8`, card surface `#FFFFFF`, elevated/input `#E8EEF5`, border `#D1DCE8`
- Text: primary `#1A202C`, secondary `#4A5568`, muted `#A0AEC0`
- Brand/success `#00A886` (buttons, active nav/tab, PASS state)
- Warning `#D97706` / bg `#FEF3E2`
- Danger `#DC2626` / bg `#FDECEC`
- Status tints: waiting `#FEF3E2`/`#B45309`, in-progress/purple `#EDE9FE`/`#5B21B6`, success `#EAF7F3`/`#00654F`

**Provenance badge colors (protected — see below):**
- Research finding: bg `#EEF2FF`, text `#4338CA` (indigo) — evidence, never user-editable in the content workflow
- AI recommendation: bg `#F5F3FF`, text `#6D28D9` (violet) — AI output, user-editable
- User decision: bg `#E8EEF5`, text `#4A5568` (neutral) — comes from Business/Brand profiles
- System validation: neutral badge next to QA/validation panels; PASS/WARN/FAIL use green/yellow/red per above

**Radii:** 8px (buttons, chips, inputs), 12px (dropzones, small panels), 16px (cards — dominant radius), pill/9999px (status badges, chips).

**Spacing:** 4px base scale; card padding 16–20px; section gaps 16–24px.

**No drop shadows anywhere.** Elevation and separation come from surface color and 1px borders only.

**Core components to build:** Card (white, 1px border, 16px radius), Status badge (pill, colored bg/text pair), Provenance badge (small uppercase pill, 4 variants above), Chip (selectable pill, teal border+bg when selected), Locked tab (padlock icon + tooltip + no-op click), Sticky approval footer (Request changes / Approve), Toggle switch, Stepper (numbered dots + label, hides labels on mobile).

---

## Responsive Rules

Breakpoints: mobile `<768px`, tablet `768–1023px`, desktop `≥1024px`.

- **Nav:** desktop/tablet — fixed 232px left sidebar. Mobile — sidebar becomes a fixed-position overlay drawer (slide from left, backdrop dims content), triggered by a hamburger in a new top bar; closes on nav item click or backdrop click.
- **Horizontal page padding:** 40px desktop, 24px tablet, 16px mobile (vertical padding unchanged).
- **Two-column forms** (business/brand profile forms, wizard basics query/market row): collapse to 1 column below desktop.
- **Blueprint tab** (tree + inspector, 320px/1fr): collapses to 1 column (stacked) on mobile only; stays 2-column on tablet.
- **Content Editor tab** (content/1fr + 300px sidebar): collapses to 1 column on tablet AND mobile (sidebar reflows below content); stays 2-column on desktop only.
- **Wizard stepper and project tab bar:** horizontally scrollable (`overflow-x:auto`) instead of wrapping; step labels hide on mobile, leaving numbered dots only.
- **Dashboard/screen headers** (title + primary action): stack vertically on mobile, row on tablet/desktop.

---

## States & Interactions

**Research/site upload:** idle → uploading (spinner) → parsed (summary) or failed (error banner + Retry). Simulated with a timeout in the prototype; real implementation replaces this with actual upload/parse calls.

**Brief tab:** default view → approved view (green "Brief approved" banner replaces the sticky Approve footer; tab remains revisitable/read-only after approval).

**Blueprint tab:** tree + inspector → approved view (green "Blueprint approved" banner, footer removed).

**Content Editor — per section:** view mode (body text + Edit / Regenerate / Approve buttons + "AI-generated" badge) ⇄ edit mode (textarea + Save / Cancel). Approve toggles badge to "Approved" (teal). Regenerate discards any local edit and resets approval for that section only — full-document regenerate is intentionally NOT offered; only section-level.

**QA tab:** category list, each PASS (green) / WARN (yellow) / FAIL (red) with a note. Banner summarizes and blocks "Continue to export" if any category is FAIL. "Re-run validation" clears the simulated failure.

**Export tab:** format checkboxes (Markdown/HTML/DOCX/Structured JSON) → validation banner (blocked if QA has a failure) → Export → exporting spinner → complete (file list with download links).

**Empty state:** Business/Brand Profiles show a plain one-line empty message ("No business profiles yet.") when the list is empty — no illustration, no filler copy.

**Feature flag:** Settings has a toggle ("Require blueprint approval before content generation") wired to the same strict-gating behavior as the tab locks — default ON.

---

## Approval & Provenance Rules (protected — do not weaken without asking)

1. Human approval is **mandatory** between Brief → Blueprint and Blueprint → Content/QA/Export. This is enforced by locking tabs, not just by a warning.
2. The project-level status badge (header, and dashboard cards) must be derived from the actual approval/export state (`briefApproved`, `blueprintApproved`, `exportState`), never from which tab happens to be open. This was a fixed bug in V1 — do not regress it.
3. Every research-derived fact is labeled **"Research finding"** and is not editable from within the content workflow (it can only change by re-uploading research).
4. Every AI-generated recommendation (brief fields, blueprint fields, content body) is labeled **"AI recommendation"** or **"AI-generated"** and is user-editable.
5. Values sourced from Business/Brand profiles are labeled **"User decision."**
6. QA/validation results are system-computed, shown as PASS/WARN/FAIL, never a single blended "SEO score."
7. No em dash is permitted in generated content; this is validated and shown as a specific QA/Forbidden-Characters check, not folded into a generic "style" check.
8. Export is blocked while any QA category is FAIL.

---

## Implementation Notes

- **Data model implication:** the prototype uses one shared "demo project" for all interactive detail — the real schema needs one Project record with its own Brief, Blueprint, Content (per-section), QA result set, and Export record, each with an `approved`/`status` field and timestamps. Business Profiles and Brand Voice profiles are separate reusable entities, referenced by Project (many-to-one), not duplicated per project.
- Section-level content storage: each content section needs its own body text, approval flag, and edit history (or at minimum last-edited-by/at) — the UI depends on per-section state, not a single document blob.
- Research/site upload states (idle/uploading/parsed/failed) should map to real async upload + parse job status, not a client-side timeout.
- The "detected from research, won't ask again" note in the wizard implies the backend must expose which fields the Research Package already answered, so the frontend can conditionally skip/pre-fill wizard fields.
- Locked-tab logic and the Settings feature flag should read from the same source of truth (a single `strictApprovalGate` setting), not be implemented twice.

---

## Assumptions (confirm with product owner if wrong)

- Content type options are limited to: Blog post, Landing page, Comparison page, Guide.
- Export formats are limited to: Markdown, HTML, DOCX, Structured JSON.
- QA categories are fixed to the 9 shown (Intent, Topic coverage, Entities, Structure, Internal links, Brand, Factual support, Style, Forbidden characters) — adding/removing categories is a product decision, not a styling one.
- "Team Lead," "SEO Manager," "Content Writer" are the only roles shown; role permissions/behavior differences are not designed and need their own spec if required.
- Research Agent integration is view-only in this product (files in, no live API shown) per the product principle that it's a separate system.

## Protected Decisions (do not change without asking)
- Two mandatory human-approval gates (Brief, Blueprint) enforced by locked tabs, defaulting ON.
- Provenance labeling on every AI/research/user-sourced value (see rules above).
- No single blended QA score; category-level PASS/WARN/FAIL only.
- Section-level (not document-level) regenerate/edit/approve in the Content Editor.
- No em dash validation as its own explicit rule, not merged into general style checks.
- Visual system: no drop shadows, 16px card radius, Poppins only, teal `#00A886` as the only brand/action color.

## Files
- `SEO Content Maker.dc.html` — the full interactive prototype (open directly in a browser).
