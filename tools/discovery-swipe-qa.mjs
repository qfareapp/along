// Uses the existing loopback Expo preview. Discovery and photo requests are mocked;
// no production accounts, real swipe choices, exports, or native builds are used.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const origin = "http://localhost:18098";
const apiOrigin = "http://127.0.0.1:4118";
const shots = path.resolve("docs/discovery-screenshots");
fs.mkdirSync(shots, { recursive: true });
const photo = fs.readFileSync("apps/mobile/assets/brand/ananya-photo.png");
const profiles = Array.from({ length: 8 }, (_, index) => ({
  id: (index + 1).toString(16).padStart(24, "0"),
  name: `Swipe QA ${index + 1}`,
  age: 28,
  identityVerified: true,
  occupation: "Designer",
  city: "Kolkata",
  bio: "Good coffee, long walks and a fresh start.",
  vibes: ["coffee"],
  mutualMatch: true,
  photoIds: [`swipe-photo-${index + 1}`],
}));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];

async function setup(reducedMotion = "no-preference") {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion,
  });
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  const saved = new Set();
  const requests = [];
  const photos = new Map();
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(
      url.origin,
      apiOrigin,
      "This test must use the loopback API preview.",
    );
    if (url.pathname === "/api/v1/discovery")
      return route.fulfill({
        json: { data: profiles.filter((profile) => !saved.has(profile.id)) },
      });
    if (/\/discovery\/[^/]+\/action$/.test(url.pathname)) {
      const id = url.pathname.split("/").at(-2);
      const action = request.postDataJSON().action;
      const entry = { id, action, completed: false };
      requests.push(entry);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      entry.completed = true;
      if (id === profiles[4].id)
        return route.fulfill({
          status: 503,
          json: { error: { message: "Simulated connection failure." } },
        });
      saved.add(id);
      return route.fulfill({ json: { data: { action, mutual: false } } });
    }
    if (url.pathname.startsWith("/api/v1/discovery/"))
      return route.fulfill({
        json: {
          data:
            profiles.find((profile) =>
              url.pathname.endsWith(`/${profile.id}`),
            ) ?? [],
        },
      });
    if (url.pathname.startsWith("/api/v1/profile/photos/swipe-photo-")) {
      photos.set(url.pathname, (photos.get(url.pathname) ?? 0) + 1);
      await new Promise((resolve) => setTimeout(resolve, 120));
      return route.fulfill({ contentType: "image/png", body: photo });
    }
    return route.continue();
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
  await page.getByRole("tab", { name: /Discover/ }).click();
  await page
    .getByRole("button", { name: "Like Swipe QA 1", exact: true })
    .waitFor();
  await page.waitForFunction(() => {
    const wrappers = [
      ...document.querySelectorAll(
        '[data-testid="discovery-deck"] [data-testid="member-photo"]',
      ),
    ];
    return (
      wrappers.length === 3 &&
      wrappers.every((wrapper) => {
        const image =
          wrapper instanceof HTMLImageElement
            ? wrapper
            : wrapper.querySelector("img");
        return image?.complete && image.naturalWidth > 0;
      })
    );
  });
  return { page, requests, photos };
}

async function gesture(page, dx, feedback) {
  const card = page.getByTestId("discovery-profile-card");
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  assert(box);
  const start = box.x + box.width / 2;
  await page.mouse.move(start, box.y + 170);
  await page.mouse.down();
  await page.mouse.move(start + dx, box.y + 170, { steps: 12 });
  if (feedback) {
    const opacity = await page
      .getByTestId(feedback)
      .evaluate((element) => Number(getComputedStyle(element).opacity));
    assert(opacity > 0.5, "Directional feedback should follow the finger.");
    await page.screenshot({ path: path.join(shots, `${feedback}.png`) });
  }
  await page.mouse.up();
  assert(
    !new URL(page.url()).pathname.includes("person"),
    "A drag must not open the tapped profile.",
  );
}

