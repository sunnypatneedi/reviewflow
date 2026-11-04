import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
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
    "Synthetic multiplayer browser passed: shared project, member roles, assignment, review, blind audit, exporter release, provider preparation, revocation, desktop/mobile. Live CRDT concurrent merge and reconnect, routing rules, WCAG A/AA checks passed. No real authentication or provider calls.",
  );
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
