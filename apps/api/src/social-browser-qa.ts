import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import sharp from "sharp";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { chromium, type Browser, type Page } from "playwright-core";
process.env.ADMIN_AUTH_MODE = "mfa";
process.env.PHOTO_STORAGE = "mongodb";
process.env.EMAIL_VERIFICATION_REQUIRED = "false";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.CORS_ORIGINS = "http://localhost:18090";
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "along-social-browser-"),
);
process.env.SOCIAL_MEDIA_DIR = directory;
const { createApp } = await import("./app.js");
const { User, ProfilePhoto, Activity, Message, Match } =
  await import("./models.js");
const { SocialMoment, MomentReaction, PlanInvitation } =
  await import("./social-models.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const { ensureMatch } = await import("./chat.js");
const { seedCategories } = await import("./categories.js");
const root = path.resolve("../.."),
  webRoot = path.join(root, "apps/mobile/dist-social-qa"),
  shots = path.join(root, "docs/social-screenshots");
fs.mkdirSync(shots, { recursive: true });
const database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
await mongoose.connect(database.getUri());
await seedCategories();
const password = "Along-social-qa-only-2026";
const members = [];
for (const [i, name] of ["QA Alice", "QA Bob"].entries()) {
  const user = await User.create({
    name,
    email: `social-${i}@example.test`,
    birthDate: "1997-01-01",
    passwordHash: await bcrypt.hash(password, 10),
    emailVerified: true,
  });
  members.push(user);
  await eligibleProfile(user._id);
  const bytes = await sharp(
    path.join(
      root,
      `apps/mobile/assets/brand/${i ? "rohan" : "ananya-photo"}.png`,
    ),
  )
    .resize(400, 500)
    .jpeg()
    .toBuffer();
  await ProfilePhoto.updateMany({ owner: user._id }, { bytes });
}
await ensureMatch(String(members[0]._id), String(members[1]._id));
const apiServer = createApp().listen(4110, "127.0.0.1");
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
    if (!file.startsWith(webRoot + path.sep) && file !== webRoot)
      return void res.writeHead(403).end();
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory())
      file = path.join(webRoot, "index.html");
    res.setHeader(
      "Content-Type",
      mime[path.extname(file)] ?? "application/octet-stream",
    );
    fs.createReadStream(file).pipe(res);
  })
  .listen(18090, "127.0.0.1");
