import { useMemo, useState } from "react";
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
import { SimulatedBadge } from "@/components/simulated-badge";
import { formatDate } from "@/lib/utils";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";

export default function Tasks() {
  const { data: tasks, isLoading } = useListTasks({
    query: { queryKey: getListTasksQueryKey(), refetchInterval: 3000 },
  });
  const importTasks = useImportTasks();
  const evaluateTasks = useEvaluateTasks();
  const retryEvaluationJob = useRetryEvaluationJob();
  
  const [importJson, setImportJson] = useState("");
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [evalMode, setEvalMode] = useState<'demo'|'live'>('demo');
  const [consent, setConsent] = useState(false);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const taskIds = useMemo(() => tasks?.map((task) => task.id) ?? [], [tasks]);
  const { data: evaluationJobs = [], isLoading: jobsLoading } = useListEvaluationJobs(
    { taskIds },
    {
      query: {
        queryKey: getListEvaluationJobsQueryKey({ taskIds }),
        enabled: taskIds.length > 0,
        refetchInterval: (query) => (
          query.state.data?.some((job) => job.status === "queued" || job.status === "running")
            ? 1500
            : false
        ),
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
  const activeJobCount = evaluationJobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const failedJobCount = evaluationJobs.filter((job) => job.status === "failed").length;

  const handleImport = () => {
    try {
      const parsed = importJson.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
      if (parsed.length === 0) return;
      importTasks.mutate({ data: { tasks: parsed } }, {
        onSuccess: () => {
          setImportJson("");
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMetricsQueryKey() });
        }
      });
    } catch (e) {
      alert("Invalid JSONL format. Each line must be a valid JSON object.");
    }
  };

  const handleEvaluate = () => {
    evaluateTasks.mutate({
      data: {
        taskIds: Array.from(selectedTasks),
        mode: evalMode,
        ownerConsent: consent
      }
    }, {
      onSuccess: () => {
        setSelectedTasks(new Set());
        setConsent(false);
        queryClient.invalidateQueries({ queryKey: getListEvaluationJobsQueryKey({ taskIds }) });
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMetricsQueryKey() });
      }
    });
  };

  const handleRetry = (job: EvaluationJob) => {
    if (job.mode === "live" && !consent) {
      setEvalMode("live");
      return;
    }
    setRetryingJobId(job.id);
    retryEvaluationJob.mutate({
      data: { taskId: job.taskId, mode: job.mode, ownerConsent: consent },
    }, {
      onSettled: () => setRetryingJobId(null),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEvaluationJobsQueryKey({ taskIds }) });
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMetricsQueryKey() });
      },
    });
  };

  const renderJobStatus = (job: EvaluationJob) => {
    const statusClass = {
      queued: "bg-fill-subtle text-text-secondary",
      running: "bg-fill-emphasis text-text-primary",
      succeeded: "bg-fill-subtle text-text-primary",
      failed: "bg-danger-wash text-danger",
    }[job.status];
    return (
      <div key={job.id} className="flex items-center gap-1.5 text-meta">
        <span className={`px-1.5 py-0.5 rounded uppercase font-semibold tracking-wider ${statusClass}`}>
          {job.mode} · {job.status}
        </span>
        {job.status === "failed" && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-meta"
            disabled={retryingJobId === job.id || (job.mode === "live" && !consent)}
            title={job.mode === "live" && !consent ? "Select Live mode and confirm consent before retrying" : undefined}
            onClick={() => handleRetry(job)}
          >
            {retryingJobId === job.id ? "Retrying…" : "Retry"}
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
          <p className="text-muted-foreground mt-2">Manage and evaluate task batches</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          {(activeJobCount > 0 || failedJobCount > 0) && (
            <div className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3 text-sm">
              <span>
                {activeJobCount > 0
                  ? `${activeJobCount} evaluation${activeJobCount === 1 ? "" : "s"} in progress`
                  : "Evaluation failures need attention"}
              </span>
              {failedJobCount > 0 && (
                <span className="text-xs text-danger">{failedJobCount} failed</span>
              )}
            </div>
          )}
          {retryEvaluationJob.isError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              Retry failed: {retryEvaluationJob.error.message}
            </p>
          )}
          <div className="border border-border rounded-md bg-card">
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
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-4">Loading tasks...</TableCell></TableRow>
                ) : tasks?.map(task => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <input 
                        type="checkbox" 
                        className="rounded border-input text-primary focus:ring-primary"
                        checked={selectedTasks.has(task.id)}
                        onChange={(e) => {
                          const next = new Set(selectedTasks);
                          if (e.target.checked) next.add(task.id);
                          else next.delete(task.id);
                          setSelectedTasks(next);
                        }}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{task.externalId}</TableCell>
                    <TableCell>
                      <span className="px-2 py-0.5 bg-secondary text-secondary-foreground rounded text-meta uppercase font-semibold tracking-wider">
                        {task.status.replace('_', ' ')}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {jobsByTask.get(task.id)?.map(renderJobStatus)}
                        {!jobsByTask.has(task.id) && (
                          <span className="text-xs text-muted-foreground">
                            {jobsLoading ? "Loading…" : "Not evaluated"}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {task.mode === 'demo' ? <SimulatedBadge mode={task.mode} /> : <span className="text-xs">Live</span>}
                    </TableCell>
                    <TableCell className="capitalize text-xs">{task.risk}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{formatDate(task.createdAt)}</TableCell>
                  </TableRow>
                ))}
                {tasks?.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No tasks found. Import some to begin.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-card border border-border p-4 rounded-md space-y-4 shadow-surface">
            <h3 className="font-semibold text-sm">Import Tasks (JSONL)</h3>
            <Textarea 
              className="font-mono text-xs min-h-[150px] resize-none" 
              placeholder={`{"externalId": "123", "question": "...", "evidence": "...", "candidateAnswer": "...", "risk": "low"}\n{"externalId": "124"...}`}
              value={importJson}
              onChange={e => setImportJson(e.target.value)}
            />
            <Button
              className="w-full"
              variant={tasks?.length === 0 ? "default" : "outline"}
              onClick={handleImport}
              disabled={!importJson || importTasks.isPending}
            >
              {importTasks.isPending ? "Importing..." : "Import JSONL"}
            </Button>
            {importTasks.isError && (
              <p className="text-sm text-destructive">Import failed: {importTasks.error.message}</p>
            )}
          </div>

          <div className="bg-card border border-border p-4 rounded-md space-y-4 shadow-surface">
            <h3 className="font-semibold text-sm flex justify-between items-center">
              Evaluate Selected 
              <span className="text-muted-foreground font-normal">{selectedTasks.size} tasks</span>
            </h3>
            
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Evaluation Mode</label>
              <select 
                className="w-full border border-input bg-background rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" 
                value={evalMode} 
                onChange={e => setEvalMode(e.target.value as any)}
              >
                <option value="demo">Demo (Simulated)</option>
                <option value="live">Live (Real API)</option>
              </select>
            </div>

            {evalMode === 'live' && (
              <div className="flex items-start gap-2 pt-2 bg-warn-wash p-3 rounded-md border border-line-border">
                <input type="checkbox" id="consent" className="mt-1 accent-warn" checked={consent} onChange={e => setConsent(e.target.checked)} />
                <label htmlFor="consent" className="text-xs text-warn leading-tight">
                  I explicitly authorize hitting the live API for these tasks, incurring real usage costs.
                </label>
              </div>
            )}

            <Button
              className="w-full"
              variant={tasks?.length === 0 ? "outline" : "default"}
              onClick={handleEvaluate}
              disabled={selectedTasks.size === 0 || (evalMode === 'live' && !consent) || evaluateTasks.isPending}
            >
              {evaluateTasks.isPending ? "Evaluating..." : "Run evaluation"}
            </Button>
            {evaluateTasks.isError && (
              <p className="text-sm text-destructive">Evaluation failed: {evaluateTasks.error.message}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
