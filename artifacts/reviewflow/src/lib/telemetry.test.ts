import assert from "node:assert/strict";
import { test } from "node:test";
import { foregroundDelta } from "./telemetry";
import { protectCredentialedWrites } from "../../../api-server/src/middlewares/requestSecurity";
test("foreground reading requires no click, excludes hidden time and bounds suspension", () => {
  assert.equal(foregroundDelta(10000, true), 10000);
  assert.equal(foregroundDelta(10000, false), 0);
  assert.equal(foregroundDelta(3600000, true), 15000);
  assert.equal(foregroundDelta(-10, true), 0);
  assert.equal(foregroundDelta(NaN, true), 0);
});

test("local default gets server scope, retries stable IDs, and never rebinds old actor queue", async () => {
  const { createTelemetry } = await import("./telemetry");
  const original = globalThis.fetch;
  const posts: Array<{
    scope: string;
    events: Array<{ id: string; kind: string; itemVersion: number }>;
  }> = [];
  let contextReads = 0,
    fail = true;
  globalThis.fetch = (async (
    url: string | URL | Request,
    options?: RequestInit,
  ) => {
    if (String(url).endsWith("/context")) {
      contextReads++;
      return new Response(
        JSON.stringify({
          scope: "server-actor-scope",
          projectId: "local-project",
        }),
        { status: 200 },
      );
    }
    // Exercise the real production CSRF middleware against the browser fetch
    // options, rather than accepting every mocked POST regardless of headers.
    const protection = protectCredentialedWrites({
      trustedOrigins: new Set(["http://localhost"]),
    } as Parameters<typeof protectCredentialedWrites>[0]);
    const headers = new Headers(options?.headers);
    let allowed = false;
    protection(
      {
        method: options?.method,
        get: (name: string) =>
          name === "origin" ? "http://localhost" : headers.get(name),
      } as Parameters<typeof protection>[0],
      {
        status: (status: number) => ({
          json: (error: unknown) =>
            assert.fail(`CSRF ${status}: ${JSON.stringify(error)}`),
        }),
      } as unknown as Parameters<typeof protection>[1],
      () => {
        allowed = true;
      },
    );
    assert.equal(allowed, true);
    const body = JSON.parse(String(options?.body));
    posts.push(body);
    assert.equal(
      (options?.headers as Record<string, string>)["x-reviewflow-project"],
      "local-project",
    );
    return fail
      ? new Response("{}", { status: 409 })
      : new Response(
          JSON.stringify({
            accepted: body.events.map((e: { id: string }) => e.id),
          }),
          { status: 202 },
        );
  }) as typeof fetch;
  try {
    const session = createTelemetry({
      factory: "evidence",
      itemId: "item",
      itemVersion: 3,
    });
    session.emit("task_opened");
    await session.flush();
    fail = false;
    await session.flush();
    assert.equal(contextReads, 1);
    assert.equal(posts[0].scope, "server-actor-scope");
    assert.deepEqual(posts[0], posts[1]);
    assert.equal(posts[0].events[0].itemVersion, 3);
    assert.deepEqual(
      Object.keys(posts[0].events[0]).sort(),
      [
        "dropped",
        "factory",
        "id",
        "itemId",
        "itemVersion",
        "kind",
        "proposalId",
        "sequence",
        "session",
        "visibleMs",
      ].sort(),
    );
    await session.flush();
    assert.equal(posts.length, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("flush requested during delivery sends the closing tail without another timer", async () => {
  const { createTelemetry } = await import("./telemetry");
  const original = globalThis.fetch;
  const posts: Array<Array<{ id: string; kind: string }>> = [];
  let releaseFirst!: () => void;
  let firstStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  globalThis.fetch = (async (
    url: string | URL | Request,
    options?: RequestInit,
  ) => {
    if (String(url).endsWith("/context"))
      return new Response(
        JSON.stringify({ scope: "scope", projectId: "project" }),
      );
    const { events } = JSON.parse(String(options?.body));
    posts.push(events);
    if (posts.length === 1) {
      firstStarted();
      await blocked;
    }
    return new Response(
      JSON.stringify({
        accepted: events.map((event: { id: string }) => event.id),
      }),
      { status: 202 },
    );
  }) as typeof fetch;
  try {
    const session = createTelemetry({ factory: "rubric", itemId: "item" });
    session.emit("task_opened");
    const first = session.flush();
    await started;
    session.emit("session_closed");
    await session.flush();
    releaseFirst();
    await first;
    assert.deepEqual(
      posts.map((batch) => batch.map((event) => event.kind)),
      [["task_opened"], ["session_closed"]],
    );
    await session.flush();
    assert.equal(posts.length, 2);
  } finally {
    releaseFirst();
    globalThis.fetch = original;
  }
});
