# Multiplayer and bounded provider preparation

This milestone extends the factory implementation with working shared-project
membership, assignment controls, dedicated roles and optional provider budgets.
It is implemented and exercised locally with synthetic identities. Real hosted
authentication, actual people and live provider quality remain unqualified.

## Shared projects and membership

The Team & provider page lists the current account's projects and creates empty
shared projects. Selecting one sends `x-reviewflow-project` on subsequent API
requests. The server resolves the authenticated identity and checks persisted
membership; the header is a selector, never an authorization credential. Switching
projects reloads the application and clears cached queries. Account changes clear
the selected project. Anonymous demos cannot select shared projects.

Owners add existing account IDs directly and change or revoke roles using a
membership revision. No invitation or notification messages are sent. The server
protects the last owner and caps owned projects at 20. Revoked rows remain stored
so legacy owner fallback cannot recreate revoked access. Global project discovery
and creation continue to work if access to the personal project was revoked.

| Role | Responsibilities |
| --- | --- |
| Owner | Membership, project policy, assignments, provider controls and authorized review/export work |
| Reviewer | Evidence and preference review; cannot resolve escalations or manage members |
| Adjudicator | Escalation, quality checks and independent disagreement resolution; no self-adjudication |
| Auditor | Assigned blind evidence audits; prior task decisions and exports are denied |
| Exporter | Create/download checked releases; cannot review, audit or adjudicate |

Owners assign or explicitly reassign work to current reviewing members in
Factories & lanes. Claim tokens remain visible only to the assignee. Changing a
role revokes that member's claims. Mutations acquire a shared membership row lock
and recheck the operation's exact role inside the transaction, so concurrent
demotion cannot retain owner or adjudicator authority. Revocation denies new
requests; data already viewed or returned by an earlier authorized read cannot be
recalled. First-use personal-project provisioning is atomic under concurrent page
requests.

## Blind integrity

Evidence decision/proposal views, release downloads and adjudication responses
record per-actor exposure. Recording exposure and creating independent audits use
the same actor/project lock. A request racing a new audit either records exposure
first and blocks the audit, or is refused before returning labels. Active audit
items hide prior labels/proposals in other task views. The dedicated auditor
factory queue shows audit assignments only.

Audit outcomes also enter the exposure ledger: agreement/disagreement status can
reveal the original label after a choice. That actor cannot later be reused as a
fresh independent auditor for the same population. Preference reviews hide other
people's judgments until reveal, and preference release/assisted-kit access marks
the actor's reveal history so later reviews cannot be called human-only. Earlier
human-only decisions and frozen releases retain their original history.

Migration `0004_team_and_budgets` marks **existing projects as having untracked
historical exposure** and enables tracking by default for new projects. Legacy
history cannot be reconstructed. New independent audits and independently
qualified releases from those old projects fail closed; use a new tracked project
for qualification. Existing frozen release bytes are preserved. Anonymous demo
exports remain explicitly unverified. No production migration was run.

## Optional Jev controls

Jev defaults off at both server and project levels. Enabling a project requires
authenticated owner consent, server opt-in and a positive lifetime call cap. The
cap is 0–100 and cannot be lowered below already reserved calls. Every actual
evidence worker attempt or preference request reserves a call transactionally
before external I/O. Concurrent requests and retries share this project-wide
ledger. Failed, timed-out or abandoned reservations are never refunded, because
the provider may have billed them. Disabling the control stops new reservations;
an already running request may finish and remains counted.

This is a call limit, not a currency estimate. Provider credentials stay server
side, actual outbound text still requires explicit privacy confirmation, and
factory assistance/quarantine checks remain active. Typed-result validation,
timeouts, bounded evidence retries and no silent live-to-simulator fallback
remain. No model suggestion becomes a final decision automatically.

Prepare evaluation plan returns at most 25 task IDs/content hashes, the current
budget and a protocol for freezing human-only references, scenario-grouped
holdouts, error slicing and independent disagreement review. It performs no
provider calls and reports `qualification: not_run`. It is preparation, not a
completed study or a claim of model quality, savings or independent accuracy.

## API and verification

New endpoints: `GET /context`, `GET/POST /projects`, `GET/POST /members`,
`GET/POST /jev`, and `GET /jev/evaluation-plan`, all beneath `/api/reviewflow`.
OpenAPI and generated clients/validators are updated. Source migrations remain
restricted to the repository's disposable database harness.

The full isolated verification passes 73 server tests, 8 frontend tests and 36
Python checks (one optional SDK check skipped), plus type checks, production
builds, migration preservation and evidence/preference API end-to-end flows.
New regressions include concurrent first sign-in, cross-project denial, all five
roles, assignment/revocation, stale authority after demotion, adjudication and
export exposure, repeated-auditor rejection, ten concurrent budget updates,
atomic reservations, legacy qualification denial and project discovery after
personal membership revocation.

A local Chromium flow used four separate browser contexts with an explicit
test-only authentication stub and all external browser requests blocked. It
exercised project creation/switching, adding synthetic member IDs, owner assignment,
review, independent audit, exporter release, disabled-provider budget/plan
preparation and revocation. Desktop/mobile checks passed with no page errors or
horizontal overflow. Captures: `screenshots/reviewflow-team.png` and
`screenshots/reviewflow-team-mobile.png`. The stub exists only in the temporary
test harness; production has no header-based authentication mode.

## Remaining qualification

Real sign-in/session changes, account-ID validation against the hosted identity
service, multiple real accounts, invitation delivery if later desired, and
revocation behavior under that service still need qualification. The user must
confirm account IDs before granting access. Live Jev connectivity, monetary cost
measurement, genuine human reference data and provider quality have not been
tested. No paid inference, real invitations, persistent credentials, external
messages, merge, push or deployment occurred. This implementation is not a launch
approval.
