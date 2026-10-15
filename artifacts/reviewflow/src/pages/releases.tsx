import { useState } from "react";
import {
  useListReleases,
  useCreateRelease,
  getListReleasesQueryKey,
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SimulatedBadge } from "@/components/simulated-badge";
import { EmptyState } from "@/components/empty-state";
import { Eyebrow } from "@/components/eyebrow";
import { Field, FieldInput } from "@/components/field";
import { InlineError } from "@/components/inline-error";
import { formatDate } from "@/lib/utils";
import { Download } from "lucide-react";

export default function Releases() {
  const {
    data: releases,
    isLoading,
    isError,
    error,
    refetch,
  } = useListReleases();
  const createRelease = useCreateRelease();

  const [name, setName] = useState("");
  const [includeSourceText, setIncludeSourceText] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleCreate = () => {
    createRelease.mutate(
      {
        data: { name, includeSourceText },
      },
      {
        onSuccess: () => {
          setName("");
          setIncludeSourceText(false);
          setConfirmOpen(false);
          queryClient.invalidateQueries({
            queryKey: getListReleasesQueryKey(),
          });
        },
      },
    );
  };

  const handleDownload = async (id: string, releaseName: string) => {
    try {
      const res = await fetch(`/api/reviewflow/releases/${id}/download`, {
        headers: { Accept: "application/x-ndjson" },
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `release-${releaseName}.jsonl`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
      } else {
        alert("Failed to download release");
      }
    } catch {
      alert("Error downloading release");
    }
  };

  if (isError) {
    return (
      <div className="p-6 min-[861px]:p-8">
        <EmptyState
          eyebrow="Releases"
          heading="Couldn’t load releases"
          description={error?.message ?? "Check your connection and try again."}
          actionLabel="Retry"
          onAction={() => {
            void refetch();
          }}
        />
      </div>
    );
  }

  const isEmpty = !isLoading && (releases?.length ?? 0) === 0;

  return (
    <div className="p-6 min-[861px]:p-8 space-y-8">
      <div className="space-y-2">
        <Eyebrow>Exports</Eyebrow>
        <h1 className="type-headline text-text-primary">Releases</h1>
        <p className="type-small text-text-secondary">
          Immutable exports of finalized labels
        </p>
      </div>

      {isEmpty ? (
        <EmptyState
          eyebrow="Empty"
          heading="No releases cut yet"
          description="Cut an immutable release once finalized labels are ready to export."
        />
      ) : null}

      <div className="grid grid-cols-1 min-[861px]:grid-cols-3 gap-6 min-[861px]:gap-8">
        <div className="min-[861px]:col-span-2 border border-line-hairline overflow-hidden">
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
              {isLoading
                ? Array.from({ length: 4 }).map((_, index) => (
                    <TableRow key={index}>
                      {Array.from({ length: 6 }).map((__, cell) => (
                        <TableCell key={cell}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : releases?.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>
                        {r.mode === "demo" ? (
                          <SimulatedBadge mode={r.mode} />
                        ) : (
                          <span className="type-caption font-medium">Live</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono type-meta">
                        {r.itemCount}
                      </TableCell>
                      <TableCell className="font-mono type-meta text-text-muted">
                        {r.digest.substring(0, 12)}…
                      </TableCell>
                      <TableCell className="text-text-muted type-small">
                        {formatDate(r.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="icon"
                          onClick={() => handleDownload(r.id, r.name)}
                          title="Download JSONL"
                          aria-label={`Download ${r.name}`}
                        >
                          <Download className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>

        <div className="border border-line-hairline p-5 space-y-5">
          <Eyebrow>Cut</Eyebrow>
          <h3 className="type-small font-semibold text-text-primary">
            Cut New Release
          </h3>
          <div className="space-y-4">
            <Field
              label="Release Name"
              hint="Immutable once cut — name carefully."
            >
              <FieldInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. v1.0.0-rc.1"
                className="font-mono"
              />
            </Field>
            <div className="flex items-start gap-2 pt-1">
              <input
                type="checkbox"
                id="includeSource"
                className="mt-1 accent-primary"
                checked={includeSourceText}
                onChange={(e) => setIncludeSourceText(e.target.checked)}
              />
              <label
                htmlFor="includeSource"
                className="type-small text-text-secondary leading-tight"
              >
                Include Source Text
                <br />
                <span className="type-caption text-text-muted">
                  Embeds full evidence text in export. Increases file size
                  significantly.
                </span>
              </label>
            </div>
            <Button
              className="w-full"
              disabled={!name || createRelease.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              {createRelease.isPending ? "Cutting release…" : "Cut release"}
            </Button>
            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cut immutable release?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Release “{name}” cannot be edited after it is cut. Downloads
                    will reflect this snapshot permanently.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(event) => {
                      event.preventDefault();
                      handleCreate();
                    }}
                    disabled={createRelease.isPending}
                  >
                    {createRelease.isPending ? "Cutting…" : "Cut release"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            {createRelease.isError ? (
              <InlineError message={createRelease.error.message} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
