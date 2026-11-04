import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer, type Server } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { and, eq } from "drizzle-orm";
import {
  db,
  pool,
  projectsTable,
  membershipsTable,
  tasksTable,
  factoryItemsTable,
  jevControlsTable,
  jevCallsTable,
} from "@workspace/db";
import { attachCollaboration } from "../lib/collaboration";
import { FactoryError } from "../lib/factory-engine";
let server: Server, base: string, wsUrl: string;
const origin = "http://synthetic.local",
  owner = `owner-${randomUUID()}`,
  reviewer = `reviewer-${randomUUID()}`,
  outsider = `outsider-${randomUUID()}`;
const projectId = randomUUID(),
  taskId = randomUUID();
const sockets: WebSocket[] = [];
before(async () => {
  assert.equal(process.env.REVIEWFLOW_ISOLATED_READY, "1");
  await db
    .insert(projectsTable)
    .values({ id: projectId, ownerId: owner, name: "Synthetic collaboration" });
  await db.insert(membershipsTable).values([
    { id: randomUUID(), projectId, userId: owner, role: "owner" },
    { id: randomUUID(), projectId, userId: reviewer, role: "reviewer" },
  ]);
  await db.insert(tasksTable).values({
    id: taskId,
    projectId,
    externalId: "synthetic-live-note",
    question: "What is the window?",
    evidence: "Thirty days.",
    candidateAnswer: "Thirty days.",
    contentHash: "synthetic-note-content-hash",
    risk: "low",
    mode: "demo",
  });
  const app = express();
  app.use(express.json());
  app.use(cookieParser("synthetic-collaboration-only"));
  app.locals.runtimeConfig = {
    appMode: "clerk",
    liveInferenceEnabled: true,
    trustedOrigins: new Set([origin]),
    demoProjectCap: 1000,
    demoProjectCreationWindowMax: 1000,
    demoProjectCreationWindowSeconds: 60,
  };
  app.use((req, _res, next) => {
    const auth = () => ({
      userId: req.get("x-synthetic-user") ?? null,
      tokenType: "session_token",
    });
    Object.assign(auth, { [Symbol.for("@clerk/express.auth")]: true });
    (req as any).auth = auth;
    next();
  });
  app.use("/api", (await import("./reviewflow")).default);
  app.use(((error: unknown, _req, res, _next) =>
    res.status(error instanceof FactoryError ? error.status : 500).json({
      error: error instanceof Error ? error.message : "Error",
    })) as express.ErrorRequestHandler);
  server = createServer(app);
  attachCollaboration(server, app.locals.runtimeConfig);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/api/reviewflow`;
  wsUrl = `ws://127.0.0.1:${address.port}/api/reviewflow/collaboration`;
});
after(async () => {
  sockets.forEach((ws) => ws.terminate());
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});
const call = (actor: string, path: string, body = {}) =>
  fetch(base + path, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "x-synthetic-user": actor,
      "x-reviewflow-project": projectId,
    },
    body: JSON.stringify(body),
  });
async function ticket(actor: string) {
  const response = await call(actor, `/tasks/${taskId}/collaboration-ticket`);
  assert.equal(response.status, 200, await response.clone().text());
  return ((await response.json()) as any).token;
}
function connect(token: string) {
  const ws = new WebSocket(wsUrl, { origin });
  sockets.push(ws);
  const messages: any[] = [];
  ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  ws.on("error", () => {});
  ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token })));
  return { ws, messages };
}
async function until(predicate: () => boolean, timeout = 4000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > end)
      throw new Error("Timed out waiting for collaboration");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const encode = (doc: Y.Doc) =>
  Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
const textOf = (message: any) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Buffer.from(message.state, "base64"));
  return doc.getText("notes").toString();
};

