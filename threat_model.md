# Threat Model

## Project Overview

ReviewFlow is an AI-assisted, evidence-grounded data-labeling application. An Express 5
API server (`artifacts/api-server`) backs a React frontend (`artifacts/reviewflow`),
persisting to PostgreSQL via Drizzle ORM (`lib/db`). Tasks are evaluated either by a
deterministic in-process simulator ("demo" mode) or by a live external provider
(Jev / typesafe.ai, "live" mode). Humans accept/correct/escalate proposals, blind
audits sample finalized work, disagreements are adjudicated, and results are exported
as immutable JSONL releases.

The app runs in two modes:
- **demo** (default when no Clerk keys are configured): no hosted authentication.
  Each visitor gets an isolated demo project keyed to a signed `reviewflow_demo`
  cookie (`demo:<uuid>`).
- **clerk**: Clerk-backed authentication; each authenticated user owns a single
  project keyed `user:<clerkUserId>` and is materialized as an `owner` membership.

## Assets

- **Labeling data** — tasks (question/evidence/candidate answer), AI proposals,
  human reviews, audit decisions, disputes, and JSONL release exports. Business-
  sensitive; integrity of the human-in-the-loop decision trail is the core product value.
- **Session isolation material** — the signed `reviewflow_demo` cookie and
  `SESSION_SECRET` used to sign it. In demo mode this cookie is the *only* tenant
  boundary between anonymous users.
- **Application secrets** — `DATABASE_URL`, `SESSION_SECRET`, `CLERK_SECRET_KEY`,
  `TYPESAFE_API_KEY` (server-only live-provider credential). None are exposed to the client.
- **Provider credential usage** — `TYPESAFE_API_KEY` authorizes billed live evaluations.

## Trust Boundaries

- **Browser ↔ API** — all requests cross `/api`. Writes require a trusted `Origin`
  plus the `x-reviewflow-csrf: 1` header (`protectCredentialedWrites`). CORS is
  restricted to `TRUSTED_ORIGINS` + managed Replit domains.
- **API ↔ PostgreSQL** — all queries use Drizzle parameterization; raw `sql``` in the
  worker interpolates only server-derived internal IDs.
- **API ↔ Jev provider** — server-side `fetch` to a fixed hardcoded URL with the
  server-only API key; not user-controllable (no SSRF surface).
- **Anonymous demo ↔ demo** — isolation enforced only by the signed cookie value.
- **Project role boundary** — `owner` / `reviewer` / `adjudicator`, enforced
  server-side in `requireProjectAccess` via persisted `rf_memberships` rows.
- **Internal ↔ Production** — production assumed `NODE_ENV=production`, which requires
  `SESSION_SECRET`, disables dev trusted origins, and enables the Clerk proxy.

## Scan Anchors

- Production entry points: `artifacts/api-server/src/app.ts`, `routes/reviewflow.ts`
  (all `/api/reviewflow/*` routes), `routes/health.ts`.
- Highest-risk areas: `routes/reviewflow.ts` (authorization + all mutations),
  `middlewares/requestSecurity.ts` (CORS/CSRF/live-inference gating),
  `config/runtime.ts` (secret + origin resolution), `evaluation-worker.ts` (job leasing).
- AuthZ helper: `routes/authorization.ts` + `requireProjectAccess`/`ensureProject`.
- Public vs authenticated: demo mode = unauthenticated but cookie-scoped; clerk mode =
  per-user single-project ownership. No cross-project/invite endpoints exist yet
  (multi-user membership management is only a proposed, unimplemented task).
- Client keys `VITE_CLERK_PUBLISHABLE_KEY` are intentionally public; not secrets.
- Dev-only / ignore unless proven reachable: `artifacts/mockup-sandbox`
  (Canvas mockup, `/__mockup`), `*.test.ts`, `scripts/`.
- Deployment: currently **not deployed** (`isDeployed: false`).

## Threat Categories

### Spoofing / Improper Authentication

In clerk mode, `@clerk/express` validates session tokens on every request; project
role comes from a persisted membership row, not client input. In demo mode there is
no authentication by design — tenant identity is the signed `reviewflow_demo` cookie,
so the integrity of `SESSION_SECRET` (required in production) is the whole boundary.

### Tampering

Writes are gated by trusted-Origin + CSRF-header checks. Object mutations are always
scoped `WHERE project_id = <caller's own project>`, and optimistic-concurrency
`version` checks plus DB transactions guard review/audit state transitions. Task IDs,
audit IDs, release IDs from the client are only ever resolved within the caller's own
project, so cross-tenant tampering is not reachable.

### Information Disclosure

Every read route calls `requireProjectAccess` and scopes queries to the caller's
project. Blind-audit and adjudication views deliberately withhold original decisions
from the assigned auditor. No secrets reach the client. Release downloads are
project-scoped and role-gated for live releases.

### Denial of Service

The demo project bootstrap path creates a project and 20 seed tasks for a new
signed-cookie session. A PostgreSQL advisory transaction lock serializes global
admission across processes and restarts; a database count enforces a configurable
global project cap and a short-window creation throttle. Existing demo projects
are resolved before admission checks, and Clerk projects bypass anonymous-demo
limits. This bounds anonymous seeded storage growth without relying on spoofable
client IP addresses. Live evaluation concurrency is capped per project
(`MAX_ACTIVE_LIVE_JOBS_PER_PROJECT`), and provider calls have a 20s timeout.
Import and evaluate endpoints bound batch sizes and text lengths.

### Elevation of Privilege

Role checks (`owner`/`reviewer`/`adjudicator`) are enforced server-side for release,
audit, and escalation-resolution actions. Live inference and live retries require an
authenticated Clerk owner plus explicit consent. No mass-assignment of role/owner/
tenant fields is exposed (import and review payloads whitelist fields).

## Guarantees the system must uphold

- `SESSION_SECRET` MUST be set (enforced) and strong in production; it is the sole
  demo-tenant boundary.
- Every data-bearing route MUST scope queries to the caller's own project (currently upheld).
- Write requests MUST carry a trusted Origin and the CSRF header (currently upheld).
- Unauthenticated request handling MUST NOT allow unbounded resource creation
  (currently upheld for demo bootstrap by database-backed global admission limits).
