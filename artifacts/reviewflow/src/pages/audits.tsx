import { useState } from "react";
import {
  getGetAuditQueryKey,
  getGetAuditAdjudicationQueryKey,
  getListAuditsQueryKey,
  useAdjudicateAuditDispute,
  useCreateAudit,
  useGetAuditAdjudication,
  useGetAudit,
  useListAudits,
  useSubmitAuditDecision,
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

const LABELS = ["supported", "contradicted", "insufficient_evidence"] as const;
type Label = (typeof LABELS)[number];

const labelTitle = (label: string) => label.replaceAll("_", " ");

export default function Audits() {
  const { data: audits, isLoading } = useListAudits();
  const createAudit = useCreateAudit();
  const submitDecision = useSubmitAuditDecision();
  const adjudicateDispute = useAdjudicateAuditDispute();
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);
  const [sampleSize, setSampleSize] = useState("3");
  const [seed, setSeed] = useState("");
  const [independent, setIndependent] = useState(true);
  const [required, setRequired] = useState(true);
  const [labels, setLabels] = useState<Record<string, Label>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [adjudicationLabels, setAdjudicationLabels] = useState<Record<string, Label>>({});
  const [adjudicationReasons, setAdjudicationReasons] = useState<Record<string, string>>({});

  const { data: selectedAudit, isLoading: detailLoading, error: detailError } = useGetAudit(
    selectedAuditId ?? "",
    { query: { queryKey: getGetAuditQueryKey(selectedAuditId ?? ""), enabled: Boolean(selectedAuditId) } },
  );
  const { data: adjudicationQueue } = useGetAuditAdjudication(
    selectedAuditId ?? "",
    { query: { queryKey: getGetAuditAdjudicationQueryKey(selectedAuditId ?? ""), enabled: Boolean(selectedAuditId) } },
  );

  const handleCreate = () => {
    createAudit.mutate({
      data: {
        sampleSize: Number(sampleSize),
        seed: seed.trim() || null,
        independent,
        required,
      },
    }, {
      onSuccess: (audit) => {
        setSeed("");
        setSelectedAuditId(audit.id);
        queryClient.invalidateQueries({ queryKey: getListAuditsQueryKey() });
      },
    });
  };

  const handleDecision = (auditId: string, itemId: string) => {
    const label = labels[itemId];
    if (!label) return;
    submitDecision.mutate({
      id: auditId,
      data: {
        auditItemId: itemId,
        label,
        reason: reasons[itemId]?.trim() || null,
      },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAuditsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAuditQueryKey(auditId) });
      },
    });
  };

  const handleAdjudication = (auditId: string, disputeId: string) => {
    const resolvedLabel = adjudicationLabels[disputeId];
    if (!resolvedLabel) return;
    adjudicateDispute.mutate({
      id: auditId,
      disputeId,
      data: {
        resolvedLabel,
        reason: adjudicationReasons[disputeId]?.trim() || null,
      },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAuditsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAuditAdjudicationQueryKey(auditId) });
      },
    });
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Audits</h1>
        <p className="text-muted-foreground mt-2">
          Blind, reproducible quality audits with independent decisions and adjudicated disagreements.
        </p>
      </div>

      <section className="border border-border rounded-md bg-card p-5 shadow-sm space-y-4">
        <div>
          <h2 className="font-semibold">Create an audit assignment</h2>
          <p className="text-sm text-muted-foreground mt-1">
            The server stores the seed and exact sampling frame. Independent assignments exclude tasks you originally reviewed.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Sample size</span>
            <Input type="number" min={1} max={200} value={sampleSize} onChange={(event) => setSampleSize(event.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Seed (optional)</span>
            <Input placeholder="Generated if blank" value={seed} onChange={(event) => setSeed(event.target.value)} />
          </label>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox checked={independent} onCheckedChange={(checked) => setIndependent(checked === true)} />
              Independent auditor
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={required} onCheckedChange={(checked) => setRequired(checked === true)} />
              Required for release
            </label>
          </div>
          <Button
            variant={selectedAuditId ? "outline" : "default"}
            onClick={handleCreate}
            disabled={createAudit.isPending}
          >
            {createAudit.isPending ? "Creating…" : "Create audit"}
          </Button>
        </div>
        {createAudit.error && (
          <p className="text-sm text-destructive">{createAudit.error.message}</p>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(420px,1.2fr)] gap-8 items-start">
        <section className="border border-border rounded-md bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Sample</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Disputes</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading audits…</TableCell></TableRow>
              ) : audits?.map((audit) => (
                <TableRow
                  key={audit.id}
                  className={`cursor-pointer ${selectedAuditId === audit.id ? "bg-muted/60" : ""}`}
                  onClick={() => setSelectedAuditId(audit.id)}
                >
                  <TableCell>
                    <span className="px-2 py-0.5 bg-secondary text-secondary-foreground rounded text-[10px] uppercase font-semibold tracking-wider">
                      {audit.status}
                    </span>
                    {audit.required && <span className="ml-2 text-[10px] text-muted-foreground">required</span>}
                  </TableCell>
                  <TableCell className="font-medium">
                    {audit.completedItems}/{audit.sampleSize}
                    <span className="block text-xs text-muted-foreground">{audit.effectiveSampleSize} included</span>
                  </TableCell>
                  <TableCell>{audit.independent ? "Independent" : "Self-check allowed"}</TableCell>
                  <TableCell className={audit.openDisputes ? "text-destructive font-medium" : "text-muted-foreground"}>
                    {audit.openDisputes}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{formatDate(audit.createdAt)}</TableCell>
                </TableRow>
              ))}
              {audits?.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">No audits run yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </section>

        <section className="border border-border rounded-md bg-card p-5 shadow-sm min-h-[280px]">
          {!selectedAuditId ? (
            <div className="h-full min-h-[240px] flex items-center justify-center text-sm text-muted-foreground">
              Select an audit to review its blind work items.
            </div>
          ) : detailLoading ? (
            <p className="text-sm text-muted-foreground">Loading blind audit items…</p>
          ) : detailError ? (
            adjudicationQueue ? (
              <div className="space-y-5">
                <div>
                  <h2 className="font-semibold">Adjudication queue</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Original and audit labels are visible only to an independent adjudicator. Resolve every disagreement before release.
                  </p>
                </div>
                {adjudicationQueue.disputes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No disagreements are waiting for adjudication.</p>
                ) : (
                  adjudicationQueue.disputes.map((dispute) => {
                    const currentLabel = adjudicationLabels[dispute.id];
                    return (
                      <article key={dispute.id} className="border border-border rounded-md p-4 space-y-3">
                        <div className="flex justify-between gap-3">
                          <span className="text-xs font-mono text-muted-foreground">{dispute.taskId}</span>
                          <span className={dispute.status === "pending" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{dispute.status}</span>
                        </div>
                        <p className="font-medium">{dispute.question}</p>
                        <div className="text-sm text-muted-foreground">
                          Original: <span className="font-medium text-foreground">{labelTitle(dispute.originalLabel)}</span>
                          {" · "}Audit: <span className="font-medium text-foreground">{labelTitle(dispute.auditLabel)}</span>
                        </div>
                        <div className="rounded bg-muted/50 p-3 text-sm">{dispute.evidence}</div>
                        {dispute.status === "pending" && (
                          <>
                            <select
                              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                              value={currentLabel ?? ""}
                              onChange={(event) => setAdjudicationLabels((previous) => ({ ...previous, [dispute.id]: event.target.value as Label }))}
                            >
                              <option value="" disabled>Select the adjudicated label</option>
                              {LABELS.map((label) => <option key={label} value={label}>{labelTitle(label)}</option>)}
                            </select>
                            <Textarea
                              placeholder="Adjudication rationale"
                              value={adjudicationReasons[dispute.id] ?? ""}
                              onChange={(event) => setAdjudicationReasons((previous) => ({ ...previous, [dispute.id]: event.target.value }))}
                            />
                            <Button
                              size="sm"
                              onClick={() => handleAdjudication(selectedAuditId, dispute.id)}
                              disabled={!currentLabel || adjudicateDispute.isPending}
                            >
                              Resolve disagreement
                            </Button>
                          </>
                        )}
                      </article>
                    );
                  })
                )}
              </div>
            ) : (
              <p className="text-sm text-destructive">{detailError.message}</p>
            )
          ) : selectedAudit ? (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold">Audit work items</h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    Seed <span className="font-mono">{selectedAudit.seed}</span> · frame {selectedAudit.samplingFrameHash.slice(0, 12)}…
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">{selectedAudit.status}</span>
              </div>
              <div className="space-y-4">
                {selectedAudit.items.map((item) => {
                  const decision = item.decision;
                  const currentLabel = labels[item.id] ?? decision?.label;
                  return (
                    <article key={item.id} className="border border-border rounded-md p-4 space-y-3">
                      <div className="flex justify-between gap-3">
                        <span className="text-xs font-mono text-muted-foreground">#{item.ordinal} · {item.externalId}</span>
                        <span className="text-xs uppercase text-muted-foreground">{item.risk} risk</span>
                      </div>
                      <p className="font-medium">{item.question}</p>
                      <div className="rounded bg-muted/50 p-3 text-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Evidence</p>
                        {item.evidence}
                      </div>
                      <div className="text-sm">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Candidate answer</span>
                        <p className="mt-1">{item.candidateAnswer}</p>
                      </div>
                      {decision ? (
                        <p className="text-xs text-muted-foreground">
                          Decision recorded: {labelTitle(decision.label)}{decision.selfCheck ? " · self-check excluded" : ""}
                        </p>
                      ) : (
                        <>
                          <select
                            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                            value={currentLabel ?? ""}
                            onChange={(event) => setLabels((previous) => ({ ...previous, [item.id]: event.target.value as Label }))}
                          >
                            <option value="" disabled>Select an independent label</option>
                            {LABELS.map((label) => <option key={label} value={label}>{labelTitle(label)}</option>)}
                          </select>
                          <Textarea
                            placeholder="Optional audit rationale"
                            value={reasons[item.id] ?? ""}
                            onChange={(event) => setReasons((previous) => ({ ...previous, [item.id]: event.target.value }))}
                          />
                          <Button
                            size="sm"
                            onClick={() => handleDecision(selectedAudit.id, item.id)}
                            disabled={!currentLabel || submitDecision.isPending}
                          >
                            Submit blind decision
                          </Button>
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
              {selectedAudit.disputes.length > 0 && (
                <div className="border-t border-border pt-4">
                  <h3 className="font-medium">Disagreements</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Original decisions stay hidden from the auditor. A separate adjudicator must resolve these before a required audit can pass.
                  </p>
                  <ul className="mt-3 space-y-2 text-sm">
                    {selectedAudit.disputes.map((dispute) => (
                      <li key={dispute.id} className="flex justify-between rounded border border-border px-3 py-2">
                        <span>Item {dispute.taskId}</span>
                        <span className={dispute.status === "pending" ? "text-destructive" : "text-muted-foreground"}>{dispute.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}