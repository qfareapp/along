// Fictional intercepted fixtures only; never sends traffic to the production API.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright-core";
const origin = process.env.COMMUNITIES_QA_ORIGIN ?? "http://127.0.0.1:18119";
const me = "1".repeat(24),
  other = "2".repeat(24),
  communityId = "3".repeat(24);
const completion = {
  state: "ready_for_discovery",
  activated: true,
  eligible: true,
  checks: { quickStart: true },
  missing: [],
  contactVerificationRequired: false,
  user: { name: "QA Member", emailVerified: true, hasBirthDate: true },
  profile: {
    city: "Test city",
    photos: [],
    interests: [],
    onboarding: { currentStep: 6, quickStartCompleted: true },
  },
};
const communities = ["Travel", "Jam", "Music", "Food", "Play", "Fit"].map(
  (name, i) => ({
    id: i === 0 ? communityId : String(i + 4).repeat(24),
    name: `#${name}Along`,
    slug: `${name.toLowerCase()}-along`,
    category: "travel",
    description: `Find people who enjoy ${name.toLowerCase()} and make a plan together.`,
    icon: "people-outline",
    memberCount: 2,
    upcomingEvents: 0,
    joined: false,
    muted: false,
    rules: "Be respectful. Meet in public and protect private information.",
    visibilityKey: "fixture",
    lastSequence: 0,
  }),
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
let currentPage, currentErrors;
fs.mkdirSync(".tmp/community-screenshots", { recursive: true });
try {
  for (const width of [390, 820]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
    });
    await context.addInitScript(() =>
      localStorage.setItem(
        "along-preview-v1",
        JSON.stringify({
          state: { welcomed: true, name: "QA Member", blocked: [] },
          version: 0,
        }),
      ),
    );
    const page = await context.newPage();
    const errors = [],
      writes = [],
      messages = [];
    currentPage = page;
    currentErrors = errors;
    let joined = false;
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(15000);
    await page.routeWebSocket("**/*", (socket) => socket.close());
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      if (url.pathname.startsWith("/api/v1/")) {
        const path = url.pathname.slice(7);
        const data = (value) => route.fulfill({ json: { data: value } });
        if (method === "OPTIONS")
          return route.fulfill({
            status: 204,
            headers: {
              "access-control-allow-origin": origin,
              "access-control-allow-headers": "*",
              "access-control-allow-methods": "*",
            },
          });
        if (path === "/users/me")
          return data({
            user: {
              _id: me,
              name: "QA Member",
              identityVerified: false,
              status: "active",
            },
            profile: completion.profile,
            completion,
          });
        if (path === "/onboarding" || path === "/profile/completion")
          return data(completion);
        if (path === "/communities")
          return data({
            items: communities.map((c, i) => ({
              ...c,
              joined: i === 0 && joined,
            })),
            next: null,
          });
        if (path === `/communities/${communityId}`)
          return data({
            ...communities[0],
            joined,
            lastSequence: messages.length,
          });
        if (path === `/communities/${communityId}/join`) {
          joined = true;
          writes.push(path);
          return data({ ...communities[0], joined: true });
        }
        if (path === `/communities/${communityId}/messages` && method === "GET")
          return data({ items: messages, nextBefore: null });
        if (
          path === `/communities/${communityId}/messages` &&
          method === "POST"
        ) {
          const body = route.request().postDataJSON();
          writes.push(body);
          messages.push({
            id: `${messages.length + 6}`.repeat(24),
            text: body.text,
            sequence: messages.length + 1,
            own: true,
            deleted: false,
            pinned: false,
            sender: { id: me, name: "QA Member" },
            reactions: [],
            reply: body.replyTo
              ? { name: "QA Member", text: messages[0].text }
              : null,
            createdAt: new Date().toISOString(),
          });
          return data({ id: messages.at(-1).id });
        }
        if (path === `/communities/${communityId}/members`)
          return data({
            items: [
              { id: me, name: "QA Member", role: "member" },
              { id: other, name: "QA Neighbour", role: "member" },
            ],
            next: null,
          });
        if (path === `/communities/${communityId}/plans`)
          return data({ items: [], next: null });
        if (path.startsWith("/communities/")) return data({ ok: true });
        if (path === "/airports/me") return data({ active: false });
        if (path.startsWith("/airports/")) return data([]);
        if (path === "/social/feed")
          return data({ items: [], next: null, connectionCount: 0 });
        if (
          path.startsWith("/social/") ||
          path.endsWith("/categories") ||
          path === "/plan-groups"
        )
          return data([]);
        if (path === "/conversations") return data([]);
        return data([]);
      }
      if (url.origin !== origin) return route.abort();
      return route.continue();
    });
    await page.goto(`${origin}/social`);
    await page
      .getByRole("button", { name: "Open Along Communities", exact: true })
      .click();
    await page.getByText("Find your people", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: /^Open #.*Along/ }).count(),
      6,
    );
    await page
      .getByRole("button", { name: "Open #TravelAlong", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Join community", exact: true })
      .click();
    await page.getByLabel("Message", { exact: true }).fill("Hello community");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page.getByText("Hello community", { exact: true }).waitFor();
    await page
      .getByRole("button", {
        name: "Message from QA Member. Hello community. Tap for actions.",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Reply", exact: true }).click();
    await page.getByLabel("Message", { exact: true }).fill("A reply from QA");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page.getByText("A reply from QA", { exact: true }).waitFor();
    assert.ok(writes.some((w) => typeof w === "object" && w.replyTo));
    await page.screenshot({
      path: `.tmp/community-screenshots/chat-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("tab", { name: "Plans", exact: true }).click();
    await page.getByText("Make a plan together", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "More filters", exact: true })
      .click();
    await page.getByLabel("Event date", { exact: true }).waitFor();
    await page.screenshot({
      path: `.tmp/community-screenshots/events-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("tab", { name: "Members", exact: true }).click();
    await page.getByText("QA Neighbour", { exact: true }).waitFor();
    await page.goto(`${origin}/social`);
    await page.getByRole("button", { name: "Add status", exact: true }).click();
    await page.getByText("Share an update", { exact: true }).waitFor();
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(
      `PASS ${width}px: floating picker, six groups, join, chat, reply, events, filters, members and Add Status.`,
    );
    await context.close();
  }
} catch (error) {
  console.error("Browser errors:", currentErrors);
  if (currentPage) {
    await currentPage.screenshot({
      path: ".tmp/community-screenshots/failure.png",
      fullPage: true,
    });
    console.error(
      (await currentPage.locator("body").innerText()).slice(0, 2000),
    );
  }
  throw error;
} finally {
  await browser.close();
}
