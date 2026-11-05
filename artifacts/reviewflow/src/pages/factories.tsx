import { RoutingAdvice } from "@/components/routing-advice";
import { SharedNotes } from "@/components/shared-notes";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ActiveTimeTracker } from "@/lib/active-time";
import { queryClient } from "@/lib/queryClient";
import { projectHeaders } from "@workspace/api-client-react";

type Policy = {
  schemaVersion: 1;
  assistanceAllowed: boolean;
  requireAssignments: boolean;
  highRiskLane: "human_review" | "escalation";
  minimumConfidence: number;
  redirectionThreshold: number;
};
type Item = {
  id: string;
  workKind: string;
  title: string;
  version: number;
  lane: string;
  reasons: string[];
  controlRevision: number;
  quarantined: boolean;
  quarantineReason: string | null;
  assignedTo: string | null;
  expiresAt: string | null;
  claimToken: string | null;
};
type FactoryData = {
  factory: string;
  policy: { revision: number; definition: Policy };
  items: Item[];
  counts: Record<string, number>;
  actor: string;
  canConfigure: boolean;
  releaseGate: string;
};
type Evidence = {
  id: string;
  version: number;
  question: string;
  evidence: string;
  candidateAnswer: string;
  proposal: unknown;
};

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/reviewflow${path}`, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...projectHeaders(),
      ...(body === undefined
        ? {}
        : { "Content-Type": "application/json", "x-reviewflow-csrf": "1" }),
    },
    ...(body === undefined
      ? {}
      : { method: "POST", body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error ?? `Request failed (${response.status})`);
  return value as T;
}
const laneName = (value: string) => value.replaceAll("_", " ");

export default function Factories() {
  const [factory, setFactory] = useState<"evidence" | "preference">("evidence");
  const [lane, setLane] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [label, setLabel] = useState("supported");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Policy | null>(null);
  const tracker = useRef(new ActiveTimeTracker());
  const base = `/factories/${factory}`;
  const query = useQuery({
    queryKey: ["factory", factory],
    queryFn: () => api<FactoryData>(base),
    refetchInterval: 15_000,
  });
  const evidence = useQuery({
    queryKey: ["factory-evidence", selected],
    enabled: factory === "evidence" && selected !== null,
    queryFn: async () =>
      (await api<Evidence[]>("/tasks")).find((item) => item.id === selected),
  });
  const current = query.data?.items.find((item) => item.id === selected);
  const [assignee, setAssignee] = useState("");
  const members = useQuery({
    queryKey: ["assignable-members"],
    enabled: Boolean(
      query.data?.canConfigure && !query.data.actor.startsWith("demo:"),
    ),
    queryFn: () => api<Array<{ userId: string; role: string }>>("/members"),
  });
  useEffect(() => {
    setDraft(query.data?.policy.definition ?? null);
  }, [factory, query.data?.policy.revision]);
  useEffect(() => {
    tracker.current.reset(!document.hidden && document.hasFocus());
    const update = () =>
      tracker.current.setActive(!document.hidden && document.hasFocus());
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, [selected]);
  async function run(action: () => Promise<unknown>, message: string) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await action();
      setNotice(message);
      await queryClient.invalidateQueries();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }
  const policy = draft;
  return (
    <main className="p-4 min-[861px]:p-8 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Factories & lanes</h1>
        <p className="text-muted-foreground mt-2">
          Route work, claim a review, and hold items that need investigation.
        </p>
      </header>
      <div className="flex gap-3 items-center flex-wrap">
        <label>
          Factory{" "}
          <select
            aria-label="Factory"
            className="border rounded p-2 ml-2"
            value={factory}
            onChange={(event) => {
              setFactory(event.target.value as typeof factory);
              setSelected(null);
              setReason("");
              setLane("all");
              setNotice("");
              setError("");
            }}
          >
            <option value="evidence">Evidence grounding</option>
            <option value="preference">Trace preference</option>
          </select>
        </label>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => query.refetch()}
        >
          Refresh
        </Button>
        <Link href="/rubrics" className="text-primary underline">Open generic rubric factory</Link>
        {factory === "preference" && (
          <Link href="/traces" className="text-primary underline">
            Open preference workbench
          </Link>
        )}
      </div>
      {(error || query.error || evidence.error) && (
        <p role="alert" className="text-destructive">
          {error || query.error?.message || evidence.error?.message}
        </p>
      )}
      {notice && (
        <p role="status" className="text-primary">
          {notice}
        </p>
      )}
      {query.isPending ? (
        <p>Loading factory…</p>
      ) : (
        query.data && (
          <>
            <div className="flex flex-wrap gap-2" aria-label="Lanes">
              {[
                ["all", query.data.items.length],
                ...Object.entries(query.data.counts),
              ].map(([name, count]) => (
                <button
                  key={name}
                  aria-pressed={lane === name}
                  onClick={() => setLane(String(name))}
                  className={`px-3 py-2 rounded border capitalize ${lane === name ? "bg-secondary font-semibold" : ""}`}
                >
                  {laneName(String(name))}{" "}
                  <span className="tabular-nums">{count}</span>
                </button>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              {query.data.releaseGate}{" "}
              <Link className="text-primary underline" href="/audits">
                Open blind audits
              </Link>
              . Audit sessions are managed separately from this task queue.
            </p>
            {policy && (
              <details className="border rounded-lg p-4">
                <summary className="cursor-pointer font-medium">
                  Factory policy · revision {query.data.policy.revision}
                </summary>
                <fieldset
                  disabled={busy || !query.data.canConfigure}
                  className="mt-4 grid sm:grid-cols-2 gap-4"
                >
                  <label className="flex gap-2 items-center">
                    <input
                      type="checkbox"
                      checked={policy.assistanceAllowed}
                      onChange={(event) =>
                        setDraft({
                          ...policy,
                          assistanceAllowed: event.target.checked,
                        })
                      }
                    />
                    Allow optional model assistance
                  </label>
                  <label className="flex gap-2 items-center">
                    <input
                      type="checkbox"
                      checked={policy.requireAssignments}
                      onChange={(event) =>
                        setDraft({
                          ...policy,
                          requireAssignments: event.target.checked,
                        })
                      }
                    />
                    Require a current work claim
                  </label>
                  <label>
                    High risk lane{" "}
                    <select
                      className="border rounded p-2 w-full"
                      value={policy.highRiskLane}
                      onChange={(event) =>
                        setDraft({
                          ...policy,
                          highRiskLane: event.target
                            .value as Policy["highRiskLane"],
                        })
                      }
                    >
                      <option value="human_review">Human review</option>
                      <option value="escalation">Escalation</option>
                    </select>
                  </label>
                  <label>
                    Confidence review threshold{" "}
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      className="border rounded p-2 w-full"
                      value={policy.minimumConfidence}
                      onChange={(event) =>
                        setDraft({
                          ...policy,
                          minimumConfidence: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Redirection escalation threshold{" "}
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      className="border rounded p-2 w-full"
                      value={policy.redirectionThreshold}
                      onChange={(event) =>
                        setDraft({
                          ...policy,
                          redirectionThreshold: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <div className="self-end">
                    <Button
                      onClick={() =>
                        run(
                          () =>
                            api(`${base}/policy`, {
                              expectedRevision: query.data!.policy.revision,
                              definition: policy,
                            }),
                          "Policy revision saved.",
                        )
                      }
                    >
                      Save policy revision
                    </Button>
                  </div>
                </fieldset>
                <p className="text-sm text-muted-foreground mt-3">
                  Assistance stays optional. Live calls also require server
                  opt-in, authentication and owner consent. Policies cannot
                  enable automatic acceptance or weaken audit gates.
                </p>
              </details>
            )}
            <div className="grid lg:grid-cols-2 gap-6">
              <section className="border rounded-lg overflow-hidden">
                <h2 className="p-4 border-b font-medium">Work queue</h2>
                <ul className="max-h-[38rem] overflow-y-auto divide-y">
                  {query.data.items
                    .filter((item) => lane === "all" || item.lane === lane)
                    .map((item) => (
                      <li key={item.id}>
                        <button
                          onClick={() => {
                            setSelected(item.id);
                            setReason("");
                            setError("");
                            setNotice("");
                          }}
                          className={`w-full p-4 text-left hover:bg-secondary ${selected === item.id ? "bg-secondary" : ""}`}
                        >
                          <span className="block font-medium break-all">
                            {item.title}
                          </span>
                          <span className="text-sm capitalize">
                            {laneName(item.lane)} · v{item.version}
                          </span>
                          {item.assignedTo && (
                            <span className="block text-xs text-muted-foreground">
                              {item.assignedTo === query.data!.actor
                                ? "Claimed by you"
                                : "Claimed by another reviewer"}{" "}
                              {item.expiresAt && (
                                <>
                                  until{" "}
                                  {new Date(
                                    item.expiresAt,
                                  ).toLocaleTimeString()}
                                </>
                              )}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                </ul>
                {!query.data.items.length && (
                  <p className="p-4 text-muted-foreground">
                    Import work in Tasks or Trace2Preference to begin.
                  </p>
                )}
              </section>
              <section className="border rounded-lg p-4 space-y-4">
                <h2 className="font-medium">
                  {current ? current.title : "Select a work item"}
                </h2>
                {current && (
                  <>
                    <ul className="text-sm text-muted-foreground list-disc pl-5">
                      {current.reasons.map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                    </ul>
                    {current.quarantineReason && (
                      <p className="text-sm">
                        Hold reason: {current.quarantineReason}
                      </p>
                    )}
                    {current.workKind === "audit" && (
                      <Link href="/audits" className="text-primary underline">
                        Open assigned blind audit
                      </Link>
                    )}
                    {current.workKind !== "audit" &&
                      !current.quarantined &&
                      (current.lane !== "complete" ||
                        factory === "preference") && (
                        <Button
                          variant="outline"
                          disabled={
                            busy ||
                            Boolean(
                              current.assignedTo &&
                              current.assignedTo !== query.data.actor,
                            )
                          }
                          onClick={() =>
                            run(
                              () =>
                                api(
                                  `${base}/items/${encodeURIComponent(current.id)}/claim`,
                                  {
                                    expectedVersion: current.version,
                                    claimToken: current.claimToken,
                                  },
                                ),
                              "Work claimed for 10 minutes.",
                            )
                          }
                        >
                          {current.assignedTo === query.data.actor
                            ? "Renew claim"
                            : "Claim for 10 minutes"}
                        </Button>
                      )}
                    {members.data &&
                      current.workKind !== "audit" &&
                      !current.quarantined && (
                        <div className="flex gap-2 flex-wrap">
                          <label>
                            Assign to
                            <select
                              aria-label="Assign to member"
                              className="border rounded p-2 block"
                              value={assignee}
                              onChange={(event) =>
                                setAssignee(event.target.value)
                              }
                            >
                              <option value="">Choose a reviewer</option>
                              {members.data
                                .filter((member) =>
                                  ["owner", "reviewer", "adjudicator"].includes(
                                    member.role,
                                  ),
                                )
                                .map((member) => (
                                  <option
                                    key={member.userId}
                                    value={member.userId}
                                  >
                                    {member.userId} · {member.role}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <Button
                            className="self-end"
                            variant="outline"
                            disabled={busy || !assignee}
                            onClick={() =>
                              run(
                                () =>
                                  api(
                                    `${base}/items/${encodeURIComponent(current.id)}/claim`,
                                    {
                                      expectedVersion: current.version,
                                      expectedRevision: current.controlRevision,
                                      assignedTo: assignee,
                                      reassign: true,
                                      claimToken: current.claimToken,
                                    },
                                  ),
                                "Assignment saved; previous claim token revoked.",
                              )
                            }
                          >
                            Assign / reassign
                          </Button>
                        </div>
                      )}
                    {factory === "evidence" && evidence.data && (
                      <div className="space-y-3">
                        <div>
                          <h3 className="text-sm text-muted-foreground">
                            Question
                          </h3>
                          <p className="whitespace-pre-wrap">
                            {evidence.data.question}
                          </p>
                        </div>
                        <div>
                          <h3 className="text-sm text-muted-foreground">
                            Supplied evidence
                          </h3>
                          <p className="whitespace-pre-wrap rounded bg-secondary p-3">
                            {evidence.data.evidence}
                          </p>
                        </div>
                        <div>
                          <h3 className="text-sm text-muted-foreground">
                            Candidate answer
                          </h3>
                          <p className="whitespace-pre-wrap">
                            {evidence.data.candidateAnswer}
                          </p>
                        </div>
                    {factory === "evidence" && current.workKind !== "audit" && !current.quarantined && current.lane !== "complete" && (
                      <div className="space-y-3"><RoutingAdvice key={`route:${current.id}:${current.version}`} taskId={current.id} version={current.version} /><SharedNotes key={current.id} taskId={current.id} onCopy={setReason} /></div>
                    )}
                        {!current.quarantined &&
                          current.lane !== "complete" && (
                            <label>
                              Human label{" "}
                              <select
                                aria-label="Human label"
                                className="border rounded p-2 w-full"
                                value={label}
                                onChange={(event) =>
                                  setLabel(event.target.value)
                                }
                              >
                                <option value="supported">Supported</option>
                                <option value="contradicted">
                                  Contradicted
                                </option>
                                <option value="insufficient_evidence">
                                  Insufficient evidence
                                </option>
                              </select>
                            </label>
                          )}
                        {Boolean(evidence.data.proposal) && (
                          <p className="text-xs text-muted-foreground">
                            A proposal exists for this item. Its provenance will
                            be retained and this decision will conservatively
                            count as assisted.
                          </p>
                        )}
                      </div>
                    )}
                    {current.workKind !== "audit" && (
                      <label className="block">
                        Decision or quarantine reason
                        <textarea
                          aria-label="Decision or quarantine reason"
                          className="block border rounded p-2 w-full min-h-24 mt-1"
                          maxLength={2000}
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                        />
                      </label>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {factory === "evidence" &&
                        evidence.data &&
                        !current.quarantined &&
                        current.lane !== "complete" && (
                          <>
                            <Button
                              disabled={busy || !reason.trim()}
                              onClick={() =>
                                run(
                                  () =>
                                    api("/reviews", {
                                      taskId: current.id,
                                      version: evidence.data!.version,
                                      action: "label",
                                      correctedLabel: label,
                                      reason,
                                      activeMs: tracker.current.milliseconds(),
                                      claimToken: current.claimToken,
                                    }),
                                  "Human decision recorded.",
                                )
                              }
                            >
                              Record human decision
                            </Button>
                            <Button
                              variant="outline"
                              disabled={busy || !reason.trim()}
                              onClick={() =>
                                run(
                                  () =>
                                    api("/reviews", {
                                      taskId: current.id,
                                      version: evidence.data!.version,
                                      action: "escalate",
                                      reason,
                                      activeMs: tracker.current.milliseconds(),
                                      claimToken: current.claimToken,
                                    }),
                                  "Item escalated.",
                                )
                              }
                            >
                              Escalate
                            </Button>
                          </>
                        )}
                      {query.data.canConfigure &&
                        current.workKind !== "audit" && (
                          <Button
                            variant="outline"
                            disabled={busy || !reason.trim()}
                            onClick={() =>
                              run(
                                () =>
                                  api(
                                    `${base}/items/${encodeURIComponent(current.id)}/quarantine`,
                                    {
                                      expectedRevision: current.controlRevision,
                                      quarantined: !current.quarantined,
                                      reason,
                                    },
                                  ),
                                current.quarantined
                                  ? "Quarantine resolved."
                                  : "Item quarantined; new exports are blocked.",
                              )
                            }
                          >
                            {current.quarantined
                              ? "Resolve quarantine"
                              : "Quarantine"}
                          </Button>
                        )}
                    </div>
                  </>
                )}
              </section>
            </div>
          </>
        )
      )}
    </main>
  );
}