let browser: Browser | undefined;
const errors: string[] = [];
async function login(page: Page, who: number) {
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:18090/auth");
  await page
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill(`social-${who}@example.test`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.getByRole("tab", { name: /Social/ }).click();
  await page
    .getByText("A little more of their world.", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("tab", { name: "Post", exact: true }).count(),
    0,
  );
}
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const alice = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await login(alice, 0);
  const floating = alice.getByRole("button", {
    name: "Open What's on your mind",
    exact: true,
  });
  await floating.waitFor();
  assert.equal(
    await alice
      .getByRole("button", { name: "Create Moment", exact: true })
      .count(),
    0,
  );
  const beforeScroll = await floating.boundingBox();
  await alice
    .getByRole("button", { name: "Privacy", exact: true })
    .scrollIntoViewIfNeeded();
  const afterScroll = await floating.boundingBox();
  assert.ok(
    beforeScroll && afterScroll && Math.abs(beforeScroll.y - afterScroll.y) < 1,
  );
  const socialTab = await alice
    .getByRole("tab", { name: /Social/ })
    .boundingBox();
  assert.ok(
    socialTab &&
      afterScroll &&
      afterScroll.y + afterScroll.height < socialTab.y,
  );
  await floating.click();
  const options = alice.getByRole("dialog", {
    name: "What's on your mind?",
    exact: true,
  });
  await options.waitFor();
  await alice.waitForTimeout(350); // Let Modal finish its fade and register Escape handling.
  await alice.screenshot({
    path: path.join(shots, "10-floating-composer-phone.png"),
  });
  await options
    .getByRole("button", { name: "Close update options", exact: true })
    .click();
  await options.waitFor({ state: "hidden" });
  await floating.click();
  await alice.waitForTimeout(350);
  await alice.keyboard.press("Escape");
  await options.waitFor({ state: "hidden" });
  await floating.click();
  await alice
    .getByRole("button", { name: "Dismiss update options", exact: true })
    .click({ position: { x: 10, y: 10 } });
  await options.waitFor({ state: "hidden" });
  for (const label of ["Photo", "Ask", "Along now"]) {
    await floating.click();
    await options
      .getByRole("button", { name: `Create a ${label} Moment`, exact: true })
      .click();
    await alice
      .getByRole("button", { name: "Publish Moment", exact: true })
      .waitFor();
    assert.equal(await options.count(), 0);
    if (label === "Photo")
      await alice
        .getByRole("button", { name: "Choose Photo", exact: true })
        .waitFor();
    await alice.getByRole("button", { name: "Go back", exact: true }).click();
    await floating.waitFor();
    assert.equal(await options.count(), 0);
  }
  await alice.setViewportSize({ width: 1024, height: 768 });
  await floating.click();
  await options.waitFor();
  const tabletOptions = await options.boundingBox();
  assert.ok(
    tabletOptions && tabletOptions.width <= 720 && tabletOptions.x >= 0,
  );
  await alice.screenshot({
    path: path.join(shots, "11-floating-composer-tablet.png"),
  });
  await options
    .getByRole("button", { name: "Close update options", exact: true })
    .click();
  await alice.setViewportSize({ width: 390, height: 844 });
  console.log(
    "Floating composer QA passed: fixed position above navigation, original options, close/Escape/backdrop dismissal, photo/question/Along now navigation, closed panel on return and tablet layout.",
  );
  if (process.argv.includes("--feed-toggle-only")) {
    const casey = await User.create({
      name: "QA Casey",
      email: "casey-social@example.test",
      birthDate: "1997-01-01",
      passwordHash: "fixture",
      emailVerified: true,
    });
    await eligibleProfile(casey._id);
    const photo = await ProfilePhoto.findOne({ owner: members[0]._id }).select(
      "+bytes",
    );
    await ProfilePhoto.updateMany(
      { owner: casey._id },
      { bytes: photo!.bytes },
    );
    const discoverText = "A Discover-shared update from Casey";
    const privateText = "A match-only update from Casey";
    await Activity.create([
      {
        creator: members[1]._id,
        type: "together",
        category: "food",
        title: "Bob's coffee meetup",
        description: "A relaxed coffee and conversation.",
        zone: "Kolkata",
        startsAt: new Date(Date.now() + 86400000),
      },
      {
        creator: casey._id,
        type: "together",
        category: "food",
        title: "Casey's weekend coffee",
        description: "Try a new cafe together.",
        zone: "Kolkata",
        startsAt: new Date(Date.now() + 86400000),
      },
      {
        creator: casey._id,
        visibility: "private",
        type: "together",
        category: "food",
        title: "Private coffee plan",
        description: "Not for the Social feed.",
        zone: "Kolkata",
        startsAt: new Date(Date.now() + 86400000),
      },
    ]);
    await SocialMoment.create([
      {
        author: casey._id,
        type: "text",
        text: discoverText,
        audience: "discover",
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      },
      {
        author: casey._id,
        type: "text",
        text: privateText,
        audience: "matches",
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      },
    ]);
    assert.equal(
      await alice.getByText(discoverText, { exact: true }).count(),
      0,
    );
    await alice
      .getByRole("radio", { name: "Discover preferences", exact: true })
      .click();
    const discoverConfirmation = alice.getByRole("dialog", {
      name: "Switch to Discover?",
      exact: true,
    });
    await discoverConfirmation
      .getByText(
        "Plans and status updates from people who fit your Discover preferences. Private updates stay private.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await alice
        .getByRole("radio", { name: "Matched connections", exact: true })
        .getAttribute("aria-checked"),
      "true",
    );
    await discoverConfirmation
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    assert.equal(
      await alice.getByText(discoverText, { exact: true }).count(),
      0,
    );
    await alice
      .getByRole("radio", { name: "Discover preferences", exact: true })
      .click();
    await discoverConfirmation
      .getByRole("button", { name: "OK", exact: true })
      .click();
    await alice.getByText(discoverText, { exact: true }).waitFor();
    await alice
      .getByRole("button", {
        name: "View Casey's weekend coffee by QA Casey",
        exact: true,
      })
      .waitFor();
    assert.equal(
      await alice.getByText("Private coffee plan", { exact: true }).count(),
      0,
    );
    assert.equal(
      await alice.getByText(privateText, { exact: true }).count(),
      0,
    );
    await alice
      .getByRole("button", { name: "QA Casey, new Moments", exact: true })
      .waitFor();
    await alice.waitForFunction(
      () =>
        !document.body.innerText.includes("Retry photo") &&
        [...document.images].filter(
          (img) => img.complete && img.naturalWidth > 0,
        ).length >= 3,
    );
    await alice.screenshot({
      path: path.join(shots, "07-discover-toggle-phone.png"),
      fullPage: true,
    });
    await alice
      .getByRole("button", { name: "Open QA Casey's Moment", exact: true })
      .click();
    await alice
      .getByText(
        "Match with this person through Discover to reply privately or make a plan.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await alice
        .getByRole("textbox", { name: "Reply privately", exact: true })
        .count(),
      0,
    );
    await alice.getByRole("button", { name: "Go back", exact: true }).click();
    await alice
      .getByRole("radio", { name: "Matched connections", exact: true })
      .click();
    const matchesConfirmation = alice.getByRole("dialog", {
      name: "Switch to Matches?",
      exact: true,
    });
    await matchesConfirmation
      .getByText("Plans and status updates from people you've matched with.", {
        exact: true,
      })
      .waitFor();
    await alice.waitForTimeout(350);
    await alice.screenshot({
      path: path.join(shots, "12-feed-switch-confirmation.png"),
    });
    await matchesConfirmation
      .getByRole("button", { name: "OK", exact: true })
      .click();
    const matchedPlan = alice.getByRole("button", {
      name: "View Bob's coffee meetup by QA Bob",
      exact: true,
    });
    await matchedPlan.waitFor();
    assert.equal(
      await alice
        .getByRole("button", {
          name: "View Casey's weekend coffee by QA Casey",
          exact: true,
        })
        .count(),
      0,
    );
    await matchedPlan.scrollIntoViewIfNeeded();
    await alice.screenshot({
      path: path.join(shots, "13-social-plans-and-updates.png"),
      fullPage: true,
    });
    await matchedPlan.click();
    await alice
      .getByText("Bob's coffee meetup", { exact: true })
      .filter({ visible: true })
      .first()
      .waitFor();
    await alice.getByRole("button", { name: "Go back", exact: true }).click();
    assert.equal(
      await alice
        .getByText(discoverText, { exact: true })
        .filter({ visible: true })
        .count(),
      0,
    );
    await floating.click();
    await alice
      .getByRole("button", { name: "Create Moment", exact: true })
      .click();
    await alice
      .getByRole("textbox", { name: "Your Moment", exact: true })
      .fill("An update for my Discover matches");
    await alice
      .getByRole("button", { name: "Discover matches", exact: true })
      .click();
    await alice
      .getByRole("button", { name: "Publish Moment", exact: true })
      .click();
    await alice
      .getByRole("button", { name: "Add Another Moment", exact: true })
      .waitFor();
    assert.equal(
      (await SocialMoment.findOne({ author: members[0]._id }))!.audience,
      "discover",
    );
    const tablet = await browser.newPage({
      viewport: { width: 1024, height: 768 },
    });
    await login(tablet, 1);
    await tablet
      .getByRole("radio", { name: "Discover preferences", exact: true })
      .click();
    await tablet
      .getByRole("dialog", { name: "Switch to Discover?", exact: true })
      .getByRole("button", { name: "OK", exact: true })
      .click();
    await tablet.getByText(discoverText, { exact: true }).waitFor();
    assert.equal(
      await tablet.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await tablet.screenshot({
      path: path.join(shots, "08-discover-toggle-tablet.png"),
      fullPage: true,
    });
    assert.equal(await Match.countDocuments(), 1);
    assert.deepEqual(errors, []);
    console.log(
      "Social feed toggle QA passed: phone/tablet, mixed plans and status updates, matched/Discover plan filtering, private plan exclusion, plan detail navigation, separate feeds and trays, protected replies, explicit Discover audience publishing and unchanged matches.",
    );
  } else {
    await alice
      .getByText("Quiet around here... for now.", { exact: true })
      .waitFor();
    await alice.screenshot({
      path: path.join(shots, "01-empty-phone.png"),
      fullPage: true,
    });
    await floating.click();
    await alice
      .getByRole("button", { name: "Create Moment", exact: true })
      .click();
    await alice
      .getByRole("textbox", { name: "Your Moment", exact: true })
      .fill("Coffee and a little sunshine ☕");
    await alice
      .getByRole("switch", {
        name: "Allow sharing with authorized matches",
        exact: true,
      })
      .click();
    await alice.screenshot({
      path: path.join(shots, "02-composer-phone.png"),
      fullPage: true,
    });
    await alice
      .getByRole("button", { name: "Publish Moment", exact: true })
      .click();
    await alice
      .getByRole("button", { name: "Add Another Moment", exact: true })
      .waitFor();
    assert.equal(await SocialMoment.countDocuments({ type: "text" }), 1);
    await alice
      .getByRole("button", { name: "Add Another Moment", exact: true })
      .click();
    await alice.getByRole("button", { name: "Photo", exact: true }).click();
    const chooser = alice.waitForEvent("filechooser");
    await alice
      .getByRole("button", { name: "Choose Photo", exact: true })
      .click();
    await (
      await chooser
    ).setFiles(path.join(root, "apps/mobile/assets/brand/coffee.png"));
    await alice
      .getByRole("textbox", { name: "Caption (optional)", exact: true })
      .fill("A small pause in the day.");
    await alice
      .getByRole("button", { name: "Publish Moment", exact: true })
      .click();
    await alice
      .getByRole("button", { name: "Add Another Moment", exact: true })
      .waitFor();
    assert.equal(await SocialMoment.countDocuments({ type: "photo" }), 1);
    if (process.argv.includes("--upload-only")) {
      assert.equal(await SocialMoment.countDocuments({ type: "text" }), 1);
      const storedPhoto = await SocialMoment.findOne({ type: "photo" }).select(
        "+media",
      );
      assert.ok(storedPhoto?.media);
      await alice.waitForFunction(
        () =>
          !document.body.innerText.includes("Retry photo") &&
          [...document.images].filter(
            (img) => img.complete && img.naturalWidth > 0,
          ).length >= 2,
      );
      await alice.screenshot({
        path: path.join(shots, "09-published-photo-status.png"),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      console.log(
        "Social upload browser QA passed: authenticated text and photo publishing, stored media and decoded photo preview.",
      );
    } else {
      const bob = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      await login(bob, 1);
      await bob
        .getByText("Coffee and a little sunshine ☕", { exact: true })
        .waitFor();
      await bob
        .getByRole("button", { name: "QA Alice, new Moments", exact: true })
        .waitFor();
      await bob.screenshot({
        path: path.join(shots, "03-feed-phone.png"),
        fullPage: true,
      });
      await bob
        .getByRole("button", { name: "Open QA Alice's Moment", exact: true })
        .first()
        .click();
      await bob
        .getByRole("textbox", { name: "Reply privately", exact: true })
        .fill("That sounds lovely!");
      await bob.getByRole("button", { name: "React ☕", exact: true }).click();
      await bob
        .getByRole("button", { name: "Send Private Reply", exact: true })
        .click();
      await bob.getByText("Reply sent privately.", { exact: true }).waitFor();
      assert.equal(
        await MomentReaction.countDocuments({ user: members[1]._id }),
        1,
      );
      assert.equal(
        await Message.countDocuments({ text: "That sounds lovely!" }),
        1,
      );
      assert.equal(await Match.countDocuments(), 1);
      await bob
        .getByRole("button", { name: "Make a plan", exact: true })
        .click();
      await bob
        .getByRole("textbox", { name: "Plan title", exact: true })
        .fill("A sunny coffee together");
      await bob
        .getByRole("textbox", { name: "Approximate area", exact: true })
        .fill("Park Street, Kolkata");
      await bob
        .getByRole("button", { name: "Send Private Invitation", exact: true })
        .click();
      await bob
        .getByText("Waiting for your match to respond.", { exact: true })
        .waitFor();
      assert.equal(await Activity.countDocuments(), 0);
      await alice.getByRole("button", { name: "Go back", exact: true }).click();
      // Return through the stack; the session is deliberately kept only in memory.
      if (
        await alice
          .getByRole("button", { name: "Go back", exact: true })
          .count()
      )
        await alice
          .getByRole("button", { name: "Go back", exact: true })
          .click();
      await alice.getByRole("tab", { name: /Social/ }).click();
      await alice
        .getByRole("button", {
          name: /^Invitations/,
        })
        .click();
      await alice
        .getByRole("button", { name: "Accept Plan", exact: true })
        .click();
      await alice
        .getByRole("button", { name: "View Confirmed Plan", exact: true })
        .waitFor();
      assert.equal(await Activity.countDocuments({ visibility: "private" }), 1);
      assert.equal(
        await PlanInvitation.countDocuments({ status: "accepted" }),
        1,
      );
      await alice.screenshot({
        path: path.join(shots, "04-private-plan-phone.png"),
        fullPage: true,
      });
      await alice
        .getByRole("button", { name: "View Confirmed Plan", exact: true })
        .click();
      await alice
        .getByText("A sunny coffee together", { exact: true })
        .filter({ visible: true })
        .waitFor();
      await alice
        .getByRole("button", {
          name: "View private plan agreement",
          exact: true,
        })
        .waitFor();
      const tablet = await browser.newPage({
        viewport: { width: 1024, height: 768 },
      });
      await login(tablet, 1);
      await tablet
        .getByText("Coffee and a little sunshine ☕", { exact: true })
        .waitFor();
      await tablet.screenshot({
        path: path.join(shots, "05-feed-tablet.png"),
        fullPage: true,
      });
      assert.equal(
        await tablet.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await tablet
        .getByRole("button", { name: "Social privacy settings", exact: true })
        .click();
      await tablet
        .getByRole("switch", { name: "View receipts", exact: true })
        .click();
      await tablet
        .getByRole("button", { name: "Save Social Settings", exact: true })
        .click();
      await tablet
        .getByText("Privacy settings saved.", { exact: true })
        .waitFor();
      await tablet.screenshot({
        path: path.join(shots, "06-privacy-tablet.png"),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      console.log(
        "Social browser QA passed: five tabs, text/photo publishing, matched feed, reaction, private chat reply, consent-based private plan, privacy settings, phone and tablet.",
      );
    }
  }
} catch (error) {
  for (const [i, page] of (
    browser?.contexts().flatMap((c) => c.pages()) ?? []
  ).entries()) {
    await page.screenshot({
      path: path.join(shots, `failure-${i}.png`),
      fullPage: true,
    });
    console.error(`Page ${i}: ${await page.locator("body").innerText()}`);
  }
  throw error;
} finally {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => apiServer.close(() => resolve()));
  await mongoose.disconnect();
  await database.stop();
  for (const file of fs.readdirSync(directory))
    fs.unlinkSync(path.join(directory, file));
  fs.rmdirSync(directory);
}
