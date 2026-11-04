export const traceBase = "/api/reviewflow/traces";
import { projectHeaders } from "@workspace/api-client-react";

export async function traceRequest<T>(path: string, body?: unknown): Promise<T> {
  // Claims are scoped to the authenticated actor by the server. Fetch the current
  // fencing token so the preference workbench can use a claim from Factories.
  const comparisonId = /^\/comparisons\/([^/]+)\//.exec(path)?.[1];
  if (body && typeof body === "object" && comparisonId) {
    const claims = await fetch("/api/reviewflow/factories/preference", { credentials: "same-origin", headers: projectHeaders() });
    if (!claims.ok) throw new Error("Could not verify work claim. Reload the factory queue.");
    const queue = await claims.json() as { items: Array<{ id: string; claimToken: string | null }> };
    body = { ...body, claimToken: queue.items.find(item => item.id === decodeURIComponent(comparisonId))?.claimToken ?? null };
  }
  const response = await fetch(`${traceBase}${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...projectHeaders(), ...(body === undefined ? {} : { "Content-Type": "application/json", "x-reviewflow-csrf": "1" }) },
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error(`Trace API returned an unreadable response (${response.status}).`); }
  if (!response.ok) throw new Error(payload.error ?? payload.message ?? `Request failed (${response.status}).`);
  return payload as T;
}

export function saveTraceFile(content: BlobPart, name: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadTrace(path: string, name: string) {
  const response = await fetch(`${traceBase}${path}`, { credentials: "same-origin", headers: projectHeaders() });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `Download failed (${response.status}).`);
  }
  saveTraceFile(await response.blob(), name, response.headers.get("content-type") ?? "application/octet-stream");
}
