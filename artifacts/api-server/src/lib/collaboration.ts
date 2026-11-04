import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { and, eq } from "drizzle-orm";
import {
  db,
  exposuresTable,
  sharedNotesTable,
  tasksTable,
} from "@workspace/db";
import { FactoryError } from "./factory-engine";
import { lockFactoryItem, type FactoryTransaction } from "./factories";
import { assertCurrentRole, blindTaskIds, lockExposure } from "./team";
import { REVIEW_ROLES } from "../routes/authorization";
import { mergeNote, MAX_NOTE_BYTES } from "./shared-notes";
import type { RuntimeConfig } from "../config/runtime";

type Scope = {
  projectId: string;
  actorId: string;
  taskId: string;
  contentHash: string;
};
type Ticket = Scope & { origin: string; expires: number };
const tickets = new Map<string, Ticket>();
const whereNote = (scope: Scope) =>
  and(
    eq(sharedNotesTable.projectId, scope.projectId),
    eq(sharedNotesTable.taskId, scope.taskId),
  );

async function authorized(
  tx: FactoryTransaction,
  scope: Scope,
  expose = false,
) {
  await assertCurrentRole(tx, scope.projectId, scope.actorId, REVIEW_ROLES);
  // Same lock as audit creation: a scratchpad is exposure to team judgments.
  await lockExposure(tx, scope.projectId, scope.actorId);
  if (
    (await blindTaskIds(scope.projectId, scope.actorId, tx)).has(scope.taskId)
  )
    throw new FactoryError(
      "Shared notes are unavailable during an independent blind audit",
      403,
    );
  const control = await lockFactoryItem(
    tx,
    scope.projectId,
    "evidence",
    scope.taskId,
  );
  const [task] = await tx
    .select()
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.projectId, scope.projectId),
        eq(tasksTable.id, scope.taskId),
      ),
    )
    .for("share");
  if (!task || task.contentHash !== scope.contentHash)
    throw new FactoryError("The source changed. Reload the item.");
  if (control.quarantined || task.status === "finalized")
    throw new FactoryError(
      "Shared notes are closed for completed or quarantined items",
    );
  if (expose)
    await tx
      .insert(exposuresTable)
      .values({
        id: randomUUID(),
        projectId: scope.projectId,
        actorId: scope.actorId,
        taskId: scope.taskId,
        contentHash: scope.contentHash,
      })
      .onConflictDoNothing();
}
export async function issueCollaborationTicket(scope: Scope, origin: string) {
  const now = Date.now();
  for (const [key, ticket] of tickets)
    if (ticket.expires < now) tickets.delete(key);
  if (
    tickets.size >= 512 ||
    [...tickets.values()].filter((t) => t.actorId === scope.actorId).length >= 5
  )
    throw new FactoryError(
      "Too many pending collaboration connections; retry shortly",
      429,
    );
  await db.transaction((tx) => authorized(tx, scope, true));
  // Authorization awaits the database; enforce the cap again after that yield.
  if (
    tickets.size >= 512 ||
    [...tickets.values()].filter((t) => t.actorId === scope.actorId).length >= 5
  )
    throw new FactoryError(
      "Too many pending collaboration connections; retry shortly",
      429,
    );
  const token = randomBytes(32).toString("base64url");
  tickets.set(token, { ...scope, origin, expires: now + 30_000 });
  return {
    token,
    expiresInSeconds: 30,
    path: "/api/reviewflow/collaboration",
    scope: "evidence_shared_notes",
  };
}
export async function sharedNoteState(scope: Scope, update?: string) {
  return db.transaction(async (tx) => {
    await authorized(tx, scope);
    // The per-item control lock serializes note updates against review and quarantine.
    const [row] = await tx
      .select()
      .from(sharedNotesTable)
      .where(whereNote(scope))
      .for("update");
    if (row && row.contentHash !== scope.contentHash)
      throw new FactoryError("Shared note source changed");
    const merged = mergeNote(row?.state, update);
    let revision = row?.revision ?? 0;
    if (update && merged.state !== row?.state) {
      revision++;
      await tx
        .insert(sharedNotesTable)
        .values({
          projectId: scope.projectId,
          taskId: scope.taskId,
          contentHash: scope.contentHash,
          state: merged.state,
          revision,
        })
        .onConflictDoUpdate({
          target: [sharedNotesTable.projectId, sharedNotesTable.taskId],
          set: { state: merged.state, revision },
        });
    }
    return { state: merged.state, revision };
  });
}

/** One API process per collaboration deployment. Tickets and fan-out are process-local.
 * Durable CRDT state is in PostgreSQL; reconnect merges against the persisted state.
 * No tokens or note bodies are logged. No websocket frame can record a decision.
 */
