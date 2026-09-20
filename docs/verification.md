# Experimental-alpha verification

## Scope and repeatability

The supported release path is an isolated, local synthetic demo, not a hosted
private-data service. Run `APP_MODE=demo pnpm run verify:isolated` with Node
24.13.0, pnpm 10.26.1 and PostgreSQL 16 tools. The harness creates a separate
temporary PostgreSQL cluster, applies the committed migration, and removes that
cluster afterward. It never falls back to the ambient application database.

## Initial executed results — 2026-09-20

The complete workspace verification exited successfully:

| Check | Result |
| --- | --- |
| Frozen lockfile dependency installation | PASS |
| Committed migration on a disposable PostgreSQL 16 cluster | PASS |
| Fresh shared declarations (old outputs removed) | PASS |
| Canonical root typecheck | PASS |
| Production builds | PASS |
| Backend tests | PASS: 30 tests, zero failures |
| API end-to-end import → queued demo proposal → correction → release → downloaded JSONL | PASS |
| Dependency vulnerability scan | PASS: zero reported findings |
| Static analysis | PASS: zero reported findings |
| Privacy/dataflow scan | PASS: zero reported findings |

Race tests include identical/conflicting imports, simultaneous review
submissions, finalized-task protection, cross-project rejection, competing
audit decisions/adjudications, atomic live-queue limits, expired/recovered worker
leases, late provider results, and repeated enqueue. Permission tests exercise
the owner/reviewer/adjudicator matrix and invalid memberships. Request tests
exercise CORS, Origin/CSRF checks, demo isolation configuration, and live gates.
Provider transport tests mock success/failure responses, retryable failures,
invalid typed results and probability bounds. Mocks do **not** prove model
quality or live connectivity.

## Failures found and corrected during preparation

- The previous test glob omitted root-level worker tests; it now includes them.
- A final-attempt lease-expiry case initially left a job running; corrected.
- Browser verification initially found a repeated-enqueue empty insert error and
  missing job-query invalidation. Both were fixed, and regression coverage added.
- A source review found raceable live admission and competing audit mutations;
  transaction locks and conditional writes now have deliberate race tests.

Earlier passing tests and the historical audit are not substituted for this
release's verification. The distributed candidate receives an additional clean
install/build/test pass; the accompanying release receipt records its exact
commit and archive checksum.

## Anonymous-demo admission hardening

A subsequent security review found unbounded anonymous project creation despite
the initial scanners reporting no findings. Creation now uses a PostgreSQL
transaction and shared advisory lock, with a persistent global project cap and
short-window creation limit. Existing sessions remain usable at either limit.
Capacity and throttling errors are explicit and visible in the overview.

Regression coverage includes concurrent admission, atomic seed creation,
database-backed limits, HTTP 429/503 mapping, Retry-After, and existing-session
access. The accompanying release receipt records the updated candidate's full
verification results. The separate black-box pentest is pending input, not passed.
These safeguards do not make an anonymously hosted demo production-ready;
operators still need retention and broader request/resource limits.

## Explicit skips and limitations

- Live Jev connectivity and quality: **NOT TESTED**; no paid inference performed.
- Hosted Clerk sign-in and real multi-user team operation: **NOT CERTIFIED**.
  Authorization checks are tested with synthetic identities and persisted
  membership fixtures, not real hosted accounts.
- Audit/dispute logic has tests; a complete multi-user browser audit workflow is
  not claimed verified.
- GitHub-hosted CI, anonymous repository readability and rendered README:
  pending successful GitHub publication.
- Production deployment, existing-database migration and real-user testing:
  deliberately not performed.
- Trace2Preference and SPEAR: not implemented.

Secret detection and license metadata checks reduce risk, but do not establish
exhaustive security or legal clearance. See [source review](source-review.md)
and [third-party notices](../THIRD_PARTY_NOTICES.md).