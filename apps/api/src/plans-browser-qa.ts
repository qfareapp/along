import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import sharp from "sharp";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { chromium, type Browser, type Page } from "playwright-core";
import { fieldsForCategory } from "../../../packages/plan-details/index.js";
process.env.ADMIN_AUTH_MODE = "mfa";
process.env.PHOTO_STORAGE = "mongodb";
process.env.EMAIL_VERIFICATION_REQUIRED = "false";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.CORS_ORIGINS = "http://localhost:18083";
const { createApp } = await import("./app.js");
const {
  Activity,
  ActivityInterest,
  ActivitySave,
  Category,
  Conversation,
  Match,
  Profile,
  ProfilePhoto,
  ProfileSwipe,
  User,
} = await import("./models.js");
const { seedCategories } = await import("./categories.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const tablet = process.argv.includes("--tablet");
const postingOnly = process.argv.includes("--posting-only");
const root = path.resolve("../.."),
  webRoot = path.join(root, "apps/mobile/dist-plans-qa"),
  shots = path.join(
    root,
    tablet ? "docs/tablet-screenshots" : "docs/plans-screenshots",
  );
fs.mkdirSync(shots, { recursive: true });
const db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
await mongoose.connect(db.getUri());
await seedCategories();
await Promise.all([
  ActivityInterest.init(),
  ActivitySave.init(),
  Conversation.init(),
  Match.init(),
]);
const password = "Along-plan-qa-only-2026";
const members = [];
for (const [i, name] of ["QA Asha", "QA Rohan"].entries()) {
  const member = await User.create({
    name,
    email: `plans-${i}@example.test`,
    passwordHash: await bcrypt.hash(password, 10),
    birthDate: "1997-01-01",
    emailVerified: true,
  });
  members.push(member);
  await eligibleProfile(member._id);
  await Profile.updateOne(
    { user: member._id },
    {
      approximateLocation: { type: "Point", coordinates: [88.36, 22.57] },
    },
  );
  const photo = await sharp(
    path.join(
      root,
      `apps/mobile/assets/brand/${i ? "rohan" : "ananya-photo"}.png`,
    ),
  )
    .resize(400, 500)
    .jpeg()
    .toBuffer();
  await ProfilePhoto.updateMany({ owner: member._id }, { bytes: photo });
}
await Category.updateOne(
  { slug: "food" },
  { name: "Coffee & Café", coverAssetKey: "coffee" },
);
await ProfileSwipe.create({
  user: members[1]._id,
  target: members[0]._id,
  action: "like",
});
const activity = await Activity.create({
  creator: members[1]._id,
  category: "food",
  type: "together",
  title: "Coffee after work?",
  description:
    "A relaxed coffee and a little good conversation. Let's meet somewhere public and decide on a café together.",
  zone: "Park Street, Kolkata",
  startsAt: new Date(Date.now() + 86400000),
});
const earlier = await Activity.create({
  creator: members[0]._id,
  category: "learning",
  type: "together",
  title: "Earlier study plan",
  description: "A study session that can be rescheduled by its organizer.",
  zone: "Kolkata",
  startsAt: new Date(Date.now() - 86400000),
  endsAt: new Date(Date.now() - 82800000),
});
const qaApp = createApp();
// Reset only this isolated loopback client's global request counter between posting cases.
const resetQaRateLimit = qaApp.router.stack
  .map(
    ({ handle }) =>
      handle as typeof handle & {
        resetKey?: (key: string) => Promise<void> | void;
      },
  )
  .find((handle) => handle.resetKey)?.resetKey;
assert.ok(resetQaRateLimit);
const apiServer = qaApp.listen(4103, "127.0.0.1");
const mime: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".css": "text/css",
  ".json": "application/json",
};
const server = http
  .createServer((req, res) => {
    let file = path.resolve(
      webRoot,
      "." + decodeURIComponent((req.url ?? "/").split("?")[0]),
    );
    if (!file.startsWith(webRoot + path.sep) && file !== webRoot) {
      res.writeHead(403).end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory())
      file = path.join(webRoot, "index.html");
    res.setHeader(
      "Content-Type",
      mime[path.extname(file)] ?? "application/octet-stream",
    );
    fs.createReadStream(file).pipe(res);
  })
  .listen(18083, "127.0.0.1");
