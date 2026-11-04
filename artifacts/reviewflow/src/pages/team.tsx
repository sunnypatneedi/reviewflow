import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { projectHeaders, setProjectId } from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
type Project = { id: string; name: string; role: string };
type Member = { userId: string; role: string; revision: number };
type Budget = {
  enabled: boolean;
  maxCalls: number;
  used: number;
  remaining: number;
  revision: number;
};
export async function teamApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/reviewflow${path}`, {
    credentials: "same-origin",
    headers: {
      ...projectHeaders(),
      "content-type": "application/json",
      ...(body === undefined ? {} : { "x-reviewflow-csrf": "1" }),
    },
    ...(body === undefined
      ? {}
      : { method: "POST", body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error ?? `Request failed (${response.status})`);
  return value;
}
export default function Team() {
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => teamApi<Project[]>("/projects"),
  });
  const context = useQuery({
    queryKey: ["team-context"],
    queryFn: () =>
      teamApi<{ projectId: string; role: string; projectName: string }>(
        "/context",
      ),
  });
  const owner = context.data?.role === "owner",
    demo = context.data?.role === "demo";
  const members = useQuery({
    queryKey: ["members"],
    enabled: owner || context.data?.role === "adjudicator",
    queryFn: () => teamApi<Member[]>("/members"),
  });
  const budget = useQuery({
    queryKey: ["jev-budget"],
    enabled: owner || demo,
    queryFn: () => teamApi<Budget>("/jev"),
  });
  const [name, setName] = useState(""),
    [userId, setUserId] = useState(""),
    [role, setRole] = useState("reviewer");
  const [cap, setCap] = useState(10),
    [enabled, setEnabled] = useState(false),
    [consent, setConsent] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [plan, setPlan] = useState<unknown>(null);
  useEffect(() => {
    if (budget.data) {
      setCap(budget.data.maxCalls);
      setEnabled(budget.data.enabled);
      setConsent(false);
    }
  }, [budget.data?.revision]);
  function select(id: string) {
    setProjectId(id || null);
    if (id) sessionStorage.setItem("reviewflow.project", id);
    else sessionStorage.removeItem("reviewflow.project");
    queryClient.clear();
    location.assign("/team");
  }
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(message);
      await queryClient.invalidateQueries();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="p-4 min-[861px]:p-8 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Team & provider</h1>
        <p className="text-muted-foreground mt-2">
          Select a project, manage existing account access and prepare a bounded
          provider evaluation.
        </p>
      </header>
      {(error || context.error || projects.error) && (
        <p role="alert" className="text-destructive">
          {error || context.error?.message || projects.error?.message}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <section className="border rounded-lg p-4 space-y-3">
        <h2 className="font-semibold">Active project</h2>
        <label>
          Project{" "}
          <select
            className="border rounded p-2 max-w-full"
            aria-label="Active project"
            value={context.data?.projectId ?? ""}
            onChange={(event) => select(event.target.value)}
          >
            {projects.data?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} · {project.role}
              </option>
            ))}
          </select>
        </label>
        <Button variant="outline" onClick={() => select("")}>
          Return to personal project
        </Button>
        {!demo && (
          <div className="flex gap-2 flex-wrap">
            <label>
              New project name
              <input
                className="border rounded p-2 block"
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <Button
              className="self-end"
              disabled={busy || !name.trim()}
              onClick={() =>
                run(async () => {
                  const created = await teamApi<Project>("/projects", { name });
                  select(created.id);
                }, "Project created.")
              }
            >
              Create shared project
            </Button>
          </div>
        )}
        {demo && (
          <p className="text-sm text-muted-foreground">
            This anonymous demo is private to its session. Sign in with
            configured authentication to use shared projects.
          </p>
        )}
      </section>
      <section className="border rounded-lg p-4 space-y-4">
        <h2 className="font-semibold">Members & roles</h2>
        <p className="text-sm text-muted-foreground">
          Owners manage access. Reviewers label work; adjudicators resolve
          disagreements; auditors use blind audits; exporters create and
          download releases. Account IDs must belong to the people you intend to
          authorize. No invitation messages are sent.
        </p>
        {members.error && <p role="alert">{members.error.message}</p>}
        <ul className="divide-y">
          {members.data?.map((member) => (
            <li
              className="py-3 flex flex-wrap items-center gap-2"
              key={member.userId}
            >
              <span className="break-all flex-1">{member.userId}</span>
              <span>{member.role}</span>
              {owner && (
                <>
                  <select
                    aria-label={`Role for ${member.userId}`}
                    className="border rounded p-2"
                    value={member.role}
                    disabled={busy}
                    onChange={(event) =>
                      run(
                        () =>
                          teamApi("/members", {
                            userId: member.userId,
                            role: event.target.value,
                            expectedRevision: member.revision,
                          }),
                        "Membership updated; previous work claims were revoked.",
                      )
                    }
                  >
                    {[
                      "owner",
                      "reviewer",
                      "adjudicator",
                      "auditor",
                      "exporter",
                      "revoked",
                    ].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </>
              )}
            </li>
          ))}
        </ul>
        {owner && (
          <div className="flex gap-2 flex-wrap">
            <label>
              Account ID
              <input
                className="border rounded p-2 block"
                value={userId}
                maxLength={200}
                onChange={(event) => setUserId(event.target.value)}
              />
            </label>
            <label>
              Role
              <select
                className="border rounded p-2 block"
                value={role}
                aria-label="New member role"
                onChange={(event) => setRole(event.target.value)}
              >
                {[
                  "reviewer",
                  "adjudicator",
                  "auditor",
                  "exporter",
                  "owner",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <Button
              className="self-end"
              disabled={busy || !userId.trim()}
              onClick={() =>
                run(
                  () =>
                    teamApi("/members", { userId, role, expectedRevision: -1 }),
                  "Member added by account ID.",
                )
              }
            >
              Add member
            </Button>
          </div>
        )}
      </section>
      {(owner || demo) && (
        <section className="border rounded-lg p-4 space-y-4">
          <h2 className="font-semibold">Jev evaluation controls</h2>
          <p>
            Project provider: {budget.data?.enabled ? "Enabled" : "Off"}.
            Reserved calls: {budget.data?.used ?? 0}; remaining:{" "}
            {budget.data?.remaining ?? 0}.
          </p>
          <p className="text-sm text-muted-foreground">
            The lifetime cap counts every request reservation, including
            failures, retries and uncertain timeouts. It is a call limit, not a
            currency quote. Server opt-in and outbound privacy confirmation
            remain required. Suggestions never finalize work.
          </p>
          <label className="block">
            Lifetime call cap (0–100)
            <input
              type="number"
              min="0"
              max="100"
              value={cap}
              className="border rounded p-2 block"
              onChange={(event) => setCap(Number(event.target.value))}
            />
          </label>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enable optional Jev requests for this project
          </label>
          {enabled && (
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              I authorize this call budget. Each evaluation still requires
              review of its actual outbound text.
            </label>
          )}
          <Button
            disabled={busy || !budget.data || (enabled && !consent)}
            onClick={() =>
              run(
                () =>
                  teamApi("/jev", {
                    expectedRevision: budget.data!.revision,
                    enabled,
                    maxCalls: cap,
                    ownerConsent: consent,
                  }),
                "Provider budget saved.",
              )
            }
          >
            Save provider controls
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(
                async () => setPlan(await teamApi("/jev/evaluation-plan")),
                "Evaluation plan prepared; no requests were made.",
              )
            }
          >
            Prepare evaluation plan
          </Button>
          {plan !== null && (
            <pre className="text-xs whitespace-pre-wrap break-all bg-secondary p-3 rounded">
              {JSON.stringify(plan, null, 2)}
            </pre>
          )}
        </section>
      )}
    </main>
  );
}
