import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitCompareArrows, Upload, ShieldCheck, Download, Eye, ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { traceRequest, downloadTrace, saveTraceFile } from "@/lib/trace-api";
import { traceSample } from "@/lib/trace-sample";

type Decision = "a" | "b" | "tie" | "both_unacceptable" | "insufficient_evidence" | "escalate";
type Candidate = { response: string; candidateIdentity?: unknown; events?: unknown[]; provenance?: unknown; kind?: string };
type Comparison = {
  id: string; task?: string; scenarioId?: string; eligible: boolean; reasons?: string[];
  version: number; a?: Candidate; b?: Candidate; context?: unknown; evidence?: unknown[];
  revealed?: boolean; proposal?: unknown; review?: { decision: Decision }; quality: { status: "passed" | "pending" | "failed"; note: string };
  pendingAnnotation?: { decision: Decision; reviewMode: "human_only" | "model_assisted"; importedAt: string } | null;
};
type Release = { id: string; name: string; createdAt?: string; itemCount: number; trainingCount: number; digest: string };
const decisions: [Decision, string][] = [
  ["a", "A preferred"], ["b", "B preferred"], ["tie", "Tie"], ["both_unacceptable", "Both unacceptable"],
  ["insufficient_evidence", "Insufficient evidence"], ["escalate", "Escalate"],
];
const panel = "rounded-lg border border-border bg-card";
const code = "whitespace-pre-wrap break-words text-xs leading-relaxed font-mono bg-muted/40 rounded-md p-4 max-h-72 overflow-auto";
const pretty = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value, null, 2);

/** Only foreground, focused, recently active time is measured. This is not a claim of human effort accuracy. */
function useActiveEffort(key: string) {
  const total = useRef(0);
  const lastInput = useRef(0);
  const paused = useRef(false);
  useEffect(() => {
    total.current = 0;
    lastInput.current = performance.now();
    const activity = () => { lastInput.current = performance.now(); };
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach(event => window.addEventListener(event, activity, true));
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      if (!paused.current && document.visibilityState === "visible" && document.hasFocus() && now - lastInput.current < 30_000) {
        total.current += Math.min(now - previous, 1500);
      }
      previous = now;
    }, 500);
    return () => { clearInterval(timer); events.forEach(event => window.removeEventListener(event, activity, true)); };
  }, [key]);
  return { total, paused };
}

