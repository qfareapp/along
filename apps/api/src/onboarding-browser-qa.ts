import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import mongoose from "mongoose";
import nodemailer from "nodemailer";
import sharp from "sharp";
import { mock } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { chromium, type Browser } from "playwright-core";
process.env.ADMIN_AUTH_MODE = "mfa";
process.env.PHOTO_STORAGE = "mongodb";
const emailOptional = process.argv.includes("--email-optional");
process.env.EMAIL_VERIFICATION_REQUIRED = emailOptional ? "false" : "true";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.SMTP_URL = "smtp://test.invalid";
process.env.CORS_ORIGINS = "http://localhost:18082";
const { createApp } = await import("./app.js");
const { User, Profile, ProfilePhoto, ProfileSwipe, Category, Activity } =
  await import("./models.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const root = path.resolve("../.."),
  webRoot = path.join(root, "apps/mobile/dist-onboarding-qa"),
  shots = path.join(root, "docs/onboarding-screenshots");
fs.mkdirSync(shots, { recursive: true });
if (!fs.existsSync(path.join(webRoot, "index.html")))
  throw new Error(
    "Export the mobile QA web build before running this command.",
  );
let verificationCode = "";
mock.method(nodemailer, "createTransport", () => ({
  sendMail: async (message: { text: string }) => {
    verificationCode = message.text.match(/\d{6}/)![0];
    return {};
  },
}));
const db = await MongoMemoryServer.create();
await mongoose.connect(db.getUri());
const fixtureIds: Record<string, string> = {};
const fixtureImage = await sharp({
  create: { width: 200, height: 250, channels: 3, background: "#174F54" },
})
  .jpeg()
  .toBuffer();
for (const name of ["Avery", "Maya", "Noor"]) {
  const fixture = await User.create({
    name: `QA ${name}`,
    email: `qa-${name.toLowerCase()}@example.test`,
    passwordHash: "fixture",
    birthDate: "1998-01-01",
    emailVerified: true,
  });
  fixtureIds[name] = String(fixture._id);
  await eligibleProfile(fixture._id);
  await ProfilePhoto.updateMany(
    { owner: fixture._id },
    { $set: { bytes: fixtureImage } },
  );
}
await Category.create({ slug: "food", name: "Food & Dining", active: true });
await Category.create({
  slug: "travel",
  name: "Travel & Holidays",
  active: true,
  allowedTypes: ["offer"],
});
await Activity.create({
  creator: fixtureIds.Avery,
  type: "together",
  category: "food",
  title: "QA Coffee Meetup",
  description:
    "Fictional activity for checking that plans stay in the Plans tab.",
  zone: "Kolkata",
  startsAt: new Date(Date.now() + 86400000),
});
const api = createApp().listen(4101, "127.0.0.1");
const mime: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".json": "application/json",
};
const web = http
  .createServer((req, res) => {
    let file = path.resolve(
      webRoot,
      "." + decodeURIComponent((req.url || "/").split("?")[0]),
    );
    if (!file.startsWith(webRoot + path.sep) && file !== webRoot) {
      res.writeHead(403).end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory())
      file = path.join(webRoot, "index.html");
    res.setHeader(
      "Content-Type",
      mime[path.extname(file)] || "application/octet-stream",
    );
    fs.createReadStream(file).pipe(res);
  })
  .listen(18082, "127.0.0.1");
