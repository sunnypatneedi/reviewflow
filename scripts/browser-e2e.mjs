import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const base = "http://127.0.0.1:5290";
for (let attempt = 0; attempt < 100; attempt++) {
  try {
    if (
      (
        await fetch(base + "/api/projects", {
          headers: { "x-synthetic-user": "browser-owner" },
        })
      ).status !== 502 &&
      (await fetch(base + "/team")).ok
    )
      break;
  } catch {}
  if (attempt === 99) throw new Error("Synthetic target unavailable");
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const browser = await chromium.launch({
  headless: true,
  ...(process.env.REVIEWFLOW_CHROMIUM_PATH
    ? { executablePath: process.env.REVIEWFLOW_CHROMIUM_PATH }
    : {}),
});
const errors = [],
  contexts = [];
const captures = resolve(
  process.env.REVIEWFLOW_SCREENSHOT_DIR || "/tmp/reviewflow-launch-captures",
);
mkdirSync(captures, { recursive: true });
async function accessible(page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      targets: v.nodes.map((n) => n.target),
    })),
    [],
  );
}
async function top(page) {
  await page.evaluate(() =>
    document.querySelectorAll("*").forEach((el) => {
      if (el.scrollTop) el.scrollTop = 0;
    }),
  );
}

async function pageFor(actor) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    extraHTTPHeaders: { "x-synthetic-user": actor },
  });
  contexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(base) ? route.continue() : route.abort(),
  );
  return page;
}
async function post(page, path, body) {
  return page.evaluate(
    async ({ path, body }) => {
      const response = await fetch("/api/reviewflow" + path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-reviewflow-csrf": "1",
          "x-reviewflow-project":
            sessionStorage.getItem("reviewflow.project") ?? "",
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, payload: await response.json() };
    },
    { path, body },
  );
}
async function shared(page, projectId) {
  await page.goto(base + "/team");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.getByLabel("Active project").selectOption(projectId),
  ]);
  await page.getByRole("heading", { name: "Team & provider" }).waitFor();
}
try {
  const owner = await pageFor("browser-owner");
  await owner.goto(base + "/team");
  await owner.getByLabel("New project name").fill("Synthetic browser team");
  await Promise.all([
    owner.waitForNavigation({ waitUntil: "domcontentloaded" }),
    owner
      .getByRole("button", { name: "Create shared project", exact: true })
      .click(),
  ]);
  await owner.waitForURL(base + "/team");
  await owner.getByLabel("Account ID").waitFor();
  const projectId = await owner.evaluate(() =>
    sessionStorage.getItem("reviewflow.project"),
  );
  for (const [actor, role] of [
    ["browser-reviewer", "reviewer"],
    ["browser-auditor", "auditor"],
    ["browser-exporter", "exporter"],
  ]) {
    await owner.getByLabel("Account ID", { exact: true }).fill(actor);
    await owner
      .getByLabel("New member role", { exact: true })
      .selectOption(role);
    await owner
      .getByRole("button", { name: "Add member", exact: true })
      .click();
    await owner.getByText(actor, { exact: true }).waitFor();
  }
  assert.equal(
    (
      await post(owner, "/tasks/import", {
        tasks: [
          {
            externalId: "browser-team-1",
            question: "Return window?",
            evidence: "30 days",
            candidateAnswer: "30 days",
            risk: "low",
          },
        ],
      })
    ).status,
    200,
  );
  await owner.goto(base + "/factories");
  await owner.getByRole("button", { name: /^browser-team-1 / }).click();
  await owner.getByLabel("Assign to member").selectOption("browser-reviewer");
  await owner
    .getByRole("button", { name: "Assign / reassign", exact: true })
    .click();
  await owner
    .getByRole("status")
    .filter({ hasText: "Assignment saved" })
    .waitFor();
  const reviewer = await pageFor("browser-reviewer");
  await shared(reviewer, projectId);
  await reviewer.goto(base + "/factories");
  await reviewer.getByRole("button", { name: /^browser-team-1 / }).click();
  const notesA = owner.getByLabel("Shared review notes", { exact: true }),
    notesB = reviewer.getByLabel("Shared review notes", { exact: true });
  await notesA.waitFor();
  await notesB.waitFor();
  await notesA.waitFor({ state: "visible" });
  await owner.waitForFunction(
    () => !document.querySelector("#shared-review-notes")?.disabled,
  );
  await reviewer.waitForFunction(
    () => !document.querySelector("#shared-review-notes")?.disabled,
  );
  await Promise.all([
    notesA.fill("Owner analysis. "),
    notesB.fill("Reviewer analysis. "),
  ]);
  await owner.waitForFunction(() => {
    const v = document.querySelector("#shared-review-notes")?.value ?? "";
    return v.includes("Owner analysis") && v.includes("Reviewer analysis");
  });
  await reviewer.waitForFunction(() => {
    const v = document.querySelector("#shared-review-notes")?.value ?? "";
    return v.includes("Owner analysis") && v.includes("Reviewer analysis");
  });
  assert.equal(await notesA.inputValue(), await notesB.inputValue());
  await reviewer.getByRole("button", { name: "Copy into my reason" }).click();
  assert.match(
    await reviewer.getByLabel("Decision or quarantine reason").inputValue(),
    /Owner analysis/,
  );
  await notesB.focus();
  await reviewer.keyboard.press("Tab");
  assert.equal(
    await reviewer
      .getByRole("button", { name: "Copy into my reason" })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await owner.getByText("Routing preview", { exact: true }).click();
  await owner
    .getByRole("button", { name: "Preview routing", exact: true })
    .click();
  await owner.getByText("No change applied.", { exact: false }).waitFor();
  await accessible(owner);
  await owner.getByText("Routing preview", { exact: true }).click();
  await owner.setViewportSize({ width: 1440, height: 1600 });
  await top(owner);
  await owner.screenshot({
    path: resolve(captures, "reviewflow-live-notes.png"),
    fullPage: true,
  });
  await owner.setViewportSize({ width: 1440, height: 1100 });
  // Reconnect preserves the merged persistent CRDT state.
  await owner.reload();
  await owner.getByRole("button", { name: /^browser-team-1 / }).click();
  await owner.waitForFunction(() =>
    document
      .querySelector("#shared-review-notes")
      ?.value?.includes("Reviewer analysis"),
  );
  await reviewer
    .getByLabel("Decision or quarantine reason")
    .fill("Synthetic assigned browser review.");
  await reviewer
    .getByRole("button", { name: "Record human decision", exact: true })
    .click();
  await reviewer
    .getByRole("status")
    .filter({ hasText: "Human decision recorded" })
    .waitFor();
  const auditor = await pageFor("browser-auditor");
  await shared(auditor, projectId);
  await auditor.goto(base + "/audits");
  await auditor.getByLabel("Sample size", { exact: true }).fill("1");
  await auditor
    .getByRole("button", { name: "Create audit", exact: true })
    .click();
  const blindLabel = auditor
    .locator("select")
    .filter({ has: auditor.locator('option[value="supported"]') })
    .first();
  await blindLabel.waitFor();
  await blindLabel.selectOption("supported");
  await auditor
    .getByRole("button", { name: "Submit blind decision", exact: true })
    .click();
  await auditor
    .getByText("Decision recorded", { exact: false })
    .first()
    .waitFor();
  const exporter = await pageFor("browser-exporter");
  await shared(exporter, projectId);
  await exporter.goto(base + "/releases");
  await exporter
    .getByPlaceholder("e.g. v1.0.0-rc.1")
    .fill("synthetic-team-release");
  await exporter
    .getByRole("button", { name: "Cut Release", exact: true })
    .click();
  await exporter.getByText("synthetic-team-release", { exact: true }).waitFor();
  // Read-only dashboard must agree with this workflow and keep unknowns honest.
  await owner.goto(base + "/observability");
  await owner
    .getByRole("heading", { name: "Evidence pipeline", exact: true })
    .waitFor();
  const metric = (label) =>
    owner.getByText(label, { exact: true }).locator("..").locator("dd");
  assert.equal(await metric("Imported tasks").innerText(), "1");
  assert.equal(await metric("Currently finalized").innerText(), "1");
  assert.equal(await metric("Released unique content").innerText(), "1");
  await owner
    .getByRole("heading", { name: "Not yet measured", exact: true })
    .waitFor();
  await accessible(owner);
  await owner.screenshot({
    path: resolve(captures, "reviewflow-observability.png"),
    fullPage: true,
  });
  await owner.setViewportSize({ width: 390, height: 844 });
  await accessible(owner);
  assert.equal(
    await owner.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await owner.screenshot({
    path: resolve(captures, "reviewflow-observability-mobile.png"),
    fullPage: true,
  });
  await owner.setViewportSize({ width: 1440, height: 1100 });
  // A failed refresh must hide prior values, not present stale data as current.
  const snapshotPattern = "**/api/reviewflow/observability";
  await owner.route(snapshotPattern, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic unavailable" }),
    }),
  );
  await owner
    .getByRole("button", { name: "Refresh observability snapshot" })
    .click();
  await owner
    .getByRole("alert")
    .filter({ hasText: "Snapshot unavailable" })
    .waitFor();
  assert.equal(
    await owner
      .getByRole("heading", { name: "Evidence pipeline", exact: true })
      .count(),
    0,
  );
  await owner.unroute(snapshotPattern);
  await owner
    .getByRole("button", { name: "Refresh observability snapshot" })
    .click();
  await owner
    .getByRole("heading", { name: "Evidence pipeline", exact: true })
    .waitFor();
  await reviewer.goto(base + "/observability");
  await reviewer
    .getByRole("alert")
    .filter({ hasText: "owners and adjudicators" })
    .waitFor();
  assert.equal(
    await reviewer
      .getByRole("heading", { name: "Evidence pipeline", exact: true })
      .count(),
    0,
  );
  // Generic rubric factory: actual UI, distinct synthetic actors and immutable bytes.
  const rubricAction = async (page, name, path, expected = 201) => {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/reviewflow/rubrics${path}`) &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name, exact: true }).click();
    const response = await responsePromise;
    const body = await response.json();
    assert.equal(response.status(), expected, JSON.stringify(body));
    if (expected === 201)
      await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
    return body;
  };
  await owner.goto(base + "/rubrics");
  await owner
    .getByRole("heading", { name: "Rubric factory", exact: true })
    .waitFor();
  await rubricAction(owner, "Save new revision", "/specs");
  await rubricAction(owner, "Import items", "/items");
  await owner
    .getByRole("heading", { name: "example-1", exact: true })
    .waitFor();
  await accessible(owner);
  const rubricData = await owner.evaluate(async () =>
    (
      await fetch("/api/reviewflow/rubrics", {
        headers: {
          "x-reviewflow-project": sessionStorage.getItem("reviewflow.project"),
        },
      })
    ).json(),
  );
  const rubricItemId = rubricData.items[0].id;
  await reviewer.goto(base + "/rubrics");
  await reviewer
    .getByRole("heading", { name: "example-1", exact: true })
    .waitFor();
  await rubricAction(reviewer, "Claim item", `/items/${rubricItemId}/claim`);
  await reviewer.getByLabel("example-1 Accuracy", { exact: true }).fill("5");
  await reviewer
    .getByLabel("example-1 Safe to use", { exact: true })
    .selectOption("yes");
  await reviewer
    .getByLabel("example-1 reason", { exact: true })
    .fill("Synthetic exercise: the supplied answer is correct.");
  await reviewer
    .getByLabel(
      "I reviewed this content for privacy and suitability for export.",
      { exact: true },
    )
    .check();
  await rubricAction(reviewer, "Renew claim", `/items/${rubricItemId}/claim`);
  assert.equal(
    await reviewer
      .getByLabel("example-1 Accuracy", { exact: true })
      .inputValue(),
    "5",
  );
  assert.equal(
    await reviewer
      .getByLabel("example-1 Safe to use", { exact: true })
      .inputValue(),
    "yes",
  );
  assert.equal(
    await reviewer.getByLabel("example-1 reason", { exact: true }).inputValue(),
    "Synthetic exercise: the supplied answer is correct.",
  );
  assert.equal(
    await reviewer
      .getByLabel(
        "I reviewed this content for privacy and suitability for export.",
        { exact: true },
      )
      .isChecked(),
    true,
  );
  await rubricAction(
    reviewer,
    "Finalize human review",
    `/items/${rubricItemId}/review`,
  );
  await owner.goto(base + "/rubrics");
  await owner.getByLabel(/I reviewed the full release/).check();
  await rubricAction(owner, "Create immutable release", "/releases", 409);
  await owner.getByRole("alert").filter({ hasText: /audit/i }).waitFor();
  await auditor.goto(base + "/rubrics");
  await auditor
    .getByRole("heading", { name: "example-1", exact: true })
    .waitFor();
  await auditor.getByLabel("example-1 Accuracy", { exact: true }).fill("5");
  await auditor
    .getByLabel("example-1 Safe to use", { exact: true })
    .selectOption("yes");
  await auditor
    .getByLabel("example-1 reason", { exact: true })
    .fill(
      "Scripted synthetic auditor agrees for workflow testing, not real qualification.",
    );
  await auditor.getByLabel(/I am a different human from the item/).check();
  await rubricAction(
    auditor,
    "Submit independent audit",
    `/items/${rubricItemId}/audit`,
  );
  await exporter.goto(base + "/rubrics");
  await exporter.getByLabel(/I reviewed the full release/).check();
  const rubricRelease = await rubricAction(
    exporter,
    "Create immutable release",
    "/releases",
  );
  const downloadPromise = exporter.waitForEvent("download");
  await exporter
    .getByRole("button", { name: "Download JSONL", exact: true })
    .click();
  const rubricDownload = await downloadPromise;
  const rubricBytes = readFileSync(await rubricDownload.path(), "utf8");
  assert.equal(
    createHash("sha256").update(rubricBytes).digest("hex"),
    rubricRelease.sha256,
  );
  const rubricRecord = JSON.parse(rubricBytes.trim());
  assert.equal(Object.hasOwn(rubricRecord, "content"), false);
  assert.equal(rubricBytes.includes("browser-reviewer"), false);
  assert.equal(rubricRecord.rubric.revision, 1);
  await owner.goto(base + "/rubrics");
  const rubricDefinition = JSON.parse(
    await owner.getByLabel("Rubric JSON", { exact: true }).inputValue(),
  );
  rubricDefinition.name = "Updated rubric, separate revision";
  await owner
    .getByLabel("Rubric JSON", { exact: true })
    .fill(JSON.stringify(rubricDefinition));
  await rubricAction(owner, "Save new revision", "/specs");
  const preserved = await exporter.evaluate(
    async (id) =>
      (
        await fetch(`/api/reviewflow/rubrics/releases/${id}/export`, {
          headers: {
            "x-reviewflow-project":
              sessionStorage.getItem("reviewflow.project"),
          },
        })
      ).text(),
    rubricRelease.id,
  );
  assert.equal(preserved, rubricBytes);
  await accessible(owner);
  await owner.screenshot({
    path: resolve(captures, "reviewflow-rubric-factory.png"),
    fullPage: true,
  });
  await owner.setViewportSize({ width: 390, height: 844 });
  await accessible(owner);
  assert.equal(
    await owner.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await owner.screenshot({
    path: resolve(captures, "reviewflow-rubric-factory-mobile.png"),
    fullPage: true,
  });
  await owner.setViewportSize({ width: 1440, height: 1100 });
  await owner.goto(base + "/observability");
  await owner
    .getByRole("heading", { name: "Evidence pipeline", exact: true })
    .waitFor();
  const observed = await owner.evaluate(async () =>
    (
      await fetch("/api/reviewflow/observability", {
        headers: {
          "x-reviewflow-project": sessionStorage.getItem("reviewflow.project"),
        },
      })
    ).json(),
  );
  assert.equal(observed.rubric.total, 1);
  assert.equal(observed.rubric.releases, 1);
  assert.ok(observed.telemetry.browser.sessions > 0);
  assert.ok(
    observed.telemetry.events.some(
      (event) => event.type === "rubric.release" && event.count === 1,
    ),
  );
  await owner.goto(base + "/team");
  await owner.getByLabel("Lifetime call cap (0–100)").fill("2");
  await owner
    .getByRole("button", { name: "Save provider controls", exact: true })
    .click();
  await owner
    .getByRole("status")
    .filter({ hasText: "Provider budget saved" })
    .waitFor();
  await owner
    .getByRole("button", { name: "Prepare evaluation plan", exact: true })
    .click();
  await owner
    .getByRole("status")
    .filter({ hasText: "no requests were made" })
    .waitFor();
  await accessible(owner);
  await top(owner);
  await owner.screenshot({
    path: resolve(captures, "reviewflow-team.png"),
    fullPage: true,
  });
  await owner
    .getByLabel("Role for browser-reviewer", { exact: true })
    .selectOption("revoked");
  await owner
    .getByRole("status")
    .filter({ hasText: "Membership updated" })
    .waitFor();
  const denied = await reviewer.evaluate(
    async () =>
      (
        await fetch("/api/reviewflow/context", {
          headers: {
            "x-reviewflow-project":
              sessionStorage.getItem("reviewflow.project"),
          },
        })
      ).status,
  );
  assert.equal(denied, 403);
  await owner.setViewportSize({ width: 390, height: 844 });
  await top(owner);
  await accessible(owner);
  await owner.screenshot({
    path: resolve(captures, "reviewflow-team-mobile.png"),
    fullPage: true,
  });
  assert.equal(
    await owner.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await owner.setViewportSize({ width: 1440, height: 1100 });
  await owner.goto(base + "/");
  await owner
    .getByRole("heading", { name: "Turn evidence into trusted decisions." })
    .waitFor();
  await accessible(owner);
  await top(owner);
  await owner.screenshot({
    path: resolve(captures, "reviewflow-launch.png"),
    fullPage: true,
  });
  await owner.setViewportSize({ width: 390, height: 844 });
  await accessible(owner);
  await top(owner);
  await owner.screenshot({
    path: resolve(captures, "reviewflow-launch-mobile.png"),
    fullPage: true,
  });
  assert.equal(
    await owner.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Synthetic multiplayer browser passed: generic rubric configure/import/review/audit/release, missing-audit refusal, immutable download after rubric revision, durable browser telemetry, shared project, member roles, assignment, review, blind audit, exporter release, provider preparation, revocation, observability counts/unknowns/access/refetch failure and recovery, desktop/mobile. Live CRDT concurrent merge and reconnect, routing rules, WCAG A/AA checks passed. No real authentication or provider calls.",
  );
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
