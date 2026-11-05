import { projectHeaders } from "@workspace/api-client-react";
export type Criterion = { id: string; label: string } & (
  | { kind: "score"; min: number; max: number }
  | { kind: "option"; options: string[] }
);
export type RubricDefinition = {
  schemaVersion: 1;
  name: string;
  criteria: Criterion[];
  minimumAudits: number;
};
export type RubricSpec = {
  id: string;
  revision: number;
  hash: string;
  definition: RubricDefinition;
};
export type RubricItem = {
  id: string;
  externalId: string;
  content: string;
  contentHash: string;
  rubricId: string;
  version: number;
  status: "pending" | "escalated" | "reviewed";
  quarantined: boolean;
  quarantineReason?: string;
  assignedTo: string | null;
  claimToken: string | null;
  expiresAt?: string;
  escalationReason?: string;
  decision?: {
    id: string;
    actor: string;
    scores: Record<string, string | number>;
    reason: string;
  };
  audits: { id: string; actor: string; pass: boolean; decisionId: string }[];
};
export type RubricData = {
  actor: string;
  role: string | null;
  authenticated: boolean;
  canConfigure: boolean;
  canRelease: boolean;
  rubrics: RubricSpec[];
  items: RubricItem[];
  releases: {
    id: string;
    createdAt: string;
    itemCount: number;
    sha256: string;
  }[];
  releaseGate: string;
};
export async function rubricApi<T>(path = "", body?: unknown): Promise<T> {
  const response = await fetch(`/api/reviewflow/rubrics${path}`, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...projectHeaders(),
      ...(body === undefined
        ? {}
        : { "Content-Type": "application/json", "x-reviewflow-csrf": "1" }),
    },
    ...(body === undefined
      ? {}
      : { method: "POST", body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? `Request failed (${response.status})`);
  return data as T;
}
export async function downloadRubricRelease(id: string) {
  const response = await fetch(
    `/api/reviewflow/rubrics/releases/${encodeURIComponent(id)}/export`,
    { credentials: "same-origin", headers: projectHeaders() },
  );
  if (!response.ok) {
    const value = await response.json();
    throw new Error(value.error ?? "Download failed");
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `rubric-release-${id}.jsonl`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
