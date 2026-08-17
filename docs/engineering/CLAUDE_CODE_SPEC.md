# Claude Code Specification: SEO Content Maker

SEO Content Maker • Claude implementation handoff

Version: V1 implementation scope

Purpose: Build the production-ready SaaS application described by the approved design. The Research Agent remains a separate upstream system.


# 1. Non-Negotiable Scope Boundary

Do NOT rebuild the SERP Research Agent in V1. Do NOT silently perform new SERP scraping unless explicitly added as a future feature. The Maker consumes Research Agent outputs as CSV, Markdown, or DOC/DOCX. The Maker is responsible for turning research into strategy, blueprint, content and QA.


# 2. Recommended Technology Stack


# 3. System Architecture

The application should separate deterministic application logic from AI reasoning.

Application code: file parsing, validation, normalization, URL canonicalization, duplicate detection, permissions, state transitions, versioning, output formatting, em-dash detection, forbidden-character validation.

Claude: interpretation, synthesis, strategy, outline/blueprint, content generation, qualitative QA.

Database: persistent source of truth for projects, research packages, website knowledge, profiles, briefs, blueprints, content versions, link candidates and QA reports.


# 4. Core Data Flow

Upload research files

Parse and normalize

Create Research Package

Upload sitemap and internal_all

Create Website Knowledge

Load Business Profile and Brand Profile

Generate Strategy Brief

Human approval

Generate Content Blueprint

Human approval

Generate Content

Run deterministic QA

Run AI QA

Final review

Export


# 5. Input Types


# 6. Research Package Normalization

Do not let prompts depend on arbitrary raw file structure. Normalize all research formats into a common internal schema.

topic

primary_query

secondary_queries

location

organic_results

parsed_pages

failed_urls

field_averages

common_ground_topics

competitor_unique_sections

serp_features

ai_overview

paa

related_searches

content_gaps

format_signals

external_source_signals

raw_competitor_content

research_warnings

When data is not present, store null/unknown and expose the gap. Never fabricate research fields.


# 7. Website Knowledge Processing

Sitemap parsing creates the URL inventory. Screaming Frog internal_all.csv creates richer URL-level knowledge. Support both independently and together.

Normalize URLs

Remove obvious tracking parameters where appropriate

Detect duplicate URLs

Record status/indexability fields when present

Preserve source rows

Build candidate destination pages

Build candidate source pages where available

Identify exact/near duplicate titles if supplied

Allow the user to inspect the parsed dataset


# 8. Internal Linking Engine

Suggest relevant destinations, do not blindly insert links.

Use URL, title, H1, metadata, available crawl fields and semantic relevance.

Prefer contextual relevance over arbitrary keyword matching.

Recommend anchor text that naturally fits the sentence.

Show reason and confidence.

Allow keep/change/remove.

Do not suggest dead, non-indexable or obviously irrelevant destinations when the data supports filtering them out.

Do not force a target number of links if there are no strong candidates.


# 9. Business and Brand Profiles

Business Profile: company, audience, geography, products/services, commercial objective, CTA, claims restrictions.

Brand Profile: tone, reading level, sentence preferences, formatting, forbidden phrases, spelling, preferred terminology, NEVER EMDASH rule.

Project Instructions: temporary piece-specific constraints.


# 10. Strategy Brief Requirements

The Brief must answer “What should we create and why?” It should not be a generic outline.

Search intent

Target audience

Content objective

Primary topic/query

Secondary topics

SERP interpretation

Common competitor expectations

Competitor differentiation

Content gaps

Unique value/differentiation

Recommended title/H1/meta

Entities/concepts

Questions

Internal-link opportunities

Evidence requirements

Things to avoid

Business alignment

Brand alignment

Research limitations


# 11. Human Approval Gates

Do not auto-advance through approval gates.

Brief Generated → requires user approval

Blueprint Generated → requires user approval

Content Generated → editable and reviewable before export


# 12. Content Blueprint

The Blueprint is a structured execution plan between the Brief and the article. Each section should have title/level, purpose, research support, unique contribution, entities, internal links, evidence needs and writing notes.


# 13. Content Generation

The writer receives the approved brief, approved blueprint, Research Package, Website Knowledge, Business Profile, Brand Profile and Project Instructions. The writer should not materially change the approved strategy without surfacing a warning.


# 14. Deterministic QA

Search for em dash character and fail validation if present.

Check heading hierarchy.

Check missing required metadata fields if those are part of the export.

Validate URLs and internal-link destinations against the project dataset.

Detect duplicate internal links where rules prohibit them.

Check word count against requested range.

Check required phrases/terms only when explicitly required.

Check forbidden phrases.

Check malformed HTML/Markdown where applicable.


# 15. AI QA

Search intent satisfied?

Important research topics missing?

Generic or repetitive?

Unique angle actually present?

Unsupported claims?

Competitor imitation too close?

Business positioning accurate?

Internal-link context natural?

Tone consistent?

Any strategy drift?


# 16. QA Output

Do not create a single fake “SEO score” as the primary signal. Return category-level PASS/WARN/FAIL with evidence and recommended fixes.


# 17. Database Model

users

projects

project_members

project_files

research_packages

research_sources

website_datasets

website_urls

business_profiles

brand_profiles

content_briefs

brief_versions

content_blueprints

blueprint_versions

content_documents

content_versions

internal_link_candidates

qa_reports

qa_findings

generation_runs

exports


# 18. Project State Machine

draft

ingesting

ready_for_brief

brief_generated

brief_changes_requested

brief_approved

