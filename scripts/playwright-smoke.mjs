#!/usr/bin/env node
/**
 * Playwright UI smoke for ReviewFlow v4.
 * Expects the isolated demo proxy at REVIEWFLOW_SMOKE_ORIGIN (default http://127.0.0.1:5280).
 * Writes screenshots under REVIEWFLOW_SMOKE_OUT (default /opt/cursor/artifacts/screenshots/merge-readiness).
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const origin = process.env.REVIEWFLOW_SMOKE_ORIGIN ?? "http://127.0.0.1:5280";
const outDir = resolve(
  process.env.REVIEWFLOW_SMOKE_OUT
    ?? "/opt/cursor/artifacts/screenshots/merge-readiness",
);
const reportPath = resolve(
  process.env.REVIEWFLOW_SMOKE_REPORT
    ?? resolve(__dirname, "../artifacts/reviewflow/design/playwright-smoke-report.json"),
);

mkdirSync(outDir, { recursive: true });

const routes = [
  { name: "overview", path: "/" },
  { name: "tasks", path: "/tasks" },
  { name: "review", path: "/review" },
  { name: "traces", path: "/traces" },
  { name: "audits", path: "/audits" },
  { name: "releases", path: "/releases" },
  { name: "settings", path: "/settings" },
];

const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "narrow", width: 390, height: 844 },
];

async function waitReady(page) {
  await page.waitForLoadState("domcontentloaded");
  // Shell brand / framed content — tolerate slow first paint.
  await page.waitForSelector("body", { timeout: 15_000 });
  await page.waitForTimeout(400);
}

async function ensureEvaluated(page) {
  // Review needs proposals; kick a demo evaluation from Tasks if the queue is empty.
  await page.goto(`${origin}/tasks`, { waitUntil: "domcontentloaded" });
  await waitReady(page);
  const evaluate = page.getByRole("button", { name: /run evaluation/i });
  if (await evaluate.count()) {
    const disabled = await evaluate.first().isDisabled().catch(() => true);
    if (!disabled) {
      await evaluate.first().click();
      await page.waitForTimeout(1500);
    }
  }
}

const started = Date.now();
const shots = [];
const checks = [];

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
  headless: true,
});

try {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Health
  const health = await page.request.get(`${origin}/api/healthz`);
  assert.equal(health.ok(), true, `healthz failed: ${health.status()}`);
  checks.push({ name: "api-healthz", ok: true, status: health.status() });

  await ensureEvaluated(page);

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const route of routes) {
      const url = `${origin}${route.path}`;
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });
      const status = response?.status() ?? 0;
      await waitReady(page);
      const file = `${route.name}-${viewport.name}.png`;
      const path = resolve(outDir, file);
      await page.screenshot({ path, fullPage: true });
      shots.push({ route: route.name, viewport: viewport.name, path: file, status });
      checks.push({
        name: `nav-${route.name}-${viewport.name}`,
        ok: status >= 200 && status < 400,
        status,
        url,
      });
    }
  }

  // Light interaction: open Review and confirm primary CTA or empty state is present.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${origin}/review`, { waitUntil: "domcontentloaded" });
  await waitReady(page);
  const primary = page.locator("button").filter({ hasText: /Accept|Correct|Check for new|Try again|Check again/i });
  const primaryCount = await primary.count();
  assert.ok(primaryCount >= 1, "Review screen missing primary action / empty CTA");
  checks.push({ name: "review-primary-cta", ok: true, primaryCount });

  const reviewShot = resolve(outDir, "review-desktop-after-eval.png");
  await page.screenshot({ path: reviewShot, fullPage: true });
  shots.push({ route: "review", viewport: "desktop-after-eval", path: "review-desktop-after-eval.png", status: 200 });
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  origin,
  outDir,
  durationMs: Date.now() - started,
  passed: failed.length === 0,
  checkCount: checks.length,
  failCount: failed.length,
  screenshotCount: shots.length,
  checks,
  screenshots: shots,
};

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  reportPath,
  passed: report.passed,
  checkCount: report.checkCount,
  failCount: report.failCount,
  screenshotCount: report.screenshotCount,
  outDir,
  durationMs: report.durationMs,
}, null, 2));

if (failed.length) {
  console.error("Playwright smoke failures:", failed);
  process.exit(1);
}
