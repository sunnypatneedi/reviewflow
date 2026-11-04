# Factories and lanes — first implementation milestone

This branch implements the first factory milestone on top of the independently
reviewed release-integrity changes at `ed644e8`. It is a local synthetic-data
prototype. It has not been merged or deployed.

## Working behavior

- **Evidence and preference factories share one policy engine.** Versioned,
  append-only policy records configure assistance, required claims, declared
  high-risk routing, and confidence/redirection thresholds. Revision zero is the
  documented default. Unknown policy fields, including automatic acceptance and
  weakened audit requirements, are rejected.
- **Factories & lanes screen:** queue counts, routing explanations, policy
  editing, claim/renew, quarantine/resolve, and evidence review. Pending evidence
  can receive a human label without first generating a model proposal. Assigned
  evidence audits appear in the blind-audit lane and open the existing audit UI.
  Preference review continues in Trace2Preference.
- **Claims:** 1–15 minute leases with actor-scoped fencing tokens. Renewing,
  reassigning, or quarantining revokes the old token. Active claims exclude other
  actors even when claims are optional. Explicit owner reassignment requires the
  current control revision and a current persisted member as the assignee.
  Completed preference comparisons can be reclaimed for quality checks or
  corrections. Source-task versions still reject stale decisions.
- **Quarantine:** owner reason required; blocks evidence and preference review,
  assistance generation/reveal, audit decisions/adjudication, new releases, and
  preference Label Studio kit export. Late evaluation responses recheck the
  control and assistance policy before committing. Existing frozen releases
  remain byte-for-byte unchanged and downloadable by authorized project users.
- **Provenance:** human-only evidence has no invented model or proposal ID.
  Existing proposals conservatively retain assisted provenance. Human decisions
  record their factory policy revision; release manifests retain the current
  policy snapshot. Preference histories retain their decision-time revisions.
- **Privacy:** evidence source text remains excluded by default. Including it
  requires explicit actual-text privacy review confirmation, recorded in the
  manifest. Live evidence evaluation/retry also requires outbound-text review
  confirmation in addition to existing server opt-in, authentication and owner
  consent. No live requests were made during implementation.
- **Release integrity:** the existing independent audit policy, immutable audit
  sampling frame, correction lineage and adjudication-to-export validation remain
  mandatory. Policies cannot turn proposals into final decisions.

## API and storage

`GET /api/reviewflow/factories/{evidence|preference}` returns policy, routing,
counts, control revisions and only the requesting assignee's claim tokens. The
queue contains no proposal labels or candidate identities.

`POST .../policy` requires `expectedRevision` and a complete `definition`.
`POST .../items/{id}/claim` requires `expectedVersion`, with optional `minutes`,
`claimToken`, and owner-only `assignedTo`/`reassign`. Reassigning another active
assignee also requires `expectedRevision`. `POST .../items/{id}/quarantine`
requires `expectedRevision`, `quarantined` and `reason`.

Evidence `POST /reviews` accepts `action: "label"`, `correctedLabel`, a reason,
measured `activeMs`, and the current `claimToken` when applicable. Preference
mutation endpoints use the same claim-token field; reconciliation accepts a
`claimTokens` map by comparison ID. The web preference client retrieves the
requesting actor's current token from the factory queue.

Migration `0003_factories.sql` adds policy/control tables and permits null proposal
IDs for human-only evidence reviews. OpenAPI, generated React client and generated
validators are updated. Use the repository's disposable-database migration harness;
no production migration was attempted.

## Verification

Executed using Node 24.22.1 and an isolated PostgreSQL 16.11 cluster:

- `sh scripts/verify-isolated.sh`: 36 Python tests (one optional SDK check
  skipped), 64 server tests, 8 frontend tests, schema/migration preservation
  checks, TypeScript checks, production builds, evidence API E2E and preference
  API E2E.
- New regression coverage includes policy races, lease renewal/expiry, stale
  tokens, cross-project denial, simulated member roles and explicit reassignment,
  token privacy, human-only release provenance, quarantine gates, late worker
  results, and preference review/quality reclaims.
- Independent review identified and the implementation corrected two edge cases:
  proposal-dependent correction requests now fail before mutating a proposal-less
  task, and high-risk policy lanes require primitive strings rather than coercible
  values. Regression checks cover both cases.
- Local Chromium browser smoke: human-only decision, claim/renew, quarantine and
  export rejection, hold resolution, policy revision, required-claim rejection and
  successful resubmission, preference empty state, desktop/mobile layout and zero
  page errors. External requests were blocked. Captures are in
  `screenshots/reviewflow-factories.png` and
  `screenshots/reviewflow-factories-mobile.png`.

On this Mac, the inherited workspace configuration excludes non-Linux native
packages. Matching locked versions of Rollup, Tailwind oxide and Lightning CSS
were loaded from temporary `NODE_PATH` packages for build verification. A portable
PostgreSQL runtime and a `createdb` shim restricted to `reviewflow_test_isolated`
were also kept under `/tmp`. No lockfile changes or system database services were
needed.

## Remaining launch gates

The subsequent [multiplayer and provider milestone](multiplayer-provider.md)
implements the shared-project, membership lifecycle, dedicated roles, exposure
tracking and call-budget controls described below. The following paragraph records
the boundary at this first milestone; consult the newer document for current
implementation and qualification status.

The next milestone is shared-project onboarding and a full multiplayer operation
with real authenticated accounts: selection/invitations, membership lifecycle,
dedicated auditor/exporter roles, session changes and revocation. The current
owner/reviewer/adjudicator checks and assignment behavior were exercised with
synthetic identities, not real accounts. No claim of team readiness is made.

Blind audit endpoints retain their existing protections; a stronger project-wide
exposure ledger and audit-specific account surfaces are still needed before
claiming that an auditor could never have seen prior labels through other project
views. Preference workflows retain explicit reveal tracking. Independent accuracy
and savings remain unmeasured.

Jev is optional and off by default. Existing bounded batch/retry/error handling
remains, but no real connectivity, monetary budget study, provider-quality
evaluation or human benchmark has been run. These require a separately authorized,
small, reviewed outbound dataset and real-account validation. This milestone is
not a launch approval.
