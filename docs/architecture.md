# Architecture and tradeoffs

## System shape

- **React/TypeScript web app:** desktop-first import, queue, review, audit, release, and settings surfaces.
- **Express/TypeScript API:** OpenAPI-first endpoints, Clerk session verification, signed anonymous demo isolation, provider adapter, and transactional state changes.
- **PostgreSQL/Drizzle:** projects, memberships, rubric versions, tasks, jobs, immutable proposals, reviews, audits, releases, and append-only events.
- **Generated client:** Orval generates React Query hooks and Zod schemas from the OpenAPI contract.

The repository uses the workspace's TypeScript server rather than a separate FastAPI service. This keeps one generated contract and one runtime dependency graph in the available environment. The provider adapter, queue records, and persistence boundaries remain replaceable.

## Trust boundaries

Imported question, evidence, and candidate answer are untrusted data. The server never executes embedded instructions or fetches imported links. Model rubric instructions are authored separately. Reference labels remain server-side and are used only to make the deterministic demo intentionally imperfect.

Anonymous users receive an HTTP-only signed demo-session cookie and can mutate only their own synthetic project. Live calls require a verified Clerk identity, explicit owner consent, and a bounded batch. Project membership records provide the persistence model for owner, reviewer, and adjudicator authorization; production expansion should make role checks explicit middleware on every live endpoint.

## State and immutability

Tasks use optimistic versions. A stale review receives `409` instead of overwriting a newer decision. Proposals are insert-only and deduplicated by task and mode. Reviews preserve actor, timestamp, proposal, task version, correction reason, evidence excerpt, and measured active time. Releases store their final JSONL, manifest, source hashes, model/rubric/policy versions, and content digest; they have no update route.

State changes and audit events share database transactions. Provider network requests occur outside transactions.

## Queue and retries

Evaluation requests enqueue one deduplicated job per task and mode. The separately supervised evaluation worker claims one available row with `FOR UPDATE SKIP LOCKED`, increments its attempt count, and sets a short lease in a transaction. It then loads the task and performs the provider call outside the transaction. A worker restart leaves the row recoverable after the lease expires.

Successful proposal insertion, task status transition, and the worker event are committed together. The proposal's task/mode unique key makes a late result from an expired worker harmless: only one decision is stored. Jobs have three bounded attempts; an expired final lease becomes terminally failed instead of remaining stuck in `running`.

Only rate-limit and transient provider responses are retried. `429` and `529` schedule the next claim no earlier than the provider's `Retry-After` value; exponential backoff is used when no value is supplied. Authentication failures, invalid requests, malformed provider responses, and exhausted retries are terminal. Provider retries may repeat provider charges even when result storage is deduplicated.

## Metrics

Queue counts, proposal coverage, corrections, measured active review time, and request latency come from stored records. Confidence and chosen-label probability are not described as accuracy. Independent accuracy is `null` until a genuinely independent blind audit exists. Savings remain unmeasured without a baseline.

## Deferred production hardening

- Add explicit membership/role middleware to all live, audit, adjudication, and export routes.
- Add reproducible blind-audit creation/adjudication endpoints and enforce required-audit policies.
- Add a PostgreSQL integration test database and mocked provider transport matrix.
