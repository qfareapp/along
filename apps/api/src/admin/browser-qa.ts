import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { chromium, type Browser } from "playwright-core";

const simpleLogin = process.argv.includes("--env-login");
const qaPassword = `Aa1!${crypto.randomBytes(20).toString("hex")}`;
process.env.ADMIN_EMAIL = "qa-operator@example.test";
process.env.ADMIN_PASSWORD = qaPassword;
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.ADMIN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.ADMIN_ORIGIN = "http://localhost:3100";
process.env.ADMIN_AUTH_MODE = simpleLogin ? "env" : "mfa";
const { createApp } = await import("../app.js");
const { provisionFirstAdmin } = await import("./provision.js");
const { totpFor } = await import("./security.js");
const { User, Profile, Activity, Category, Report } =
  await import("../models.js");
const { Verification } = await import("./models.js");
const { tokens } = await import("../auth.js");
const { seedCategories } = await import("../categories.js");
const database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
await mongoose.connect(database.getUri());
const server = createApp().listen(4100, "127.0.0.1");
let next: ChildProcess | undefined;
let browser: Browser | undefined;
const root = path.resolve("../..");
const shots = path.join(
  root,
  simpleLogin
    ? "docs/admin-simple-login-screenshots"
    : "docs/admin-screenshots",
);
fs.mkdirSync(shots, { recursive: true });
try {
  const password = qaPassword;
  const setup = await provisionFirstAdmin(
    "qa-operator@example.test",
    password,
    "Platform Operator",
  );
  await seedCategories();
  const names = [
    "Avery Morgan",
    "Maya Sen",
    "Rohan Das",
    "Ananya Roy",
    "Arjun Bose",
    "Tara Mehta",
    "Nikhil Rao",
    "Ishani Shah",
  ];
  const users = [];
  const hash = await bcrypt.hash(password, 12);
  for (const [i, name] of names.entries()) {
    const user = await User.create({
      name,
      email: `fictional-${i}@example.test`,
      birthDate: "1998-01-01",
      passwordHash: hash,
      emailVerified: true,
      identityVerified: i % 3 === 0,
      createdAt: new Date(Date.now() - i * 3 * 86400000),
      lastActiveAt: i % 2 === 0 ? new Date() : undefined,
    });
    users.push(user);
    await Profile.create({
      user: user._id,
      city: i < 6 ? "Kolkata" : "Bengaluru",
      area: "Salt Lake",
      bio: "An entirely fictional adult for isolated automated browser testing.",
      onboardingComplete: i % 3 !== 0,
      interests: ["Coffee", "Travel"],
    });
  }
  for (const [i, title] of [
    "Coffee After Work",
    "Office Carpool to Sector V",
    "A Weekend by the Sea",
    "Morning Walk Together",
  ].entries())
    await Activity.create({
      creator: users[i]._id,
      category: ["food", "commute", "travel", "fitness"][i],
      type: "together",
      title,
      description: "Fictional plan in the isolated browser test database.",
      zone: "Kolkata",
      startsAt: new Date(Date.now() + 86400000),
    });
  await Verification.create({
    user: users[1]._id,
    type: "identity",
    providerReference: "qa-provider-reference",
  });
  const report = await Report.create({
    reporter: users[1]._id,
    target: users[0]._id,
    reason: "Fictional report for testing a moderation workflow.",
    severity: "medium",
  });
  const memberToken = (await tokens(String(users[0]._id))).accessToken;
  const viewerToken = (await tokens(String(users[1]._id))).accessToken;
  const adminDir = path.resolve("../admin");
  next = spawn(
    process.execPath,
    [
      path.join(adminDir, "node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "-p",
      "3100",
    ],
    {
      cwd: adminDir,
      env: {
        ...process.env,
        ALONG_API_URL: "http://127.0.0.1:4100",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://localhost:3100/login")).ok) break;
    } catch {
      /* Wait for the owned Next process to start. */
    }
    if (next.exitCode !== null)
      throw new Error("Next.js exited before readiness.");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ??
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:3100/dashboard");
  await page.waitForURL("**/login");
  await page
    .getByLabel("Work email", { exact: true })
    .fill("qa-operator@example.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  if (simpleLogin)
    await page
      .getByLabel("Authenticator or recovery code", { exact: true })
      .waitFor({ state: "hidden" });
  else
    await page
      .getByLabel("Authenticator or recovery code", { exact: true })
      .fill(totpFor(setup.secret).generate());
  // Capture before entering a secret code; screenshots never retain operator passwords or codes.
  await page.getByLabel("Password", { exact: true }).fill("");
  if (!simpleLogin)
    await page
      .getByLabel("Authenticator or recovery code", { exact: true })
      .fill("");
  await page.screenshot({ path: path.join(shots, "01-login.png") });
  await page.getByLabel("Password", { exact: true }).fill(password);
  if (!simpleLogin)
    await page
      .getByLabel("Authenticator or recovery code", { exact: true })
      .fill(totpFor(setup.secret).generate());
  await page.getByRole("button", { name: "Sign in to Along" }).click();
  await page.getByRole("heading", { name: /A little overview/ }).waitFor();
  await page.getByText("Community members", { exact: true }).waitFor();
  await page.screenshot({
    path: path.join(shots, "02-dashboard.png"),
    fullPage: true,
  });
  assert.ok(
    !(await page.evaluate(() => document.cookie)).includes("along_admin"),
  );
  await page.getByRole("link", { name: "People", exact: true }).click();
  await page
    .getByRole("button", { name: "View Avery Morgan", exact: true })
    .waitFor();
  await page.screenshot({ path: path.join(shots, "03-users.png") });
  await page
    .getByRole("button", { name: "View Avery Morgan", exact: true })
    .click();
  await page
    .getByLabel("Account action", { exact: true })
    .selectOption("suspend");
  await page
    .getByLabel("Reason for this action", { exact: true })
    .fill("Fictional browser test: reviewing a safety concern.");
  await page
    .getByRole("button", { name: "Confirm account action", exact: true })
    .click();
  await page
    .getByText("Account updated. Existing sessions were revoked.", {
      exact: true,
    })
    .waitFor();
  await page.screenshot({ path: path.join(shots, "04-user-detail.png") });
  assert.equal(
    (
      await fetch("http://127.0.0.1:4100/api/v1/users/me", {
        headers: { Authorization: `Bearer ${memberToken}` },
      })
    ).status,
    401,
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .getByRole("link", { name: "Reports & safety", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Review decision", { exact: true })
    .selectOption("resolved");
  await page
    .getByLabel("Review reason", { exact: true })
    .fill(
      "Fictional browser test: investigation completed and outcome recorded.",
    );
  await page
    .getByRole("button", { name: "Confirm decision", exact: true })
    .click();
  await page
    .getByText("Review saved and recorded in the audit trail.", { exact: true })
    .waitFor();
  assert.equal((await Report.findById(report._id))?.status, "resolved");
  await page.getByRole("link", { name: "Categories", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit Food & Dining", exact: true })
    .click();
  await page.getByLabel("Category enabled", { exact: true }).uncheck();
  await page
    .getByLabel("Category change reason", { exact: true })
    .fill("Fictional browser test: temporary category review.");
  await page
    .getByRole("button", { name: "Confirm category change", exact: true })
    .click();
  await page
    .getByText(
      "Category saved. Mobile discovery will refresh from the same API.",
      { exact: true },
    )
    .waitFor();
  assert.equal((await Category.findOne({ slug: "food" }))?.active, false);
  const mobileCategories = await (
    await fetch("http://127.0.0.1:4100/api/v1/categories")
  ).json();
  assert.ok(
    !mobileCategories.data.some((v: { slug: string }) => v.slug === "food"),
  );
  await page.screenshot({ path: path.join(shots, "05-categories.png") });
  await page.getByRole("link", { name: "Matching rules", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "romantic", exact: true })
    .fill("40");
  await page
    .getByRole("spinbutton", { name: "activity", exact: true })
    .fill("25");
  await page
    .getByLabel("Matching change reason", { exact: true })
    .fill("Fictional browser test: versioned weight adjustment.");
  await page
    .getByRole("button", { name: "Confirm new version", exact: true })
    .click();
  await page
    .getByText("Configuration version saved.", { exact: true })
    .waitFor();
  await page.getByText("Version 1", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(shots, "06-matching.png") });
  await page.getByRole("link", { name: "Audit trail", exact: true }).click();
  await page.getByText("user.suspend", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(shots, "07-audit.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:3100/dashboard");
  await page.getByRole("heading", { name: /A little overview/ }).waitFor();
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.screenshot({ path: path.join(shots, "08-responsive.png") });
  assert.deepEqual(errors, []);
  assert.equal(
    (
      await fetch("http://127.0.0.1:4100/api/v1/users/me", {
        headers: { Authorization: `Bearer ${viewerToken}` },
      })
    ).status,
    200,
  );
  console.log(
    "PASS: authenticated Next.js UI, private cookie, live dashboard/users, suspension in mobile API, report resolution, category disablement, matching version, audit history and mobile sidebar. No page errors. Test database only.",
  );
} finally {
  if (browser) await browser.close();
  if (next) next.kill();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mongoose.disconnect();
  await database.stop();
}
