# Trace2Preference v1 contract

Python entry point: `PYTHONPATH=python python3 -m trace2preference validate`.
All commands take one JSON object on stdin and write one JSON object to stdout.
Invalid envelopes exit 2 with `{"error":"..."}`; no files, network, or imported
code are executed. Maximum input 8 MiB; maximum 500 runs, 2000 comparisons.

Input: `{"schemaVersion":1,"runs":[{"id":"unique","scenarioId":"case",
"groupId":"related-case-family","task":"observable task","decisionPoint":"turn-2",
"context":{"complete":true,"messages":[{"role":"user","content":"actual prompt"}],
"tools":[],"parameters":{}},"response":"actual response","events":[],
"provenance":{},"candidateIdentity":"optional","kind":"scripted"}]}`.
Kinds: `scripted`, `real_model`, `telemetry`. Extra observable fields are preserved.
Missing context, response, or counterpart are retained and ineligible. A complete
context must explicitly include complete=true, messages, tools and parameters.
Every context field participates in the canonical SHA-256 equality check,
including extension fields. Arrays retain order. No text or event is invented.
Telemetry-only runs are ineligible even if metadata asserts completeness.
Completeness is an importer's assertion, not proof of capture completeness.
Eligibility means structurally matching exporter-attested complete context, not
independently verified capture. Nested structured reference-answer, ground-truth
and prior-human-decision fields flag `reference_material_present`; these imports
remain visible but ineligible. This key guard cannot recognize arbitrary free-text
reference material. `comparisonType` or `scope` trajectory markers also block.

Validation output: `{schemaVersion:1,runs,comparisons,issues}`. Comparisons pair
all runs sharing scenarioId AND decisionPoint, in stable run-id order. Each has
`{id,scenarioId,groupId,task,decisionPoint,context,contextHash,a,b,eligible,reasons}`.
Sides are `{runId,response,events,provenance,candidateIdentity,kind}`; absent side
is null and absent values remain null. Reasons are machine-readable strings.
Mismatched group IDs block export rather than allowing cross-split leakage.
Issues are `{runId,code}`. Malformed required identifiers/envelopes are errors.
Duplicate IDs are retained as issues but cannot become eligible comparisons.
Identical actual responses are ineligible as duplicate alternatives.

Other commands:

- `export`: `{validation:<validate output>,decisions:[{comparisonId,outcome,
  finalized:true,reviewMode:"human_only"|"model_assisted",qualityChecksPassed:true,
  ...}],salt:"nonempty project-specific pseudonymization salt"}` produces
  `{schemaVersion:1,complete:[...],training:[...],summary:{...}}`.
  Outcomes: `a`, `b`, `tie`, `both_unacceptable`, `insufficient_evidence`,
  `escalation`; always refer to canonical side, never current display position.
  More than one supplied decision per comparison blocks inclusion (caller must
  supply its single canonical final revision). Missing/false quality checks,
  missing review mode, escalation and nonbinary results never train. Complete
  records preserve nonbinary results and inclusion/exclusion reasons.
  Training entries have actual `prompt` (context messages), `chosen`, `rejected`,
  full `context`, stable `split`, pseudonymous IDs and decision provenance.
  Decision evidence references accept `evidenceRefs` (application name) or
  `evidenceReferences` (legacy CLI alias); outputs preserve both aliases.
  Export strips candidate identities and pseudonymizes identifiers/structured
  source provenance; raw task/context/response/event text requires caller privacy
  review because arbitrary text may contain personal information.
- `labelstudio`: `{validation,condition?:"human_only"|"model_assisted",
  proposals?:[{comparisonId,outcome,provider,simulated}]}` produces
  `{config,tasks,manifest,condition}`. Default human-only kit contains no model
  proposals anywhere. Manifest is private reconciliation metadata, not tasks.
  Assisted kit adds typed proposals (no explanation/rewritten response) to task
  data and conditional reveal UI. This is UI blindness, not secrecy from a
  reviewer inspecting the downloaded JSON. Model proposals never prefill choices.
  `reconcile`: `{manifest,annotations:<Label Studio JSON export array>}` returns
  `{decisions,issues}`; validates task IDs, immutable display mapping, completed
  single annotations and all six outcomes. Returned decisions are not final:
  owner-side authorization and required quality checks still apply.
  Uses immutable `data.comparison_id`, not numeric task IDs (Label Studio assigns
  its own). Annotation result controls must be `preference` → `a`, type `choices`,
  one of `A preferred`, `B preferred`, `Tie`, `Both unacceptable`,
  `Insufficient evidence`, `Escalation`. Assisted reveal is a separate `assistance`
  → `a` choices result containing `Reveal model proposal`. Reconciliation returns
  `assistedReveal`, `assignedCondition`, and actual recorded `reviewMode`.
- `assign`: `{reviewers:["id"],comparisons:[...],conditions?:["rf_human",
  "rf_assisted","ls_human","ls_assisted"]}` returns `{assignments}`. Each reviewer
  sees at most one example per group across all conditions, deterministic.
- `analyze`: `{records:[{reviewerId,comparisonId,groupId,interface:"reviewflow"|
  "labelstudio",reviewMode:"human_only"|"model_assisted",activeMs?,waitingMs?,
  serviceMs?,correctionMs?,auditMs?,outcome?}]}` returns condition summaries
  with separate measured timing aggregates and missing counts. No inferred
  accuracy, savings, agreement, or fabricated duration; absent means null.
  Optional `measurementOrigin:"genuine_human"` is required before calculating
  agreement from distinct reviewers on the same comparison within a condition.
  Accuracy additionally requires `referenceOutcome` and a nonempty
  `referenceSource`. These provenance values are explicit caller attestations;
  no independent authenticity is inferred. Duplicate reviews by one reviewer
  are excluded from agreement. Savings always remains null (no causal estimate).