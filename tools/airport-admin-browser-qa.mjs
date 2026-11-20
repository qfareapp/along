// Local UI fixture only. Every admin API call is intercepted; production data is untouched.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright-core";
const origin = process.env.ALONG_ADMIN_QA_URL ?? "http://localhost:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
fs.mkdirSync("docs/airport-admin-screenshots", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 950 } });
    const page = await context.newPage(), writes = [], errors = [];
    page.setDefaultTimeout(45000);
    page.on("pageerror", e => errors.push(e.message));
    let failNext = false;
    const airports = [
      { _id: "a".repeat(24), name: "QA Airport One", city: "Test city", iataCode: "QA1", enabled: false, radiusM: 1000, zones: [] },
      { _id: "b".repeat(24), name: "QA Airport Two", city: "Another city", iataCode: "QA2", enabled: true, radiusM: 1500, zones: [{ id: "known", name: "Existing zone", compatibleWith: [] }] },
    ];
    await page.route("**/api/admin/**", async route => {
      const path = new URL(route.request().url()).pathname.slice("/api/admin".length);
      if (path === "/auth/me") return route.fulfill({ json: { data: { id: "qa-admin", name: "QA Operator", email: "qa@example.test", role: "operator", permissions: ["settings.manage"], csrf: "qa-csrf" } } });
      if (path === "/airports" && route.request().method() === "GET") return route.fulfill({ json: { data: airports } });
      const match = path.match(/^\/airports\/([a-f0-9]{24})\/controls$/);
      assert.ok(match, `Unexpected fixture request: ${path}`);
      assert.equal(route.request().headers()["x-csrf-token"], "qa-csrf");
      const body = route.request().postDataJSON();
      writes.push({ id: match[1], body });
      if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { error: { message: "Temporary fixture failure. Please retry." } } }); }
      const airport = airports.find(a => a._id === match[1]);
      Object.assign(airport, body);
      if (body.enabled && !airport.zones.length) airport.zones = [{ id: "near-airport", name: "Near airport (approximate)", compatibleWith: [] }];
      return route.fulfill({ json: { data: airport } });
    });
    await page.goto(`${origin}/airports`, { timeout: 120000 });
    const first = page.getByRole("region", { name: "QA Airport One", exact: true });
    const second = page.getByRole("region", { name: "QA Airport Two", exact: true });
    await first.getByRole("button", { name: "Enable QA Airport One", exact: true }).click();
    await first.getByRole("button", { name: "Disable QA Airport One", exact: true }).waitFor();
    assert.deepEqual(writes.at(-1).body, { enabled: true });
    assert.ok(await second.getByRole("button", { name: "Disable QA Airport Two", exact: true }).isVisible());
    const slider = first.getByRole("slider", { name: "Radius for QA Airport One" });
    const before = writes.length;
    await slider.fill("2500");
    assert.equal(writes.length, before, "Dragging the radius must not send repeated requests");
    assert.equal(await slider.getAttribute("aria-valuetext"), "2.5 km");
    failNext = true;
    await first.getByRole("button", { name: "Save radius", exact: true }).click();
    await first.getByRole("alert").filter({ hasText: "Temporary fixture failure" }).waitFor();
    assert.equal(await slider.inputValue(), "2500");
    await first.getByRole("button", { name: "Save radius", exact: true }).click();
    await first.getByRole("status").filter({ hasText: "Radius saved: 2.5 km." }).waitFor();
    assert.deepEqual(writes.at(-1).body, { radiusM: 2500 });
    assert.equal(await second.getByRole("slider").inputValue(), "1500");
    await first.getByRole("button", { name: "Disable QA Airport One", exact: true }).click();
    await first.getByRole("button", { name: "Enable QA Airport One", exact: true }).waitFor();
    assert.equal(await slider.inputValue(), "2500");
    await page.getByRole("textbox", { name: "Search airports" }).fill("QA2");
    await first.waitFor({ state: "detached" });
    assert.ok(await second.isVisible());
    await page.getByRole("textbox", { name: "Search airports" }).fill("");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "The controls should fit the viewport");
    await page.screenshot({ path: `docs/airport-admin-screenshots/controls-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: per-airport enable/disable, slider/save, retry, independent rows and search`);
    await context.close();
  }
} finally { await browser.close(); }
