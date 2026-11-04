import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { projectHeaders } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
/** Keep the local operation small so a concurrent edit preserves both authors' text. */
function replaceText(text: Y.Text, value: string) {
  const old = text.toString();
  let start = 0;
  while (
    start < old.length &&
    start < value.length &&
    old[start] === value[start]
  )
    start++;
  let end = 0;
  while (
    end < old.length - start &&
    end < value.length - start &&
    old[old.length - 1 - end] === value[value.length - 1 - end]
  )
    end++;
  text.doc!.transact(() => {
    if (old.length - start - end) text.delete(start, old.length - start - end);
    if (value.length - start - end)
      text.insert(start, value.slice(start, value.length - end));
  }, "local");
}
export function SharedNotes({
  taskId,
  onCopy,
}: {
  taskId: string;
  onCopy: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState("Connecting…");
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const edit = useRef<(value: string) => void>(() => {});
  useEffect(() => {
    const doc = new Y.Doc();
    const text = doc.getText("notes");
    let ws: WebSocket | undefined;
    let stopped = false;
    let pending = 0;
    let sequence = 0;
    let dirty = false;
    let ready = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;
    const flush = () => {
      if (
        stopped ||
        pending ||
        !dirty ||
        !ready ||
        ws?.readyState !== WebSocket.OPEN
      )
        return;
      pending = ++sequence;
      dirty = false;
      setStatus("Saving shared notes…");
      ws.send(
        JSON.stringify({
          type: "update",
          id: pending,
          state: encode(Y.encodeStateAsUpdate(doc)),
        }),
      );
    };
    edit.current = (next) => {
      replaceText(text, next);
      setValue(text.toString());
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(flush, 150);
    };
    async function connect() {
      setConnected(false);
      setStatus("Connecting…");
      ready = false;
      try {
        const response = await fetch(
          `/api/reviewflow/tasks/${encodeURIComponent(taskId)}/collaboration-ticket`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: {
              ...projectHeaders(),
              "Content-Type": "application/json",
              "x-reviewflow-csrf": "1",
            },
            body: "{}",
          },
        );
        const ticket = await response.json();
        if (!response.ok) {
          setStatus(ticket.error ?? "Shared notes unavailable");
          return;
        }
        if (stopped) return;
        const url = new URL(ticket.path, window.location.href);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        ws = new WebSocket(url);
        ws.onopen = () =>
          ws?.send(JSON.stringify({ type: "auth", token: ticket.token }));
        ws.onmessage = (event) => {
          if (stopped) return;
          const message = JSON.parse(event.data);
          if (message.type === "error") {
            setStatus(message.message);
            ready = false;
            setConnected(false);
            return;
          }
          if (message.type !== "state") return;
          const selection =
            input.current && document.activeElement === input.current
              ? [
                  Y.createRelativePositionFromTypeIndex(
                    text,
                    input.current.selectionStart,
                  ),
                  Y.createRelativePositionFromTypeIndex(
                    text,
                    input.current.selectionEnd,
                  ),
                ]
              : null;
          Y.applyUpdate(doc, decode(message.state), "remote");
          setValue(text.toString());
          setPeers(message.peers);
          if (message.ack === pending) pending = 0;
          ready = true;
          retry = 0;
          setConnected(true);
          // Reconnect also sends local edits whose acknowledgement was lost.
          if (encode(Y.encodeStateAsUpdate(doc)) !== message.state)
            dirty = true;
          setStatus(
            dirty || pending
              ? "Saving shared notes…"
              : "All shared notes saved",
          );
          if (selection)
            requestAnimationFrame(() => {
              const positions = selection.map(
                (p) =>
                  Y.createAbsolutePositionFromRelativePosition(p, doc)?.index ??
                  text.length,
              );
              input.current?.setSelectionRange(positions[0], positions[1]);
            });
          flush();
        };
        ws.onclose = (event) => {
          if (stopped) return;
          ready = false;
          pending = 0;
          setConnected(false);
          if (event.code === 1008 || event.code === 1009) {
            setStatus(
              "Shared notes closed. Reload to check access; unsent text remains here.",
            );
            return;
          }
          setStatus("Disconnected. Reconnecting; unsent text remains here.");
          timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
        };
        ws.onerror = () => {}; // The close event owns retry and user feedback.
      } catch (error) {
        if (!stopped) {
          setStatus(
            "Connection unavailable. Reconnecting; keep this page open to preserve unsent text.",
          );
          timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
        }
      }
    }
    void connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
      doc.destroy();
    };
  }, [taskId]);
  return (
    <section
      className="rounded-xl border bg-secondary/30 p-4 space-y-3"
      aria-label="Live shared notes"
    >
      <div className="flex flex-wrap justify-between gap-2 items-center">
        <h3 className="font-medium">Live shared notes</h3>
        <span className="text-xs text-muted-foreground">
          {connected
            ? `${peers} connected editor${peers === 1 ? "" : "s"}`
            : "Offline"}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        Write together. Concurrent text edits merge. These team notes inform
        review; only an explicit human submission records a decision. Opening
        notes excludes you from a later blind audit of this item.
      </p>
      <label className="sr-only" htmlFor="shared-review-notes">
        Shared review notes
      </label>
      <textarea
        ref={input}
        id="shared-review-notes"
        className="w-full min-h-28 rounded-lg border bg-background p-3 text-sm"
        maxLength={2000}
        value={value}
        disabled={!connected}
        onChange={(e) => edit.current(e.target.value)}
      />
      <div className="flex flex-wrap justify-between items-center gap-3">
        <p
          role="status"
          aria-live="polite"
          className="text-xs text-muted-foreground"
        >
          {status}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!value.trim()}
          onClick={() => onCopy(value)}
        >
          Copy into my reason
        </Button>
      </div>
    </section>
  );
}
