# Trace2Preference study kit: awaiting genuine human data

This is an instrumented comparison kit, not a completed user study. Synthetic
fixtures, scripted review submissions, and simulator proposals are mechanical
checks only. They do not establish agreement, model accuracy, time savings,
independent human review, or a benchmark win.

## Four conditions, two independent factors

Use `rf_human`, `rf_assisted`, `ls_human`, and `ls_assisted` when calling the
Python `assign` command. Interface (ReviewFlow versus Label Studio Community)
and assistance (human-only versus explicitly revealed model proposal) are
different factors. Do not pool them into a single “AI versus human” comparison.
The deterministic assignment groups related scenarios: a reviewer must not see
the same or related case again in another condition. Supply trustworthy group
IDs across scenario variants before assignment; names alone do not prove
independence.

Use the [Python CLI](trace-python.md) with your authorized exported runs.
`labelstudio` produces a Community-compatible XML configuration, task JSON, and
an immutable side-mapping manifest. Import the configuration and tasks into a
local Label Studio project, retain the manifest, export completed annotations
as JSON, and pass them through `reconcile`. Do not regenerate candidate order
between task creation and reconciliation. All six outcomes survive; multiple,
missing, and malformed annotations are reported, not silently accepted.

Tasks initially hide candidate identities and model preferences. Human-only
kits contain no proposals. Assisted kits contain the typed proposal in task
data and use an explicit recorded reveal control in their configuration.
That control is a study instrument, not a security boundary: someone inspecting
assisted task JSON can see the proposal. Do not give assisted task files to
human-only reviewers. Keep the reconciliation manifest outside reviewer access.
A model suggestion is never a human-finalized decision. Returned annotations
can be imported through the Trace2Preference interface, but require explicit
authorized confirmation and new quality checks before training inclusion.
The CLI alone does not grant project permissions.

## Measurement

Record active review effort separately from waiting and provider service
latency. Record correction and quality-audit effort too; do not count unmeasured
work as zero. The `analyze` command reports each condition and timing component,
including missing counts. Elapsed session duration alone is not active effort.
Keep raw timing records, assignment group IDs, interface, assistance/reveal
state, rubric version, and the exact source/dataset revisions alongside analysis.

Imported event timestamps are observations, not reviewer timings. Missing
timestamps, outcomes, and identities must remain missing. Mechanical fixtures
may contain explicit artificial timing values for assertion tests; these must
never enter a human benchmark.

## Compatibility and limits

Python tests exercise Label Studio-shaped task/result JSON and immutable
candidate-order reconciliation. That is not by itself proof of import/export in
a running Label Studio Community server. Report actual server compatibility
checks separately in [verification](verification.md). No participants were
recruited by this task; a genuine controlled study remains to be conducted.

## SPEAR capture boundary

An optional [local SPEAR capture exercise](spear-capture.md) targets
`sunnypatneedi/spear` at a pinned revision without vendoring or modifying it.
Its guard events are executed locally, its responses are explicitly scripted,
and its telemetry-only record remains partial. The verification receipt must
record whether the exercise actually ran; a script alone is not execution
evidence.

Telemetry alone is partial evidence: preserve its observed event order and
source provenance, import it as `kind: "telemetry"`, and keep it visible but
excluded from training. Complete comparisons additionally require actually
captured, authorized, identical model-visible context and actual candidate
responses at the selected decision point. Scripted synthetic responses are
not real model runs; executed local security events are not human judgments.
No prompts, tool observations, timestamps, responses, outcomes, or hidden
reasoning may be manufactured to upgrade a partial capture.