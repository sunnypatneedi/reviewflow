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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { Eyebrow } from "@/components/eyebrow";
import { InlineError } from "@/components/inline-error";
import { Notice } from "@/components/notice";
import { formatDate } from "@/lib/utils";

const LABELS = ["supported", "contradicted", "insufficient_evidence"] as const;
type Label = (typeof LABELS)[number];

const labelTitle = (label: string) => label.replaceAll("_", " ");

export default function Audits() {
  const {
    data: audits,
    isLoading,
    isError,
    error,
    refetch,
  } = useListAudits();
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
  const [adjudicationLabels, setAdjudicationLabels] = useState<
    Record<string, Label>
  >({});
  const [adjudicationReasons, setAdjudicationReasons] = useState<
    Record<string, string>
  >({});

  const {
    data: selectedAudit,
    isLoading: detailLoading,
    error: detailError,
  } = useGetAudit(selectedAuditId ?? "", {
    query: {
      queryKey: getGetAuditQueryKey(selectedAuditId ?? ""),
      enabled: Boolean(selectedAuditId),
    },
  });
  const { data: adjudicationQueue } = useGetAuditAdjudication(
    selectedAuditId ?? "",
    {
      query: {
        queryKey: getGetAuditAdjudicationQueryKey(selectedAuditId ?? ""),
        enabled: Boolean(selectedAuditId),
      },
    },
  );

  const handleCreate = () => {
    createAudit.mutate(
      {
        data: {
          sampleSize: Number(sampleSize),
          seed: seed.trim() || null,
          independent,
          required,
        },
      },
      {
        onSuccess: (audit) => {
          setSeed("");
          setSelectedAuditId(audit.id);
          queryClient.invalidateQueries({ queryKey: getListAuditsQueryKey() });
        },
      },
    );
  };

  const handleDecision = (auditId: string, itemId: string) => {
    const label = labels[itemId];
    if (!label) return;
    submitDecision.mutate(
      {
        id: auditId,
        data: {
          auditItemId: itemId,
          label,
          reason: reasons[itemId]?.trim() || null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAuditsQueryKey() });
          queryClient.invalidateQueries({
            queryKey: getGetAuditQueryKey(auditId),
          });
        },
      },
    );
  };

  const handleAdjudication = (auditId: string, disputeId: string) => {
    const resolvedLabel = adjudicationLabels[disputeId];
    if (!resolvedLabel) return;
    adjudicateDispute.mutate(
      {
        id: auditId,
        disputeId,
        data: {
          resolvedLabel,
          reason: adjudicationReasons[disputeId]?.trim() || null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAuditsQueryKey() });
          queryClient.invalidateQueries({
            queryKey: getGetAuditAdjudicationQueryKey(auditId),
          });
        },
      },
    );
  };

  if (isError) {
    return (
      <div className="p-6 min-[861px]:p-8">
        <EmptyState
          eyebrow="Audits"
          heading="Couldn’t load audits"
          description={error?.message ?? "Check your connection and try again."}
          actionLabel="Retry"
          onAction={() => {
            void refetch();
          }}
        />
      </div>
    );
  }

  const isEmpty = !isLoading && (audits?.length ?? 0) === 0;
  // One filled CTA: form Create when no detail selected; detail Submit/Resolve otherwise.
  const createIsPrimary = !selectedAuditId;

  return (
    <div className="p-6 min-[861px]:p-8 space-y-8">
      <div className="space-y-2">
        <Eyebrow>Quality</Eyebrow>
        <h1 className="type-headline text-text-primary">Audits</h1>
        <p className="type-small text-text-secondary">
          Blind, reproducible quality audits with independent decisions and
          adjudicated disagreements.
        </p>
      </div>

      <section className="border border-line-hairline p-5 space-y-4">
        <div>
          <Eyebrow>Create</Eyebrow>
          <h2 className="type-small font-semibold text-text-primary mt-1">
            Create an audit assignment
          </h2>
          <p className="type-small text-text-muted mt-1">
            The server stores the seed and exact sampling frame. Independent
            assignments exclude tasks you originally reviewed.
          </p>
        </div>
        <div className="grid grid-cols-1 min-[700px]:grid-cols-4 gap-4 items-end">
          <label className="space-y-1.5 type-small">
            <Eyebrow as="span">Sample size</Eyebrow>
            <Input
              type="number"
              min={1}
              max={200}
              value={sampleSize}
              onChange={(event) => setSampleSize(event.target.value)}
            />
          </label>
          <label className="space-y-1.5 type-small">
            <Eyebrow as="span">Seed (optional)</Eyebrow>
            <Input
              placeholder="Generated if blank"
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
            />
          </label>
          <div className="space-y-2 type-small">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={independent}
                onCheckedChange={(checked) => setIndependent(checked === true)}
              />
              Independent auditor
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={required}
                onCheckedChange={(checked) => setRequired(checked === true)}
              />
              Required for release
            </label>
          </div>
          <Button
            variant={createIsPrimary ? "default" : "outline"}
            onClick={handleCreate}
            disabled={createAudit.isPending}
          >
            {createAudit.isPending ? "Creating…" : "Create audit"}
          </Button>
        </div>
        {createAudit.error ? (
          <InlineError message={createAudit.error.message} />
        ) : null}
      </section>

      {isEmpty ? (
        <EmptyState
          eyebrow="Empty"
          heading="No audits run yet"
          description="Use Create audit above to sample finalized work for blind review."
        />
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(420px,1.2fr)] gap-6 min-[861px]:gap-8 items-start">
        <section className="border border-line-hairline overflow-hidden">
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
              {isLoading
                ? Array.from({ length: 4 }).map((_, index) => (
                    <TableRow key={index}>
                      {Array.from({ length: 5 }).map((__, cell) => (
                        <TableCell key={cell}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : audits?.map((audit) => (
                    <TableRow
                      key={audit.id}
                      className={`cursor-pointer ${selectedAuditId === audit.id ? "bg-fill-subtle" : ""}`}
                      onClick={() => setSelectedAuditId(audit.id)}
                    >
                      <TableCell>
                        <span className="px-2 py-0.5 bg-fill-subtle text-text-secondary rounded-[length:var(--radius-sm)] type-meta uppercase font-semibold tracking-wider">
                          {audit.status}
                        </span>
                        {audit.required && (
                          <span className="ml-2 type-meta text-text-muted">
                            required
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        {audit.completedItems}/{audit.sampleSize}
                        <span className="block type-caption text-text-muted">
                          {audit.effectiveSampleSize} included
                        </span>
                      </TableCell>
                      <TableCell>
                        {audit.independent
                          ? "Independent"
                          : "Self-check allowed"}
                      </TableCell>
                      <TableCell
                        className={
                          audit.openDisputes
                            ? "text-danger font-medium"
                            : "text-text-muted"
                        }
                      >
                        {audit.openDisputes}
                      </TableCell>
                      <TableCell className="text-text-muted type-small">
                        {formatDate(audit.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </section>

        <section className="border border-line-hairline p-5 min-h-[280px]">
          {!selectedAuditId ? (
            <EmptyState
              hatchHalf={false}
              className="min-h-[240px] border-0 p-0"
              eyebrow="Detail"
              heading="Select an audit"
              description="Choose an audit from the list to review its blind work items."
            />
          ) : detailLoading ? (
            <div className="space-y-3" role="status" aria-label="Loading audit">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : detailError ? (
            adjudicationQueue ? (
              <div className="space-y-5">
                <div>
                  <Eyebrow>Adjudication</Eyebrow>
                  <h2 className="type-small font-semibold mt-1">
                    Adjudication queue
                  </h2>
                  <p className="type-small text-text-muted mt-1">
                    Original and audit labels are visible only to an independent
                    adjudicator. Resolve every disagreement before release.
                  </p>
                </div>
                {adjudicationQueue.disputes.length === 0 ? (
                  <p className="type-small text-text-muted">
                    No disagreements are waiting for adjudication.
                  </p>
                ) : (
                  adjudicationQueue.disputes.map((dispute) => {
                    const currentLabel = adjudicationLabels[dispute.id];
                    return (
                      <article
                        key={dispute.id}
                        className="border border-line-hairline p-4 space-y-3"
                      >
                        <div className="flex justify-between gap-3">
                          <span className="type-meta font-mono text-text-muted">
                            {dispute.taskId}
                          </span>
                          <span
                            className={
                              dispute.status === "pending"
                                ? "type-caption text-danger"
                                : "type-caption text-text-muted"
                            }
                          >
                            {dispute.status}
                          </span>
                        </div>
                        <p className="font-medium">{dispute.question}</p>
                        <div className="type-small text-text-muted">
                          Original:{" "}
                          <span className="font-medium text-text-primary">
                            {labelTitle(dispute.originalLabel)}
                          </span>
                          {" · "}Audit:{" "}
                          <span className="font-medium text-text-primary">
                            {labelTitle(dispute.auditLabel)}
                          </span>
                        </div>
                        <div className="rounded-[length:var(--radius-sm)] bg-fill-subtle p-3 type-small">
                          {dispute.evidence}
                        </div>
                        {dispute.status === "pending" && (
                          <>
                            <select
                              className="h-11 w-full rounded-[length:var(--radius-input)] border border-line-border bg-surface-base px-3 type-small"
                              value={currentLabel ?? ""}
                              onChange={(event) =>
                                setAdjudicationLabels((previous) => ({
                                  ...previous,
                                  [dispute.id]: event.target.value as Label,
                                }))
                              }
                            >
                              <option value="" disabled>
                                Select the adjudicated label
                              </option>
                              {LABELS.map((label) => (
                                <option key={label} value={label}>
                                  {labelTitle(label)}
                                </option>
                              ))}
                            </select>
                            <Textarea
                              placeholder="Adjudication rationale"
                              value={adjudicationReasons[dispute.id] ?? ""}
                              onChange={(event) =>
                                setAdjudicationReasons((previous) => ({
                                  ...previous,
                                  [dispute.id]: event.target.value,
                                }))
                              }
                            />
                            <Button
                              variant="default"
                              onClick={() =>
                                handleAdjudication(selectedAuditId, dispute.id)
                              }
                              disabled={
                                !currentLabel || adjudicateDispute.isPending
                              }
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
              <Notice tone="danger">{detailError.message}</Notice>
            )
          ) : selectedAudit ? (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Eyebrow>Work items</Eyebrow>
                  <h2 className="type-small font-semibold mt-1">
                    Audit work items
                  </h2>
                  <p className="type-meta text-text-muted mt-1">
                    Seed{" "}
                    <span className="font-mono">{selectedAudit.seed}</span> ·
                    frame {selectedAudit.samplingFrameHash.slice(0, 12)}…
                  </p>
                </div>
                <span className="type-meta text-text-muted">
                  {selectedAudit.status}
                </span>
              </div>
              <div className="space-y-4">
                {selectedAudit.items.map((item) => {
                  const decision = item.decision;
                  const currentLabel = labels[item.id] ?? decision?.label;
                  return (
                    <article
                      key={item.id}
                      className="border border-line-hairline p-4 space-y-3"
                    >
                      <div className="flex justify-between gap-3">
                        <span className="type-meta font-mono text-text-muted">
                          #{item.ordinal} · {item.externalId}
                        </span>
                        <span className="type-meta uppercase text-text-muted">
                          {item.risk} risk
                        </span>
                      </div>
                      <p className="font-medium">{item.question}</p>
                      <div className="rounded-[length:var(--radius-sm)] bg-fill-subtle p-3 type-small">
                        <Eyebrow className="mb-1">Evidence</Eyebrow>
                        {item.evidence}
                      </div>
                      <div className="type-small">
                        <Eyebrow>Candidate answer</Eyebrow>
                        <p className="mt-1">{item.candidateAnswer}</p>
                      </div>
                      {decision ? (
                        <p className="type-caption text-text-muted">
                          Decision recorded: {labelTitle(decision.label)}
                          {decision.selfCheck ? " · self-check excluded" : ""}
                        </p>
                      ) : (
                        <>
                          <select
                            className="h-11 w-full rounded-[length:var(--radius-input)] border border-line-border bg-surface-base px-3 type-small"
                            value={currentLabel ?? ""}
                            onChange={(event) =>
                              setLabels((previous) => ({
                                ...previous,
                                [item.id]: event.target.value as Label,
                              }))
                            }
                          >
                            <option value="" disabled>
                              Select an independent label
                            </option>
                            {LABELS.map((label) => (
                              <option key={label} value={label}>
                                {labelTitle(label)}
                              </option>
                            ))}
                          </select>
                          <Textarea
                            placeholder="Optional audit rationale"
                            value={reasons[item.id] ?? ""}
                            onChange={(event) =>
                              setReasons((previous) => ({
                                ...previous,
                                [item.id]: event.target.value,
                              }))
                            }
                          />
                          <Button
                            variant="default"
                            onClick={() =>
                              handleDecision(selectedAudit.id, item.id)
                            }
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
                <div className="border-t border-line-hairline pt-4">
                  <h3 className="font-medium">Disagreements</h3>
                  <p className="type-small text-text-muted mt-1">
                    Original decisions stay hidden from the auditor. A separate
                    adjudicator must resolve these before a required audit can
                    pass.
                  </p>
                  <ul className="mt-3 space-y-2 type-small">
                    {selectedAudit.disputes.map((dispute) => (
                      <li
                        key={dispute.id}
                        className="flex justify-between rounded-[length:var(--radius-sm)] border border-line-hairline px-3 py-2"
                      >
                        <span>Item {dispute.taskId}</span>
                        <span
                          className={
                            dispute.status === "pending"
                              ? "text-danger"
                              : "text-text-muted"
                          }
                        >
                          {dispute.status}
                        </span>
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
