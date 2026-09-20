import assert from "node:assert/strict";
import test from "node:test";
import { corsOrigin, liveInferenceError, writeProtectionError } from "./requestSecurity";

test("CORS accepts absent and explicitly trusted origins only", async () => {
  const decide = corsOrigin(new Set(["https://trusted.test"]));
  const result = (origin?: string) => new Promise<{ error: Error | null; allowed?: boolean }>((resolve) => {
    decide(origin, (error, allowed) => resolve({ error, allowed }));
  });
  await Promise.all([
    result(undefined).then(({ error, allowed }) => {
      assert.equal(error, null);
      assert.equal(allowed, true);
    }),
    result("https://trusted.test").then(({ error, allowed }) => {
      assert.equal(error, null);
      assert.equal(allowed, true);
    }),
    result("https://attacker.test").then(({ error, allowed }) => {
      assert.equal(error, null);
      assert.equal(allowed, false);
    }),
  ]);
});

test("credentialed writes require both trusted origin and CSRF marker", () => {
  const trustedOrigins = new Set(["https://trusted.test"]);
  assert.equal(writeProtectionError({ method: "GET", trustedOrigins }), null);
  assert.match(
    writeProtectionError({ method: "POST", origin: "https://attacker.test", csrfHeader: "1", trustedOrigins }) ?? "",
    /trusted Origin/,
  );
  assert.match(
    writeProtectionError({ method: "POST", origin: "https://trusted.test", trustedOrigins }) ?? "",
    /CSRF/,
  );
  assert.equal(
    writeProtectionError({ method: "POST", origin: "https://trusted.test", csrfHeader: "1", trustedOrigins }),
    null,
  );
});

test("live inference is gated by opt-in, Clerk mode, and authentication", () => {
  assert.deepEqual(
    liveInferenceError({
      method: "POST",
      requestedMode: "live",
      appMode: "clerk",
      liveInferenceEnabled: false,
      authenticated: true,
    }),
    { status: 403, error: "Live inference is disabled by server configuration" },
  );
  assert.equal(
    liveInferenceError({
      method: "POST",
      requestedMode: "live",
      appMode: "clerk",
      liveInferenceEnabled: true,
      authenticated: true,
    }),
    null,
  );
  assert.equal(
    liveInferenceError({
      method: "POST",
      requestedMode: "demo",
      appMode: "demo",
      liveInferenceEnabled: false,
      authenticated: false,
    }),
    null,
  );
  assert.equal(
    liveInferenceError({
      method: "POST",
      requestedMode: "live",
      appMode: "demo",
      liveInferenceEnabled: true,
      authenticated: false,
    })?.status,
    401,
  );
});
