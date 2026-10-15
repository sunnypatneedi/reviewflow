import { useMemo, useRef, useState } from "react";
import {
  useListTasks,
  useImportTasks,
  useEvaluateTasks,
  useListEvaluationJobs,
  useRetryEvaluationJob,
  getListTasksQueryKey,
  getGetMetricsQueryKey,
  getListEvaluationJobsQueryKey,
  type EvaluationJob,
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { SimulatedBadge } from "@/components/simulated-badge";
import { EmptyState } from "@/components/empty-state";
import { Eyebrow } from "@/components/eyebrow";
import { SearchField } from "@/components/search-field";
import { Notice } from "@/components/notice";
import { InlineError } from "@/components/inline-error";
import { formatDate } from "@/lib/utils";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";

export default function Tasks() {
  const {
    data: tasks,
    isLoading,
    isError,
    error,
    refetch,
  } = useListTasks({
    query: { queryKey: getListTasksQueryKey(), refetchInterval: 3000 },
  });
  const importTasks = useImportTasks();
  const evaluateTasks = useEvaluateTasks();
  const retryEvaluationJob = useRetryEvaluationJob();

  const [importJson, setImportJson] = useState("");
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [evalMode, setEvalMode] = useState<"demo" | "live">("demo");
  const [consent, setConsent] = useState(false);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const importRef = useRef<HTMLTextAreaElement>(null);

  const taskIds = useMemo(() => tasks?.map((task) => task.id) ?? [], [tasks]);
  const { data: evaluationJobs = [], isLoading: jobsLoading } =
    useListEvaluationJobs(
      { taskIds },
      {
        query: {
          queryKey: getListEvaluationJobsQueryKey({ taskIds }),
          enabled: taskIds.length > 0,
          refetchInterval: (query) =>
            query.state.data?.some(
              (job) => job.status === "queued" || job.status === "running",
            )
              ? 1500
              : false,
        },
      },
    );
  const jobsByTask = useMemo(() => {
    const grouped = new Map<string, EvaluationJob[]>();
    for (const job of evaluationJobs) {
      const current = grouped.get(job.taskId) ?? [];
      current.push(job);
      grouped.set(job.taskId, current);
    }
    return grouped;
  }, [evaluationJobs]);
  const activeJobCount = evaluationJobs.filter(
    (job) => job.status === "queued" || job.status === "running",
  ).length;
  const failedJobCount = evaluationJobs.filter(
    (job) => job.status === "failed",
  ).length;

  const filteredTasks = useMemo(() => {
    const list = tasks ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((task) => {
      const haystack = [
        task.externalId,
        task.status,
        task.mode,
        task.risk,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [tasks, search]);

  const hasTasks = (tasks?.length ?? 0) > 0;
  const queueEmpty = !isLoading && !isError && tasks?.length === 0;

  const handleImport = () => {
    try {
      const parsed = importJson
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      if (parsed.length === 0) return;
      importTasks.mutate(
        { data: { tasks: parsed } },
        {
          onSuccess: () => {
            setImportJson("");
            queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
            queryClient.invalidateQueries({
              queryKey: getGetMetricsQueryKey(),
            });
          },
        },
      );
    } catch {
      alert("Invalid JSONL format. Each line must be a valid JSON object.");
    }
  };

  const handleEvaluate = () => {
    evaluateTasks.mutate(
      {
        data: {
          taskIds: Array.from(selectedTasks),
          mode: evalMode,
          ownerConsent: consent,
        },
      },
      {
        onSuccess: () => {
          setSelectedTasks(new Set());
          setConsent(false);
          queryClient.invalidateQueries({
            queryKey: getListEvaluationJobsQueryKey({ taskIds }),
          });
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMetricsQueryKey() });
        },
      },
    );
  };

  const handleRetry = (job: EvaluationJob) => {
    if (job.mode === "live" && !consent) {
      setEvalMode("live");
      return;
    }
    setRetryingJobId(job.id);
    retryEvaluationJob.mutate(
      {
        data: { taskId: job.taskId, mode: job.mode, ownerConsent: consent },
      },
      {
        onSettled: () => setRetryingJobId(null),
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListEvaluationJobsQueryKey({ taskIds }),
          });
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMetricsQueryKey() });
        },
      },
    );
  };

  const focusImport = () => {
    importRef.current?.focus();
    importRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const renderJobStatus = (job: EvaluationJob) => {
    const statusClass = {
      queued: "bg-fill-subtle text-text-secondary",
      running: "bg-fill-emphasis text-text-primary",
      succeeded: "bg-fill-subtle text-text-primary",
      failed: "bg-danger-wash text-danger",
    }[job.status];
    return (
      <div key={job.id} className="flex items-center gap-1.5 type-meta">
        <span
          className={`px-1.5 py-0.5 rounded-[length:var(--radius-sm)] uppercase font-semibold tracking-wider ${statusClass}`}
        >
          {job.mode} · {job.status}
        </span>
        {job.status === "failed" && (
          <Button
            variant="outline"
            size="sm"
            className="type-meta"
            disabled={
              retryingJobId === job.id || (job.mode === "live" && !consent)
            }
            title={
              job.mode === "live" && !consent
                ? "Select Live mode and confirm consent before retrying"
                : undefined
            }
            onClick={() => handleRetry(job)}
          >
            {retryingJobId === job.id ? "Retrying…" : "Retry"}
          </Button>
        )}
      </div>
    );
  };

  if (isError) {
    return (
      <div className="p-6 min-[861px]:p-8">
        <EmptyState
          eyebrow="Tasks"
          heading="Couldn’t load the task queue"
          description={error?.message ?? "Check your connection and try again."}
          actionLabel="Retry"
          onAction={() => {
            void refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-6 min-[861px]:p-8 space-y-8 pb-28 min-[861px]:pb-8">
      <div className="space-y-2">
        <Eyebrow>Queue</Eyebrow>
        <h1 className="type-headline text-text-primary">Tasks</h1>
        <p className="type-small text-text-secondary">
          Manage and evaluate task batches
        </p>
      </div>

      {queueEmpty ? (
        <EmptyState
          eyebrow="Empty"
          heading="No tasks in the queue"
          description="Import a JSONL batch below to begin evaluation and review."
        />
      ) : null}

      <div className="grid grid-cols-1 min-[861px]:grid-cols-3 gap-6 min-[861px]:gap-8">
        <div className="min-[861px]:col-span-2 space-y-4">
          {hasTasks ? (
            <SearchField
              value={search}
              onChange={setSearch}
              label="Filter tasks"
              placeholder="Search by ID, status, mode, risk…"
              matchIndex={filteredTasks.length}
              matchTotal={tasks?.length ?? 0}
            />
          ) : null}

          {(activeJobCount > 0 || failedJobCount > 0) && (
            <Notice tone={failedJobCount > 0 ? "warn" : "info"}>
              {activeJobCount > 0
                ? `${activeJobCount} evaluation${activeJobCount === 1 ? "" : "s"} in progress`
                : "Evaluation failures need attention"}
              {failedJobCount > 0
                ? ` · ${failedJobCount} failed`
                : null}
            </Notice>
          )}
          {retryEvaluationJob.isError ? (
            <InlineError message={`Retry failed: ${retryEvaluationJob.error.message}`} />
          ) : null}

          <div className="border border-line-hairline overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Ext ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Evaluation</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? Array.from({ length: 5 }).map((_, index) => (
                      <TableRow key={index}>
                        {Array.from({ length: 7 }).map((__, cell) => (
                          <TableCell key={cell}>
                            <Skeleton className="h-4 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : filteredTasks.map((task) => (
                      <TableRow key={task.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            className="rounded-[length:var(--radius-sm)] border-line-border text-fill-inverse focus-visible:ring-2 focus-visible:ring-ring"
                            checked={selectedTasks.has(task.id)}
                            onChange={(e) => {
                              const next = new Set(selectedTasks);
                              if (e.target.checked) next.add(task.id);
                              else next.delete(task.id);
                              setSelectedTasks(next);
                            }}
                            aria-label={`Select ${task.externalId}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono type-meta">
                          {task.externalId}
                        </TableCell>
                        <TableCell>
                          <span className="px-2 py-0.5 bg-fill-subtle text-text-secondary rounded-[length:var(--radius-sm)] type-meta uppercase font-semibold tracking-wider">
                            {task.status.replace("_", " ")}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {jobsByTask.get(task.id)?.map(renderJobStatus)}
                            {!jobsByTask.has(task.id) && (
                              <span className="type-caption text-text-muted">
                                {jobsLoading ? "Loading…" : "Not evaluated"}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {task.mode === "demo" ? (
                            <SimulatedBadge mode={task.mode} />
                          ) : (
                            <span className="type-caption">Live</span>
                          )}
                        </TableCell>
                        <TableCell className="capitalize type-caption">
                          {task.risk}
                        </TableCell>
                        <TableCell className="text-text-muted type-caption">
                          {formatDate(task.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                {!isLoading &&
                  hasTasks &&
                  filteredTasks.length === 0 &&
                  search.trim() && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center py-8 text-text-muted type-small"
                      >
                        No tasks match “{search.trim()}”. Press Esc to clear.
                      </TableCell>
                    </TableRow>
                  )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="border border-line-hairline p-4 space-y-4">
            <Eyebrow>Import</Eyebrow>
            <h3 className="type-small font-semibold text-text-primary">
              Import Tasks (JSONL)
            </h3>
            <Textarea
              ref={importRef}
              className="font-mono type-caption min-h-[150px] resize-none"
              placeholder={`{"externalId": "123", "question": "...", "evidence": "...", "candidateAnswer": "...", "risk": "low"}\n{"externalId": "124"...}`}
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
            />
            <Button
              className="w-full max-[860px]:hidden"
              variant={hasTasks ? "outline" : "default"}
              onClick={handleImport}
              disabled={!importJson || importTasks.isPending}
            >
              {importTasks.isPending ? "Importing..." : "Import JSONL"}
            </Button>
            {importTasks.isError ? (
              <InlineError
                message={`Import failed: ${importTasks.error.message}`}
              />
            ) : null}
          </div>

          <div className="border border-line-hairline p-4 space-y-4">
            <div className="flex justify-between items-center gap-2">
              <Eyebrow>Evaluate</Eyebrow>
              <span className="type-meta text-text-muted">
                {selectedTasks.size} selected
              </span>
            </div>
            <h3 className="type-small font-semibold text-text-primary">
              Evaluate Selected
            </h3>

            <div className="space-y-2">
              <Eyebrow as="label" htmlFor="eval-mode">
                Evaluation Mode
              </Eyebrow>
              <select
                id="eval-mode"
                className="h-11 w-full border border-line-border bg-surface-base rounded-[length:var(--radius-input)] px-3 type-small focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={evalMode}
                onChange={(e) =>
                  setEvalMode(e.target.value as "demo" | "live")
                }
              >
                <option value="demo">Demo (Simulated)</option>
                <option value="live">Live (Real API)</option>
              </select>
            </div>

            {evalMode === "live" && (
              <div className="flex items-start gap-2 pt-2 bg-warn-wash p-3 rounded-[length:var(--radius-panel)] border border-line-border">
                <input
                  type="checkbox"
                  id="consent"
                  className="mt-1 accent-warn"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <label
                  htmlFor="consent"
                  className="type-caption text-warn leading-tight"
                >
                  I explicitly authorize hitting the live API for these tasks,
                  incurring real usage costs.
                </label>
              </div>
            )}

            <Button
              className="w-full max-[860px]:hidden"
              variant={hasTasks ? "default" : "outline"}
              onClick={handleEvaluate}
              disabled={
                selectedTasks.size === 0 ||
                (evalMode === "live" && !consent) ||
                evaluateTasks.isPending
              }
            >
              {evaluateTasks.isPending ? "Evaluating..." : "Run evaluation"}
            </Button>
            {evaluateTasks.isError ? (
              <InlineError
                message={`Evaluation failed: ${evaluateTasks.error.message}`}
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* Narrow sticky primary — sole filled CTA on small screens */}
      <div className="min-[861px]:hidden fixed inset-x-0 bottom-0 z-sticky border-t border-line-hairline bg-surface-glass backdrop-blur px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        {hasTasks ? (
          <Button
            className="w-full"
            variant="default"
            onClick={handleEvaluate}
            disabled={
              selectedTasks.size === 0 ||
              (evalMode === "live" && !consent) ||
              evaluateTasks.isPending
            }
          >
            {evaluateTasks.isPending ? "Evaluating..." : "Run evaluation"}
          </Button>
        ) : (
          <Button
            className="w-full"
            variant="default"
            onClick={() => {
              if (importJson.trim()) handleImport();
              else focusImport();
            }}
            disabled={importTasks.isPending}
          >
            {importTasks.isPending ? "Importing..." : "Import JSONL"}
          </Button>
        )}
      </div>
    </div>
  );
}
