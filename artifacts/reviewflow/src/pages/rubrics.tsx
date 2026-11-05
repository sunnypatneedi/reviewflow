import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTelemetry } from "@/lib/telemetry";
import { Button } from "@/components/ui/button";
import {
  rubricApi,
  downloadRubricRelease,
  type RubricData,
  type RubricDefinition,
  type RubricItem,
  type RubricSpec,
} from "@/lib/rubric-api";

const sample: RubricDefinition = {
  schemaVersion: 1,
  name: "Answer quality",
  criteria: [
    { id: "accuracy", label: "Accuracy", kind: "score", min: 0, max: 5 },
    {
      id: "safe",
      label: "Safe to use",
      kind: "option",
      options: ["yes", "no"],
    },
  ],
  minimumAudits: 1,
};
const sampleItems = [
  { externalId: "example-1", content: "Question: What is 2 + 2?\nAnswer: 4." },
];
const field =
  "w-full rounded-md border border-border bg-background p-2 text-sm";

function ItemReview({
  item,
  spec,
  data,
  run: persist,
  busy,
}: {
  item: RubricItem;
  spec: RubricSpec;
  data: RubricData;
  run: (path: string, body: unknown) => Promise<void>;
  busy: boolean;
}) {
  const telemetry = useTelemetry({
    factory: "rubric",
    itemId: item.id,
    itemVersion: item.version,
  });
  const run = (path: string, body: unknown) => {
    if (/\/(review|adjudicate|audit)$/.test(path)) telemetry("submit");
    return persist(path, body);
  };
  const [scores, setScores] = useState<Record<string, string | number>>({});
  const [reason, setReason] = useState("");
  const [privacy, setPrivacy] = useState(false);
  const [independent, setIndependent] = useState(false);
  const canReview =
    !data.role || ["owner", "reviewer", "adjudicator"].includes(data.role);
  const canAdjudicate =
    !data.role || ["owner", "adjudicator"].includes(data.role);
  const canAudit =
    !data.role ||
    ["owner", "reviewer", "adjudicator", "auditor"].includes(data.role);
  const path = `/items/${encodeURIComponent(item.id)}`;
  const body = {
    expectedVersion: item.version,
    claimToken: item.claimToken,
    scores,
    reason,
    privacyReviewed: privacy,
    action: "finalize",
  };
  return (
    <section
      className="rounded-xl border border-border p-5 space-y-4"
      aria-label={`Review ${item.externalId}`}
    >
      <div className="flex flex-wrap justify-between gap-2">
        <h2 className="font-semibold">{item.externalId}</h2>
        <span className="text-sm">
          {item.quarantined ? "Quarantine" : item.status} · version{" "}
          {item.version}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        {spec.definition.name} · rubric revision {spec.revision} ·{" "}
        {spec.definition.minimumAudits} independent audit(s) required
      </p>
      <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-sm">
        {item.content}
      </pre>
      <details className="text-xs text-muted-foreground">
        <summary>Immutable source identity</summary>
        <p className="break-all">Content SHA-256: {item.contentHash}</p>
        <p className="break-all">Rubric SHA-256: {spec.hash}</p>
      </details>
      {item.escalationReason && (
        <p role="status" className="text-amber-600">
          {item.escalationReason}
        </p>
      )}
      {item.quarantined && (
        <p role="status">Quarantine reason: {item.quarantineReason}</p>
      )}
      {item.assignedTo && (
        <p className="text-sm">
          Claimed by {item.assignedTo === data.actor ? "you" : item.assignedTo}{" "}
          until{" "}
          {item.expiresAt
            ? new Date(item.expiresAt).toLocaleTimeString()
            : "unknown"}
          .
        </p>
      )}
      {item.status !== "reviewed" && canReview && !item.quarantined && (
        <Button
          disabled={
            busy ||
            (Boolean(item.assignedTo) && item.assignedTo !== data.actor) ||
            (item.status === "escalated" && !canAdjudicate)
          }
          onClick={() =>
            void run(`${path}/claim`, { expectedVersion: item.version })
          }
        >
          {item.claimToken ? "Renew claim" : "Claim item"}
        </Button>
      )}
      {!item.quarantined && (
        <>
          <fieldset className="grid gap-3 sm:grid-cols-2" disabled={busy}>
            <legend className="text-sm font-medium mb-2">
              {item.status === "reviewed"
                ? "Enter your independent audit scores"
                : "Human assessment"}
            </legend>
            {spec.definition.criteria.map((c) => (
              <label key={c.id} className="block text-sm">
                {c.label}
                {c.kind === "score" ? (
                  <input
                    className={field}
                    type="number"
                    step="1"
                    min={c.min}
                    max={c.max}
                    aria-label={`${item.externalId} ${c.label}`}
                    value={scores[c.id] ?? ""}
                    onChange={(e) =>
                      setScores((s) => {
                        const next = { ...s };
                        if (e.target.value === "") delete next[c.id];
                        else next[c.id] = Number(e.target.value);
                        return next;
                      })
                    }
                  />
                ) : (
                  <select
                    className={field}
                    aria-label={`${item.externalId} ${c.label}`}
                    value={scores[c.id] ?? ""}
                    onChange={(e) =>
                      setScores((s) => ({ ...s, [c.id]: e.target.value }))
                    }
                  >
                    <option value="">Choose…</option>
                    {c.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            ))}
          </fieldset>
          <label className="block text-sm">
            Reason / evidence
            <textarea
              className={field}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-label={`${item.externalId} reason`}
            />
          </label>
          {item.status !== "reviewed" && canReview && (
            <>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={privacy}
                  onChange={(e) => setPrivacy(e.target.checked)}
                />
                I reviewed this content for privacy and suitability for export.
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    busy ||
                    !item.claimToken ||
                    !privacy ||
                    !reason.trim() ||
                    (item.status === "escalated" && !canAdjudicate)
                  }
                  onClick={() =>
                    void run(
                      `${path}/${item.status === "escalated" ? "adjudicate" : "review"}`,
                      body,
                    )
                  }
                >
                  {item.status === "escalated"
                    ? "Adjudicate and finalize"
                    : "Finalize human review"}
                </Button>
                {item.status === "pending" && (
                  <Button
                    variant="outline"
                    disabled={busy || !item.claimToken || !reason.trim()}
                    onClick={() =>
                      void run(`${path}/review`, {
                        ...body,
                        action: "escalate",
                      })
                    }
                  >
                    Escalate
                  </Button>
                )}
              </div>
            </>
          )}
          {item.status === "reviewed" && canAudit && (
            <>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={independent}
                  onChange={(e) => setIndependent(e.target.checked)}
                />
                I am a different human from the item’s reviewers and performed
                my own assessment. A second account used by the same person does
                not qualify.
              </label>
              <Button
                disabled={
                  busy ||
                  !independent ||
                  !reason.trim() ||
                  !data.authenticated ||
                  item.decision?.actor === data.actor
                }
                onClick={() =>
                  void run(`${path}/audit`, {
                    expectedVersion: item.version,
                    scores,
                    reason,
                    independentHuman: independent,
                  })
                }
              >
                Submit independent audit
              </Button>
              {!data.authenticated && (
                <p className="text-sm text-muted-foreground">
                  Local solo practice can review and escalate. An authenticated
                  independent teammate is required for a qualified audit and
                  release.
                </p>
              )}
              {item.decision?.actor === data.actor && (
                <p className="text-sm text-muted-foreground">
                  You reviewed this item. A different human must audit it.
                </p>
              )}
            </>
          )}
        </>
      )}
      {item.audits.length > 0 && (
        <ul className="text-sm">
          {item.audits.map((a) => (
            <li key={a.id}>
              Audit by {a.actor}: {a.pass ? "agrees" : "disagrees"}
              {item.decision && a.decisionId !== item.decision.id
                ? " (previous decision, not release-qualifying)"
                : ""}
            </li>
          ))}
        </ul>
      )}
      {data.canConfigure && (
        <div className="border-t pt-3">
          <label className="block text-sm">
            Quarantine explanation
            <input
              className={field}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-label={`${item.externalId} quarantine reason`}
            />
          </label>
          <Button
            className="mt-2"
            variant="outline"
            disabled={busy || !reason.trim()}
            onClick={() =>
              void run(`${path}/quarantine`, {
                expectedVersion: item.version,
                quarantined: !item.quarantined,
                reason,
              })
            }
          >
            {item.quarantined ? "Resolve quarantine" : "Quarantine item"}
          </Button>
        </div>
      )}
    </section>
  );
}
export default function RubricsPage() {
  const query = useQuery({
    queryKey: ["rubric-factory"],
    queryFn: () => rubricApi<RubricData>(),
  });
  const [definition, setDefinition] = useState(JSON.stringify(sample, null, 2));
  const [items, setItems] = useState(JSON.stringify(sampleItems, null, 2));
  const [rubricId, setRubricId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [releasePrivacy, setReleasePrivacy] = useState(false);
  const [includeSource, setIncludeSource] = useState(false);
  const data = query.data;
  const run = async (path: string, body: unknown) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await rubricApi(path, body);
      await query.refetch();
      setNotice("Saved. The queue now reflects the latest version.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      await query.refetch();
    } finally {
      setBusy(false);
    }
  };
  const parseAndRun = (path: string, build: () => unknown) => {
    try {
      void run(path, build());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };
  if (query.isLoading) return <p className="p-6">Loading rubric factory…</p>;
  if (!data)
    return (
      <div className="p-6">
        <p role="alert">
          {query.error?.message ?? "Unable to load rubric factory"}
        </p>
        <Button onClick={() => void query.refetch()}>Retry</Button>
      </div>
    );
  const latest = data.rubrics.at(-1);
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Rubric factory</h1>
        <p className="text-muted-foreground mt-2">
          Configure a versioned rubric, import source items, review,
          independently audit, and export immutable provenance. Human-only by
          default.
        </p>
      </header>
      <aside className="rounded-lg border p-4 text-sm">
        {data.releaseGate}{" "}
        {data.authenticated
          ? "Independent human identity is attested, not automatically verified."
          : "This solo local workspace cannot manufacture an independent human audit. No release bypass is provided."}
      </aside>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive p-3 text-destructive"
        >
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => void query.refetch()}
      >
        Reload queue
      </Button>
      {data.canConfigure && (
        <div className="grid gap-5 md:grid-cols-2">
          <section className="border rounded-xl p-4 space-y-3">
            <h2 className="font-semibold">1. Configure a rubric revision</h2>
            <p className="text-sm text-muted-foreground">
              1–12 bounded criteria, 1–5 independent audits per item. Saving
              creates a new immutable revision; existing items keep their
              original rubric.
            </p>
            <label className="block text-sm">
              Rubric JSON
              <textarea
                className={`${field} font-mono h-72`}
                value={definition}
                onChange={(e) => setDefinition(e.target.value)}
                aria-label="Rubric JSON"
              />
            </label>
            <div className="flex gap-2">
              <Button
                disabled={busy}
                onClick={() =>
                  parseAndRun("/specs", () => ({
                    definition: JSON.parse(definition),
                    expectedRevision: latest?.revision ?? 0,
                  }))
                }
              >
                Save new revision
              </Button>
              {latest && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    setDefinition(JSON.stringify(latest.definition, null, 2))
                  }
                >
                  Load latest
                </Button>
              )}
            </div>
          </section>
          <section className="border rounded-xl p-4 space-y-3">
            <h2 className="font-semibold">2. Import items</h2>
            <label className="block text-sm">
              Rubric revision
              <select
                className={field}
                value={rubricId || latest?.id || ""}
                onChange={(e) => setRubricId(e.target.value)}
              >
                <option value="" disabled>
                  Save a rubric first
                </option>
                {data.rubrics.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.definition.name} · revision {r.revision}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Items JSON
              <textarea
                className={`${field} font-mono h-52`}
                aria-label="Items JSON"
                value={items}
                onChange={(e) => setItems(e.target.value)}
              />
            </label>
            <p className="text-sm text-muted-foreground">
              1–100 items per import; 500 per local project. External IDs are
              unique. Content is immutable and hashed. Review sample text before
              import.
            </p>
            <Button
              disabled={busy || !latest}
              onClick={() =>
                parseAndRun("/items", () => ({
                  rubricId: rubricId || latest?.id,
                  items: JSON.parse(items),
                }))
              }
            >
              Import items
            </Button>
          </section>
        </div>
      )}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">
          3. Review and audit ({data.items.length} items)
        </h2>
        {!data.items.length && (
          <p>No items yet. Save a rubric and import sample items to begin.</p>
        )}
        {data.items.length > 0 && (
          <label className="block text-sm">
            Work item
            <select
              className={field}
              value={selectedId || data.items[0].id}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {data.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.externalId} ·{" "}
                  {item.quarantined ? "quarantine" : item.status}
                </option>
              ))}
            </select>
          </label>
        )}
        {data.items
          .filter((item) => item.id === (selectedId || data.items[0]?.id))
          .map((item) => {
            const spec = data.rubrics.find((r) => r.id === item.rubricId);
            return spec ? (
              <ItemReview
                // Claim/renewal versions must not erase an in-progress assessment.
                // Reset only when the item workflow or our saved audit changes.
                key={`${item.id}:${item.status}:${item.decision?.id ?? ""}:${item.quarantined}:${item.audits
                  .filter((a) => a.actor === data.actor)
                  .map((a) => a.id)
                  .join(",")}`}
                item={item}
                spec={spec}
                data={data}
                run={run}
                busy={busy}
              />
            ) : null;
          })}
      </section>
      {data.canRelease && (
        <section className="border rounded-xl p-5 space-y-3">
          <h2 className="font-semibold">4. Release JSONL with provenance</h2>
          <p className="text-sm text-muted-foreground">
            All imported items must pass their pinned rubric’s audit minimum.
            Unreviewed, escalated, quarantined, or missing-audit items block the
            entire release.
          </p>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={releasePrivacy}
              onChange={(e) => setReleasePrivacy(e.target.checked)}
            />
            I reviewed the full release, including written reasons, for privacy
            and authorize this local export snapshot.
          </label>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeSource}
              onChange={(e) => setIncludeSource(e.target.checked)}
            />
            Include original source text (excluded by default). Actor
            identifiers remain pseudonymous.
          </label>
          <Button
            disabled={
              busy ||
              !releasePrivacy ||
              (!data.items.length && data.role !== "exporter")
            }
            onClick={() =>
              void run("/releases", {
                privacyReviewed: true,
                includeSourceText: includeSource,
              })
            }
          >
            Create immutable release
          </Button>
          <ul className="space-y-3">
            {data.releases.map((r) => (
              <li key={r.id} className="text-sm">
                <p>
                  {r.itemCount} items · {new Date(r.createdAt).toLocaleString()}
                </p>
                <p className="font-mono text-xs break-all">
                  SHA-256 {r.sha256}
                </p>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void downloadRubricRelease(r.id)
                      .catch((e) => setError(e.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  Download JSONL
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
