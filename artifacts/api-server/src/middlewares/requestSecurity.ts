import type { RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import type { RuntimeConfig } from "../config/runtime";

export const CSRF_HEADER = "x-reviewflow-csrf";
export const CSRF_VALUE = "1";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const clerkAuthBrand = Symbol.for("@clerk/express.auth");

export function demoSignedOutAuth(): RequestHandler {
  return (req, _res, next) => {
    const auth = () => ({ status: "signed-out", reason: "session-token-missing" });
    Object.assign(auth, { [clerkAuthBrand]: true });
    (req as typeof req & { auth: typeof auth }).auth = auth;
    next();
  };
}

export function corsOrigin(
  trustedOrigins: ReadonlySet<string>,
): (origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void) => void {
  return (origin, callback) => {
    if (!origin || trustedOrigins.has(origin)) callback(null, true);
    else callback(null, false);
  };
}

export function writeProtectionError(input: {
  method: string;
  origin?: string;
  csrfHeader?: string;
  trustedOrigins: ReadonlySet<string>;
}): string | null {
  if (SAFE_METHODS.has(input.method)) return null;
  if (!input.origin || !input.trustedOrigins.has(input.origin)) {
    return "Write requests require a trusted Origin";
  }
  if (input.csrfHeader !== CSRF_VALUE) return "Missing or invalid CSRF header";
  return null;
}

export function protectCredentialedWrites(config: RuntimeConfig): RequestHandler {
  return (req, res, next) => {
    const error = writeProtectionError({
      method: req.method,
      origin: req.get("origin"),
      csrfHeader: req.get(CSRF_HEADER),
      trustedOrigins: config.trustedOrigins,
    });
    if (error) {
      res.status(403).json({ error });
      return;
    }
    next();
  };
}

export function liveInferenceError(input: {
  method: string;
  requestedMode?: unknown;
  appMode: RuntimeConfig["appMode"];
  liveInferenceEnabled: boolean;
  authenticated: boolean;
}): { status: 401 | 403; error: string } | null {
  if (SAFE_METHODS.has(input.method) || input.requestedMode !== "live") return null;
  if (!input.liveInferenceEnabled) {
    return { status: 403, error: "Live inference is disabled by server configuration" };
  }
  if (input.appMode !== "clerk" || !input.authenticated) {
    return { status: 401, error: "Live inference requires an authenticated Clerk user" };
  }
  return null;
}

export function enforceLiveInference(config: RuntimeConfig): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method) || req.body?.mode !== "live") return next();
    const error = liveInferenceError({
      method: req.method,
      requestedMode: req.body?.mode,
      appMode: config.appMode,
      liveInferenceEnabled: config.liveInferenceEnabled,
      authenticated: Boolean(getAuth(req).userId),
    });
    if (error) {
      res.status(error.status).json({ error: error.error });
      return;
    }
    next();
  };
}
