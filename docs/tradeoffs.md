# Architecture, tradeoffs, and limitations

## Implemented shape

ReviewFlow is a pnpm workspace built in TypeScript:

- `artifacts/reviewflow`: React 19, Vite, Tailwind CSS, Wouter, React Query
- `artifacts/api-server`: Express 5 API plus a separately run evaluation worker
- `lib/db`: PostgreSQL schema and committed migrations using Drizzle ORM
- `lib/api-spec`, `lib/api-zod`, `lib/api-client-react`: OpenAPI contract,
  generated validation types, and browser client
- `scripts/same-origin-proxy.mjs`: local proxy that keeps browser UI and API
  traffic on one origin

The worker claims queued rows with PostgreSQL locking and leases, performs
provider work outside the transaction, and fences writes against the current
lease. Proposals and releases are persisted; task reviews use optimistic
versions to reject stale decisions.

## Why this stack

A single TypeScript graph keeps the API contract, generated client, server, and
UI types close together. PostgreSQL supplies the transactions, uniqueness
constraints, and row locking needed for review and worker state. The cost is a
multi-process local setup and a hard dependency on PostgreSQL semantics; this
is not a static frontend or embedded-database application.

The small Node proxy is intentionally development-oriented. It avoids separate
browser origins without folding the Vite server, API, and worker into one
process. Production deployment, supervision, TLS, backups, observability, and
horizontal scaling are outside this repository's demonstrated scope.

Both web artifacts use system font stacks and standard Vite plugins. Optional
Replit development overlays and cartography were removed because they were not
needed for application routing or the mockup preview route; the application,
same-origin proxy, and preview plugin remain platform-portable.

## Authentication and authorization

`APP_MODE=demo` is the default when Clerk keys are absent. It creates an
isolated synthetic project identified by a signed cookie and blocks live
inference. This is convenient for local evaluation, but it is not an identity
system and should not hold sensitive or multi-user data. Anonymous project
creation has a database-backed global capacity and short-window throttle;
existing sessions remain usable at capacity. This bounds seeded storage growth
but intentionally means a public demo can become unavailable to new visitors
until capacity is freed.

Optional Clerk mode verifies identities and the database stores owner,
reviewer, and adjudicator memberships. Current routes apply role checks to
review, escalation, audit, release, and live-evaluation actions. That code is a
useful shared-role prototype, not proof of production readiness: it has not
received an independent penetration test or security certification, and the
repository does not provide organization lifecycle, invitation, offboarding,
or deployment policy.

## Evaluation choices

The demo evaluator is deterministic and synthetic. It intentionally makes some
mistakes so the human workflow can be exercised. Its probabilities, latency,
complexity, and model identifier are simulated and must not be interpreted as
quality measurements.

An adapter for the hosted Jev service exists and validates typed choices,
probability bounds, redirection probability, and an anchored complexity score.
Live requests are opt-in, authenticated, owner-consented, bounded by worker
retry policy, and never fall back to demo output. However:

- no live Jev call is claimed to have passed for this release;
- connectivity, billing behavior, provider contract drift, and judgment
  quality remain unverified here;
- provider retries can repeat billable requests even though database writes
  are deduplicated; and
- Jev is a third-party hosted product, not code distributed by this repository.

## What this is not

- Not a production-ready labeling service or compliance control
- Not an accuracy benchmark; independent accuracy remains unavailable without
  a genuinely independent completed audit
- Not an implementation of Trace2Preference
- Not an implementation or live evaluation of SPEAR
- Not evidence that Jev has been live-tested
- Not a claim that generated confidence equals correctness

The intended release description is therefore narrow: an experimental local
synthetic demo of model-proposal, human-review, audit, and versioned-export
workflows.