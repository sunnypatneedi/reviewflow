# Trace2Preference API contract

All routes are beneath `/api/reviewflow/traces`, use the existing signed demo session
or authorized Clerk project, and return JSON errors `{error: string}`. Existing
evidence-labeling routes remain unchanged. Imported strings must render as inert text.

- `POST /imports` body `{document: {schemaVersion:1,runs:[...]}}` invokes the Python
  validator. Returns `{imported: number, comparisons: number, issues: [...]}`.
  Identical run IDs/content are idempotent; conflicting duplicate IDs return 409.
- `GET /comparisons` returns an array of comparison objects.
- `GET /comparisons/:id` returns one comparison object.
  Comparison: `{id,scenarioId,groupId,task,context,contextHash,a,b,eligible,reasons,
  version,review:null|{decision,evidenceRefs,effort,assisted,createdAt},
  quality:{status:"passed"|"pending"|"failed",note:string},revealed:boolean}`.
  Candidates contain `{runId,response,events,provenance}`. Candidate identities and
  model proposals are hidden until the current reviewer explicitly reveals them.
  Stable `a` and `b` keys are canonical identities, not screen positions.
- `POST /comparisons/:id/reveal` body `{}` records an assisted reveal for the
  current reviewer and returns the comparison including `candidateIdentity` and
  `proposal` (if any). Revealing does not reverse or rewrite a previous judgment.
- `POST /comparisons/:id/reviews` body `{decision,expectedVersion,evidenceRefs:[],
  effort?:{activeMs?,waitingMs?,correctionMs?,auditMs?}}`; decisions are `a`, `b`,
  `tie`, `both_unacceptable`, `insufficient_evidence`, `escalate`. Returns updated
  comparison. Stale versions return 409. Missing effort is unavailable, not zero.
- `POST /comparisons/:id/quality` body `{status:"passed"|"pending"|"failed",
  note,expectedVersion}`; owner/adjudicator only. Returns updated comparison.
  New comparisons require this explicit quality check before training export.
- `POST /comparisons/:id/proposals` body `{provider:"simulator"|"jev",consent?:true,outboundReviewed?:true}`.
  Returns `{available:true,provider}` without exposing the proposal. Simulator is
  no-key and explicitly simulated. Jev requires opt-in server configuration,
  authorized signed-in project, explicit outbound consent and separate confirmation
  that the actual text was reviewed for private data; it is off by default.
- `GET /releases` returns `[{id,name,createdAt,itemCount,trainingCount}]`.
- `POST /releases` body `{name}` returns release metadata. Snapshots are immutable.
  Complete export retains excluded records and reasons; unresolved/failed checks
  exclude affected examples from preference training, not from the evidence record.
- `GET /releases/:id/download?format=complete|preference` downloads JSON (complete)
  or JSONL (directional preference training). Complete includes inclusion/exclusion
  reasons and all nonbinary outcomes; training includes only context-eligible,
  human-finalized `a`/`b` judgments with passed quality checks. Related group IDs
  deterministically share splits. Private identity fields are removed.

Review version changes on judgment and quality updates. Display-order toggles must
submit canonical `a`/`b`, never visual left/right. No paid evaluation is executed
by verification. Model proposals are never human decisions.

Additional kit/instrumentation endpoints:

- `POST /labelstudio/reconcile` body `{annotations: [...Label Studio exported tasks],
  expectedVersions: {"comparison-id": 3}, reviewMode:"human_only"|"model_assisted"}`.
  Here reviewMode selects the downloaded kit condition; actual assistance is
  determined from the returned recorded reveal, not asserted by the uploader.
  Server regenerates the canonical manifest from private current runs (never trusts
  a client-supplied display mapping), validates exported task data, maps all six
  outcomes, and version-fences every affected comparison. Returns `{pending,issues}`.
  Repeated annotation batches return 409. Accepted records appear as
  `pendingAnnotation:{decision,reviewMode,importedAt}` and do not replace or finalize
  the current review; training is blocked until explicit confirmation.
- `POST /comparisons/:id/confirm-labelstudio` body `{expectedVersion,evidenceRefs:[],
  effort?:{activeMs?,waitingMs?,correctionMs?,auditMs?}}`; owner/adjudicator only.
  Confirms the pending canonical outcome as a Label Studio-interface judgment,
  preserving declared assistance mode. It increments version and resets required
  quality checks. A second confirmation fails; stale submissions return 409.
- Quality request additionally accepts `effort:{auditMs?,waitingMs?}`. Measurements
  are safe integer milliseconds (maximum seven days), null when unavailable.

- `GET /labelstudio?condition=human_only|model_assisted`: authorized owner/adjudicator
  downloads `{config,tasks,manifest}`. Defaults human-only. Assisted config starts
  with a conditional reveal; its raw task JSON contains proposal data and is not a
  security boundary. Never distribute private manifest metadata to reviewers.
  Reconciliation uses the included Python `reconcile` command; annotations are
  staged by the reconciliation route and never silently accepted as final judgments.
- `GET /analysis`: authorized owner/adjudicator receives Python condition summaries,
  separating interface and assistance mode, measured active/correction/audit/waiting/
  service timing, and explicitly unavailable accuracy/agreement/savings.

Trace proposals use synchronous bounded requests, not durable background jobs.
Short project-locked reservations expire after 30 seconds; external I/O occurs
outside the lock. Completion requires the same request token and review version.
Expired requests recover on retry; stale/competing results cannot overwrite reviews.
Provider failure leaves no proposal committed and never triggers simulation.
`TRACE_ALLOW_LIVE_JEV=true` is necessary but insufficient: the existing live-inference
server flag, Clerk authorization, live project mode, explicit consent, and configured
credentials are also required. Live calls were not made during implementation.
Shareable releases pseudonymize structured identities/provenance, but the required
privacy check must inspect actual free text before sharing; response text is never
silently rewritten. Complete records include canonical review history, anonymous
reveal timestamps, quality status, and separately typed model proposals.

## Existing development workspace opt-in

New disposable databases continue to use the unchanged guarded migration runner.
An already-running **development** workspace may lack only the additive trace table.
After the operator confirms that DATABASE_URL is its existing development database:

```sh
node lib/db/scripts/enable-traces.mjs --confirm-additive-trace-schema
```

This explicit command validates the existing public.rf_projects prerequisite and,
inside a transaction/advisory lock, creates only the missing rf_trace_records table
and its unique index. It validates compatibility on repeated runs and never alters,
deletes, or rewrites existing records or migration history. It does not print
connection strings. It refuses NODE_ENV=production and Replit deployment execution.
Do not call it at app startup or in deployment hooks; managed production schema
changes belong to the Replit Publish flow. Do not falsify disposable migration flags.

Its standalone regression command uses only a newly created disposable cluster:

```sh
sh scripts/with-isolated-postgres.sh node lib/db/scripts/enable-traces.test.mjs
```