export default function Traces() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState("");
  const [document, setDocument] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [name, setName] = useState("");
  const [annotations, setAnnotations] = useState("");
  const [annotationVersions, setAnnotationVersions] = useState<Record<string, number>>({});
  const [annotationMode, setAnnotationMode] = useState<"human_only" | "model_assisted">("human_only");
  const [kitCondition, setKitCondition] = useState<"human_only" | "model_assisted">("human_only");
  const [annotationIssues, setAnnotationIssues] = useState<unknown>(null);
  const list = useQuery({ queryKey: ["traces", "comparisons"], queryFn: () => traceRequest<Comparison[]>("/comparisons"), refetchInterval: 15_000 });
  const releases = useQuery({ queryKey: ["traces", "releases"], queryFn: () => traceRequest<Release[]>("/releases"), refetchInterval: 15_000 });
  const detail = useQuery({
    queryKey: ["traces", "comparison", selected],
    queryFn: () => traceRequest<Comparison>(`/comparisons/${encodeURIComponent(selected)}`),
    enabled: Boolean(selected), refetchInterval: 15_000,
  });
  useEffect(() => { window.document.title = "Trace2Preference · ReviewFlow"; }, []);
  const run = async (action: () => Promise<unknown>, message: string) => {
    setPending(true); setError(""); setNotice("");
    try {
      await action();
      await qc.invalidateQueries({ queryKey: ["traces"] });
      setNotice(message);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setPending(false); }
  };
  return (
    <div className="p-6 lg:p-8 max-w-screen-2xl mx-auto space-y-6">
      <header className="flex flex-wrap gap-4 justify-between items-start">
        <div>
          <div className="flex items-center gap-2 text-primary text-xs font-semibold uppercase tracking-wider mb-2"><GitCompareArrows size={16} /> Observable runs → human preferences</div>
          <h1 className="text-3xl font-bold tracking-tight">Trace2Preference</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">Compare actual responses at a shared, fully known decision point. Partial traces stay visible; only eligible, human-finalized comparisons enter training exports.</p>
        </div>
        <span className="text-xs rounded-full border px-3 py-1.5 flex gap-2 items-center"><ShieldCheck size={14} /> External evaluation off by default</span>
      </header>
      {(error || list.error || detail.error || releases.error) && <div role="alert" data-testid="trace-error" className="border border-destructive/30 bg-destructive/5 text-destructive rounded-md p-4 text-sm">{error || (list.error || detail.error || releases.error)?.message}</div>}
      {notice && <div role="status" data-testid="trace-notice" className="border rounded-md p-3 text-sm bg-primary/5">{notice}</div>}
      <section className={`${panel} p-5`}>
        <h2 className="font-semibold flex items-center gap-2"><Upload size={17} /> Import observable runs</h2>
        <p className="text-xs text-muted-foreground mt-2">JSON is data only: imported links, tool calls, and scripts are never executed. Import only traces you are authorized to review.</p>
        <div className="flex flex-wrap gap-3 items-center mt-4">
          <Input type="file" accept=".json,application/json" aria-label="Trace JSON file" data-testid="input-trace-file" className="max-w-sm" onChange={async event => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > 5_000_000) { setError("Trace file exceeds the 5 MB browser import limit."); return; }
            try { setDocument(await file.text()); setError(""); } catch { setError("Unable to read this file."); }
          }} />
          <Button variant="outline" data-testid="download-trace-sample" disabled={pending} onClick={() => { saveTraceFile(JSON.stringify(traceSample, null, 2), "trace-scripted-synthetic.json"); setNotice("Synthetic scripted sample downloaded; this is not a real model run."); }}>Download synthetic sample</Button>
        </div>
        <details className="mt-3"><summary className="text-sm cursor-pointer" data-testid="toggle-trace-json">Paste or inspect JSON</summary>
          <textarea className={`${code} w-full border mt-2 h-36`} aria-label="Trace JSON document" data-testid="input-trace-json" value={document} onChange={event => setDocument(event.target.value)} placeholder="Paste your exported trace document" />
        </details>
        <Button className="mt-3" variant={selected ? "outline" : "default"} disabled={!document.trim() || pending} data-testid="import-traces" onClick={() => run(async () => {
          let parsed: unknown;
          try { parsed = JSON.parse(document); } catch { throw new Error("Invalid JSON. No traces were imported."); }
          await traceRequest("/imports", { document: parsed });
          setDocument("");
        }, "Import validated. Eligible and excluded comparisons are listed below.")}>{pending ? "Working…" : "Validate & import"}</Button>
      </section>
      <div className="grid xl:grid-cols-[260px_minmax(0,1fr)] gap-5">
        <section className={`${panel} self-start overflow-hidden`}>
          <h2 className="p-4 font-semibold border-b text-sm">Comparison queue <span className="text-muted-foreground font-normal">({list.data?.length ?? 0})</span></h2>
          {list.isLoading && <p className="p-4 text-sm" role="status">Loading comparisons…</p>}
          {list.data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">Import traces to begin. No reviews or model runs are manufactured.</p>}
          <div className="max-h-[650px] overflow-auto">{list.data?.map(item => <button type="button" key={item.id} data-testid={`select-comparison-${item.id}`} aria-pressed={selected === item.id} className={`w-full text-left p-4 border-b last:border-0 hover:bg-secondary ${selected === item.id ? "bg-primary/5 border-l-2 border-l-primary" : ""}`} onClick={() => { setSelected(item.id); setError(""); setNotice(""); }}>
            <p className="text-sm font-medium truncate">{item.task || item.scenarioId || "Imported comparison"}</p>
            <p className="text-xs text-muted-foreground mt-1">{item.pendingAnnotation ? "Confirm returned annotation" : item.review ? "Decision recorded" : "Awaiting review"} · {item.eligible ? "Context eligible" : "Excluded / partial"}</p>
          </button>)}</div>
        </section>
        {!selected ? <div className={`${panel} p-10 flex flex-col justify-center items-center text-center min-h-80`}><GitCompareArrows className="text-muted-foreground mb-4" size={32} /><h2 className="font-semibold">Evidence first. Preference second.</h2><p className="text-sm text-muted-foreground mt-2 max-w-md">Select a comparison to inspect its context and actual responses. Candidate identities and model proposals begin hidden.</p></div>
          : detail.isLoading ? <p role="status">Loading evidence…</p>
          : detail.data && <TraceReview key={selected} comparison={detail.data} run={run} pending={pending} />}
      </div>
      <section className={`${panel} p-5 space-y-4`}>
        <div><h2 className="font-semibold">Reproducible dataset releases</h2><p className="text-xs text-muted-foreground mt-1">Immutable snapshots. Complete records preserve nonbinary outcomes and exclusion reasons; preference exports include only eligible finalized A/B preferences. Related scenario variants stay in one split. Review trace text for private content before sharing.</p></div>
        <div className="flex gap-3 flex-wrap"><Input aria-label="Trace release name" data-testid="input-trace-release-name" placeholder="Release name" className="max-w-sm" value={name} onChange={event => setName(event.target.value)} /><Button variant="outline" disabled={!name.trim() || pending} data-testid="create-trace-release" onClick={() => run(async () => { await traceRequest("/releases", { name: name.trim() }); setName(""); }, "Immutable release created.")}>Create release</Button></div>
        {releases.isLoading && <p className="text-sm">Loading releases…</p>}
        {releases.data?.length === 0 && <p className="text-sm text-muted-foreground">No trace dataset releases yet.</p>}
        {releases.data?.map(release => <div key={release.id} data-testid={`trace-release-${release.id}`} className="border-t pt-4 flex flex-wrap gap-3 items-center justify-between"><div className="min-w-0"><p className="font-medium text-sm">{release.name}</p><p className="text-xs text-muted-foreground break-all">Snapshot {release.id}</p><p className="text-xs text-muted-foreground break-all max-w-lg">SHA-256: {release.digest}</p><p className="text-xs">{release.trainingCount} training included · {release.itemCount - release.trainingCount} training excluded · {release.itemCount} complete records</p></div><div className="flex flex-wrap gap-2">
          {(["complete", "preference"] as const).map(format => <Button key={format} variant="outline" size="sm" disabled={pending} data-testid={`download-${format}-${release.id}`} onClick={() => run(() => downloadTrace(`/releases/${encodeURIComponent(release.id)}/download?format=${format}`, `trace-${release.id}-${format}.${format === "complete" ? "json" : "jsonl"}`), `${format} export downloaded.`)}><Download size={14} className="mr-2" />{format === "complete" ? "Complete record" : "Preference training"}</Button>)}
        </div></div>)}
      </section>
      <section className={`${panel} p-5 space-y-3`}>
        <h2 className="font-semibold">Label Studio & study kit</h2>
        <p className="text-xs text-muted-foreground max-w-3xl">Download equivalent tasks, a preference-review configuration, and the stable candidate-order manifest. Human-only tasks omit model proposals. Assisted kits contain proposals behind a recorded reveal control; their raw JSON is not a secrecy boundary. Actual returned reveal records determine assistance mode. The Python reconciliation and assignment commands preserve nonbinary outcomes and avoid related cases across conditions. The kit awaits genuine participant data; mechanical checks are not benchmark wins.</p>
        <label className="text-sm flex flex-wrap gap-3 items-center">Download kit condition<select data-testid="select-labelstudio-kit-condition" className="border rounded-md p-2 bg-background" value={kitCondition} onChange={event => setKitCondition(event.target.value as typeof kitCondition)}><option value="human_only">Human-only</option><option value="model_assisted">Model-assisted (optional recorded reveal)</option></select></label>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" data-testid="download-trace-labelstudio" disabled={pending || !list.data?.length} onClick={() => run(() => downloadTrace(`/labelstudio?condition=${kitCondition}`, `trace-labelstudio-${kitCondition}-kit.json`), "Label Studio kit downloaded. Keep its manifest and condition for order-safe annotation reconciliation.")}><Download size={14} className="mr-2" />Label Studio kit</Button>
          <Button variant="outline" data-testid="download-trace-analysis" disabled={pending} onClick={() => run(() => downloadTrace("/analysis", "trace-review-analysis.json"), "Measured review analysis downloaded; missing measurements remain unavailable.")}><Download size={14} className="mr-2" />Measured review analysis</Button>
        </div>
        <div className="border-t pt-4 space-y-3">
          <h3 className="text-sm font-semibold">Return Label Studio annotations</h3>
          <p className="text-xs text-muted-foreground">Upload the exported Label Studio JSON tasks with their unchanged task data. Server-side reconciliation preserves canonical candidate order and all six outcomes. Imported decisions are staged, not finalized: inspect each affected comparison, explicitly confirm, then complete its required quality check. Mechanical compatibility does not establish genuine human review or live Label Studio compatibility.</p>
          <Input type="file" aria-label="Label Studio annotations JSON" accept=".json,application/json" data-testid="input-labelstudio-annotations" disabled={pending || !list.data?.length} className="max-w-sm" onChange={async event => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > 5_000_000) { setError("Annotation file exceeds the 5 MB browser limit."); return; }
            try {
              setAnnotations(await file.text());
              setAnnotationVersions(Object.fromEntries((list.data ?? []).map(item => [item.id, item.version])));
              setAnnotationIssues(null); setError("");
            } catch { setError("Unable to read annotation file."); }
          }} />
          <label className="text-sm flex flex-wrap items-center gap-3">Original downloaded kit condition<select data-testid="select-labelstudio-review-mode" className="border rounded-md p-2 bg-background" value={annotationMode} onChange={event => setAnnotationMode(event.target.value as typeof annotationMode)}><option value="human_only">Human-only kit</option><option value="model_assisted">Model-assisted kit</option></select></label>
          <p className="text-xs text-muted-foreground">Select the kit used to create these annotations. Actual assistance mode is derived from its returned reveal record, not this selection. Imported review duration is unavailable unless separately instrumented; confirmation timing is not Label Studio participant effort.</p>
          <Button variant="outline" disabled={!annotations || pending} data-testid="reconcile-labelstudio-annotations" onClick={() => run(async () => {
            let parsed: unknown;
            try { parsed = JSON.parse(annotations); } catch { throw new Error("Invalid Label Studio JSON. No annotations were staged."); }
            if (!Array.isArray(parsed)) throw new Error("Expected a Label Studio JSON array of exported tasks.");
            const result = await traceRequest<{ pending: unknown; issues: unknown[] }>("/labelstudio/reconcile", { annotations: parsed, expectedVersions: annotationVersions, reviewMode: annotationMode });
            setAnnotationIssues(result.issues);
            setAnnotations("");
          }, "Annotation reconciliation finished. Inspect staged decisions in the queue and explicitly confirm them.")}>Reconcile & stage annotations</Button>
          {annotationIssues != null && <pre className={code} data-testid="labelstudio-reconciliation-issues">{pretty(annotationIssues)}</pre>}
        </div>
      </section>
    </div>
  );
}