test("two real WebSocket clients merge concurrent edits, persist and reconnect; tickets cannot replay", async () => {
  const ownerToken = await ticket(owner),
    a = connect(ownerToken),
    b = connect(await ticket(reviewer));
  await until(
    () =>
      a.messages.some((m) => m.type === "state") &&
      b.messages.some((m) => m.type === "state"),
  );
  const adoc = new Y.Doc(),
    bdoc = new Y.Doc();
  Y.applyUpdate(adoc, Buffer.from(a.messages[0].state, "base64"));
  Y.applyUpdate(bdoc, Buffer.from(b.messages[0].state, "base64"));
  adoc.getText("notes").insert(0, "Alpha ");
  bdoc.getText("notes").insert(0, "Beta ");
  a.ws.send(JSON.stringify({ type: "update", id: 1, state: encode(adoc) }));
  b.ws.send(JSON.stringify({ type: "update", id: 1, state: encode(bdoc) }));
  await until(() =>
    [a, b].every((client) =>
      client.messages.some(
        (m) =>
          m.type === "state" &&
          textOf(m).includes("Alpha") &&
          textOf(m).includes("Beta"),
      ),
    ),
  );
  const latest = a.messages.filter((m) => m.type === "state").at(-1);
  const c = connect(await ticket(owner));
  await until(() => c.messages.some((m) => m.type === "state"));
  assert.equal(textOf(c.messages[0]), textOf(latest));
  const replay = connect(ownerToken);
  await until(() => replay.messages.some((m) => m.type === "error"));
  assert.match(replay.messages[0].message, /expired/);
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId));
  assert.equal(task.finalLabel, null);
  assert.equal(task.version, 1);
  a.ws.close();
  b.ws.close();
  c.ws.close();
});
test("collaboration denies cross-project actors, revoked members, auditor roles and quarantined/final items", async () => {
  assert.equal(
    (await call(outsider, `/tasks/${taskId}/collaboration-ticket`)).status,
    403,
  );
  const connected = connect(await ticket(reviewer));
  await until(() => connected.messages.some((m) => m.type === "state"));
  await db
    .update(membershipsTable)
    .set({ role: "revoked" })
    .where(
      and(
        eq(membershipsTable.projectId, projectId),
        eq(membershipsTable.userId, reviewer),
      ),
    );
  const doc = new Y.Doc();
  doc.getText("notes").insert(0, "Revoked update");
  connected.ws.send(
    JSON.stringify({ type: "update", id: 1, state: encode(doc) }),
  );
  await until(() => connected.messages.some((m) => m.type === "error"));
  assert.equal(
    (await call(reviewer, `/tasks/${taskId}/collaboration-ticket`)).status,
    403,
  );
  await db
    .update(membershipsTable)
    .set({ role: "auditor" })
    .where(
      and(
        eq(membershipsTable.projectId, projectId),
        eq(membershipsTable.userId, reviewer),
      ),
    );
  assert.equal(
    (await call(reviewer, `/tasks/${taskId}/collaboration-ticket`)).status,
    403,
  );
  await db
    .update(factoryItemsTable)
    .set({ quarantined: true })
    .where(
      and(
        eq(factoryItemsTable.projectId, projectId),
        eq(factoryItemsTable.itemId, taskId),
      ),
    );
  assert.equal(
    (await call(owner, `/tasks/${taskId}/collaboration-ticket`)).status,
    409,
  );
  await db
    .update(factoryItemsTable)
    .set({ quarantined: false })
    .where(
      and(
        eq(factoryItemsTable.projectId, projectId),
        eq(factoryItemsTable.itemId, taskId),
      ),
    );
  await db
    .update(tasksTable)
    .set({ status: "finalized" })
    .where(eq(tasksTable.id, taskId));
  assert.equal(
    (await call(owner, `/tasks/${taskId}/collaboration-ticket`)).status,
    409,
  );
  await db
    .update(tasksTable)
    .set({ status: "pending" })
    .where(eq(tasksTable.id, taskId));
});
test("malformed websocket state is rejected without damaging persisted notes", async () => {
  const a = connect(await ticket(owner));
  await until(() => a.messages.some((m) => m.type === "state"));
  const before = textOf(a.messages[0]);
  a.ws.send(JSON.stringify({ type: "update", id: 1, state: "malformed!" }));
  await until(() => a.messages.some((m) => m.type === "error"));
  const b = connect(await ticket(owner));
  await until(() => b.messages.some((m) => m.type === "state"));
  assert.equal(textOf(b.messages[0]), before);
  b.ws.close();
});
test("routing API uses rules and synthetic advice, enforces budget and falls back on mocked provider failure", async () => {
  const path = `/tasks/${taskId}/routing-advice`;
  const rules = await call(owner, path, {
    provider: "rules",
    expectedVersion: 1,
  });
  assert.equal(rules.status, 200);
  const baseline = (await rules.json()) as any;
  assert.equal(baseline.source, "rules");
  assert.equal(baseline.applied, false);
  const simulated = await call(owner, path, {
    provider: "simulator",
    expectedVersion: 1,
  });
  assert.equal(simulated.status, 200);
  assert.equal(((await simulated.json()) as any).source, "simulator");
  assert.equal(
    (await call(owner, path, { provider: "jev", expectedVersion: 1 })).status,
    403,
  );
  await db
    .insert(jevControlsTable)
    .values({ projectId, enabled: true, maxCalls: 2 });
  const realFetch = globalThis.fetch,
    originalKey = process.env.TYPESAFE_API_KEY;
  let externalCalls = 0;
  process.env.TYPESAFE_API_KEY = "synthetic-never-transmitted";
  globalThis.fetch = (async (url, options) => {
    if (String(url).startsWith("https://api.typesafe.ai/")) {
      externalCalls++;
      assert.ok(options?.signal);
      return new Response("Synthetic upstream failure", { status: 503 });
    }
    return realFetch(url, options);
  }) as typeof fetch;
  try {
    const response = await call(owner, path, {
      provider: "jev",
      expectedVersion: 1,
      allowOutbound: true,
    });
    assert.equal(response.status, 200);
    const value = (await response.json()) as any;
    assert.equal(value.source, "rules");
    assert.ok(value.fallback);
    assert.equal(externalCalls, 1);
    const calls = await db
      .select()
      .from(jevCallsTable)
      .where(eq(jevCallsTable.projectId, projectId));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].status, "failed");
  } finally {
    globalThis.fetch = realFetch;
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = originalKey;
  }
  assert.equal(
    (await call(owner, path, { provider: "rules", expectedVersion: 0 })).status,
    409,
  );
});
test("routing deadline, concurrent-call fallback and quarantine remain safe under a delayed mock", async () => {
  const realFetch = globalThis.fetch,
    originalKey = process.env.TYPESAFE_API_KEY;
  let started = false;
  process.env.TYPESAFE_API_KEY = "synthetic-never-transmitted";
  globalThis.fetch = (async (url, options) => {
    if (!String(url).startsWith("https://api.typesafe.ai/"))
      return realFetch(url, options);
    started = true;
    return new Promise<Response>((_resolve, reject) =>
      options?.signal?.addEventListener(
        "abort",
        () => reject(new Error("Synthetic deadline")),
        { once: true },
      ),
    );
  }) as typeof fetch;
  try {
    const start = performance.now();
    const pending = call(owner, `/tasks/${taskId}/routing-advice`, {
      provider: "jev",
      expectedVersion: 1,
      allowOutbound: true,
    });
    await until(() => started);
    const busy = await call(owner, `/tasks/${taskId}/routing-advice`, {
      provider: "jev",
      expectedVersion: 1,
      allowOutbound: true,
    });
    assert.equal(((await busy.json()) as any).fallback, "busy");
    await db
      .update(factoryItemsTable)
      .set({ quarantined: true })
      .where(
        and(
          eq(factoryItemsTable.projectId, projectId),
          eq(factoryItemsTable.itemId, taskId),
        ),
      );
    const response = await pending;
    assert.equal(response.status, 200);
    const advice = (await response.json()) as any;
    assert.equal(advice.effectiveLane, "quarantine");
    assert.equal(advice.recommendedLane, "quarantine");
    assert.equal(advice.applied, false);
    assert.ok(
      performance.now() - start < 4000,
      "Mocked provider aborts within the bounded test deadline",
    );
    const calls = await db
      .select()
      .from(jevCallsTable)
      .where(eq(jevCallsTable.projectId, projectId));
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = realFetch;
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = originalKey;
    await db
      .update(factoryItemsTable)
      .set({ quarantined: false })
      .where(
        and(
          eq(factoryItemsTable.projectId, projectId),
          eq(factoryItemsTable.itemId, taskId),
        ),
      );
  }
});
test("report local routing observations without provider speed or accuracy claims", async () => {
  for (const provider of ["rules", "simulator"]) {
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const response = await call(owner, `/tasks/${taskId}/routing-advice`, {
        provider,
        expectedVersion: 1,
      });
      assert.equal(response.status, 200);
      times.push(((await response.json()) as any).latencyMs);
    }
    times.sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        benchmark:
          "local synthetic API, warm disposable PG, n=10; no live inference",
        provider,
        p50Ms: times[4],
        p95Ms: times[9],
      }),
    );
  }
});
test("shared notes count as exposure and cannot be reopened inside an existing blind audit", async () => {
  const { exposuresTable, auditsTable, auditItemsTable } =
    await import("@workspace/db");
  const rows = await db
    .select()
    .from(exposuresTable)
    .where(
      and(
        eq(exposuresTable.projectId, projectId),
        eq(exposuresTable.actorId, owner),
        eq(exposuresTable.taskId, taskId),
      ),
    );
  assert.equal(rows.length, 1);
  const auditId = randomUUID();
  await db.insert(auditsTable).values({
    id: auditId,
    projectId,
    status: "in_progress",
    sampleSize: 1,
    seed: "synthetic",
    samplingFrameHash: "synthetic",
    samplingFrame: [],
    independent: true,
    auditorId: owner,
  });
  await db.insert(auditItemsTable).values({
    id: randomUUID(),
    auditId,
    taskId,
    ordinal: 0,
    originalReviewId: "synthetic-legacy-review",
    originalReviewerId: reviewer,
    originalLabel: "supported",
    taskContentHash: "synthetic-note-content-hash",
  });
  try {
    assert.equal(
      (await call(owner, `/tasks/${taskId}/collaboration-ticket`)).status,
      403,
    );
  } finally {
    await db
      .delete(auditItemsTable)
      .where(eq(auditItemsTable.auditId, auditId));
    await db.delete(auditsTable).where(eq(auditsTable.id, auditId));
  }
});