try {
  const { page, requests, photos } = await setup();
  const nextPhoto = await page
    .getByTestId("discovery-preview-card")
    .first()
    .locator("img")
    .getAttribute("src");
  const started = Date.now();
  await page
    .getByRole("button", { name: "Like Swipe QA 1", exact: true })
    .dblclick({ delay: 35 });
  await page
    .getByRole("button", { name: "Pass on Swipe QA 2", exact: true })
    .waitFor({ timeout: 1200 });
  assert(
    Date.now() - started < 1500,
    "Next profile must appear before the slow save completes.",
  );
  assert.equal(
    requests.filter((request) => request.id === profiles[0].id).length,
    1,
  );
  assert.equal(requests[0].completed, false);
  assert.equal(
    await page
      .getByTestId("discovery-profile-card")
      .locator("img")
      .getAttribute("src"),
    nextPhoto,
    "Promotion must preserve the already decoded image.",
  );
  assert.equal(photos.get("/api/v1/profile/photos/swipe-photo-2"), 1);
  await page
    .getByRole("button", { name: "Pass on Swipe QA 2", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Like Swipe QA 3", exact: true })
    .waitFor({ timeout: 1200 });
  await gesture(page, 135, "discovery-like-feedback");
  await page
    .getByRole("button", { name: "Like Swipe QA 4", exact: true })
    .waitFor();
  // A short, slow drag must spring back without recording an action.
  const before = requests.length;
  await gesture(page, -18);
  await page.waitForTimeout(450);
  assert.equal(requests.length, before);
  await gesture(page, -135, "discovery-pass-feedback");
  await page
    .getByRole("button", { name: "Like Swipe QA 5", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Like Swipe QA 5", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Like Swipe QA 6", exact: true })
    .waitFor({ timeout: 1200 });
  await page
    .getByRole("alert")
    .filter({ hasText: "Swipe QA 5's choice wasn't saved" })
    .waitFor();
  assert(
    await page
      .getByRole("button", { name: "Like Swipe QA 6", exact: true })
      .isVisible(),
    "Failed saves must not interrupt the current card.",
  );
  assert.deepEqual(
    requests.map(({ id, action }) => [id, action]),
    profiles
      .slice(0, 5)
      .map((profile, index) => [
        profile.id,
        ["like", "pass", "like", "pass", "like"][index],
      ]),
  );
  await page.screenshot({ path: path.join(shots, "failure-restored.png") });
  // Finish the remaining cards and verify the failed choice is available again.
  for (const number of [6, 7, 8]) {
    await page
      .getByRole("button", { name: `Pass on Swipe QA ${number}`, exact: true })
      .click();
    await page
      .getByRole("button", {
        name: `Like Swipe QA ${number === 8 ? 5 : number + 1}`,
        exact: true,
      })
      .waitFor();
  }
  await page.waitForTimeout(1600);
  await page
    .getByRole("button", { name: "View Swipe QA 5's profile", exact: true })
    .click();
  await page.waitForURL(
    (url) =>
      url.pathname === "/person" &&
      url.searchParams.get("id") === profiles[4].id,
  );
  await page
    .getByText("Swipe QA 5, 28", { exact: true })
    .filter({ visible: true })
    .waitFor();
  await page.close();

  const reduced = await setup("reduce");
  assert.equal(
    await reduced.page.getByTestId("discovery-like-feedback").count(),
    0,
  );
  await reduced.page
    .getByRole("button", { name: "Like Swipe QA 1", exact: true })
    .click();
  await reduced.page
    .getByRole("button", { name: "Like Swipe QA 2", exact: true })
    .waitFor({ timeout: 1000 });
  await reduced.page.waitForTimeout(1600);
  await reduced.page.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: preloaded/decoded next photos, rapid likes/passes before slow saves, duplicate-tap protection, both drag animations, cancelled drag, per-choice failure restoration, profile tap navigation, and reduced motion.",
  );
} catch (error) {
  for (const [index, context] of browser.contexts().entries()) {
    const page = context.pages()[0];
    if (page)
      await page
        .screenshot({ path: path.join(shots, `failed-${index}.png`) })
        .catch(() => {});
  }
  if (errors.length) console.error(errors);
  throw error;
} finally {
  await browser.close();
}
