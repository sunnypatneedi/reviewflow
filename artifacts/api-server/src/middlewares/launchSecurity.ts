import { randomUUID } from "node:crypto";
import type { RequestHandler, ErrorRequestHandler } from "express";
import { getAuth } from "@clerk/express";
import { FactoryError } from "../lib/factory-engine";

/** Socket identity only: forwarded client-IP headers are never trusted implicitly. */
export function requestBudget(
  limit = 600,
  now = () => performance.now(),
  maxEntries = 4096,
): RequestHandler {
  let sweepAt = 0;
  const clients = new Map<string, { used: number; until: number }>();
  return (req, res, next) => {
    const time = now();
    if (time >= sweepAt) {
      for (const [key, value] of clients)
        if (value.until <= time) clients.delete(key);
      sweepAt = time + 1000;
    }
    const key = req.socket.remoteAddress || "unknown";
    let entry = clients.get(key);
    if (!entry && clients.size < maxEntries) {
      entry = { used: 0, until: time + 60_000 };
      clients.set(key, entry);
    }
    if (!entry || entry.used >= limit) {
      res.set(
        "Retry-After",
        String(
          Math.max(
            1,
            Math.ceil(((entry?.until ?? time + 60_000) - time) / 1000),
          ),
        ),
      );
      res
        .status(429)
        .json({ error: "Request budget exhausted. Retry shortly." });
      return;
    }
    entry.used++;
    next();
  };
}
export function requestCapacity(maximum = 32): RequestHandler {
  let active = 0;
  return (_req, res, next) => {
    if (active >= maximum) {
      res
        .set("Retry-After", "1")
        .status(503)
        .json({ error: "Server is busy. Retry shortly." });
      return;
    }
    active++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        active--;
      }
    };
    res.once("finish", release);
    res.once("close", release);
    next();
  };
}
export const requestPrivacy: RequestHandler = (_req, res, next) => {
  res.locals.requestId = randomUUID();
  res.set({
    "X-Request-ID": res.locals.requestId,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  next();
};
export function requireConfiguredIdentity(
  mode: "demo" | "clerk",
): RequestHandler {
  return (req, res, next) => {
    if (mode === "clerk" && !getAuth(req).userId) {
      res.status(401).json({ error: "Sign in required" });
      return;
    }
    next();
  };
}
export const privateErrors: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (
    error instanceof FactoryError &&
    error.status >= 400 &&
    error.status < 500
  ) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  const kind = error && typeof error === "object" ? error.type : undefined;
  const status =
    kind === "entity.too.large"
      ? 413
      : [
            "entity.parse.failed",
            "request.aborted",
            "encoding.unsupported",
            "charset.unsupported",
          ].includes(kind)
        ? 400
        : 500;
  res.status(status).json({
    error:
      status === 413
        ? "Request body exceeds the allowed limit"
        : status === 400
          ? "Invalid request body"
          : "Request failed",
    requestId: res.locals.requestId,
  });
};
