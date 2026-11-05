# SEO Strategy

## In scope
- ReviewFlow's publicly served HTML shell, entry/authentication pages, and shared brand/social metadata.
- Source-detectable WCAG 2.2 A/AA issues on these public surfaces.

## Out of scope
- Operational application dashboards and workflows: Overview, Tasks, Trace2Preference, Review, Audits, Releases, and Settings. These are internal review tools, not marketing/content pages, even when locally accessible in synthetic demo mode.
- Mockup Canvas (`artifacts/mockup-sandbox`, `/__mockup`): internal design/preview tooling.
- API endpoints, Python CLI, repository-only Markdown documentation, and exported datasets as search landing pages.

## Target audience
- Researchers and reviewers evaluating an experimental human-in-the-loop evidence-labeling and trace-preference prototype.

## Primary topics
- ReviewFlow; evidence-grounded data labeling; human review; Trace2Preference.

## Content and crawler assumptions
- The current app is a React/Vite SPA, with an Express API; no public marketing, blog, product catalog, or served documentation routes are implemented.
- Demo mode is the supported local first-run path; optional Clerk mode uses the same HTML shell for sign-in and sign-up.
- Public entry URLs should remain shareable. Do not recommend server-rendering private workflow data or invent content-site sitemap/schema/llms requirements for this operational prototype.
- No source evidence of Cloudflare or intentional AI-crawler blocking was found.

## Dismissed categories
- None explicitly dismissed by the user.
