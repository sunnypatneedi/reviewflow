import { randomBytes } from "node:crypto";

export type AppMode = "demo" | "clerk";

export type RuntimeConfig = {
  appMode: AppMode;
  liveInferenceEnabled: boolean;
  sessionSecret: string;
  trustedOrigins: ReadonlySet<string>;
  demoProjectCap: number;
  demoProjectCreationWindowMax: number;
  demoProjectCreationWindowSeconds: number;
};

function parseBoolean(name: string, value: string | undefined): boolean {
  if (value === undefined || value === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be "true" or "false"`);
}

function parsePositiveInteger(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function resolveAppMode(env: NodeJS.ProcessEnv): AppMode {
  const explicit = env.APP_MODE;
  if (explicit !== undefined && explicit !== "demo" && explicit !== "clerk") {
    throw new Error('APP_MODE must be either "demo" or "clerk"');
  }

  const hasPublishableKey = Boolean(env.CLERK_PUBLISHABLE_KEY);
  const hasSecretKey = Boolean(env.CLERK_SECRET_KEY);
  if (hasPublishableKey !== hasSecretKey) {
    throw new Error("Clerk configuration is incomplete: both Clerk keys are required");
  }
  if (explicit === "clerk" && !hasPublishableKey) {
    throw new Error("APP_MODE=clerk requires Clerk publishable and secret keys");
  }
  return explicit ?? (hasPublishableKey ? "clerk" : "demo");
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`Invalid trusted origin: ${value}`);
  }
  return url.origin;
}

function safeManagedHost(value: string): string | null {
  const host = value.trim().toLowerCase();
  if (!host || host.includes(":") || !/^[a-z0-9.-]+$/.test(host) || host.startsWith(".") || host.endsWith(".")) {
    return null;
  }
  return host;
}

export function resolveTrustedOrigins(env: NodeJS.ProcessEnv): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const entry of (env.TRUSTED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean)) {
    origins.add(normalizeOrigin(entry));
  }

  if (env.NODE_ENV !== "production") {
    origins.add("http://localhost:5173");
    origins.add("http://127.0.0.1:5173");
    const devHost = safeManagedHost(env.REPLIT_DEV_DOMAIN ?? "");
    if (devHost?.endsWith(".replit.dev")) origins.add(`https://${devHost}`);
  }

  for (const entry of (env.REPLIT_DOMAINS ?? "").split(",")) {
    const host = safeManagedHost(entry);
    if (host) origins.add(`https://${host}`);
  }
  return origins;
}

export function loadRuntimeConfig(
  env: NodeJS.ProcessEnv,
  ephemeralSecret = () => randomBytes(32).toString("base64url"),
): RuntimeConfig {
  const appMode = resolveAppMode(env);
  const configuredSecret = env.SESSION_SECRET;
  if (env.NODE_ENV === "production" && !configuredSecret) {
    throw new Error("SESSION_SECRET is required in production");
  }
  return {
    appMode,
    liveInferenceEnabled: parseBoolean("LIVE_INFERENCE_ENABLED", env.LIVE_INFERENCE_ENABLED),
    sessionSecret: configuredSecret ?? ephemeralSecret(),
    trustedOrigins: resolveTrustedOrigins(env),
    demoProjectCap: parsePositiveInteger("DEMO_PROJECT_CAP", env.DEMO_PROJECT_CAP, 100),
    demoProjectCreationWindowMax: parsePositiveInteger(
      "DEMO_PROJECT_CREATION_WINDOW_MAX",
      env.DEMO_PROJECT_CREATION_WINDOW_MAX,
      10,
    ),
    demoProjectCreationWindowSeconds: parsePositiveInteger(
      "DEMO_PROJECT_CREATION_WINDOW_SECONDS",
      env.DEMO_PROJECT_CREATION_WINDOW_SECONDS,
      60,
    ),
  };
}