export function attachCollaboration(server: Server, config: RuntimeConfig) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_NOTE_BYTES * 1.4 + 512,
    perMessageDeflate: false,
  });
  const peers = new Map<WebSocket, Scope & { expires: number }>();
  const send = (ws: WebSocket, value: unknown) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 128_000) {
      ws.close(1008, "Connection is too slow");
      return;
    }
    ws.send(JSON.stringify(value));
  };
  const closeFailure = (ws: WebSocket, error: unknown) => {
    send(ws, {
      type: "error",
      message:
        error instanceof FactoryError
          ? error.message
          : "Shared notes unavailable; reload to reconnect",
    });
    ws.close(1008, "Shared notes closed");
  };
  async function sync(ws: WebSocket, ack?: number) {
    const scope = peers.get(ws);
    if (!scope) return;
    if (ws.readyState !== WebSocket.OPEN) {
      peers.delete(ws);
      return;
    }
    if (scope.expires < Date.now()) {
      peers.delete(ws);
      ws.close(1000, "Refresh collaboration session");
      return;
    }
    try {
      const state = await sharedNoteState(scope);
      send(ws, {
        type: "state",
        ...(ack === undefined ? {} : { ack }),
        ...state,
        peers: [...peers.values()].filter(
          (p) => p.projectId === scope.projectId && p.taskId === scope.taskId,
        ).length,
      });
    } catch (error) {
      closeFailure(ws, error);
    }
  }
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/api/reviewflow/collaboration") {
      socket.destroy();
      return;
    }
    const origin = request.headers.origin;
    if (
      !origin ||
      !config.trustedOrigins.has(origin) ||
      wss.clients.size >= 128
    ) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const timer = setTimeout(
        () => ws.close(1008, "Authentication required"),
        5_000,
      );
      let busy = false;
      let count = 0;
      let windowStart = Date.now();
      ws.on("error", () => {});
      ws.on("close", () => {
        clearTimeout(timer);
        peers.delete(ws);
      });
      ws.on("message", async (raw, binary) => {
        if (busy) {
          ws.close(1008, "Wait for shared note acknowledgement");
          return;
        }
        busy = true;
        try {
          if (binary)
            throw new FactoryError("Use the shared notes protocol", 400);
          if (Date.now() - windowStart > 10_000) {
            count = 0;
            windowStart = Date.now();
          }
          if (++count > 80)
            throw new FactoryError("Shared notes rate limit reached", 429);
          const message = JSON.parse(raw.toString());
          if (!peers.has(ws)) {
            if (message.type !== "auth" || typeof message.token !== "string")
              throw new FactoryError("Authentication required", 401);
            const ticket = tickets.get(message.token);
            tickets.delete(message.token); // Single use, including rejected attempts.
            if (
              !ticket ||
              ticket.expires < Date.now() ||
              ticket.origin !== origin
            )
              throw new FactoryError("Collaboration ticket expired", 401);
            if (
              [...peers.values()].filter(
                (p) =>
                  p.projectId === ticket.projectId &&
                  p.taskId === ticket.taskId,
              ).length >= 16
            )
              throw new FactoryError(
                "This shared note has 16 connected editors",
                429,
              );
            await sharedNoteState(ticket); // Fresh membership, blind-audit and source checks.
            if (ws.readyState !== WebSocket.OPEN) return;
            if (
              [...peers.values()].filter(
                (p) =>
                  p.projectId === ticket.projectId &&
                  p.taskId === ticket.taskId,
              ).length >= 16
            )
              throw new FactoryError(
                "This shared note has 16 connected editors",
                429,
              );
            peers.set(ws, { ...ticket, expires: Date.now() + 300_000 });
            clearTimeout(timer);
            await sync(ws);
          } else {
            const scope = peers.get(ws)!;
            if (scope.expires < Date.now())
              throw new FactoryError("Refresh collaboration session", 401);
            if (
              message.type !== "update" ||
              typeof message.state !== "string" ||
              !Number.isSafeInteger(message.id) ||
              message.id < 1
            )
              throw new FactoryError("Invalid shared notes message", 400);
            await sharedNoteState(scope, message.state);
            // Every recipient is reauthorized before reading, including after revocation.
            await Promise.all(
              [...peers]
                .filter(
                  ([peer, p]) =>
                    peer !== ws &&
                    p.projectId === scope.projectId &&
                    p.taskId === scope.taskId,
                )
                .map(([peer]) =>
                  sync(peer, peer === ws ? message.id : undefined),
                ),
            );
            // A sender may flush queued typing immediately on its ack. It must
            // arrive only after recipient fan-out is done and we accept work.
            busy = false;
            await sync(ws, message.id);
          }
        } catch (error) {
          closeFailure(ws, error);
        } finally {
          busy = false;
        }
      });
    });
  });
  // Access changes close idle sockets too. Periodic state also repairs missed fan-out.
  const refresh = setInterval(() => {
    for (const ws of peers.keys()) void sync(ws);
  }, 5_000);
  refresh.unref();
  server.on("close", () => {
    clearInterval(refresh);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  });
  return wss;
}
