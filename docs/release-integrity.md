# Release decision integrity

`independent-sample-v1` is the default persisted release-audit policy for
authenticated projects. A release needs at least one completed required,
independent audit whose sampling frame matches the current eligible task and
decision population. The requested sample size, seed, frame commitment and
selected items remain explicit. This is a sample policy, not a claim that every
task was audited or that a measured quality threshold was achieved. No new
agreement or accuracy threshold is implied.

Anonymous synthetic demo projects explicitly use `demo-unverified-v1` and can
export without an independent audit. That policy is recorded in every exported
row and the release manifest. It is refused for authenticated or live projects.
Unknown policy versions fail closed. Neither policy permits unresolved disputes,
including disputes in optional audits, or incomplete required audit evidence.

New audit frames use `rf-audit-v2`: each eligible item binds source hash, task
version, original review, current label, current decision author and previous
adjudication. Selected items must match the committed deterministic sample.
Frame hashes canonicalize object keys because PostgreSQL JSONB changes key
ordering. A changed decision outside the sample makes the old population frame
obsolete; a fresh completed audit restores coverage. A sample's own approved
adjudication can advance its selected decision by exactly one bound version.

Adjudication updates the dispute, task label, task version, decision pointer and
event in one transaction. The original review is preserved. An auditor and the
original/current decision author cannot adjudicate their own work. Competing
audits cannot both overwrite the same task decision. A stale decision is refused.
Exports validate the complete original-review/adjudication chain and include its
IDs. Missing, contradictory, revoked or changed evidence blocks a new release;
the exporter does not fall back to an older label.

Release checks, provenance, JSONL construction and insertion share one PostgreSQL
repeatable-read snapshot. A concurrent valid mutation can be observed before or
after its commit, without mixing evidence from different revisions. Downloads
return stored bytes; a later correction never rewrites an existing release or
its digest.

Migration `0002_release_integrity` adds policy and lineage fields without
rewriting existing releases. Historical audit items have no task-version
binding and cannot establish this new trusted policy. Historical ambiguous or
unbound adjudications fail closed; this change does not invent missing lineage
or automatically repair/retire those records. Operator-reviewed remediation is
required if such data exists. Do not run the disposable migration runner against
an existing application database.

The seven release-integrity HTTP integration tests use synthetic actors and
records in disposable PostgreSQL. They inspect downloaded labels, lineage,
digests, old release bytes, missing evidence and concurrent requests. These are
mechanical correctness checks, not genuine human review, model-quality evidence,
or hosted Clerk/multi-user certification. Existing Trace2Preference instruments
and their four-condition study kit remain separate and unchanged.
