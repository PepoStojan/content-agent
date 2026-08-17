# SEO Content Maker

Turns Research Agent output into approved, on-brand, QA'd SEO content
through two mandatory human approval gates (Brief, Blueprint).

This is the application codebase. Product/design source of truth lives
alongside it:

- `design_handoff_seo_content_maker/` — Design V1 (frozen UI/UX handoff)
- `SEO_Content_Maker_Claude_Code_Handoff/docs/engineering/CLAUDE_CODE_SPEC.md` — engineering specification
- `SEO_Content_Maker_Claude_Code_Handoff/samples/` — real Research Agent / sitemap / Screaming Frog samples

Architecture V1 is approved and frozen (see project chat log). Do not
change schema, architecture, or Design V1 without asking.

## Status

Phase 0 — application shell and infrastructure configuration only. No
product feature workflows are implemented yet.

## Stack

Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui (`base-nova`,
Lucide icons) + Supabase (Postgres/Auth/Storage) + Anthropic Claude +
Vercel Workflow + Sentry.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in values — see project notes for what's required
npm run dev
```

## Database

Migrations live in `supabase/migrations/`, in the order they must be
applied. They implement Architecture V1 exactly (see engineering spec
§17/§18). RLS is enabled on every tenant-scoped table with no policies
yet — policies matching the Team Lead / SEO Manager / Content Writer
permission model are a later phase.

## Design system

Design V1's frozen tokens (colors, radii, Poppins-only type) are wired
into `app/globals.css` as CSS variables, and its core components
(Card, StatusBadge, ProvenanceBadge, Chip, LockedTab,
StickyApprovalFooter, ToggleSwitch, Stepper) live in
`components/design-system/`. Do not change these visual values without
a design decision — see `design_handoff_seo_content_maker/README.md`
"Protected Decisions."
