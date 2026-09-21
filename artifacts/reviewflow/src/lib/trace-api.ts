export const traceBase = "/api/reviewflow/traces";

export async function traceRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${traceBase}${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json", "x-reviewflow-csrf": "1" }) },
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
  const response = await fetch(`${traceBase}${path}`, { credentials: "same-origin" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `Download failed (${response.status}).`);
  }
  saveTraceFile(await response.blob(), name, response.headers.get("content-type") ?? "application/octet-stream");
}