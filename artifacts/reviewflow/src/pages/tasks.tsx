import { useState } from "react";
import { useListTasks, useImportTasks, useEvaluateTasks, getListTasksQueryKey, getGetMetricsQueryKey } from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SimulatedBadge } from "@/components/simulated-badge";
import { formatDate } from "@/lib/utils";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";

export default function Tasks() {
  const { data: tasks, isLoading } = useListTasks();
  const importTasks = useImportTasks();
  const evaluateTasks = useEvaluateTasks();
  
  const [importJson, setImportJson] = useState("");
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [evalMode, setEvalMode] = useState<'demo'|'live'>('demo');
  const [consent, setConsent] = useState(false);

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
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMetricsQueryKey() });
      }
    });
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
          <div className="border border-border rounded-md bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Ext ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-4">Loading tasks...</TableCell></TableRow>
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
                      <span className="px-2 py-0.5 bg-secondary text-secondary-foreground rounded text-[10px] uppercase font-semibold tracking-wider">
                        {task.status.replace('_', ' ')}
                      </span>
                    </TableCell>
                    <TableCell>
                      {task.mode === 'demo' ? <SimulatedBadge mode={task.mode} /> : <span className="text-xs">Live</span>}
                    </TableCell>
                    <TableCell className="capitalize text-xs">{task.risk}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{formatDate(task.createdAt)}</TableCell>
                  </TableRow>
                ))}
                {tasks?.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No tasks found. Import some to begin.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-card border border-border p-4 rounded-md space-y-4 shadow-sm">
            <h3 className="font-semibold text-sm">Import Tasks (JSONL)</h3>
            <Textarea 
              className="font-mono text-xs min-h-[150px] resize-none" 
              placeholder={`{"externalId": "123", "question": "...", "evidence": "...", "candidateAnswer": "...", "risk": "low"}\n{"externalId": "124"...}`}
              value={importJson}
              onChange={e => setImportJson(e.target.value)}
            />
            <Button className="w-full" onClick={handleImport} disabled={!importJson || importTasks.isPending}>
              {importTasks.isPending ? "Importing..." : "Import JSONL"}
            </Button>
          </div>

          <div className="bg-card border border-border p-4 rounded-md space-y-4 shadow-sm">
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
              <div className="flex items-start gap-2 pt-2 bg-amber-50 p-3 rounded-md border border-amber-200">
                <input type="checkbox" id="consent" className="mt-1 accent-amber-600" checked={consent} onChange={e => setConsent(e.target.checked)} />
                <label htmlFor="consent" className="text-xs text-amber-900 leading-tight">
                  I explicitly authorize hitting the live API for these tasks, incurring real usage costs.
                </label>
              </div>
            )}

            <Button 
              className="w-full" 
              onClick={handleEvaluate} 
              disabled={selectedTasks.size === 0 || (evalMode === 'live' && !consent) || evaluateTasks.isPending}
            >
              {evaluateTasks.isPending ? "Evaluating..." : "Run Evaluation"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
