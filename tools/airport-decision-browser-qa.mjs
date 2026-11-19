// Fictional airport decision notices on loopback only; never sends real pushes.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright-core";
const origin = "http://localhost:18100",
  apiOrigin = "http://127.0.0.1:4118";
const browser = await chromium.launch({ channel: "msedge", headless: true });
fs.mkdirSync("docs/airport-screenshots", { recursive: true });
const errors = [];
try {
  for (const scenario of [
    { width: 390, kind: "connected", incoming: true },
    { width: 820, kind: "ended", incoming: true },
    { width: 390, kind: "ended", incoming: false },
  ]) {
    const context = await browser.newContext({
      viewport: { width: scenario.width, height: 950 },
      reducedMotion: scenario.width === 820 ? "reduce" : "no-preference",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    page.on("pageerror", (error) => errors.push(error.message));
    const connectionId = "a".repeat(24);
    let choice = null,
      acknowledgements = 0;
    function finalNotice(own) {
      return {
        id: "e".repeat(24),
        connectionId,
        kind: scenario.kind,
        name: "QA Alex",
        own,
        title:
          scenario.kind === "connected"
            ? "Both chose to stay connected!"
            : "Your airport connection has ended",
        body:
          scenario.kind === "connected"
            ? "You and QA Alex both chose to stay connected. Your conversation can continue in Along."
            : own
              ? "You chose to leave this connection at the airport. Wishing you a good journey ahead."
              : "QA Alex chose not to continue this connection. A moment shared, a new journey ahead.",
        conversationId: scenario.kind === "connected" ? "c".repeat(24) : null,
        presentedAt: null,
        readAt: null,
        createdAt: new Date().toISOString(),
      };
    }
    let notice = scenario.incoming
      ? {
          ...finalNotice(false),
          id: "b".repeat(24),
          kind: "keep",
          title: "QA Alex wants to stay connected",
          body: "QA Alex chose Stay connected. Would you like to keep talking?",
          conversationId: null,
        }
      : finalNotice(false);
    await page.route("**/api/v1/**", async (route) => {
      const url = new URL(route.request().url());
      assert.equal(url.origin, apiOrigin);
      const path = url.pathname.replace("/api/v1", "");
      const data = (value) => route.fulfill({ json: { data: value } });
      if (path === "/airports/me")
        return data({ active: false, session: null, airport: null });
      if (path === "/airports/nearby") return data([]);
      if (path === "/airports/connections")
        return data(
          scenario.incoming && !choice
            ? [
                {
                  id: connectionId,
                  name: "QA Alex",
                  state: "connected",
                  incoming: true,
                  needsDecision: true,
                  kept: false,
                  otherKept: true,
                  conversationId: "c".repeat(24),
                  intent: "conversation",
                },
              ]
            : [],
        );
      if (path === "/airports/notices") return data([notice]);
      if (path === `/airports/connections/${connectionId}/decision`) {
        choice = route.request().postDataJSON().action;
        assert.equal(choice, scenario.kind === "connected" ? "keep" : "end");
        notice = finalNotice(true);
        return data({ conversationId: notice.conversationId });
      }
      if (
        path.endsWith("/presented") &&
        path.startsWith("/airports/notices/")
      ) {
        assert.equal(path, `/airports/notices/${notice.id}/presented`);
        acknowledgements++;
        notice = {
          ...notice,
          presentedAt: new Date().toISOString(),
          readAt: new Date().toISOString(),
        };
        return route.fulfill({ status: 204 });
      }
      if (path.startsWith("/airports/"))
        throw new Error(`Unexpected airport route ${path}`);
      const response = await route.fetch();
      return route.fulfill({
        response,
        headers: {
          ...response.headers(),
          "access-control-allow-origin": origin,
          "access-control-allow-credentials": "true",
        },
      });
    });
    await page.goto(`${origin}/auth`, { timeout: 120000 });
    await page
      .getByRole("textbox", { name: "Email address", exact: true })
      .fill("play-bob@example.test");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page
      .getByLabel("Password", { exact: true })
      .fill("Along-play-local-2026");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    if (scenario.incoming) {
      await page
        .getByText("QA Alex wants to stay connected", { exact: true })
        .waitFor();
      await page.screenshot({
        path: `docs/airport-screenshots/decision-request-${scenario.width}.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", {
          name:
            scenario.kind === "connected" ? "Stay connected" : "End connection",
          exact: true,
        })
        .click();
    }
    const result = page.getByTestId(`airport-outcome-${scenario.kind}`);
    await result.waitFor();
    await page.waitForTimeout(1800);
    assert.equal(
      await result
        .getByText(
          scenario.kind === "connected"
            ? "Both chose to stay connected!"
            : "Your airport connection has ended",
          { exact: true },
        )
        .count(),
      1,
    );
    if (!scenario.incoming)
      assert.ok(
        await result.getByText(/QA Alex chose not to continue/).count(),
      );
    await page.screenshot({
      path: `docs/airport-screenshots/decision-${scenario.kind}-${scenario.incoming ? "own" : "received"}-${scenario.width}.png`,
      fullPage: true,
    });
    const bounds = await result.boundingBox();
    assert.ok(
      bounds && bounds.x >= 0 && bounds.x + bounds.width <= scenario.width,
    );
    await result
      .getByRole("button", {
        name: scenario.kind === "connected" ? "Lovely" : "Continue exploring",
        exact: true,
      })
      .click();
    await result.waitFor({ state: "hidden" });
    assert.equal(acknowledgements, 1);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Decision UI passed: incoming stay-connected notice, mutual celebration, own/received gentle ending, offline notice and persistent acknowledgement; phone/tablet and reduced motion.",
  );
} finally {
  await browser.close();
}
