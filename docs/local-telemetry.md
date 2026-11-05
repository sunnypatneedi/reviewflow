# Local telemetry and measurement boundaries

No hosted monitoring service is required. Migration 0009 adds a PostgreSQL outbox,
a projection, and metadata-only browser events. The API and worker use the same
local database; browser telemetry sends only to the same-origin API.

## Delivery and recovery

Every new `rf_events` row creates an outbox row in its original transaction through
a database trigger. Existing events are backfilled by the migration. Rollback
removes both. The projection stores only event ID, project, event type and time,
not the potentially sensitive source event payload. Do not add a wholesale payload
copy to this path.

The worker processes up to 20 projects per five-second pass and 1,000 events per
project. Each statement has a two-second timeout. PostgreSQL `FOR UPDATE SKIP
LOCKED` row locks act as short transaction leases: rollback/disconnect releases
them. Projection insert and delivery acknowledgement commit atomically. Stable
primary keys prevent duplicate counts on retries. There is no timestamp watermark,
so an older event committed late remains deliverable. The observability refresh
also drains one bounded project batch, then reports remaining backlog.

If the worker stops or a query fails, events remain pending. Restart the normal
worker and refresh Observability; pending should decline. Delivered means committed
to the local projection, not exported to another service. There is no external
export destination. Outbox and projection are retained; no automatic purge is
implemented, so normal database backup and capacity planning apply.

## Browser delivery

A same-origin context endpoint supplies an opaque project-and-actor scope,
including for the default anonymous local project. Ingestion verifies this scope
against the current server identity and rejects actor changes. Queues from a former
actor are never replayed under a new actor's scope.

Each session has a random ID, monotonic sequence and stable event IDs. IndexedDB
commits and deletes individual events, making retries and multi-tab acknowledgement
safe. Delivery is acknowledged only after the database transaction commits.
Identical retries are accepted; conflicting event IDs or session sequence values
reject the entire batch with HTTP 409. Invalid fields reject HTTP 400. Storage or
network failures never block reviews. An in-memory queue provides best-effort
fallback when IndexedDB is unavailable.

The local queue is bounded to 2,000 events per project-and-actor scope and 200
in-memory events per mounted item. Server batches contain at most 50 events.
Overflow can create sequence gaps. Entirely lost/evicted sessions are unknowable.
The dashboard distinguishes gaps, reported dropped events and sessions without a
terminal close event. Gaps can fill when delayed events arrive; a close event is
not proof of complete delivery. Browser termination can interrupt the final flush.

Metadata includes a factory, opaque item/proposal identifiers and item version when
the page has one. Null means unavailable: audit-page timing is currently audit-level,
and preference proposal identity may be unavailable. `asset_loaded` means the
item's React view committed, not that external media finished downloading.
No labels, input text, model responses, source text, URLs or credentials are captured.

## What the numbers establish

- Foreground presence accrues while the page is visible and focused, including
  reading or watching without clicks. Each interval is capped at 15 seconds to
  bound timer suspension. Parallel tabs/windows may overlap. This is client-reported
  presence, not verified attention, billable labor or total human effort.
- Browser events never determine permissions, blinding, exposures, release gates,
  independent accuracy or treatment assignment. Existing server gates remain
  authoritative. A client can fabricate telemetry; do not use it as quality proof.
- Instrumented lifetime attempt starts count retained `evaluation.attempt.started`
  server events. They survive job requeue counter resets but do not reconstruct
  pre-instrumentation attempts, external provider billing or calls outside this path.
- Time-to-first-release measures current task creation to the first retained release
  containing its current content hash. The denominator is matched task observations,
  excludes unreleased tasks, and the p95 uses nearest rank. It is not a project-wide
  service-level objective or a causal improvement estimate.
- Generic-rubric counters describe current item state and retained release records.
  Reviewed is not equivalent to an independent pass or release eligibility.
- Complete monetary cost, verified human quality, baseline improvement and total
  human effort remain unavailable. No prices or quality estimates are invented.
