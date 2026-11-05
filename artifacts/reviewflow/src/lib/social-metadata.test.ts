import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const appRoot = new URL("../../", import.meta.url);
const html = readFileSync(new URL("index.html", appRoot), "utf8");

function meta(attribute: "name" | "property", key: string): string {
  const tag = html.match(new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="([^"]+)"\\s*/?>`));
  assert.ok(tag, `Initial HTML must include ${key}`);
  return tag[1];
}

test("social cards reference the same absolute, publicly served PNG", () => {
  assert.equal(meta("name", "twitter:card"), "summary_large_image");
  const image = new URL(meta("property", "og:image"));
  assert.equal(image.protocol, "https:");
  assert.equal(image.origin, "https://reviewflow-app.replit.app");
  assert.equal(image.pathname, "/social-preview.png");
  assert.equal(meta("name", "twitter:image"), image.href);
  assert.equal(meta("property", "og:image:type"), "image/png");
  assert.ok(meta("property", "og:image:alt").includes("ReviewFlow"));
  assert.equal(meta("name", "twitter:image:alt"), meta("property", "og:image:alt"));

  const png = readFileSync(fileURLToPath(new URL(`public${image.pathname}`, appRoot)));
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.equal(meta("property", "og:image:width"), "1200");
  assert.equal(meta("property", "og:image:height"), "630");
});