let browser: Browser | undefined;
try {
  browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  // Account-first entry and returning-member login use the real API.
  const authContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const authPage = await authContext.newPage();
  await authPage.goto("http://localhost:18082");
  await authPage
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  const advance = () =>
    authPage.getByRole("button", { name: "Continue", exact: true }).click();
  await authPage.getByLabel("Email address", { exact: true }).fill("invalid");
  await advance();
  await authPage.getByText("Enter a valid email.", { exact: true }).waitFor();
  await authPage
    .getByLabel("Email address", { exact: true })
    .fill(" QA-Auth@Example.Test ");
  await advance();
  await authPage.getByLabel("Password", { exact: true }).fill("short");
  await advance();
  await authPage
    .getByText("Use at least 10 characters.", { exact: true })
    .waitFor();
  const authPassword = "Fictional-auth-password-123";
  await authPage.getByLabel("Password", { exact: true }).fill(authPassword);
  await authPage
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  assert.equal(
    await authPage.getByLabel("Password", { exact: true }).getAttribute("type"),
    "text",
  );
  await authPage.getByRole("button", { name: "Back", exact: true }).click();
  assert.equal(
    await authPage.getByLabel("Email address", { exact: true }).inputValue(),
    "QA-Auth@Example.Test",
  );
  await advance();
  assert.equal(
    await authPage.getByLabel("Password", { exact: true }).inputValue(),
    authPassword,
  );
  assert.equal(
    await authPage.getByLabel("Password", { exact: true }).getAttribute("type"),
    "password",
  );
  await advance();
  await authPage.getByLabel("First name", { exact: true }).fill("Auth Adult");
  await advance();
  await authPage
    .getByLabel("Date of birth", { exact: true })
    .fill("2015-01-01");
  await authPage
    .getByRole("button", { name: "Create Account", exact: true })
    .click();
  await authPage.getByRole("alert").waitFor();
  await authPage
    .getByLabel("Date of birth", { exact: true })
    .fill("1998-01-01");
  await authPage.screenshot({ path: path.join(shots, "auth-birthday.png") });
  await authContext.route("**/api/v1/auth/register", (route) => route.abort());
  await authPage
    .getByRole("button", { name: "Create Account", exact: true })
    .click();
  await authPage.getByRole("alert").waitFor();
  assert.equal(
    await authPage.getByLabel("Date of birth", { exact: true }).inputValue(),
    "1998-01-01",
  );
  await authContext.unroute("**/api/v1/auth/register");
  await authPage
    .getByRole("button", { name: "Create Account", exact: true })
    .click();
  await authPage
    .getByRole("button", { name: "Coffee dates", exact: true })
    .waitFor();
  assert.ok(await User.findOne({ email: "qa-auth@example.test" }));
  await authContext.close();
  const loginContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const loginPage = await loginContext.newPage();
  await loginPage.goto("http://localhost:18082");
  await loginPage.getByRole("button", { name: "Sign in", exact: true }).click();
  await loginPage
    .getByLabel("Email address", { exact: true })
    .fill("qa-auth@example.test");
  await loginPage
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await loginPage
    .getByLabel("Password", { exact: true })
    .fill("Wrong-password-123");
  await loginPage.getByRole("button", { name: "Sign In", exact: true }).click();
  await loginPage
    .getByText("Email or password is incorrect.", { exact: true })
    .waitFor();
  await loginPage.getByLabel("Password", { exact: true }).fill(authPassword);
  await loginPage.getByRole("button", { name: "Sign In", exact: true }).click();
  await loginPage
    .getByRole("button", { name: "Coffee dates", exact: true })
    .waitFor();
  await loginContext.close();
  console.log(
    "Auth browser QA passed: account-first entry, validation, back preservation, password visibility, adult check, network retry, normalized email, login error/retry and onboarding handoff.",
  );
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:18082");
  await page.goto("http://localhost:18082/onboarding");
  assert.equal(
    await page
      .getByRole("button", { name: "Continue", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Coffee dates", exact: true }).click();
  await page
    .getByRole("button", { name: "Weekend exploring", exact: true })
    .click();
  await page.screenshot({ path: path.join(shots, "01-your-vibe.png") });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Let's do something", exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("button", { name: "Let's do something", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Let's do something", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "Back", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Coffee dates", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Open to something meaningful", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Kolkata", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.screenshot({ path: path.join(shots, "02-make-it-you.png") });
  await page.getByRole("button", { name: "Skip for Now", exact: true }).click();
  await page.screenshot({ path: path.join(shots, "03-starter-card.png") });
  await page
    .getByRole("button", { name: "Explore Along", exact: true })
    .click();
  const password = "Fictional-qa-password-123";
  await page
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill("qa-onboarding@example.test");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("textbox", { name: "First name", exact: true })
    .fill("QA Adult");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Choose Date of birth", exact: true })
    .click();
  const birthCalendar = page.getByRole("dialog", {
    name: "Date of birth picker",
    exact: true,
  });
  await birthCalendar
    .getByRole("button", { name: "Choose year", exact: true })
    .click();
  assert.equal(
    await birthCalendar
      .getByRole("button", { name: "Next years", exact: true })
      .isDisabled(),
    true,
  );
  // Jump to a birth year, then pick its month and day without stepping through months.
  while (
    (await birthCalendar
      .getByRole("button", { name: "1998", exact: true })
      .count()) === 0
  )
    await birthCalendar
      .getByRole("button", { name: "Previous years", exact: true })
      .click();
  await birthCalendar
    .getByRole("button", { name: "1998", exact: true })
    .click();
  await birthCalendar.getByRole("button", { name: "Jan", exact: true }).click();
  await birthCalendar
    .getByRole("button", { name: "1998-01-01", exact: true })
    .click();
  await page.screenshot({
    path: path.join(shots, "themed-birth-calendar.png"),
    animations: "disabled",
  });
  await birthCalendar
    .getByRole("button", { name: "Confirm date", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Date of birth", { exact: true }).inputValue(),
    "1998-01-01",
  );
  assert.equal(
    await page
      .getByLabel("Date of birth", { exact: true })
      .getAttribute("type"),
    "date",
  );
  await page
    .getByRole("button", { name: "Create Account", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Complete Profile to Connect", exact: true })
    .waitFor();
  assert.equal(
    (
      await Profile.findOne({
        user: (await User.findOne({ email: "qa-onboarding@example.test" }))!
          ._id,
      })
    )?.onboarding?.quickStartCompleted,
    true,
  );
  await page.screenshot({ path: path.join(shots, "04-safe-preview.png") });
  await page
    .getByRole("button", { name: "Complete Profile to Connect", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Display name", exact: true })
    .waitFor();
  assert.equal(await page.getByLabel(/Date of birth/).count(), 0);
  await page.getByRole("button", { name: "Non-binary", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Woman", exact: true }).click();
  await page.getByRole("switch", { name: "Accept Terms", exact: true }).click();
  await page
    .getByRole("switch", { name: "Accept Community Guidelines", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save Safety Details", exact: true })
    .click();
  if (emailOptional) {
    await page
      .getByText(
        "Email verification is temporarily optional. You can continue without a code.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Send Verification Code", exact: true })
        .count(),
      0,
    );
  } else {
    await page
      .getByRole("button", { name: "Send Verification Code", exact: true })
      .click();
    await page
      .getByText(
        "A six-digit code has been sent to your email. It expires in 10 minutes.",
        { exact: true },
      )
      .waitFor();
    assert.match(verificationCode, /^\d{6}$/);
    await page
      .getByRole("textbox", { name: "Email verification code", exact: true })
      .fill(verificationCode);
    await page
      .getByRole("button", { name: "Verify Email", exact: true })
      .click();
    await page.getByText("Email verified ✓", { exact: true }).waitFor();
  }
  const photoPath = path.join(shots, "qa-photo.png");
  await sharp(crypto.randomBytes(1600 * 1200 * 3), {
    raw: { width: 1600, height: 1200, channels: 3 },
  })
    .png()
    .toFile(photoPath);
  const chooser = page.waitForEvent("filechooser");
  await page.evaluate(() => {
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      if (body instanceof FormData) {
        const photo = body.get("photo");
        if (photo instanceof Blob)
          (
            window as unknown as { uploadedPhotoBytes: number }
          ).uploadedPhotoBytes = photo.size;
      }
      return originalSend.call(this, body);
    };
  });
  await page.getByRole("button", { name: "Add Photo", exact: true }).click();
  await (await chooser).setFiles(photoPath);
  await page.getByText("1 private photo saved", { exact: true }).waitFor();
  const uploadedBytes = await page.evaluate(
    () =>
      (window as unknown as { uploadedPhotoBytes: number }).uploadedPhotoBytes,
  );
  assert.ok(
    uploadedBytes > 0 && uploadedBytes < 100_000,
    "Client compresses actual multipart photo bytes under 100 KB",
  );

  await page.screenshot({ path: path.join(shots, "05-profile-unlock.png") });
  // A photo request can race with session expiry or a provider outage. Exercise
  // both, then require actual decoded pixels rather than just an Image element.
  let photoRequests = 0;
  let photoRefreshes = 0;
  page.on("request", (req) => {
    if (req.url().endsWith("/auth/refresh")) photoRefreshes++;
  });
  await page.route(/\/profile\/photos\/[^/?]+$/, async (route) => {
    photoRequests++;
    if (photoRequests <= 2)
      await route.fulfill({
        status: photoRequests === 1 ? 401 : 503,
        headers: { "Access-Control-Allow-Origin": "http://localhost:18082" },
        json: { error: { message: "Fixture photo delivery failure" } },
      });
    else await route.continue();
  });
  await page
    .getByRole("button", { name: "Activate Discovery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Like QA Noor", exact: true })
    .waitFor();
  const member = await User.findOne({ email: "qa-onboarding@example.test" });
  assert.equal(member?.emailVerified, !emailOptional);
  assert.equal(
    (await User.findById(member!._id).select("+birthDate"))?.birthDate
      ?.toISOString()
      .slice(0, 10),
    "1998-01-01",
  );
  assert.equal(
    (await Profile.findOne({ user: member!._id }))?.onboarding?.currentStage,
    "ready_for_discovery",
  );
  if (process.argv.includes("--date-time-only")) {
    assert.deepEqual(errors, []);
    console.log(
      "Birthday QA passed: collected once at registration, reused during profile completion, email verification and activation.",
    );
  } else {
    await ProfileSwipe.create({
      user: fixtureIds.Noor,
      target: member!._id,
      action: "like",
    });
    await page
      .getByRole("button", { name: "Retry profile photo", exact: true })
      .click();
    assert.equal(photoRefreshes, 1);
    await page.waitForFunction(() => {
      const image = document.querySelector<HTMLImageElement>(
        '[data-testid="member-photo"] img',
      );
      return image?.complete && image.naturalWidth > 0;
    });
    await page.screenshot({
      path: path.join(shots, "06-discovery-profiles.png"),
    });
    await page
      .getByRole("button", { name: "Like QA Noor", exact: true })
      .click();
    await page
      .getByText(
        "You and QA Noor liked each other. Say hello while the vibe is fresh.",
        { exact: true },
      )
      .waitFor();
    await page
      .getByRole("button", { name: "Keep Exploring", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save QA Maya's profile", exact: true })
      .click();
    const swipeCard = page.locator(
      '[data-testid="discovery-profile-card"]:visible',
    );
    await page
      .getByRole("button", { name: "Like QA Avery", exact: true })
      .waitFor();
    const bounds = await swipeCard.boundingBox();
    assert.ok(bounds);
    await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + 200);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + 200, {
      steps: 12,
    });
    await page.mouse.up();
    await page
      .getByText("Your next connection is on the way", { exact: true })
      .filter({ visible: true })
      .waitFor();
    assert.equal(await ProfileSwipe.countDocuments({ user: member!._id }), 3);
    await page.getByRole("button", { name: "Your likes", exact: true }).click();
    await page
      .getByRole("button", { name: "View QA Noor's profile", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "View QA Maya's profile", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "View QA Maya's profile", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save Profile", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Go back", exact: true }).click();
    await page.getByRole("button", { name: "Go back", exact: true }).click();
    await page.getByRole("tab", { name: /Plans/ }).click();
    await page
      .getByText("QA Coffee Meetup", { exact: true })
      .filter({ visible: true })
      .waitFor();
    assert.equal(
      await page
        .locator('[data-testid="discovery-profile-card"]:visible')
        .count(),
      0,
    );
    await page.screenshot({ path: path.join(shots, "07-plans-tab.png") });
    // Pick a category, change it, navigate back and publish the selected slug.
    await page.getByRole("tab", { name: /Plans/ }).click();
    await page.getByRole("button", { name: /Start a plan/ }).click();
    await page
      .getByRole("textbox", { name: "What’s the plan?", exact: true })
      .fill("QA Weekend Walk");
    await page
      .getByRole("textbox", { name: "What are you looking for?", exact: true })
      .fill(
        "A fictional weekend plan to verify category selection persists through publishing.",
      );
    assert.equal(
      await page
        .getByRole("button", { name: "Next", exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByRole("button", { name: "Category: Food & Dining", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("button", { name: "Category: Food & Dining", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page
      .getByRole("button", { name: "I Can Offer", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Category: Travel & Holidays", exact: true })
      .click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page
      .getByText("Category: Travel & Holidays", { exact: true })
      .filter({ visible: true })
      .waitFor();
    await page
      .getByText("Back to plan details", { exact: true })
      .filter({ visible: true })
      .click();
    assert.equal(
      await page
        .getByRole("button", {
          name: "Category: Travel & Holidays",
          exact: true,
        })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Approximate area", exact: true })
      .fill("Kolkata");
    const published = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/activities") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Publish Plan", exact: true })
      .click();
    const posted = await published;
    assert.equal(posted.status(), 201);
    const created = await Activity.findOne({ title: "QA Weekend Walk" });
    assert.equal(created?.category, "travel");
    assert.equal(created?.type, "offer");
    await page
      .getByText("QA Weekend Walk", { exact: true })
      .filter({ visible: true })
      .waitFor();
    await page.getByRole("button", { name: "Go back", exact: true }).click();
    // Editing a saved step offline keeps its input and permits a successful retry.
    await page.getByRole("tab", { name: /Profile/ }).click();
    await page
      .getByRole("button", { name: "Edit My Profile & Vibe", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit Vibe, Intention & City", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit My Vibe", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Fitness buddies", exact: true })
      .click();
    await context.route("**/api/v1/onboarding/vibes", (route) => route.abort());
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Fitness buddies", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await context.unroute("**/api/v1/onboarding/vibes");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page
      .getByText("What sounds good right now?", { exact: true })
      .filter({ visible: true })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      `Onboarding browser QA passed (${emailOptional ? "email bypass" : "email verification"}): selection, back, reload/resume, optional skip, registration, Mongo persistence, photo upload, activation, protected photo session refresh/retry and decoded image, profile swipes, likes/saves, profile details, Plans tab, category selection/back navigation/publishing, network failure/retry.`,
    );
  }
} finally {
  await browser?.close();
  mock.restoreAll();
  await new Promise<void>((r) => api.close(() => r()));
  await new Promise<void>((r) => web.close(() => r()));
  await mongoose.disconnect();
  await db.stop();
}
