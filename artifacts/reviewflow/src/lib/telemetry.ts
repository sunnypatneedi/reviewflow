import { useEffect, useRef } from "react";
import { projectHeaders } from "@workspace/api-client-react";

type Kind =
  | "task_opened"
  | "asset_loaded"
  | "proposal_shown"
  | "edit"
  | "submit"
  | "review"
  | "release"
  | "foreground"
  | "session_closed";
type Context = {
  factory: "evidence" | "preference" | "audit" | "rubric";
  itemId?: string | null;
  itemVersion?: number | null;
  proposalId?: string | null;
};
type Event = {
  id: string;
  session: string;
  sequence: number;
  kind: Kind;
  factory: Context["factory"];
  itemId: string | null;
  itemVersion: number | null;
  proposalId: string | null;
  visibleMs: number;
  dropped: number;
};
type StoredEvent = Event & { scope: string };
let database: Promise<IDBDatabase> | null = null;
function eventDatabase() {
  if (!database)
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("reviewflow-local-telemetry-v1", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("events", {
          keyPath: "id",
        });
        store.createIndex("scope", "scope");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        database = null;
        reject(request.error);
      };
    });
  return database;
}
async function storeEvent(event: StoredEvent) {
  const database = await eventDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction("events", "readwrite");
    const store = tx.objectStore("events");
    store.put(event);
    // Bounded per-project retention. Evictions are visible as sequence gaps,
    // except entirely evicted sessions, whose loss remains unknowable.
    const request = store.index("scope").getAllKeys(event.scope);
    request.onsuccess = () => {
      for (const id of request.result.slice(
        0,
        Math.max(0, request.result.length - 2000),
      ))
        store.delete(id);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
async function storedEvents(scope: string): Promise<StoredEvent[]> {
  const database = await eventDatabase();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction("events")
      .objectStore("events")
      .index("scope")
      .getAll(scope, 50);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function removeEvents(ids: string[]) {
  const database = await eventDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction("events", "readwrite");
    for (const id of ids) tx.objectStore("events").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
/** Metadata-only IndexedDB queue. Each event is separately committed/deleted so
 * concurrent tabs cannot overwrite new events while acknowledging an old batch.
 * Storage failures fall back to a bounded memory queue; coverage stays partial. */
export function createTelemetry(context: Context) {
  const session = crypto.randomUUID();
  const headers = projectHeaders();
  let scope: string | null = null;
  const initialize = async () => {
    if (scope) return;
    const response = await fetch("/api/reviewflow/telemetry/context", {
      credentials: "same-origin",
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Telemetry context unavailable");
    const context = await response.json();
    if (
      typeof context.scope !== "string" ||
      typeof context.projectId !== "string"
    )
      throw new Error("Invalid telemetry context");
    scope = context.scope;
    headers["x-reviewflow-project"] = context.projectId;
    for (const event of queue)
      await storeEvent({ ...event, scope: context.scope }).catch(() => {});
  };
  let sequence = 0,
    dropped = 0,
    busy = false,
    flushRequested = false;
  let queue: Event[] = [];
  let writes = Promise.resolve();
  const emit = (kind: Kind, visibleMs = 0) => {
    if (++sequence > 1000000) return;
    if (queue.length >= 200) {
      queue.shift();
      dropped++;
    }
    const event: Event = {
      id: crypto.randomUUID(),
      session,
      sequence,
      kind,
      factory: context.factory,
      itemId: context.itemId ?? null,
      itemVersion: context.itemVersion ?? null,
      proposalId: context.proposalId ?? null,
      visibleMs: Math.max(0, Math.min(15000, Math.floor(visibleMs))),
      dropped,
    };
    queue.push(event);
    const eventScope = scope;
    if (eventScope)
      writes = writes
        .then(() => storeEvent({ ...event, scope: eventScope }))
        .catch(() => {});
  };
  const flush = async () => {
    if (busy) {
      flushRequested = true;
      return;
    }
    busy = true;
    let delivered = false;
    try {
      await initialize();
      if (!scope) return;
      await writes;
      let batch: Event[];
      try {
        batch = (await storedEvents(scope)).map(
          ({ scope: _scope, ...event }) => event,
        );
      } catch {
        batch = queue.slice(0, 50);
      }
      if (!batch.length) batch = queue.slice(0, 50);
      if (!batch.length) return;
      const response = await fetch("/api/reviewflow/telemetry", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "x-reviewflow-csrf": "1",
        },
        body: JSON.stringify({ scope, events: batch }),
        keepalive: true,
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return;
      const acknowledged: string[] = (await response.json()).accepted;
      const ids = new Set(acknowledged);
      queue = queue.filter((e) => !ids.has(e.id));
      await removeEvents(acknowledged).catch(() => {});
      delivered = true;
    } catch {
      /* retry stable event IDs on next tick/reload */
    } finally {
      busy = false;
      // A close/submit may arrive while a request is in flight. Do not discard
      // that flush: unmounted views have no next timer to deliver their tail.
      const requested = flushRequested;
      flushRequested = false;
      if (requested && delivered) await flush();
    }
  };
  return { emit, flush };
}
/** Foreground presence includes reading/watching without clicks. Long suspended
 * timer intervals are capped; hidden/unfocused intervals never accrue. */
export function foregroundDelta(elapsed: number, visible: boolean) {
  return visible && Number.isFinite(elapsed)
    ? Math.max(0, Math.min(15000, Math.floor(elapsed)))
    : 0;
}
export function useTelemetry(context: Context) {
  const current = useRef<ReturnType<typeof createTelemetry> | null>(null);
  useEffect(() => {
    if (!context.itemId) return;
    const telemetry = createTelemetry(context);
    current.current = telemetry;
    telemetry.emit("task_opened");
    telemetry.emit("asset_loaded"); // React has committed the item; not an external media download.
    if (context.proposalId) telemetry.emit("proposal_shown");
    let last = performance.now();
    const visible = () =>
      document.visibilityState === "visible" && document.hasFocus();
    let wasVisible = visible();
    const tick = () => {
      const now = performance.now();
      const ms = foregroundDelta(now - last, wasVisible);
      if (ms) telemetry.emit("foreground", ms);
      last = now;
      wasVisible = visible();
      void telemetry.flush();
    };
    let lastEdit = -Infinity;
    const edit = () => {
      const now = performance.now();
      if (now - lastEdit >= 1000) {
        telemetry.emit("edit");
        lastEdit = now;
      }
    };
    document.addEventListener("input", edit, true);
    const timer = setInterval(tick, 10000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    window.addEventListener("blur", tick);
    const hide = () => {
      tick();
      telemetry.emit("session_closed");
      void telemetry.flush();
    };
    window.addEventListener("pagehide", hide);
    void telemetry.flush();
    return () => {
      document.removeEventListener("input", edit, true);
      clearInterval(timer);
      tick();
      telemetry.emit("session_closed");
      void telemetry.flush();
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
      window.removeEventListener("blur", tick);
      window.removeEventListener("pagehide", hide);
      if (current.current === telemetry) current.current = null;
    };
  }, [
    context.factory,
    context.itemId,
    context.itemVersion,
    context.proposalId,
  ]);
  return (kind: Kind) => {
    current.current?.emit(kind);
    void current.current?.flush();
  };
}