let browser: Browser | undefined;
const errors: string[] = [];
async function login(page: Page, who: number, foodCount = 1) {
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:18083/auth");
  await page
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill(`plans-${who}@example.test`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  if (
    who === 0 &&
    (await Activity.exists({
      _id: earlier._id,
      startsAt: { $lt: new Date() },
      ownerState: { $nin: ["closed", "expired", "successful"] },
    }))
  ) {
    await page
      .getByRole("button", { name: "Not now · Mark as expired", exact: true })
      .click();
  }
  await page.getByRole("tab", { name: /Plans/ }).click();
  await page
    .getByRole("button", {
      name: `Explore Coffee & Café, ${foodCount} live plans`,
      exact: true,
    })
    .waitFor();
}
async function tabletLayouts(page: Page) {
  for (const [width, height, columns] of [
    [320, 740, 1],
    [390, 844, 2],
    [500, 900, 2],
    [768, 1024, 3],
    [800, 1280, 3],
    [1024, 768, 4],
    [1280, 800, 4],
    [1440, 900, 4],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction((expected) => {
      const app = document
        .querySelector('[data-testid="app-shell"]')
        ?.getBoundingClientRect();
      return !!app && Math.abs(app.width - Math.min(expected, 1440)) < 2;
    }, width);
    const tab = page.getByRole("tab", { name: /Plans/ });
    await tab.waitFor();
    const box = await tab.boundingBox();
    assert.ok(box);
    assert.ok(
      width >= 768 ? box.x < 104 && box.y < height / 2 : box.y > height - 110,
      `navigation adapts at ${width}x${height}`,
    );
    await page.waitForFunction((expected) => {
      const cards = Array.from(
        document.querySelectorAll('[role="button"][aria-label^="Explore "]'),
      )
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0);
      return (
        cards.length > 0 &&
        cards.filter((r) => Math.abs(r.top - cards[0].top) < 2).length ===
          expected
      );
    }, columns);
    assert.ok(
      await page.evaluate(() => {
        const covers = Array.from(
          document.querySelectorAll('[aria-label$=" illustration"]'),
        );
        return (
          covers.length > 0 &&
          covers.every((cover) => {
            const image = cover.getBoundingClientRect();
            const card = cover
              .closest('[role="button"]')
              ?.getBoundingClientRect();
            return (
              !!card &&
              image.width > 80 &&
              image.height > 60 &&
              image.left >= card.left - 1 &&
              image.right <= card.right + 1 &&
              image.bottom <= card.bottom + 1
            );
          })
        );
      }),
      `category illustrations fit their cards at ${width}x${height}`,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      `no horizontal overflow at ${width}x${height}`,
    );
    await page.screenshot({
      path: path.join(shots, `layout-${width}x${height}.png`),
    });
  }
  await page
    .getByRole("textbox", { name: "Search plans", exact: true })
    .fill("coffee");
  await page.setViewportSize({ width: 768, height: 1024 });
  assert.equal(
    await page
      .getByRole("textbox", { name: "Search plans", exact: true })
      .inputValue(),
    "coffee",
  );
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.setViewportSize({ width: 1024, height: 768 });
}
try {
  browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  if (tablet) {
    const welcomeContext = await browser.newContext({
      viewport: { width: 1024, height: 600 },
      reducedMotion: "reduce",
    });
    const welcome = await welcomeContext.newPage();
    welcome.on("pageerror", (e) => errors.push(e.message));
    await welcome.goto("http://localhost:18083");
    const begin = welcome.getByRole("button", {
      name: "Create account",
      exact: true,
    });
    await begin.scrollIntoViewIfNeeded();
    const beginBox = await begin.boundingBox();
    assert.ok(
      beginBox && beginBox.y >= 0 && beginBox.y + beginBox.height <= 600,
    );
    await welcome.screenshot({
      path: path.join(shots, "tablet-welcome-landscape.png"),
    });
    await begin.click();
    await welcome.getByLabel("Email address", { exact: true }).waitFor();
    await welcome.goto("http://localhost:18083/onboarding");
    await welcome
      .getByRole("button", { name: "Coffee dates", exact: true })
      .click();
    await welcome.setViewportSize({ width: 768, height: 1024 });
    assert.equal(
      await welcome
        .getByRole("button", { name: "Coffee dates", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await welcome.screenshot({
      path: path.join(shots, "tablet-onboarding.png"),
    });
    await welcomeContext.close();
  }
  const context = await browser.newContext({
    viewport: tablet
      ? { width: 1024, height: 768 }
      : { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await login(page, 0);
  if (!postingOnly) {
    await page.getByRole("tab", { name: /Discover/ }).click();
    await page
      .getByRole("button", { name: "Likes, 1 people liked you", exact: true })
      .click();
    await page.getByText("1 person likes you.", { exact: false }).waitFor();
    const liker = page.getByRole("button", {
      name: "View QA Rohan's profile",
      exact: true,
    });
    const likerBounds = await liker.boundingBox();
    assert.ok(
      likerBounds && likerBounds.height > 100 && likerBounds.width > 100,
      "Incoming like must show a visible profile card",
    );
    await page
      .getByText("QA Rohan, 29", { exact: true })
      .filter({ visible: true })
      .waitFor();
    await page.waitForFunction(() =>
      Array.from(
        document.querySelectorAll('[data-testid="member-photo"] img'),
      ).some(
        (img) =>
          img instanceof HTMLImageElement &&
          img.complete &&
          img.naturalWidth > 0 &&
          img.getBoundingClientRect().height > 100,
      ),
    );
    await page.screenshot({ path: path.join(shots, "liked-you.png") });
    if (tablet) {
      for (const size of [
        { width: 320, height: 740 },
        { width: 768, height: 1024 },
        { width: 1024, height: 768 },
      ]) {
        await page.setViewportSize(size);
        await page.waitForFunction(() => {
          const card = document
            .querySelector('[data-testid="received-like-card"]')
            ?.getBoundingClientRect();
          return (
            !!card &&
            card.width > 150 &&
            card.height > 200 &&
            card.right <= window.innerWidth
          );
        });
        await page
          .getByText("QA Rohan, 29", { exact: true })
          .filter({ visible: true })
          .waitFor();
        await page
          .getByRole("button", { name: "Like QA Rohan back", exact: true })
          .waitFor();
      }
    }
    await liker.click();
    await page.getByRole("button", { name: "Go back", exact: true }).click();
    await page.getByRole("button", { name: "Go back", exact: true }).click();
    await page.getByRole("tab", { name: /Plans/ }).click();
    if (tablet) {
      await page.getByRole("tab", { name: /Discover/ }).click();
      await page
        .getByRole("button", { name: "View QA Rohan's profile", exact: true })
        .waitFor();
      await page.screenshot({ path: path.join(shots, "tablet-discover.png") });
      await page.getByRole("tab", { name: /Plans/ }).click();
      await tabletLayouts(page);
    }
    await page.screenshot({
      path: path.join(shots, "01-explore-categories.png"),
    });
    await page
      .getByRole("textbox", { name: "Search plans", exact: true })
      .fill("coffee");
    await page.getByText("Matching categories", { exact: true }).waitFor();
    await page
      .getByRole("button", {
        name: "View Coffee after work? by QA Rohan",
        exact: true,
      })
      .waitFor();
    await page.screenshot({ path: path.join(shots, "02-category-search.png") });
    await page
      .getByRole("button", { name: "Clear search", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Explore Coffee & Café, 1 live plans",
        exact: true,
      })
      .click();
    const plan = page.getByRole("button", {
      name: "View Coffee after work? by QA Rohan",
      exact: true,
    });
    await plan.waitFor();
    await page.waitForFunction(() =>
      Array.from(
        document.querySelectorAll(
          '[data-testid="member-photo"] img, img[data-testid="member-photo"]',
        ),
      ).some((img) => (img as HTMLImageElement).naturalWidth > 0),
    );
    await page.screenshot({ path: path.join(shots, "03-people-plans.png") });
    await page.getByRole("button", { name: "Group", exact: true }).click();
    await page
      .getByText("No plans here yet. Why not start one?", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Group", exact: true }).click();
    await plan.waitFor();
    await page.getByRole("button", { name: "Save plan", exact: true }).click();
    await page
      .getByRole("button", { name: "Unsave plan", exact: true })
      .waitFor();
    assert.equal(
      await ActivitySave.countDocuments({
        user: members[0]._id,
        activity: activity._id,
      }),
      1,
    );
    await page.getByRole("button", { name: "Go back", exact: true }).click();
    await page
      .getByRole("button", { name: "Saved Plans", exact: true })
      .click();
    await plan.waitFor();
    await plan.click();
    await page
      .getByRole("button", { name: "I'm Interested", exact: true })
      .waitFor();
    if (tablet) {
      await page
        .getByRole("button", { name: "View QA Rohan's profile", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Profile options", exact: true })
        .waitFor();
      for (const size of [
        { width: 768, height: 1024 },
        { width: 1024, height: 768 },
      ]) {
        await page.setViewportSize(size);
        const photo = await page
          .getByTestId("member-photo")
          .filter({ visible: true })
          .first()
          .boundingBox();
        assert.ok(
          photo &&
            photo.width > 460 &&
            photo.width <= 680 &&
            photo.height <= 620,
        );
      }
      await page.screenshot({
        path: path.join(shots, "tablet-member-profile.png"),
      });
      await page.getByRole("button", { name: "Go back", exact: true }).click();
    }
    await page.screenshot({
      path: path.join(shots, "04-activity-details.png"),
    });
    assert.equal(await Conversation.countDocuments(), 0);
    await page
      .getByRole("button", { name: "I'm Interested", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Request Sent", exact: true })
      .waitFor();
    assert.equal(await ActivityInterest.countDocuments(), 1);
    assert.equal(await Conversation.countDocuments(), 0);
    const ownerContext = await browser.newContext({
      viewport: tablet
        ? { width: 768, height: 1024 }
        : { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    const owner = await ownerContext.newPage();
    await login(owner, 1);
    await owner.getByRole("button", { name: /^Notifications/ }).click();
    await owner
      .getByText("QA Asha liked your activity", { exact: true })
      .waitFor();
    await owner.screenshot({
      path: path.join(shots, "05-interest-request.png"),
    });
    await owner
      .getByRole("button", { name: "Accept & Message", exact: true })
      .click();
    await owner
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Coffee tomorrow? Looking forward to it.");
    await owner
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await owner
      .getByText("Coffee tomorrow? Looking forward to it.", { exact: true })
      .waitFor();
    await owner.screenshot({
      path: path.join(shots, "06-owner-first-message.png"),
    });
    assert.equal(
      await ActivityInterest.countDocuments({ status: "accepted" }),
      1,
    );
    await page
      .getByRole("button", { name: "Accepted · Open chat", exact: true })
      .click();
    await page
      .getByText("Coffee tomorrow? Looking forward to it.", { exact: true })
      .waitFor();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Sounds good!");
    if (tablet) {
      await page.setViewportSize({ width: 768, height: 1024 });
      assert.equal(
        await page
          .getByRole("textbox", { name: "Message", exact: true })
          .inputValue(),
        "Sounds good!",
      );
      await page.setViewportSize({ width: 1024, height: 768 });
    }
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page.getByText("Sounds good!", { exact: true }).waitFor();
    await resetQaRateLimit("127.0.0.1");
    const statusPage = await ownerContext.newPage();
    statusPage.on("pageerror", (error) => errors.push(error.message));
    await login(statusPage, 1);
    await statusPage
      .getByRole("button", {
        name: "Explore Coffee & Café, 1 live plans",
        exact: true,
      })
      .click();
    await statusPage
      .getByRole("button", {
        name: "View Coffee after work? by QA Rohan",
        exact: true,
      })
      .click();
    const stateChoice = (name: string) =>
      statusPage.getByRole("radio", {
        name:
          (
            {
              "Go live": "Live",
              Pause: "Paused",
              "Plan success": "Done",
            } as Record<string, string>
          )[name] ?? name,
        exact: true,
      });
    await stateChoice("Go live").waitFor();
    assert.equal(
      await stateChoice("Go live").getAttribute("aria-checked"),
      "true",
    );
    await stateChoice("Pause").click();
    await statusPage
      .getByRole("radio", { name: "Paused", checked: true, exact: true })
      .waitFor();
    assert.equal((await Activity.findById(activity._id))!.ownerState, "paused");
    const viewerStatus = await context.newPage();
    await login(viewerStatus, 0, 0);
    await statusPage
      .getByRole("button", { name: "Go back", exact: true })
      .click();
    await statusPage
      .getByRole("button", { name: "Your plans", exact: true })
      .click();
    await statusPage.getByText("Paused", { exact: true }).waitFor();
    await statusPage
      .getByRole("button", {
        name: "View Coffee after work? by QA Rohan",
        exact: true,
      })
      .click();
    await stateChoice("Plan success").click();
    await statusPage
      .getByRole("radio", { name: "Done", checked: true, exact: true })
      .waitFor();
    await statusPage
      .getByRole("button", { name: "Go back", exact: true })
      .click();
    await statusPage.getByText("Plan successful", { exact: true }).waitFor();
    await statusPage
      .getByRole("button", {
        name: "View Coffee after work? by QA Rohan",
        exact: true,
      })
      .click();
    await statusPage
      .getByRole("radio", { name: "Done", checked: true, exact: true })
      .waitFor();
    for (const size of tablet
      ? [
          { width: 768, height: 1024 },
          { width: 1024, height: 768 },
        ]
      : [
          { width: 320, height: 740 },
          { width: 390, height: 844 },
        ]) {
      await statusPage.setViewportSize(size);
      await statusPage
        .getByRole("radio", {
          name: "Plan success",
          checked: true,
          exact: true,
        })
        .scrollIntoViewIfNeeded();
      assert.equal(
        await statusPage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
        true,
      );
      await statusPage.screenshot({
        path: path.join(shots, `plan-status-${size.width}.png`),
      });
    }
    assert.equal(
      (await Activity.findById(activity._id))!.ownerState,
      "successful",
    );
    await stateChoice("Go live").click();
    await statusPage
      .getByRole("radio", { name: "Live", checked: true, exact: true })
      .waitFor();
    await viewerStatus
      .getByRole("button", {
        name: "Explore Coffee & Café, 1 live plans",
        exact: true,
      })
      .click();
    await viewerStatus
      .getByRole("button", {
        name: "View Coffee after work? by QA Rohan",
        exact: true,
      })
      .click();
    await viewerStatus
      .getByRole("button", { name: "Accepted · Open chat", exact: true })
      .waitFor();
    assert.equal(
      await viewerStatus
        .getByRole("radio", { name: "Pause", exact: true })
        .count(),
      0,
    );
    await statusPage.close();
    await viewerStatus.close();
    await resetQaRateLimit("127.0.0.1");
    await page.getByRole("button", { name: "Go back", exact: true }).click();
    await page.getByRole("button", { name: "Go back", exact: true }).click();
    await page.getByRole("button", { name: "Go back", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Explore Learning, 0 live plans",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Your plans", exact: true }).click();
    await page
      .getByRole("button", {
        name: "View Earlier study plan by QA Asha",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Reschedule plan", exact: true })
      .last()
      .click();
    for (const [label, type] of [
      ["New date", "date"],
      ["New time", "time"],
    ]) {
      const picker = page.getByLabel(label, { exact: true });
      assert.equal(await picker.getAttribute("type"), type);
      await picker.click();
      await page
        .getByRole("dialog", { name: `${label} picker`, exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
    }
    await page
      .getByRole("button", { name: "Choose New date", exact: true })
      .click();
    let calendar = page.getByRole("dialog", {
      name: "New date picker",
      exact: true,
    });
    await calendar
      .getByRole("button", { name: "Tomorrow", exact: true })
      .click();
    const originalSize = page.viewportSize()!;
    for (const size of [
      { width: 320, height: 740 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(size);
      await calendar
        .getByRole("button", { name: "Choose year", exact: true })
        .click();
      await calendar
        .getByRole("button", {
          name: String(new Date(Date.now() + 86400000).getFullYear()),
          exact: true,
        })
        .click();
      await calendar
        .getByRole("button", {
          name: new Date(Date.now() + 86400000).toLocaleString("en", {
            month: "short",
          }),
          exact: true,
        })
        .click();
      const bounds = await calendar.boundingBox();
      assert.ok(
        bounds &&
          bounds.x >= 0 &&
          bounds.y >= 0 &&
          bounds.x + bounds.width <= size.width + 1 &&
          bounds.y + bounds.height <= size.height + 1,
      );
      assert.equal(
        await calendar.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
        true,
      );
      await page.screenshot({
        path: path.join(shots, `calendar-${size.width}x${size.height}.png`),
        animations: "disabled",
      });
    }
    await page.setViewportSize(originalSize);
    await page.screenshot({ path: path.join(shots, "themed-calendar.png") });
    await calendar.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(
      await page.getByLabel("New date", { exact: true }).inputValue(),
      "",
    );
    await page
      .getByRole("button", { name: "Choose New date", exact: true })
      .click();
    calendar = page.getByRole("dialog", {
      name: "New date picker",
      exact: true,
    });
    await calendar
      .getByRole("button", { name: "Tomorrow", exact: true })
      .click();
    await calendar
      .getByRole("button", { name: "Confirm date", exact: true })
      .click();
    assert.equal(
      await page.getByLabel("New date", { exact: true }).inputValue(),
      new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    );
    await page
      .getByRole("button", { name: "Choose New time", exact: true })
      .click();
    const clock = page.getByRole("dialog", {
      name: "New time picker",
      exact: true,
    });
    await clock.getByRole("button", { name: "AM", exact: true }).click();
    await clock.getByRole("button", { name: "Hour 9", exact: true }).click();
    await clock.getByRole("button", { name: "Minute 30", exact: true }).click();
    await clock
      .getByRole("textbox", { name: "Exact minute", exact: true })
      .fill("99");
    assert.equal(
      await clock
        .getByRole("button", { name: "Set time", exact: true })
        .isDisabled(),
      true,
    );
    await clock
      .getByRole("textbox", { name: "Exact minute", exact: true })
      .fill("37");
    await clock.getByRole("button", { name: "PM", exact: true }).click();
    await clock
      .getByRole("textbox", { name: "Exact minute", exact: true })
      .blur();
    await page.screenshot({ path: path.join(shots, "themed-clock.png") });
    await clock.getByRole("button", { name: "Set time", exact: true }).click();
    assert.equal(
      await page.getByLabel("New time", { exact: true }).inputValue(),
      "21:37",
    );
    await page
      .getByRole("button", { name: "Save new date", exact: true })
      .click();
    await page
      .getByRole("button", { name: "View interest requests", exact: true })
      .waitFor();
    assert.ok((await Activity.findById(earlier._id))!.startsAt > new Date());
    await page.getByRole("button", { name: "Go back", exact: true }).click();
    await page.getByRole("button", { name: "Go back", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Explore Learning, 1 live plans",
        exact: true,
      })
      .waitFor();
    await page
      .getByRole("button", {
        name: "Explore Social Events, 0 live plans",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Create a Plan", exact: true })
      .click();
    await page.getByText("Selected: Social Events", { exact: true }).waitFor();
    if (tablet) {
      await page
        .getByRole("textbox", { name: "What’s the plan?", exact: true })
        .fill("A tablet-friendly weekend plan");
      await page
        .getByRole("textbox", {
          name: "What are you looking for?",
          exact: true,
        })
        .fill(
          "An isolated test plan to verify rotation keeps the posting draft intact.",
        );
      await page.setViewportSize({ width: 768, height: 1024 });
      assert.equal(
        await page
          .getByRole("textbox", { name: "What’s the plan?", exact: true })
          .inputValue(),
        "A tablet-friendly weekend plan",
      );
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Event name", exact: true })
        .fill("Weekend meetup");
      await page
        .getByRole("textbox", { name: "Venue or meeting area", exact: true })
        .fill("Public park");
      await page.getByRole("button", { name: "Meetup", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Approximate area", exact: true })
        .fill("Kolkata");
      await page
        .getByRole("button", { name: "Small group", exact: true })
        .click();
      await page
        .getByRole("textbox", {
          name: "Available places (excluding you)",
          exact: true,
        })
        .fill("5");
      await page.setViewportSize({ width: 500, height: 900 });
      assert.equal(
        await page
          .getByRole("textbox", { name: "Approximate area", exact: true })
          .inputValue(),
        "Kolkata",
      );
      assert.equal(
        await page
          .getByRole("textbox", {
            name: "Available places (excluding you)",
            exact: true,
          })
          .inputValue(),
        "5",
      );
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.screenshot({ path: path.join(shots, "tablet-post-form.png") });
      await page
        .getByRole("button", { name: "Publish Plan", exact: true })
        .click();
      await page
        .getByText("Your plan is published. Find it in Explore Plans.", {
          exact: true,
        })
        .waitFor();
      await page.getByRole("button", { name: "Go back", exact: true }).click();
      await page.getByRole("tab", { name: /Profile/ }).click();
      await page
        .getByRole("button", { name: "Edit profile", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Save Changes", exact: true })
        .scrollIntoViewIfNeeded();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: path.join(shots, "tablet-profile-form.png"),
      });
    }
    assert.deepEqual(errors, []);
  }
  if (!tablet) {
    const enabledCategories = await Category.find({ active: true }).lean();
    for (const category of enabledCategories) {
      await resetQaRateLimit("127.0.0.1");
      await page.getByRole("tab", { name: /Plans/ }).click();
      await page.getByRole("button", { name: /Start a plan/ }).click();
      const title = `Category QA ${category.slug}`;
      console.log(`Checking posting form: ${category.slug}`);
      await page
        .getByRole("textbox", { name: "What’s the plan?", exact: true })
        .fill(title);
      await page
        .getByRole("textbox", {
          name: "What are you looking for?",
          exact: true,
        })
        .fill(
          "A category-specific public plan with all practical details supplied.",
        );
      await page
        .getByRole("button", {
          name: `Category: ${category.name}`,
          exact: true,
        })
        .click();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Approximate area", exact: true })
        .fill("Kolkata");
      if (category.slug === "commute") {
        await page.getByLabel("Plan minimum age", { exact: true }).fill("45");
        await page.getByLabel("Plan maximum age", { exact: true }).fill("25");
        await page
          .getByRole("button", { name: "Publish Plan", exact: true })
          .click();
        await page
          .getByText(
            "Choose an age range from 18 to 120, with minimum age no higher than maximum age.",
            { exact: true },
          )
          .waitFor();
        await page.getByLabel("Plan minimum age", { exact: true }).fill("25");
        await page.getByLabel("Plan maximum age", { exact: true }).fill("45");
        await page.getByRole("radio", { name: "Female", exact: true }).click();
        await page
          .getByRole("button", { name: "Within 10 km", exact: true })
          .click();
      }
      await page
        .getByRole("textbox", { name: "Approximate area", exact: true })
        .fill("Kolkata");
      await page
        .getByRole("button", { name: "Publish Plan", exact: true })
        .click();
      await page
        .getByText("Complete the category details below before publishing.", {
          exact: true,
        })
        .waitFor();
      const expected: Record<string, string | string[]> = {};
      for (const field of fieldsForCategory(category.slug)) {
        if (field.kind === "days") {
          expected[field.key] = ["Mon", "Wed", "Fri"];
          for (const day of expected[field.key])
            await page.getByRole("button", { name: day, exact: true }).click();
        } else if (field.kind === "choice") {
          expected[field.key] = field.options![0];
          await page
            .getByRole("button", { name: field.options![0], exact: true })
            .click();
        } else {
          const value =
            field.kind === "time"
              ? field.key === "returnTime"
                ? "18:30"
                : "08:30"
              : field.kind === "date"
                ? new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
                : field.kind === "number"
                  ? "60"
                  : `Public ${field.key}`;
          expected[field.key] = value;
          if (field.kind === "date" || field.kind === "time")
            assert.equal(
              await page
                .getByLabel(field.label, { exact: true })
                .getAttribute("type"),
              field.kind,
            );
          await page.getByLabel(field.label, { exact: true }).fill(value);
        }
      }
      await page.getByText("Back to plan details", { exact: true }).click();
      assert.equal(
        await page
          .getByRole("textbox", { name: "What’s the plan?", exact: true })
          .inputValue(),
        title,
      );
      await page.getByRole("button", { name: "Next", exact: true }).click();
      if (category.slug === "commute") {
        assert.equal(
          await page
            .getByLabel("Leaving home at", { exact: true })
            .inputValue(),
          "08:30",
        );
        await page.screenshot({
          path: path.join(shots, "commute-category-fields.png"),
          fullPage: true,
        });
      }
      await page
        .getByRole("button", { name: "Publish Plan", exact: true })
        .click();
      await page
        .getByText("Your plan is published. Find it in Explore Plans.", {
          exact: true,
        })
        .waitFor({ timeout: 15000 })
        .catch(async (error) => {
          console.log(await page.locator("body").innerText());
          throw error;
        });
      const saved = await Activity.findOne({ title }).lean();
      assert.ok(saved);
      assert.deepEqual(saved.categoryDetails, expected);
      assert.equal(saved.recurring, category.slug === "commute");
      assert.deepEqual(saved.audience, {
        minAge: category.slug === "commute" ? 25 : 18,
        maxAge: category.slug === "commute" ? 45 : 120,
        gender: category.slug === "commute" ? "female" : "both",
        maxDistanceKm: category.slug === "commute" ? 10 : null,
        distanceUnit: "km",
      });
      if (category.slug === "commute") {
        assert.deepEqual(
          saved.approximateLocation?.coordinates,
          [88.36, 22.57],
        );
        await page
          .getByText(/Ages 25/)
          .filter({ visible: true })
          .waitFor();
      }
      await page.getByText("Plan details", { exact: true }).waitFor();
      for (const field of fieldsForCategory(category.slug))
        await page
          .getByText(field.label.replace(" (optional)", ""), { exact: true })
          .filter({ visible: true })
          .waitFor();
      await page.getByRole("button", { name: "Go back", exact: true }).click();
    }
    console.log(
      "All 12 category posting forms passed: required fields, draft retention, publishing, stored details and public summaries.",
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    postingOnly
      ? "Plans posting QA passed through Plans → Start a plan for all 12 categories."
      : "Plans browser QA passed: incoming liker photo, identity and profile navigation, category grid, search, decoded organizer photo, filters, persistent save, details, request, organizer acceptance, owner-first message and reply, owner-only earlier plans, rescheduling and refreshed live counts.",
  );
} catch (error) {
  for (const context of browser?.contexts() ?? [])
    for (const page of context.pages()) {
      console.error(await page.locator("body").innerText());
    }
  throw error;
} finally {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => apiServer.close(() => resolve()));
  await mongoose.disconnect();
  await db.stop();
}
