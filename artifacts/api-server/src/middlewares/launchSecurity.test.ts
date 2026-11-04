import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { once } from "node:events";
import {
  requestBudget,
  requestCapacity,
  requestPrivacy,
  requireConfiguredIdentity,
  privateErrors,
} from "./launchSecurity";
import { createReadiness } from "../lib/readiness";
import { clerkProxyMiddleware } from "./clerkProxyMiddleware";
async function serve(app: express.Express) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
async function until(check: () => boolean) {
  const end = Date.now() + 2000;
  while (!check()) {
    assert.ok(Date.now() < end, "Condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
test("Clerk API boundary refuses signed-out requests before parsing or provisioning", async () => {
  const app = express();
  let reached = 0;
  app.use((req, _res, next) => {
    const auth = () => ({
      userId: req.get("x-fixture-auth") === "valid" ? "synthetic-member" : null,
      tokenType: "session_token",
    });
    Object.assign(auth, { [Symbol.for("@clerk/express.auth")]: true });
    (req as any).auth = auth;
    next();
  });
  app.use(requireConfiguredIdentity("clerk"));
  app.use(express.json());
  app.post("/", (_req, res) => {
    reached++;
    res.json({ ok: true });
  });
  app.use(privateErrors);
  const target = await serve(app);
  try {
    const unsigned = await fetch(target.base, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "reviewflow_demo=forged",
        authorization: "Bearer forged",
        "x-synthetic-user": "forged-member",
      },
      body: "{ private malformed payload",
    });
    assert.equal(unsigned.status, 401);
    assert.equal(unsigned.headers.get("set-cookie"), null);
    assert.equal(reached, 0);
    assert.equal(
      (
        await fetch(target.base, {
          method: "POST",
          headers: {
            "x-fixture-auth": "valid",
            "content-type": "application/json",
          },
          body: "{}",
        })
      ).status,
      200,
    );
    assert.equal(reached, 1);
  } finally {
    await target.close();
  }
});
test("rate budget ignores spoofed forwarded IPs and refills with bounded identity storage", async () => {
  let clock = 0;
  const app = express();
  app.use(requestBudget(2, () => clock, 1));
  app.get("/", (_req, res) => res.json({ ok: true }));
  const target = await serve(app);
  try {
    for (const ip of ["203.0.113.1", "203.0.113.2"])
      assert.equal(
        (await fetch(target.base, { headers: { "x-forwarded-for": ip } }))
          .status,
        200,
      );
    const limited = await fetch(target.base, {
      headers: { "x-forwarded-for": "203.0.113.3" },
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
    const bounded = requestBudget(10, () => clock, 1);
    function invoke(ip: string) {
      let status = 200;
      const res = {
        set() {
          return this;
        },
        status(code: number) {
          status = code;
          return this;
        },
        json() {},
      };
      bounded({ socket: { remoteAddress: ip } } as any, res as any, () => {});
      return status;
    }
    assert.equal(invoke("127.0.0.1"), 200);
    assert.equal(
      invoke("127.0.0.2"),
      429,
      "A new identity cannot grow the full bounded store",
    );
    clock = 60_001;
    assert.equal((await fetch(target.base)).status, 200);
  } finally {
    await target.close();
  }
});
test("concurrency admission releases capacity on aborted and completed requests", async () => {
  const app = express(),
    releases: Array<() => void> = [];
  let entered = 0,
    closed = 0;
  app.use(requestCapacity(2));
  app.get("/", async (_req, res) => {
    entered++;
    res.once("close", () => closed++);
    await new Promise<void>((resolve) => releases.push(resolve));
    if (!res.destroyed) res.json({ ok: true });
  });
  const target = await serve(app),
    controller = new AbortController();
  const first = fetch(target.base);
  const aborted = fetch(target.base, { signal: controller.signal }).catch(
    () => null,
  );
  try {
    await until(() => entered === 2);
    assert.equal((await fetch(target.base)).status, 503);
    controller.abort();
    await aborted;
    await until(() => closed > 0);
    const replacement = fetch(target.base);
    await until(() => entered === 3);
    releases.splice(0).forEach((release) => release());
    assert.equal((await first).status, 200);
    assert.equal((await replacement).status, 200);
  } finally {
    releases.forEach((release) => release());
    controller.abort();
    await target.close();
  }
});
test("parser and internal errors return generic JSON without payload, stack or database text", async () => {
  const app = express();
  app.use(requestPrivacy);
  app.use(express.json({ limit: 32 }));
  app.post("/", (_req, _res, next) =>
    next(
      new Error("SYNTHETIC_PRIVATE_DATABASE_VALUE /Users/private/source.ts"),
    ),
  );
  let delegated = false;
  app.get("/partial", (_req, res, next) => {
    res.write("partial");
    next(new Error("SYNTHETIC_PRIVATE_LATE_ERROR"));
  });
  app.use(privateErrors);
  app.use(((_error, _req, res, _next) => {
    delegated = true;
    res.destroy();
  }) satisfies express.ErrorRequestHandler);
  const target = await serve(app);
  try {
    for (const [body, expected] of [
      ["{SYNTHETIC_PRIVATE_BODY", 400],
      [JSON.stringify({ value: "SYNTHETIC_PRIVATE_BODY".repeat(30) }), 413],
      ["{}", 500],
    ] as const) {
      const response = await fetch(target.base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      const text = await response.text();
      assert.equal(response.status, expected);
      assert.doesNotMatch(text, /SYNTHETIC_PRIVATE|Users|stack|SyntaxError/);
      assert.match(
        response.headers.get("x-request-id") ?? "",
        /^[a-f0-9-]{36}$/,
      );
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.match(
        response.headers.get("content-type") ?? "",
        /application\/json/,
      );
    }
    await assert.rejects(async () => {
      const partial = await fetch(target.base + "/partial");
      await partial.text();
    });
    assert.equal(
      delegated,
      false,
      "Never forward a private late error to the default logging handler",
    );
  } finally {
    await target.close();
  }
});
test("readiness coalesces probes, caches briefly and converts dependency failure to unavailable", async () => {
  let calls = 0,
    clock = 0,
    release!: () => void;
  const ready = createReadiness(
    async () => {
      calls++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    () => clock,
  );
  const probes = Array.from({ length: 40 }, () => ready());
  await until(() => calls === 1);
  release();
  assert.ok((await Promise.all(probes)).every(Boolean));
  assert.equal(await ready(), true);
  assert.equal(calls, 1);
  clock = 501;
  const next = ready();
  await until(() => calls === 2);
  release();
  assert.equal(await next, true);
  assert.equal(
    await createReadiness(() => {
      throw new Error("SYNTHETIC_PRIVATE_FAILURE");
    })(),
    false,
  );
});
test("optional Clerk proxy pins configured origin, bounds unknown-length responses and times out", async () => {
  const previousMode = process.env.NODE_ENV,
    previousKey = process.env.CLERK_SECRET_KEY;
  process.env.NODE_ENV = "production";
  process.env.CLERK_SECRET_KEY = "synthetic-proxy-only";
  let observed: Record<string, unknown> = {};
  const upstream = express();
  upstream.get("/small", (req, res) => {
    observed = req.headers;
    res.write("synthetic");
    res.end(" response");
  });
  upstream.get("/large", (_req, res) => {
    res.write("x".repeat(1_000_000));
    res.end("x".repeat(1_100_000));
  });
  upstream.get("/slow", (_req, _res) => {});
  const remote = await serve(upstream),
    app = express();
  app.use(clerkProxyMiddleware("https://trusted.test", remote.base));
  const target = await serve(app);
  try {
    assert.equal(
      await (
        await fetch(target.base + "/small", {
          headers: {
            "x-forwarded-host": "untrusted.invalid",
            "x-forwarded-proto": "http",
            "x-forwarded-for": "203.0.113.5",
          },
        })
      ).text(),
      "synthetic response",
    );
    assert.equal(
      observed["clerk-proxy-url"],
      "https://trusted.test/api/__clerk",
    );
    assert.equal(observed["clerk-secret-key"], "synthetic-proxy-only");
    assert.doesNotMatch(String(observed["x-forwarded-for"]), /203\.0\.113/);
    const large = await fetch(target.base + "/large");
    assert.equal(large.status, 502);
    assert.equal(await large.text(), "");
    const started = Date.now();
    assert.equal((await fetch(target.base + "/slow")).status, 502);
    assert.ok(Date.now() - started < 7000);
  } finally {
    await target.close();
    await remote.close();
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
    if (previousKey === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = previousKey;
  }
});