function TraceReview({ comparison: c, run, pending }: { comparison: Comparison; run: (action: () => Promise<unknown>, message: string) => Promise<void>; pending: boolean }) {
  const [reversed, setReversed] = useState(false);
  const [decision, setDecision] = useState<Decision | "">("");
  const [reviewVersion, setReviewVersion] = useState(c.version);
  const [refs, setRefs] = useState("");
  const [consent, setConsent] = useState(false);
  const [outboundReviewed, setOutboundReviewed] = useState(false);
  const [annotationConfirmed, setAnnotationConfirmed] = useState(false);
  const [provider, setProvider] = useState("simulator");
  const [qualityNote, setQualityNote] = useState("");
  const [qualityStatus, setQualityStatus] = useState<"passed" | "pending" | "failed">("pending");
  const [qualityVersion, setQualityVersion] = useState(c.version);
  const [auditing, setAuditing] = useState(false);
  const effort = useActiveEffort(c.id);
  const auditEffort = useActiveEffort(`${c.id}:quality`);
  const waiting = useRef(0);
  const auditWaiting = useRef(0);
  effort.paused.current = pending || auditing;
  auditEffort.paused.current = pending || !auditing;
  const assistedRequest = async (suffix: string, body: unknown) => {
    const started = performance.now();
    const counter = auditing ? auditWaiting : waiting;
    try { return await traceRequest(`${path}${suffix}`, body); }
    finally { counter.current += performance.now() - started; }
  };
  const path = `/comparisons/${encodeURIComponent(c.id)}`;
  useEffect(() => { if (!decision) setReviewVersion(c.version); }, [c.version, decision]);
  useEffect(() => { if (!qualityNote) setQualityVersion(c.version); }, [c.version, qualityNote]);
  useEffect(() => { setConsent(false); setOutboundReviewed(false); setAnnotationConfirmed(false); }, [c.version]);
  const trainingReady = c.eligible && !c.pendingAnnotation && ["a", "b"].includes(c.review?.decision ?? "") && c.quality.status === "passed";
  // Labels remain stable candidate keys. Reordering cards never relabels saved judgments.
  const order = reversed ? (["b", "a"] as const) : (["a", "b"] as const);
  return <section className={`${panel} p-5 space-y-5 min-w-0`}>
    <div className="flex flex-wrap gap-3 justify-between"><div><h2 className="font-semibold">{c.task || "Inspect comparison"}</h2><p className="text-xs text-muted-foreground mt-1">Version {c.version} · {c.revealed ? "Assisted reveal recorded" : "Blind review"}</p></div><span data-testid="trace-eligibility" className={`text-xs rounded-md px-3 py-2 self-start ${c.eligible ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"}`}>{c.eligible ? "Matching exporter-attested context" : "Not eligible for training"}</span></div>
    <p className="text-xs text-muted-foreground">Blind mode hides structured candidate identities and model proposals. Original prompts, responses, or events may self-identify their source; these actual texts are not rewritten to fabricate blinding. Context completeness is exporter-attested, not independently verified capture.</p>
    {c.reasons?.length ? <div className="text-sm border rounded-md p-3 bg-amber-500/5" data-testid="trace-exclusion-reasons"><strong>Excluded:</strong><ul className="list-disc ml-5">{c.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div> : null}
    <div className="text-xs rounded-md bg-muted/40 p-3" data-testid="trace-training-readiness"><strong>{trainingReady ? "Ready for preference training." : "Not included in preference training yet."}</strong> {c.pendingAnnotation ? "Returned Label Studio annotation requires explicit confirmation. " : ""}{!c.review ? "Human decision required. " : !["a", "b"].includes(c.review.decision) ? "This nonbinary or unresolved outcome stays in the complete record only. " : ""}{c.quality.status !== "passed" ? `Required quality check is ${c.quality.status}. ` : ""}{!c.eligible ? "Context eligibility requirements are not met. " : ""}Complete evidence exports preserve the record and its exclusion reasons.</div>
    <details open><summary className="text-sm font-medium cursor-pointer" data-testid="toggle-trace-context">Task & model-visible context</summary><p className="text-xs text-muted-foreground mt-2">Equality is checked across the captured context. Completeness is the importer's assertion, not proof that capture was complete.</p><pre className={`${code} mt-2`} data-testid="trace-context">{c.context == null ? "Context not captured. Do not infer or manufacture missing context." : pretty(c.context)}</pre></details>
    <div className="flex justify-end"><Button variant="ghost" size="sm" data-testid="reverse-trace-display" onClick={() => setReversed(value => !value)}><ArrowLeftRight size={14} className="mr-2" />Swap positions (keep labels)</Button></div>
    <div className="grid md:grid-cols-2 gap-4">{order.map(key => <article key={key} className="border rounded-md min-w-0 overflow-hidden"><h3 className="border-b bg-muted/40 p-3 text-sm font-semibold">Candidate {key.toUpperCase()} <span className="font-normal text-xs text-muted-foreground">{c[key]?.kind === "scripted" ? "· Scripted fixture" : c[key]?.kind === "telemetry" ? "· Partial telemetry" : c[key]?.kind === "real_model" ? "· Imported model run" : ""}</span></h3><pre className={`${code} bg-transparent min-h-28`} data-testid={`trace-response-${key}`}>{c[key]?.response ?? "No actual response captured."}</pre>{c.revealed && c[key]?.candidateIdentity != null && <pre className="text-xs whitespace-pre-wrap break-words p-3 border-t">{pretty(c[key]?.candidateIdentity)}</pre>}<details className="border-t p-3"><summary className="cursor-pointer text-xs" data-testid={`toggle-events-${key}`}>Observable events & evidence</summary><pre className={`${code} mt-2`} data-testid={`trace-events-${key}`}>{pretty(c[key]?.events ?? [])}</pre>{c.revealed && <pre className={code}>{pretty(c[key]?.provenance ?? {})}</pre>}</details></article>)}</div>
    {c.evidence && <details><summary className="cursor-pointer text-sm" data-testid="toggle-trace-evidence">Additional evidence references</summary><pre className={code}>{pretty(c.evidence)}</pre></details>}
    {c.pendingAnnotation && <div className="border rounded-md p-4 space-y-3 bg-amber-500/5" data-testid="trace-pending-annotation">
      <h3 className="text-sm font-semibold">Returned Label Studio decision · awaiting confirmation</h3>
      <p className="text-sm">{decisions.find(([value]) => value === c.pendingAnnotation?.decision)?.[1] ?? c.pendingAnnotation.decision} · {c.pendingAnnotation.reviewMode === "human_only" ? "Human-only" : "Model-assisted"}</p>
      <p className="text-xs text-muted-foreground">The outcome refers to stable candidate A/B, not current screen position. This import is not yet a finalized human judgment. Its Label Studio review duration is unavailable; confirmation effort is recorded as audit effort, not original review time.</p>
      <label className="text-sm flex gap-2"><input type="checkbox" data-testid="confirm-labelstudio-checkbox" checked={annotationConfirmed} onChange={event => setAnnotationConfirmed(event.target.checked)} />I inspected this evidence and confirm the returned canonical decision and declared review condition.</label>
      <Button data-testid="confirm-labelstudio-decision" disabled={!annotationConfirmed || pending} onClick={() => run(async () => {
        await traceRequest(`${path}/confirm-labelstudio`, { expectedVersion: c.version, evidenceRefs: refs.split("\n").map(value => value.trim()).filter(Boolean), effort: { activeMs: null, correctionMs: null, waitingMs: Math.round(waiting.current + auditWaiting.current), auditMs: Math.round(effort.total.current + auditEffort.total.current) } });
        setAnnotationConfirmed(false); effort.total.current = 0; auditEffort.total.current = 0; waiting.current = 0; auditWaiting.current = 0;
      }, "Label Studio decision confirmed. Required quality check must pass before training inclusion.")}>Confirm returned decision</Button>
    </div>}
    <div className="border-t pt-4 space-y-3">
      <div><h3 className="font-semibold text-sm">Human preference</h3><p className="text-xs text-muted-foreground mt-1">Judge the displayed evidence, not confidence. Escalation and insufficient evidence remain unresolved for training.</p></div>
      {c.review && <p data-testid="trace-saved-decision" className="text-sm bg-primary/5 p-3 rounded-md">Saved decision: <strong>{decisions.find(([key]) => key === c.review?.decision)?.[1] ?? c.review.decision}</strong>. A later correction creates a new revision; earlier releases remain unchanged.</p>}
      <fieldset disabled={pending || Boolean(c.pendingAnnotation)} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2"><legend className="sr-only">Preference outcome</legend>{decisions.map(([value, label]) => <label key={value} className={`cursor-pointer text-sm border rounded-md p-3 flex gap-2 items-center ${decision === value ? "border-primary bg-primary/5" : ""}`}><input data-testid={`decision-${value}`} type="radio" name={`decision-${c.id}`} checked={decision === value} onChange={() => setDecision(value)} />{label}</label>)}</fieldset>
      {decision && reviewVersion !== c.version && <div role="alert" className="text-sm text-amber-700 border rounded-md p-3">This comparison changed while you were deciding. Review the latest evidence before choosing again. <Button variant="outline" size="sm" data-testid="reset-stale-trace-review" onClick={() => { setDecision(""); setRefs(""); }}>Clear stale draft</Button></div>}
      <label className="block text-xs font-medium">Evidence references (one observable event/reference ID per line)<textarea data-testid="input-trace-evidence-refs" value={refs} onChange={event => setRefs(event.target.value)} className="mt-2 w-full border rounded-md p-3 bg-background font-mono text-xs" rows={2} /></label>
      <p className="text-xs text-muted-foreground">Active effort measures focused interaction with a 30-second idle cutoff and excludes requests in flight. Opening the quality check switches timing to audit effort. Waiting records completed assistance requests, not save latency or background refreshes; provider service latency is measured separately. These are interface measurements, not verified human-effort claims.</p>
      <Button data-testid="save-trace-review" variant={c.pendingAnnotation ? "outline" : "default"} disabled={!decision || pending || Boolean(c.pendingAnnotation) || reviewVersion !== c.version} onClick={() => run(async () => {
        await traceRequest(`${path}/reviews`, { decision, expectedVersion: reviewVersion, evidenceRefs: refs.split("\n").map(value => value.trim()).filter(Boolean), effort: { activeMs: c.review ? null : Math.round(effort.total.current), correctionMs: c.review ? Math.round(effort.total.current) : null, waitingMs: Math.round(waiting.current), auditMs: null } });
        setDecision(""); effort.total.current = 0; waiting.current = 0;
      }, "Human decision saved against this comparison version.")}>{pending ? "Saving…" : c.review ? "Save correction" : "Record human preference"}</Button>
    </div>
    <details className="border-t pt-4" onToggle={event => setAuditing(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium" data-testid="toggle-trace-quality">Required quality check · {c.quality.status}</summary><p className="text-xs text-muted-foreground mt-3">An authorized owner or adjudicator must verify evidence, privacy, context eligibility, and the decision before this example can enter training. While this section is open, active timing is attributed to audit effort instead of decision effort. Close it to resume decision timing. This is a recorded check, not a claim of independent review.</p>{c.quality.note && <p className="text-sm mt-2" data-testid="trace-quality-note">{c.quality.note}</p>}<label className="flex gap-3 items-center text-sm mt-3">Check result<select className="border rounded-md bg-background p-2" data-testid="select-trace-quality" value={qualityStatus} onChange={event => setQualityStatus(event.target.value as typeof qualityStatus)}><option value="pending">Pending</option><option value="passed">Passed</option><option value="failed">Failed</option></select></label><label className="block text-xs mt-3">Quality check note<Input className="mt-2" data-testid="input-trace-quality-note" value={qualityNote} onChange={event => setQualityNote(event.target.value)} /></label>{qualityNote && qualityVersion !== c.version && <p role="alert" className="text-sm mt-2">This comparison changed. Clear the note and recheck the latest decision before submitting.</p>}<Button className="mt-3" variant="outline" data-testid="save-trace-quality" disabled={pending || !qualityNote.trim() || qualityVersion !== c.version} onClick={() => run(async () => { await traceRequest(`${path}/quality`, { status: qualityStatus, note: qualityNote.trim(), expectedVersion: qualityVersion, effort: { auditMs: Math.round(auditEffort.total.current), waitingMs: Math.round(auditWaiting.current) } }); setQualityNote(""); auditEffort.total.current = 0; auditWaiting.current = 0; }, "Quality check recorded.")}>Record quality check</Button></details>
    <details className="border-t pt-4"><summary className="text-sm font-medium cursor-pointer" data-testid="toggle-trace-assistance">Optional model assistance</summary><p className="text-xs text-muted-foreground mt-3">Revealing candidate identities or proposals is recorded separately as assisted review. Simulator judgments are scripted, not real model judgments. Jev returns typed judgments only; it does not rewrite responses or learn from corrections.</p>
      {!c.revealed ? <Button variant="outline" className="mt-3" data-testid="reveal-trace-assistance" disabled={pending} onClick={() => run(() => assistedRequest("/reveal", {}), "Assisted reveal recorded.")}><Eye size={14} className="mr-2" />Reveal identities & assistance</Button>
        : <div className="space-y-3 mt-3"><label className="text-sm flex items-center gap-3">Evaluator<select data-testid="select-trace-provider" className="border rounded-md p-2 bg-background" value={provider} onChange={event => { setProvider(event.target.value); setConsent(false); setOutboundReviewed(false); }}><option value="simulator">No-key simulator (scripted)</option><option value="jev">Jev (external, optional)</option></select></label>{provider === "jev" && <><label className="flex gap-2 text-xs items-start"><input type="checkbox" data-testid="review-outbound-trace-jev" checked={outboundReviewed} onChange={event => setOutboundReviewed(event.target.checked)} />I inspected the actual context and responses for private data, reference answers, and earlier human decisions and confirm this content is appropriate to send. Schema checks alone cannot establish absence of sensitive information embedded in text.</label><label className="flex gap-2 text-xs items-start"><input type="checkbox" data-testid="consent-trace-jev" checked={consent} onChange={event => setConsent(event.target.checked)} />I am authorized and explicitly consent to sending the captured context and actual candidate responses to Jev. Structured reference answers and human decisions are excluded; I reviewed raw text separately. External evaluation may incur cost.</label></>}<Button variant="outline" data-testid="request-trace-proposal" disabled={pending || !c.eligible || (provider === "jev" && (!consent || !outboundReviewed))} onClick={() => run(() => assistedRequest("/proposals", { provider, consent, outboundReviewed }), "Proposal recorded separately from the human decision.")}>Request proposal</Button><pre data-testid="trace-model-proposal" className={code}>{c.proposal ? pretty(c.proposal) : "No model proposal. A failed live evaluation never falls back to simulation."}</pre></div>}
    </details>
  </section>;
}