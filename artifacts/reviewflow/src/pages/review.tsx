import { useEffect, useRef, useState } from "react";
import { useGetNextReview, useSubmitReview, getGetNextReviewQueryKey, getGetMetricsQueryKey } from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { SimulatedBadge } from "@/components/simulated-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Check, X, AlertTriangle } from "lucide-react";
import { ActiveTimeTracker } from "@/lib/active-time";

export default function Review() {
  const { data: item, isLoading } = useGetNextReview();
  const submitReview = useSubmitReview();
  const [reason, setReason] = useState("");
  const [correctedLabel, setCorrectedLabel] = useState<any>("");
  const activeTime = useRef(new ActiveTimeTracker());

  useEffect(() => {
    const isActive = () => document.visibilityState === "visible" && document.hasFocus();
    activeTime.current.reset(isActive());
    const update = () => activeTime.current.setActive(isActive());
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      update();
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, [item?.task.id]);

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading queue...</div>;
  if (!item) return <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-4">
    <Check className="w-12 h-12 text-primary/20" />
    <div className="text-lg font-medium text-foreground">Inbox Zero</div>
    <div>No tasks pending review.</div>
  </div>;

  const handleAction = (action: 'accept' | 'correct' | 'escalate') => {
    submitReview.mutate({
      data: {
        taskId: item.task.id,
        version: item.task.version,
        action,
        reason: action === 'accept' ? undefined : reason || undefined,
        correctedLabel: action === 'correct' ? correctedLabel : undefined,
        activeMs: activeTime.current.milliseconds(),
      }
    }, {
      onSuccess: () => {
        setReason("");
        setCorrectedLabel("");
        queryClient.invalidateQueries({ queryKey: getGetNextReviewQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMetricsQueryKey() });
      }
    });
  };

  const p = item.task.proposal;

  return (
    <div className="flex h-full w-full bg-secondary/20">
      {/* Pane 1: Context */}
      <div className="w-1/4 max-w-[320px] border-r border-border bg-card p-6 overflow-y-auto flex flex-col space-y-6">
        <div>
          <h2 className="font-semibold uppercase text-[10px] tracking-widest text-muted-foreground mb-3">Context</h2>
          <div className="space-y-4">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Task External ID</div>
              <div className="font-mono text-sm bg-secondary px-2 py-1 rounded inline-block">{item.task.externalId}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Risk Level</div>
              <div className="capitalize text-sm font-medium">{item.task.risk}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Mode</div>
              <div>
                {item.task.mode === 'demo' ? <SimulatedBadge mode={item.task.mode} /> : <span className="text-sm font-medium">Live</span>}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Routing Reasons</div>
              <ul className="list-disc list-inside text-sm text-foreground/80 space-y-1 bg-amber-50 p-3 rounded border border-amber-100 text-amber-900">
                {item.routingReasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Pane 2: Content */}
      <div className="flex-1 border-r border-border bg-background p-8 overflow-y-auto space-y-8">
        <div>
          <h2 className="font-semibold text-lg text-foreground mb-3">Question</h2>
          <p className="text-foreground/90 text-lg leading-relaxed">{item.task.question}</p>
        </div>
        <div>
          <h2 className="font-semibold text-lg text-foreground mb-3">Evidence Excerpt</h2>
          <div className="bg-secondary/40 p-5 rounded-lg font-mono text-sm leading-relaxed border border-border/60 text-foreground/80 whitespace-pre-wrap">
            {item.task.evidence}
          </div>
        </div>
        <div>
          <h2 className="font-semibold text-lg text-foreground mb-3">Candidate Answer</h2>
          <p className="text-foreground/90 text-lg leading-relaxed">{item.task.candidateAnswer}</p>
        </div>
      </div>

      {/* Pane 3: Review */}
      <div className="w-[360px] bg-card p-6 flex flex-col overflow-y-auto">
        <div>
          <h2 className="font-semibold uppercase text-[10px] tracking-widest text-muted-foreground mb-4">Model Proposal</h2>
          {p ? (
            <div className="space-y-3">
              <div className="flex flex-col bg-secondary/40 p-4 rounded-lg border border-border gap-1">
                <span className="text-xs text-muted-foreground">Proposed Label</span>
                <span className="font-mono text-lg text-primary font-bold">{p.label}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-secondary/20 p-3 rounded border border-border/50">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Confidence</div>
                  <div className="font-mono text-sm">{(p.confidence * 100).toFixed(1)}%</div>
                </div>
                <div className="bg-secondary/20 p-3 rounded border border-border/50">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Latency</div>
                  <div className="font-mono text-sm">{p.latencyMs}ms</div>
                </div>
                <div className="bg-secondary/20 p-3 rounded border border-border/50">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Complexity</div>
                  <div className="font-mono text-sm">{p.complexity.toFixed(2)}</div>
                </div>
                <div className="bg-secondary/20 p-3 rounded border border-border/50">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Inj. Risk</div>
                  <div className="font-mono text-sm">{(p.injectionProbability * 100).toFixed(1)}%</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground bg-secondary/20 p-4 rounded text-center border border-border/50">No proposal generated.</div>
          )}
        </div>

        <div className="flex-1 min-h-[40px]" />

        <div className="space-y-6 pt-6 mt-6 border-t border-border">
          {submitReview.isError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              Review failed: {submitReview.error.message}
            </p>
          )}
          <div className="space-y-3">
            <h2 className="font-semibold uppercase text-[10px] tracking-widest text-muted-foreground">Accept</h2>
            <Button className="w-full font-medium h-12 text-base" onClick={() => handleAction('accept')} disabled={submitReview.isPending}>
              <Check className="w-5 h-5 mr-2" />
              Accept Proposal
            </Button>
          </div>
          
          <div className="space-y-3 pt-4 border-t border-border/50">
            <h2 className="font-semibold uppercase text-[10px] tracking-widest text-muted-foreground">Override</h2>
            <div className="space-y-3">
              <select 
                className="w-full bg-background border border-input rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary shadow-sm"
                value={correctedLabel}
                onChange={(e) => setCorrectedLabel(e.target.value)}
              >
                <option value="" disabled>Select correction label...</option>
                <option value="supported">Supported</option>
                <option value="contradicted">Contradicted</option>
                <option value="insufficient_evidence">Insufficient Evidence</option>
              </select>
              <Textarea 
                placeholder="Reason for correction or escalation..." 
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="text-sm min-h-[100px] resize-none"
              />
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => handleAction('correct')} disabled={submitReview.isPending || !correctedLabel || !reason}>
                  <X className="w-4 h-4 mr-2 text-destructive" />
                  Correct
                </Button>
                <Button variant="outline" className="flex-1 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground" onClick={() => handleAction('escalate')} disabled={submitReview.isPending || !reason}>
                  <AlertTriangle className="w-4 h-4 mr-2" />
                  Escalate
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
