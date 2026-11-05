import assert from "node:assert/strict";
import { test, after } from "node:test";
import express from "express";
import { randomUUID } from "node:crypto";
import { db, pool, projectsTable } from "@workspace/db";
import { registerTelemetryRoutes } from "./telemetry";
import { telemetrySnapshot } from "../lib/telemetry";

test("default local context, exact replay, conflicting replay rollback, privacy, and actor switch", async () => {
  assert.equal(process.env.REVIEWFLOW_ISOLATED_READY, "1");
  const project = randomUUID();
  let actor = "anonymous-local",
    allowed = true;
  await db
    .insert(projectsTable)
    .values({ id: project, name: "synthetic-telemetry" });
  const app = express();
  app.use(express.json());
  registerTelemetryRoutes(app, {
    ensureProject: async () => ({ project: { id: project } }),
    identity: () => actor,
    requireProjectAccess: async (_req, res) => {
      if (!allowed) res.status(403).json({ error: "denied" });
      return allowed;
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/reviewflow/telemetry`;
  const send = (body: unknown) =>
    fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const contextResponse = await fetch(`${base}/context`);
    assert.equal(contextResponse.status, 200);
    assert.equal(contextResponse.headers.get("cache-control"), "no-store");
    const context = (await contextResponse.json()) as {
      scope: string;
      projectId: string;
    };
    assert.equal(context.projectId, project);
    assert.ok(!context.scope.includes(actor));
    const event = {
      id: "first",
      session: "session",
      sequence: 1,
      kind: "foreground",
      factory: "evidence",
      itemId: null,
      itemVersion: null,
      proposalId: null,
      visibleMs: 100,
      dropped: 0,
    };
    assert.equal(
      (await send({ scope: context.scope, events: [event] })).status,
      202,
    );
    assert.equal(
      (await send({ scope: context.scope, events: [event] })).status,
      202,
    );
    assert.equal(
      (await telemetrySnapshot(project)).browser.observedForegroundMs,
      100,
    );
    assert.equal(
      (
        await send({
          scope: context.scope,
          events: [
            { ...event, id: "second", sequence: 2 },
            { ...event, visibleMs: 200 },
          ],
        })
      ).status,
      409,
    );
    assert.equal(
      (await telemetrySnapshot(project)).browser.observedForegroundMs,
      100,
    );
    assert.equal(
      (
        await send({
          scope: context.scope,
          events: [{ ...event, id: "different" }],
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await send({
          scope: context.scope,
          events: [{ ...event, source: "PRIVATE_SOURCE" }],
        })
      ).status,
      400,
    );
    actor = "another-actor";
    assert.equal(
      (await send({ scope: context.scope, events: [event] })).status,
      409,
    );
    const second = (await (await fetch(`${base}/context`)).json()) as {
      scope: string;
    };
    assert.notEqual(second.scope, context.scope);
    allowed = false;
    assert.equal((await fetch(`${base}/context`)).status, 403);
    assert.equal(
      (await send({ scope: second.scope, events: [event] })).status,
      403,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
after(async () => pool.end());
