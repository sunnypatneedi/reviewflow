import assert from "node:assert/strict";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

/** Actual no-key launcher application, never the synthetic authentication fixture. */
export async function verifyAnonymousLocalBrowser(
  base = "http://127.0.0.1:5280",
) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.REVIEWFLOW_CHROMIUM_PATH
      ? { executablePath: process.env.REVIEWFLOW_CHROMIUM_PATH }
      : {}),
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  const telemetryResponses = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/reviewflow/telemetry"))
      telemetryResponses.push({
        url: response.url(),
        status: response.status(),
      });
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    route
      .request()
      .url()
      .startsWith(base + "/")
      ? route.continue()
      : route.abort(),
  );
  try {
    await page.goto(base + "/tasks");
    await page.getByRole("heading", { name: "Tasks", exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem("reviewflow.project")),
      null,
    );
    const target = await page.evaluate(async () => {
      const tasks = await (await fetch("/api/reviewflow/tasks")).json();
      const task = tasks.find((item) => item.status === "pending");
      if (!task) throw new Error("No fresh local task");
      const response = await fetch("/api/reviewflow/evaluate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-reviewflow-csrf": "1",
        },
        body: JSON.stringify({
          taskIds: [task.id],
          mode: "demo",
          ownerConsent: false,
          experimentRunId: "local-browser",
        }),
      });
      if (response.status !== 202)
        throw new Error(`Local evaluation failed: ${response.status}`);
      return task.id;
    });
    // waitForFunction treats an async predicate's Promise as truthy before
    // its value resolves. Explicitly await each API read until work is ready.
    const evaluationDeadline = Date.now() + 20000;
    while (
      !(await page.evaluate(async (id) => {
        const tasks = await (await fetch("/api/reviewflow/tasks")).json();
        return tasks.some(
          (task) =>
            task.id === id && task.status === "proposed" && task.proposal,
        );
      }, target))
    ) {
      if (Date.now() > evaluationDeadline)
        throw new Error(
          "Anonymous evaluation did not produce a reviewable proposal",
        );
      await page.waitForTimeout(100);
    }
    const pattern = "**/api/reviewflow/telemetry";
    await page.route(pattern, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic delivery interruption" }),
      }),
    );
    await page.goto(base + "/review");
    const pending = () =>
      page.evaluate(async () => {
        // Observing persistence must not create an empty v1 database before
        // the application's onupgradeneeded handler creates its event store.
        const name = "reviewflow-local-telemetry-v1";
        if (!(await indexedDB.databases()).some((db) => db.name === name))
          return 0;
        return new Promise((resolve, reject) => {
          const open = indexedDB.open(name, 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const database = open.result;
            if (!database.objectStoreNames.contains("events")) {
              database.close();
              resolve(0);
              return;
            }
            const request = database
              .transaction("events")
              .objectStore("events")
              .count();
            request.onsuccess = () => {
              const count = request.result;
              database.close();
              resolve(count);
            };
            request.onerror = () => {
              database.close();
              reject(request.error);
            };
          };
        });
      });
    let end = Date.now() + 10000;
    while ((await pending()) === 0) {
      if (Date.now() > end)
        throw new Error(
          `Anonymous local events did not reach IndexedDB: ${JSON.stringify({ telemetryResponses, errors, page: await page.locator("body").innerText(), databases: await page.evaluate(() => indexedDB.databases()) })}`,
        );
      await page.waitForTimeout(100);
    }
    await page.reload();
    assert.ok(
      (await pending()) > 0,
      "Delivery interruption survives page reload",
    );
    await page.unroute(pattern);
    await page.reload();
    end = Date.now() + 10000;
    while ((await pending()) > 0) {
      if (Date.now() > end)
        throw new Error(
          "Persisted browser events were not acknowledged after recovery",
        );
      await page.waitForTimeout(100);
    }
    const contextResult = await page.evaluate(async () =>
      (await fetch("/api/reviewflow/telemetry/context")).json(),
    );
    assert.match(contextResult.projectId, /^demo:/);
    assert.match(contextResult.scope, /^[0-9a-f]{64}$/);
    await page.goto(base + "/observability");
    await page
      .getByRole("heading", { name: "Evidence pipeline", exact: true })
      .waitFor();
    const snapshot = await page.evaluate(async () =>
      (await fetch("/api/reviewflow/observability")).json(),
    );
    assert.ok(snapshot.telemetry.browser.sessions >= 2);
    assert.ok(
      snapshot.telemetry.events.some(
        (event) =>
          event.type === "evaluation.attempt.started" && event.count >= 1,
      ),
    );
    const violations = (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations;
    assert.deepEqual(
      violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
      [],
    );
    assert.deepEqual(errors, []);
    console.log(
      "Actual anonymous local browser passed: no hosted key/project selector, versioned simulated evaluation, persisted IndexedDB events across interruption/reload, scoped replay recovery and dashboard/accessibility. All actions used synthetic launcher data.",
    );
  } finally {
    await context.close();
    await browser.close();
  }
}
