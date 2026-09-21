# Architecture, tradeoffs, and limitations

## Implemented shape

ReviewFlow is a pnpm workspace with a TypeScript application and a Python
standard-library trace-processing component:

- `artifacts/reviewflow`: React 19, Vite, Tailwind CSS, Wouter, React Query
- `artifacts/api-server`: Express 5 API plus a separately run evaluation worker
- `lib/db`: PostgreSQL schema and committed migrations using Drizzle ORM
- `lib/api-spec`, `lib/api-zod`, `lib/api-client-react`: OpenAPI contract,
  generated validation types, and browser client
- `scripts/same-origin-proxy.mjs`: local proxy that keeps browser UI and API
  traffic on one origin
- `python/trace2preference`: CLI/library validation and reproducible dataset
  processing used by the Trace2Preference API, also usable outside ReviewFlow

The worker claims queued rows with PostgreSQL locking and leases, performs
provider work outside the transaction, and fences writes against the current
lease. Proposals and releases are persisted; task reviews use optimistic
versions to reject stale decisions.

## Why this stack

A TypeScript graph keeps the original API contract, generated client, server,
and UI types close together. The trace workload's explicit versioned JSON
contract separates portable Python processing from access-controlled API
transactions. PostgreSQL supplies the transactions, uniqueness
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

## Trace2Preference case study

The workload is additive: existing evidence tasks, review queues, provider
jobs, audit controls, and releases keep their original routes. Trace imports
and preference judgments use separate project-scoped storage and a dedicated
screen. Python supplies a reusable validation/export contract rather than
replacing the TypeScript application.

The central safety decision is to compare actual responses only at a selected
decision point with known identical model-visible context. Context includes
ordered messages, tools, parameters, and extension fields; matching scenario
names or questions does not establish equivalence. Importer-declared
completeness remains an assertion, not independently proven capture completeness.
Unknown context, telemetry-only runs, absent counterparts, and unsupported
comparisons remain inspectable but cannot enter preference-training exports.

Reviews begin blind to identities and proposals. Explicit reveal is separately
recorded as assisted review. Canonical side IDs, rather than screen positions,
bind decisions; optimistic versions prevent stale and competing writes.
Six outcomes preserve ties, unacceptable pairs, uncertainty, and escalation.
Quality checks gate training inclusion instead of silently converting excluded
records into preferences. Corrections create a newer decision state without
rewriting existing release snapshots.

The complete export retains evidence and exclusion reasons; the narrower
training export contains only directional, eligible, human-finalized examples.
Related group IDs determine splits together. Structured identity removal and
pseudonymization are not arbitrary-text anonymization: authorized source text
must receive a privacy review before sharing.

Python also supplies Label Studio task/configuration interchange, preserved
candidate mappings, nonbinary reconciliation, deterministic study assignments,
and condition-separated timing analysis. Those are instruments awaiting real
human data, not measured productivity gains. See [study protocol](trace-study.md)
and [executed verification](verification.md) for compatibility boundaries.

## What this is not

- Not a production-ready labeling service or compliance control
- Not an accuracy benchmark; independent accuracy remains unavailable without
  a genuinely independent completed audit
- Not a replacement for SPEAR or a live-model SPEAR evaluation; the optional
  pinned upstream exercise uses local middleware and scripted responders only
- Not evidence that Jev has been live-tested
- Not a claim that generated confidence equals correctness

The intended release description is therefore narrow: an experimental local
synthetic demo of evidence labeling and trace-to-preference review with
model-proposal, human-review, quality-check, and immutable dataset-export
workflows. Live provider quality, genuine reviewer behavior, independent audits,
and production operations remain outside the evidence demonstrated here.