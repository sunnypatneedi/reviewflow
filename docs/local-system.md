# Local system and verification contract

ReviewFlow is a local review application, not a claim to implement every possible
architecture or the newest algorithm. Its design favors explicit trust boundaries,
durable state, human decisions and reproducible evidence over additional services.
This document describes the implemented scope and remaining gaps.

## Pipeline and design choices

The evidence and preference factories share versioned routing policies, work
claims, quarantine and role checks. The path is configure → import → assign →
review → adjudicate when required → quality/audit → frozen release. Evidence has
independent blind audit and adjudication gates. Preference has context eligibility,
explicit human preference and quality attestations; its quality check is **not**
an independent human audit. The generic rubric factory supports immutable rubric
revisions, scored/option criteria, human decisions, independent audit and
adjudication gates, and digest-checked releases. See [rubric workflow](rubric-factory.md).

- React/TypeScript provides the local browser UI. Express handles API and WebSocket
  traffic. PostgreSQL is the single authoritative store. A separate worker claims
  persisted jobs. Python standard-library tools validate and export trace data.
- Content/context hashing and stable grouped splits preserve identity and avoid
  accidental comparison or train/test group mixing. Missing context is retained
  and excluded rather than invented. Nonbinary preference outcomes remain visible.
- Optimistic task versions, transactional locks and expiring fenced claims reject
  stale/competing work. PostgreSQL `FOR UPDATE SKIP LOCKED` leases recover queued
  jobs. Retries are bounded; deduplicated storage does not imply free provider retries.
- Authorization, privacy, eligibility, protected lanes and release gates are
  deterministic. Optional model advice never accepts, finalizes or releases work.
  Server/project opt-in and current outbound grants are required before live calls.
- Blind-exposure records, current membership checks and independent-audit guards
  prevent assistance or shared notes being mistaken for blind review. Yjs merges
  shared **notes**, not source evidence or final labels. One API process is the
  supported collaboration topology.
- Releases freeze bytes, digest and provenance. Subsequent corrections do not
  rewrite old releases. Audit/adjudication lineage is checked when new evidence
  releases are cut.
- The Jev adapter validates typed responses and bounded payloads. Native five-level
  Score is fractional 0–4; the existing app complexity scale is explicitly native
  score + 1, stored fractionally. Simulations remain clearly labeled. No OpenAI
  adapter or live-provider performance claim is included.

This modular monolith avoids an unnecessary queue service, event bus or cluster
orchestrator for a local app. State changes and audit events are transactional.
A PostgreSQL outbox projects metadata locally with idempotent delivery and recovery;
there is no external telemetry destination. A bounded IndexedDB browser queue
retries stable event IDs and exposes partial-delivery indicators. See
[telemetry boundaries](local-telemetry.md).

Evidence and preference evaluation identity now binds project, item and immutable
snapshot, question version, context preparation version, requested model, and
experiment run. Exact identity can reuse persisted results. Changing an experiment
run creates a distinct evaluation; old history is retained. Public APIs accept
only implemented question/context/model versions, not arbitrary model labels.
Legacy evaluations remain marked as unknown provenance. This is not a general
model marketplace or evidence of comparative model quality.

## Observability with honest denominators

`/observability` is a project-scoped aggregate snapshot. Refreshing it may drain a
bounded local telemetry-projection batch; it does not change review decisions. Owners/adjudicators without
active blind assignments can inspect it. Responses contain aggregate values, not
source text, labels, provider responses, account IDs or claim tokens. Reads use a
consistent transaction, per-statement timeout and explicit row cap; exceeding the
cap fails instead of silently sampling.

Evidence counts distinguish current tasks/assignments, review events, included
declared-independent audit decisions, disputes and distinct released content.
Preference counts distinguish finalized decisions, quality attestations and
distinct released comparison IDs. Rubric counts separate imported, reviewed,
audited, quarantined and released items. These stages have different units; they are not
a conversion funnel or independently proven accuracy.

The dashboard shows queue states, delayed work, retries and expired/missing leases,
plus separate live-measured and demo-simulated proposal latency and recorded tokens.
Retry counters describe current job attempt cycles; manual requeue resets them.
A separate retained event count reports instrumented attempt starts, but cannot
recover attempts before instrumentation or external billing.
It is not a historical alerting/uptime system. Database reachability at snapshot time
does not prove worker or provider health. Local launch readiness checks the actual
owned API and worker separately.

Recorded evidence review time is client-reported, not all human effort. Audit,
adjudication, rework outside submitted review events, full preference effort and
all compute/tool/infrastructure/human costs are not comprehensively captured.
Total labor, cost per accepted item, independent quality and baseline improvement
therefore remain N/A. Cohort labels are recorded assistance provenance, not a causal
experiment. Time-to-first-release p50/p95 covers matched current-content tasks
that have a retained release and excludes unreleased items; it is not an all-task
SLA. Language/risk slice quality and human reference studies remain unqualified,
not values to infer from the simulator.

## One local verification gate

After installing prerequisites/dependencies, install the test browser once:

```sh
pnpm --filter @workspace/scripts exec playwright install chromium
pnpm run verify:local
```

The gate runs prerequisite checks, fresh isolated schema/type/build/unit/integration
and API journeys, owned-database crash recovery, synthetic browser/accessibility
journeys, actual disposable launcher startup/duplicate-launch/cleanup and durable
local initialization/restart/session/release-byte preservation. Each database and
managed test workspace is newly created with synthetic data. Ambient database and
provider overrides are discarded. A failure marks subsequent stages not-run.
A JSON result is written outside the source tree.

CI is configured to run the same gate on Ubuntu. Configuration is not a successful
remote run. Native macOS execution does not prove Windows support or a virgin-machine
download/install. Dependency/browser caches may be reused. Docker Compose is not
yet a supported path. Automated axe checks and selected keyboard journeys do not
replace screen-reader/manual accessibility or user studies.

For a clean committed source artifact, use a trusted installed gitleaks binary:

```sh
REVIEWFLOW_GITLEAKS=/path/to/gitleaks pnpm run verify:candidate
```

This verifies committed/staged/extracted file identities, scans and packages the
exact commit, then runs **the complete local gate from the extracted archive**.
The receipt records revision, archive digest and scope. It does not publish.

## Local usage boundary

The [durable workspace](local-workspace.md) needs no hosted auth or provider key.
It owns a private password-authenticated loopback database and never silently
resets or upgrades existing durable data. Browser identity recovery, backup/restore,
relocation and schema upgrades are not automated. Keep the same browser/hostname,
matching source release and an offline backup. The disposable trial is separate.

Real team authentication, independent human reference studies and live provider
qualification require separate evidence when those features are used. Hosted TLS,
distributed limits, monitoring and production recovery are not prerequisites for
a synthetic single-user local trial, and this local gate does not certify them.
