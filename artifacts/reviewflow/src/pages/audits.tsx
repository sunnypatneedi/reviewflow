import { useListAudits } from "@workspace/api-client-react";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

export default function Audits() {
  const { data: audits, isLoading } = useListAudits();

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Audits</h1>
        <p className="text-muted-foreground mt-2">Blind quality audits of finalized tasks</p>
      </div>

      <div className="border border-border rounded-md bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Audit ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sample Size</TableHead>
              <TableHead>Independent</TableHead>
              <TableHead>Created At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading audits...</TableCell></TableRow>
            ) : audits?.map(audit => (
              <TableRow key={audit.id}>
                <TableCell className="font-mono text-xs text-muted-foreground">{audit.id}</TableCell>
                <TableCell>
                  <span className="px-2 py-0.5 bg-secondary text-secondary-foreground rounded text-[10px] uppercase font-semibold tracking-wider">
                    {audit.status}
                  </span>
                </TableCell>
                <TableCell className="font-medium">{audit.sampleSize}</TableCell>
                <TableCell>{audit.independent ? "Yes" : "No"}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{formatDate(audit.createdAt)}</TableCell>
              </TableRow>
            ))}
            {audits?.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">No audits run yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
