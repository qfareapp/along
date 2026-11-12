import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import sharp from "sharp";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { chromium, type Browser, type Page } from "playwright-core";

process.env.NODE_ENV = "test";
process.env.ADMIN_AUTH_MODE = "env";
process.env.ADMIN_EMAIL = "play-operator@example.test";
process.env.ADMIN_PASSWORD = "Play-admin-qa-only123!";
process.env.ADMIN_ORIGIN = "http://localhost:3128";
process.env.TRUST_PROXY_HOPS = "1";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.EMAIL_VERIFICATION_REQUIRED = "false";
process.env.PHOTO_STORAGE = "mongodb";
process.env.CORS_ORIGINS = "http://localhost:18098";
const { createApp } = await import("./app.js");
const { User, ProfilePhoto, Activity } = await import("./models.js");
const { PlanInvitation } = await import("./social-models.js");
const { GameQuestion, GameSession } = await import("./play-models.js");
const { initializePlay } = await import("./play-bank.js");
const { attachPlaySockets } = await import("./play-sockets.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const { ensureMatch } = await import("./chat.js");
const { seedCategories } = await import("./categories.js");
const root = path.resolve("../.."),
  webRoot = path.join(root, "apps/mobile/dist-play-qa"),
  shots = path.join(root, "docs/play-screenshots");
fs.mkdirSync(shots, { recursive: true });
const database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
await mongoose.connect(database.getUri());
await initializePlay();
await seedCategories();
const password = "Play-browser-qa-only123!";
const members = [];
for (const [i, name] of ["QA Alice", "QA Bob"].entries()) {
  const user = await User.create({
    name,
    email: `play-browser-${i}@example.test`,
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
    .resize(300, 400)
    .jpeg()
    .toBuffer();
  await ProfilePhoto.updateMany({ owner: user._id }, { bytes });
}
await ensureMatch(String(members[0]._id), String(members[1]._id));
const apiServer = createApp().listen(4118, "127.0.0.1"),
  sockets = attachPlaySockets(apiServer);
const mime: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".css": "text/css",
  ".json": "application/json",
};
const webServer = http
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
  .listen(18098, "127.0.0.1");
const adminServer = spawn(
  process.execPath,
  [
    "scripts/next-production.mjs",
    "start",
    "--port",
    "3128",
    "--hostname",
    "127.0.0.1",
  ],
  {
    cwd: path.join(root, "apps/admin"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      ALONG_API_URL: "http://127.0.0.1:4118",
    },
    stdio: "ignore",
    windowsHide: true,
  },
);
let browser: Browser | undefined;
const errors: string[] = [];
async function login(page: Page, who: number) {
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://localhost:18098/auth");
  await page
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill(`play-browser-${who}@example.test`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.getByRole("tab", { name: /Social/ }).click();
  await page
    .getByRole("button", { name: "Along Play. Play Together", exact: true })
    .waitFor();
}
async function waitForAdmin() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch("http://127.0.0.1:3128/login")).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Admin server did not start.");
}
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const alice = await browser.newPage({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { "X-Forwarded-For": "198.51.100.101" },
  });
  const bob = await browser.newPage({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { "X-Forwarded-For": "198.51.100.102" },
  });
  await login(alice, 0);
  await login(bob, 1);
  await alice
    .getByRole("button", { name: "Along Play. Play Together", exact: true })
    .click();
  await alice.getByRole("button", { name: /Create Play Invitation/ }).click();
  await bob
    .getByRole("button", { name: "Request to Play", exact: true })
    .click();
  await alice.getByRole("button", { name: "Accept", exact: true }).click();
  await alice
    .getByRole("button", { name: "Ready to play", exact: true })
    .waitFor();
  await bob.getByRole("button", { name: /Continue your game with/ }).click();
  await bob
    .getByRole("button", { name: "Ready to play", exact: true })
    .waitFor();
  await alice.screenshot({
    path: path.join(shots, "01-lobby.png"),
    fullPage: true,
  });
  await alice
    .getByRole("button", { name: "Ready to play", exact: true })
    .click();
  await bob.getByRole("button", { name: "Ready to play", exact: true }).click();
  await alice.getByTestId("play-option-A").waitFor();
  await bob.getByTestId("play-option-B").waitFor();
  assert(
    sockets.io.of("/play").sockets.size >= 2,
    "Both browser clients use game sockets",
  );
  await alice.getByRole("button", { name: /Chat with your match/ }).click();
  await alice
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Ready for a little friendly competition?");
  await alice.getByRole("button", { name: "Send", exact: true }).click();
  await bob.getByRole("button", { name: /Chat with your match/ }).click();
  await bob
    .getByText("Ready for a little friendly competition?", { exact: true })
    .waitFor();
  await alice.getByRole("button", { name: /Close game chat/ }).click();
  await bob.getByRole("button", { name: /Close game chat/ }).click();
  await alice.screenshot({
    path: path.join(shots, "02-question.png"),
    fullPage: true,
  });
  for (let i = 0; i < 15; i++) {
    await alice.getByText(new RegExp(`^Question ${i + 1} of 15`)).waitFor();
    await bob.getByText(new RegExp(`^Question ${i + 1} of 15`)).waitFor();
    await alice.getByTestId("play-option-A").click();
    await bob.getByTestId(i === 0 ? "play-option-B" : "play-option-A").click();
  }
  await alice.getByText("93%", { exact: true }).waitFor();
  await bob.getByText("93%", { exact: true }).waitFor();
  await alice.screenshot({
    path: path.join(shots, "03-results.png"),
    fullPage: true,
  });
  const completed = await GameSession.findOne({ status: "completed" }).select(
    "+answers",
  );
  assert.equal(completed!.answers.length, 30);
  assert.equal(completed!.result!.score, 93);
  await alice.getByRole("button", { name: /Make a Plan Together/ }).click();
  await alice
    .getByRole("textbox", { name: "Meeting place", exact: true })
    .fill("A public cafe near the park");
  await alice
    .getByRole("button", { name: "Send private plan invitation", exact: true })
    .click();
  await alice.getByText("Private plans", { exact: true }).waitFor();
  assert.equal(await Activity.countDocuments(), 0);
  const plan = await PlanInvitation.findOne({});
  assert(plan);
  assert.equal(plan.status, "pending");
  assert.equal(String(plan.gameSession), String(completed!._id));
  await bob
    .getByRole("button", { name: "Back to Social", exact: true })
    .click();
  await bob
    .getByRole("button", { name: /1 plan invitation waiting for you/ })
    .last()
    .click();
  await bob.getByRole("button", { name: "Accept Plan", exact: true }).click();
  for (
    let i = 0;
    i < 30 && !(await Activity.exists({ visibility: "private" }));
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await Activity.countDocuments({ visibility: "private" }), 1);
  await waitForAdmin();
  const operator = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: { "X-Forwarded-For": "198.51.100.103" },
  });
  operator.on("pageerror", (e) => errors.push(e.message));
  await operator.goto("http://localhost:3128/login");
  await operator
    .getByLabel("Work email", { exact: true })
    .fill(process.env.ADMIN_EMAIL!);
  await operator
    .getByLabel("Password", { exact: true })
    .fill(process.env.ADMIN_PASSWORD!);
  await operator
    .getByRole("button", { name: "Sign in to Along", exact: true })
    .click();
  await operator.getByRole("link", { name: "Along Play", exact: true }).click();
  await operator
    .getByRole("button", { name: "Add question", exact: true })
    .click();
  await operator
    .getByRole("textbox", { name: "Question", exact: true })
    .fill("A new friendly browser-tested question?");
  await operator
    .getByRole("textbox", { name: "Option A", exact: true })
    .fill("Coffee together");
  await operator
    .getByRole("textbox", { name: "Option B", exact: true })
    .fill("A quiet walk");
  await operator
    .getByRole("textbox", { name: "Reason", exact: true })
    .fill("Verify question editing in the real admin screen");
  await operator
    .getByRole("button", { name: "Save question", exact: true })
    .click();
  await operator
    .getByRole("heading", {
      name: "A new friendly browser-tested question?",
      exact: true,
    })
    .waitFor();
  assert(
    await GameQuestion.exists({
      text: "A new friendly browser-tested question?",
    }),
  );
  await operator.screenshot({
    path: path.join(shots, "04-admin-bank.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Along Play browser QA passed: two accounts, invitation, live game, chat, 15 questions, shared 93% result, private plan acceptance and admin question creation.",
  );
} catch (error) {
  if (browser)
    for (const [index, context] of browser.contexts().entries())
      for (const page of context.pages())
        await page
          .screenshot({
            path: path.join(shots, `failure-${index}.png`),
            fullPage: true,
          })
          .catch(() => {});
  console.error("Browser errors:", errors);
  throw error;
} finally {
  await browser?.close();
  if (process.platform === "win32" && adminServer.pid)
    spawnSync("taskkill", ["/PID", String(adminServer.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  else adminServer.kill();
  await sockets.close();
  await new Promise<void>((resolve) => webServer.close(() => resolve()));
  await mongoose.disconnect();
  await database.stop();
}
