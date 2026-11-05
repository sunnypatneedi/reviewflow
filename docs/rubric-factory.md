# Generic rubric factory

The Rubric factory is separate from evidence labeling and Trace2Preference. Owners
create immutable rubric revisions with 1–12 criteria: an integer score range
within 0–100, or 2–20 named options. Each rubric requires 1–5 independent audits
per reviewed item. New revisions do not rewrite existing items or releases.

## Workflow

1. Save a rubric revision using the example JSON or your own bounded criteria.
2. Import authorized text items with unique external IDs. Identical imports are
   idempotent; changing the content or rubric under the same ID is rejected. Use
   a new ID for a new immutable item.
3. Assign and claim work. Claims expire and renewal preserves an unfinished form.
   Item versions reject stale writes. Reviewers provide every criterion, a reason
   and privacy confirmation; escalation and quarantine block release.
4. A distinct authenticated human records their own audit scores and reason, and
   explicitly attests independence. Contributors cannot audit their own item.
   A failed audit requires adjudication followed by fresh independent auditing.
5. An authorized exporter reviews the complete release and creates frozen JSONL.
   The export binds the rubric, content hash, decision, audit lineage and release
   digest. Source text is omitted unless explicitly selected. Original internal
   actor IDs are not exported; pseudonymous lineage is still potentially linkable.

The single-user local demo supports rubric definition, import and review, but
cannot establish independent human identity. It intentionally cannot pass the
independent-audit gate merely by generating synthetic judgments. Automated browser
checks use explicitly synthetic role fixtures; they prove workflow mechanics,
not real-team authentication or human quality.

## Boundaries

This factory is human-driven. It has no rubric-model evaluator or automatic
accept/release path. Imported content is inert, not fetched or executed. A privacy
checkbox is an operator attestation, not an automated sensitive-data detector.
The rubric API is currently a separately typed local route; it is not part of the
generated OpenAPI client used by the original evidence API.

Migrations 0007–0009 are additive for fresh disposable verification databases.
The durable workspace launcher refuses a changed migration inventory; automated
upgrades of existing durable workspaces are not implemented. Keep their matching
source release and an offline backup instead of forcing migrations.