blueprint_generated

blueprint_changes_requested

blueprint_approved

generating_content

content_ready

qa_failed

qa_warning

ready_for_export

exported

failed


# 19. Security

Never expose API keys client-side.

Use server-side secrets.

Use row-level security for tenant/project separation.

Validate uploaded files by size and type.

Treat uploaded content as untrusted input.

Do not execute uploaded files.

Log generation errors without storing secrets.

Require explicit permissions for project access.


# 20. Claude Code Must Ask the Product Owner Before Building

STOP before implementation if any essential answer below is missing. Ask grouped questions rather than guessing. The first implementation response should include a checklist of what is available, what is missing, and what you recommend.


# 21. How Claude Code Should Behave During Development

Ask when a decision could materially change architecture.

Challenge requirements when a simpler or safer solution exists.

Do not invent credentials, domains, schemas or API contracts.

Explain assumptions before implementing them.

Prefer small, testable milestones.

After meaningful changes, run tests and inspect the app.

Before declaring complete, verify the entire flow from upload → processing → brief → approval → blueprint → content → QA → export.


# 22. V1 Acceptance Criteria

User can authenticate.

User can create a project.

User can upload CSV/MD/DOC/DOCX research.

System normalizes research into a common package.

User can upload sitemap.xml.

User can upload internal_all.csv.

System creates inspectable website knowledge.

System generates a strategy brief.

User can edit and approve the brief.

System generates a content blueprint.

User can edit and approve the blueprint.

System generates content.

User can edit content in the editor.

QA detects em dash and other deterministic failures.

Internal-link recommendations are editable and explainable.

Versions are persisted.

Exports work.

Errors and partial failures are visible.

Security boundaries are enforced.


# 23. Suggested Build Order

Initialize repo and deployment

Set up Supabase and auth

Implement project/workspace shell

Implement file storage and ingestion

Implement research normalization

Implement sitemap/internal_all ingestion

Implement Business/Brand profiles

Implement Brief generation

Implement Brief review/approval

Implement Blueprint editor

Implement Content generation

Implement Content editor

Implement deterministic QA

Implement AI QA

Implement exports

Add tests and end-to-end verification

Production hardening and deploy


# 24. Final Instruction To Claude Code

Treat this document as the implementation specification, but do not interpret it as permission to guess. Before writing substantial code, inspect the approved design and explicitly report: (1) what you have, (2) what is missing, (3) what decisions you recommend, (4) what is blocked, and (5) the first small implementation milestone. Ask the product owner the smallest set of questions necessary to remove ambiguity.


## Table 1

| Layer | Recommendation | Purpose |

| --- | --- | --- |

| Frontend | Next.js + TypeScript + App Router | Web application |

| UI | Tailwind CSS + shadcn/ui + Lucide | Consistent SaaS UI |

| Editor | TipTap | Rich content editing |

| Validation | Zod | Schemas and input validation |

| Database | Supabase PostgreSQL | Projects, versions, users, metadata |

| Auth | Supabase Auth | Login and permissions |

| Storage | Supabase Storage | Uploaded files and exports |

| AI | Anthropic Claude API | Strategy, blueprint, writing and qualitative QA |

| Background jobs | Vercel Workflow | Long-running ingestion/generation |

| Deployment | Vercel | Hosting and deployment |

| Monitoring | Sentry + Vercel logging | Errors and production observability |


## Table 2

| Input | Required? | Notes |

| --- | --- | --- |

| Research Agent CSV | At least one research format required | Structured research when available |

| Research Agent Markdown | At least one research format required | Human-readable research |

| Research Agent DOC/DOCX | At least one research format required | Document research |

| XML Sitemap | Recommended | URL universe |

| Screaming Frog internal_all.csv | Optional but strongly recommended | Richer internal-link data |

| Business Profile | Reusable | Company, audience, market, commercial goal |

| Brand Profile | Reusable | Tone and content rules |

| Project instructions | Optional | Piece-specific instructions |


## Table 3

| Requirement | What Claude needs |

| --- | --- |

| 1. GitHub repository | Where the code should live. If none exists, recommend repository setup. |

| 2. Vercel | Vercel account/team/project and deployment target. |

| 3. Supabase | Supabase project or approval to create one; database region if relevant. |

| 4. Anthropic | Claude API access/key and preferred model. Never paste secrets into source files. |

| 5. Domain | Production domain/subdomain or temporary Vercel domain. |

| 6. Authentication | Email/password, magic link, Google or another preferred method. |

| 7. Research samples | At least one real CSV, one Markdown and/or one DOC/DOCX research output from the Research Agent. |

| 8. Sitemap sample | A real sitemap.xml from a target site. |

| 9. Screaming Frog sample | A real internal_all.csv. |

| 10. Brand examples | 2–3 examples of writing the owner considers excellent. |

| 11. Bad examples | 1–2 examples of content the tool must avoid producing. |

| 12. Brand/profile data | Company, audience, market, services, CTA, terminology and style rules for initial seed profiles. |

| 13. Export preference | Which formats must be supported in V1. |

| 14. Roles | Admin/editor/writer/viewer or simpler permission model. |

| 15. Design handoff | Approved Claude Design project/prototype before UI implementation. |

| 16. Usage limits | Expected number of users/projects/files and rough generation volume to size storage and model usage. |

| 17. Future integrations | Any V1 requirement for Google Docs, WordPress, Webflow, Drive or similar. Do not build unrequested integrations. |

| 18. Content safety/compliance | Any industries or content classes requiring extra restrictions. |