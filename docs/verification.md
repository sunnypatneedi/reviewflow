# Experimental-alpha verification

## Scope and repeatability

The supported release path is an isolated, local synthetic demo, not a hosted
private-data service. Run `APP_MODE=demo pnpm run verify:isolated` with Node
24.13.0, pnpm 10.26.1, Python 3.11+ and PostgreSQL 16 tools. The harness creates a separate
temporary PostgreSQL cluster, applies the committed migration, and removes that
cluster afterward. It never falls back to the ambient application database.

## Published alpha — confirmed

The original hardened alpha was published to
https://github.com/sunnypatneedi/reviewflow at
`c906f276fdb484b9bf8c40adaebf0f2d04bc5c3c`. Its
[GitHub verification run](https://github.com/sunnypatneedi/reviewflow/actions/runs/35527091162)
completed successfully: 34 tests passed, no failures/skips, and the synthetic
import-to-JSONL API E2E passed. Public main and that recorded CI result were
rechecked read-only before beginning the incremental Trace2Preference workload.
The earlier connector write-permission blocker is resolved.

## Trace2Preference incremental verification

On 2026-09-21, `APP_MODE=demo pnpm run verify:isolated` completed with **exit 0**
against a newly created disposable PostgreSQL cluster, which was removed
afterward. The application/user database was not used.

| Incremental check | Executed result |
| --- | --- |
| Python tests | 35 passed, 1 skipped (optional official Label Studio SDK absent) |
| Frozen-lockfile install | PASS |
| Committed original and additive trace migrations on disposable PostgreSQL | PASS |
| Explicit additive development enablement command | PASS separately on disposable data: opt-in/production/prerequisite guards, idempotence, record preservation, incompatible-schema refusal |
| Fresh declarations and canonical typechecks | PASS |
| Production builds | PASS |
| Backend tests | 44 passed, 0 failed, 0 skipped |
| Original evidence-labeling import → evaluation → correction → release → JSONL | PASS |
| Trace import → blind/assisted review → quality check → complete/training release | PASS |
| Label Studio-shaped annotation import, order reconciliation, explicit finalization | PASS |
| Nested reference-answer metadata blocked before proposal admission | PASS |

The trace API E2E checks mismatched/incomplete contexts, missing counterparts,
telemetry exclusions, duplicate/conflicting imports, all nonbinary decisions,
cross-project access, concurrent review fencing, private identifier removal,
human evidence references, and release immutability after correction. Backend
tests additionally cover mocked provider failures, lock release during outbound
requests, stale-result fencing, and expired proposal-request recovery. No paid
request was sent.

Initial integration passes exposed two stale backend test assumptions (pair
ordering and reference-field rejection rather than redaction), corrected before
the passing run. A later E2E bootstrap hit the shared synthetic-test admission
window; the isolated E2E server now explicitly allows 100 new projects per window.
Production/demo defaults remain unchanged and their cap/throttle tests still run.

The workspace log is `/tmp/reviewflow-trace-verification-final.log`. A final
sanitized-candidate rerun is recorded separately; workspace checks alone are not
a claim that a new public revision is published.

### Clean sanitized candidate: passed

The allowlisted 231-file source candidate was copied onto a separate clone of
public alpha `c906f276fdb484b9bf8c40adaebf0f2d04bc5c3c`, with no private workspace
history. From that fresh candidate, the full isolated harness passed again:
35 Python passes/1 optional SDK skip, 44 backend passes/no skips, fresh frozen
install, committed migrations, declarations/typechecks/builds, both API E2Es,
and the additive-enablement regression in its own second temporary cluster.
The candidate log is `/tmp/reviewflow-trace-candidate-verification.log`.
The final documentation records this result; no runtime source changed after
the passing candidate run.

Gitleaks 8.30.0 (official checksum-verified binary) reported zero findings in
the complete source candidate. Final incremental-commit/history scanning and
the exact published revision belong in the publication receipt; a pending
new public CI run must not be confused with the earlier alpha's success.

### Disposable browser verification: passed

A real browser exercised the separate disposable preview: import the scripted
sample, inspect blind candidates, reverse their display order, save canonical
A preference, complete the quality check, create/download complete and
preference releases, import a Label Studio-shaped returned annotation, confirm
it, recheck quality, then correct the review to a tie. The prior release remained
unchanged. The original evidence-labeling `/review` page also rendered.

Assisted reveal and the other nonbinary outcomes were not separately exercised
in this browser pass; their API/backend mechanical checks passed. Browser
annotations and reviews were scripted verification actions, not independent
human participants. No paid provider or real private trace was used.

The browser produced tool-only image evidence; no filesystem screenshot of the
new trace page was available for publication. The README therefore retains and
explicitly captions the real synthetic screenshot of the original evidence
workflow. It is not represented as a Trace2Preference capture.

### Existing development workspace enablement (not verification)

After reviewing the additive command and its separate disposable checks, the
operator explicitly ran `enable-traces.mjs --confirm-additive-trace-schema`
against the development workspace. It created/validated the new trace
table/index without modifying existing application records; the API/frontend
processes were refreshed. This was feature enablement, **not** testing against
user data. All automated verification and browser test data remain disposable.
The original migration runner's disposable-only safeguard was not bypassed.

### Optional SPEAR capture: executed

`scripts/spear-capture.mjs` ran against unmodified upstream
`sunnypatneedi/spear` revision `ff300b3f9cfda7cf1f58fea9794d7174447202a6`.
Frozen-lockfile installation and the core build passed. The initial configured
package mirror returned 403 for a dev dependency; retrying the same frozen
lockfile with the public npm registry succeeded.

The capture executed benign local pre/post guards and an inert policy-rejection
check, with fetch/HTTP/TCP disabled. It emitted two actually executed scripted
responses and one partial telemetry record. Python validation passed: one
eligible scripted comparison and one excluded record with context-incomplete,
counterpart-missing, response-missing, and telemetry-only reasons.
The captured JSON SHA-256 was
`02ada766921e4b5be8fb83f78ed1e64b7a25c2d32707200968d41a97a633b085`.
Upstream tracked files remained unchanged. This is not a real model run,
production capture, independent human review, or benchmark-quality claim.

## Initial executed results — 2026-09-20 (historical)

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
verification results. No available separate black-box pentest report establishes
independent clearance.
These safeguards do not make an anonymously hosted demo production-ready;
operators still need retention and broader request/resource limits.

## Explicit skips and limitations

- Live Jev connectivity and quality: **NOT TESTED**; no paid inference performed.
- Hosted Clerk sign-in and real multi-user team operation: **NOT CERTIFIED**.
  Authorization checks are tested with synthetic identities and persisted
  membership fixtures, not real hosted accounts.
- Audit/dispute logic has tests; a complete multi-user browser audit workflow is
  not claimed verified.
- Incremental Trace2Preference public CI: pending publication of its verified
  incremental source; the earlier alpha CI is not evidence for this new code.
- Production deployment and real-user testing: deliberately not performed.
  The separate additive development-schema enablement above is not production
  deployment or verification using the user's database.
- SPEAR real-model/production capture: **NOT TESTED**. The local scripted
  exercise above does not supply genuine model or human data; telemetry alone
  remains partial and excluded from preference training.
- Label Studio running-server compatibility and genuine human study results:
  not established by JSON-shape mechanical tests alone.

Secret detection and license metadata checks reduce risk, but do not establish
exhaustive security or legal clearance. See [source review](source-review.md)
and [third-party notices](../THIRD_PARTY_NOTICES.md).