# Trace2Preference Python toolkit

Python 3.10+ standard library only. This is a reusable validation, comparison,
export, Label Studio and study-analysis core, not a Python rewrite of ReviewFlow.
From repository root:

```sh
PYTHONPATH=python python3 -m unittest discover -s python/tests -v
PYTHONPATH=python python3 -m trace2preference validate < python/fixtures/synthetic-traces.json > validated.json
```

See [trace-contract.md](trace-contract.md) for each command's exact JSON envelope.
To export after genuine human review, build an object containing the validation
output, canonical finalized decisions, quality-check status and a stable private
project salt; pipe it to `python3 -m trace2preference export`. The application must
authorize decisions and store immutable release snapshots. This stateless toolkit
does not replace database concurrency controls or access control.

Context completeness must be asserted only by the authorized capture producer
when every relevant model-visible instruction, message, tool result, tool schema,
image/reference representation and parameter at the decision point is captured.
Do not mark a partial transcript complete. Extension context fields are hashed.
Whole-trajectory comparisons are unsupported. Shared scenario names never make
responses eligible by themselves. All supplied events retain their source order;
the toolkit never estimates timestamps, hidden reasoning or outcomes.

## Label Studio Community

`labelstudio` produces task JSON, an XML labeling configuration and a private
manifest. Save `tasks` as a JSON file, paste `config` into the project's labeling
interface and import the tasks. Keep the manifest outside reviewer access.
Export annotations as JSON and pass them with the manifest to `reconcile`.
Do not use CSV or binary-only exporters: they lose nonbinary decisions.
Candidate display mapping remains immutable and reconciliation maps display
choices back to canonical identity. Altered task content and competing annotations
are rejected. Returned decisions are deliberately unfinalized pending authorized
review and required quality checks in ReviewFlow.

Mechanical tests cover XML parsing and the documented Label Studio JSON
task/annotation shape, including numeric task IDs reassigned by Label Studio.
An optional test in `python/tests/test_labelstudio_sdk.py` runs the official
SDK's `LabelInterface` parser and annotation validator for all six outcomes in
both conditions if the SDK is installed; otherwise it reports an explicit skip.
A live Label Studio Community installation has **not** been exercised by this
toolkit's tests; installed-version/browser compatibility remains unverified.

Use `condition:"human_only"` (default) or `condition:"model_assisted"` when
generating a kit. Human-only kits contain no model proposals anywhere. Assisted
kits show only typed proposal fields behind an explicit reveal control and
record that reveal separately on reconciliation. The assisted JSON contains the
proposal, so this is an interaction boundary, not secure concealment against
source inspection. Neither condition preselects a human choice. Keep private
manifest metadata outside reviewer access. Assigned condition and recorded
assistance exposure are distinct; an assigned assisted task without a reveal is
not evidence of actual assistance. Reconciliation uses immutable comparison IDs,
so Label Studio can allocate its own task IDs on import.

## Study kit

`assign` allocates no more than one related scenario-family example to each
reviewer across four interface/assistance conditions. `analyze` aggregates measured
active review, waiting, service, correction and audit durations independently;
missing measurements remain unavailable. UI versus Label Studio and human-only
versus assisted are separate factors. Assignments do not recruit participants.
Synthetic fixture tests are mechanical evidence, not human study results.
There are no claimed reviewer speed, agreement, accuracy or benchmark wins.
If genuine human data later exists, explicit `measurementOrigin:genuine_human`
records permit pairwise exact agreement within the same interface/assistance
condition. Accuracy additionally requires a separately sourced reference outcome.
Synthetic tests exercise the arithmetic but do not establish genuine data.

## Privacy and execution boundary

Imported strings are inert data; this module never follows a URL, executes a tool,
or loads an imported script. Shareable exports remove candidate identity fields
and pseudonymize structured identifiers/source provenance with a supplied salt.
Arbitrary context, responses and event text can still contain personal data:
inspect/redact through an authorized provenance-preserving process before sharing.
Do not treat identifier pseudonymization as an automatic free-text anonymizer.
The private validated import retains original provenance for reproducibility.

## SPEAR

See [the local SPEAR capture exercise](spear-capture.md) and
`scripts/spear-capture.mjs`. The integrator exercised unmodified upstream
`sunnypatneedi/spear` revision `ff300b3f9cfda7cf1f58fea9794d7174447202a6`
(AGPL-3.0-only) in a disposable local checkout. The exercise separates an executed
guard/security event from explicitly scripted candidate responses and partial
telemetry; it does not claim a real model run, production trace, or independent
human review. No SPEAR implementation is vendored here. The Python standalone
fixture remains explicitly synthetic, **not SPEAR telemetry**. Telemetry-only
imports remain ineligible. Security events alone cannot reconstruct context.