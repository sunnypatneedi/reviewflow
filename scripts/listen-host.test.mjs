import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveListenHost } from "./listen-host.mjs";
test("listeners default to loopback and reject public binding without explicit opt-in", () => {
  assert.equal(resolveListenHost({}), "127.0.0.1");
  assert.equal(resolveListenHost({ REVIEWFLOW_HOST: "::1" }), "::1");
  for (const host of ["0.0.0.0", "::", "192.168.1.4"])
    assert.throws(
      () => resolveListenHost({ REVIEWFLOW_HOST: host }),
      /Non-loopback/,
    );
  assert.equal(
    resolveListenHost({
      REVIEWFLOW_HOST: "0.0.0.0",
      REVIEWFLOW_PUBLIC_LISTEN: "true",
    }),
    "0.0.0.0",
  );
  assert.throws(
    () => resolveListenHost({ REVIEWFLOW_HOST: "untrusted.test" }),
    /IP address/,
  );
  assert.throws(
    () => resolveListenHost({ REVIEWFLOW_PUBLIC_LISTEN: "yes" }),
    /true or false/,
  );
});
