import { useState } from "react";
import { useListReleases, useCreateRelease, getListReleasesQueryKey } from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { SimulatedBadge } from "@/components/simulated-badge";
import { formatDate } from "@/lib/utils";
import { Download } from "lucide-react";

export default function Releases() {
  const { data: releases, isLoading } = useListReleases();
  const createRelease = useCreateRelease();
  
  const [name, setName] = useState("");
  const [includeSourceText, setIncludeSourceText] = useState(false);

  const handleCreate = () => {
    createRelease.mutate({
      data: { name, includeSourceText }
    }, {
      onSuccess: () => {
        setName("");
        setIncludeSourceText(false);
        queryClient.invalidateQueries({ queryKey: getListReleasesQueryKey() });
      }
    });
  };

  const handleDownload = async (id: string, releaseName: string) => {
    try {
      const res = await fetch(`/api/reviewflow/releases/${id}/download`, {
        headers: { 'Accept': 'application/x-ndjson' }
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `release-${releaseName}.jsonl`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
      } else {
        alert("Failed to download release");
      }
    } catch (e) {
      alert("Error downloading release");
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Releases</h1>
          <p className="text-muted-foreground mt-2">Immutable exports of finalized labels</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 border border-border rounded-md bg-card shadow-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Digest</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading releases...</TableCell></TableRow>
              ) : releases?.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>
                    {r.mode === 'demo' ? <SimulatedBadge mode={r.mode} /> : <span className="text-xs font-medium">Live</span>}
                  </TableCell>
                  <TableCell>{r.itemCount}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.digest.substring(0, 12)}...</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{formatDate(r.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => handleDownload(r.id, r.name)} title="Download JSONL">
                      <Download className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {releases?.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No releases cut yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="bg-card border border-border p-5 rounded-md space-y-5 shadow-surface">
          <h3 className="font-semibold text-sm">Cut New Release</h3>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Release Name</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. v1.0.0-rc.1" className="font-mono text-sm" />
            </div>
            <div className="flex items-start gap-2 pt-1">
              <input type="checkbox" id="includeSource" className="mt-1 accent-primary" checked={includeSourceText} onChange={e => setIncludeSourceText(e.target.checked)} />
              <label htmlFor="includeSource" className="text-sm text-foreground/80 leading-tight">
                Include Source Text<br/>
                <span className="text-xs text-muted-foreground">Embeds full evidence text in export. Increases file size significantly.</span>
              </label>
            </div>
            <Button className="w-full" onClick={handleCreate} disabled={!name || createRelease.isPending}>
              {createRelease.isPending ? "Cutting release…" : "Cut release"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
