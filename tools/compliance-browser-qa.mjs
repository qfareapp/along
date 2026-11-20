// Fictional, intercepted browser fixtures only. No request is sent to the live API.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright-core";
const origin = "http://127.0.0.1:18109";
const me = "1".repeat(24), other = "2".repeat(24), group = "3".repeat(24), message = "4".repeat(24);
const completion = { state: "ready_for_discovery", activated: true, eligible: true, checks: { quickStart: true }, missing: [], contactVerificationRequired: false, user: { name: "QA Member", emailVerified: true, hasBirthDate: true }, profile: { city: "Test city", photos: [], interests: [], onboarding: { currentStep: 6, quickStartCompleted: true } } };
const browser = await chromium.launch({ channel: "msedge", headless: true });
fs.mkdirSync("docs/compliance-screenshots", { recursive: true });
try {
  for (const width of [390, 820]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addInitScript(() => localStorage.setItem("along-preview-v1", JSON.stringify({ state: { welcomed: true, name: "QA Member", blocked: [] }, version: 0 })));
    const page = await context.newPage(), errors = [], writes = [];
    page.on("pageerror", e => errors.push(e.message));
    page.setDefaultTimeout(30000);
    let blocked = true;
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/v1/")) {
        const path = url.pathname.slice(7), method = route.request().method();
        const data = value => route.fulfill({ json: { data: value } });
        if (method === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": origin, "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
        if (path === "/users/me") return data({ user: { _id: me, name: "QA Member", identityVerified: false, status: "active" }, profile: completion.profile, completion });
        if (path === "/onboarding" || path === "/profile/completion") return data(completion);
        if (path === "/blocks" && method === "GET") return data(blocked ? [{ id: other, name: "QA Other" }] : []);
        if (path.startsWith("/blocks") && method !== "GET") { writes.push({ path, method, body: route.request().postDataJSON() }); blocked = method !== "DELETE"; return route.fulfill({ status: 204 }); }
        if (path === "/reports" && method === "POST") { writes.push({ path, method, body: route.request().postDataJSON() }); return data({ received: true, reference: "qa-report-reference" }); }
        if (path === `/plan-groups/${group}` && method === "GET") return data({ id: group, title: "QA group", memberCount: 2, messagingMode: "everyone", canSend: true, isOrganiser: false, unread: 0, lastSequence: 1, nextBefore: null, members: [{ id: me, name: "QA Member", own: true }, { id: other, name: "QA Other", own: false }], messages: [{ id: message, sender: { id: other, name: "QA Other", isOrganiser: false }, text: "A fictional group message", own: false, kind: "message", sequence: 1, createdAt: new Date().toISOString() }] });
        if (path === "/airports/me") return data({ active: false });
        if (path.startsWith("/airports/") || path === "/plan-groups" || path === "/categories") return data([]);
        if (path === "/conversations") return data({ items: [], unread: 0 });
        return data({ items: [], nextCursor: null, unread: 0 });
      }
      if (url.origin !== origin) throw new Error(`Unexpected external browser request: ${url.origin}`);
      return route.continue();
    });
    await page.goto(`${origin}/policies?section=privacy`);
    await page.getByText("Location and Airport Mode", { exact: true }).waitFor();
    await page.getByRole("link", { name: "Child Safety Standards", exact: true }).click();
    await page.getByText("Zero tolerance for child exploitation", { exact: true }).waitFor();
    await page.goto(`${origin}/safety`);
    await page.getByRole("radio", { name: "Child safety", exact: true }).click();
    await page.getByText(/Child-safety concerns are prioritised/).waitFor();
    await page.getByLabel("What happened?", { exact: true }).fill("Please review this fictional safety concern.");
    await page.getByRole("button", { name: "Submit concern", exact: true }).click();
    await page.getByText(/Reference: qa-report-reference/).waitFor();
    assert.equal(writes.at(-1).body.category, "child_safety");
    assert.equal(writes.at(-1).body.userId, undefined);
    await page.screenshot({ path: `docs/compliance-screenshots/safety-${width}.png`, fullPage: true });
    await page.goto(`${origin}/settings`);
    await page.getByText("QA Other", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Unblock", exact: true }).click();
    await page.getByText("You haven't blocked anyone.", { exact: true }).waitFor();
    assert.ok(writes.some(w => w.method === "DELETE" && w.path === `/blocks/${other}`));
    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/delete-account");
    await page.getByText(/Limited safety reports may be kept/).waitFor({ state: "attached" });
    await page.screenshot({ path: `docs/compliance-screenshots/deletion-${width}.png`, fullPage: true });
    await page.goto(`${origin}/plan-group?id=${group}`);
    await page.getByRole("button", { name: "Report message from QA Other", exact: true }).click();
    await page.getByLabel("What happened?", { exact: true }).fill("Review this fictional group message please.");
    await page.getByRole("button", { name: "Submit concern", exact: true }).click();
    await page.getByText(/Reference: qa-report-reference/).waitFor();
    assert.equal(writes.at(-1).body.groupMessageId, message);
    assert.equal(writes.at(-1).body.groupId, group);
    await page.getByRole("button", { name: "Block member", exact: true }).click();
    await page.getByRole("button", { name: "Confirm block", exact: true }).click();
    await page.waitForURL(url => url.pathname !== "/safety");
    assert.ok(writes.some(w => w.path === "/blocks" && w.method === "POST" && w.body.userId === other));
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: policies, child-safety feedback, blocked list/unblock, deletion disclosure, group reporting and real block request`);
    await context.close();
  }
} finally { await browser.close(); }
