/** Runs only against the isolated dev:groups loopback fixture. No builds or live accounts. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
const origin = "http://localhost:18098";
const base = "http://127.0.0.1:4118/api/v1";
const shots = path.resolve("../../docs/vibe-check-screenshots");
fs.mkdirSync(shots, { recursive: true });
async function fixtureLogin(email: string) {
  assert(email.endsWith("@example.test"));
  const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Along-play-local-2026" }) });
  assert.equal(response.status, 200, "Start npm run dev:groups first.");
  return (await response.json()).data as { accessToken: string; user: { id: string } };
}
async function api(token: string, route: string, body?: object, method = body ? "POST" : "GET") {
  const response = await fetch(`${base}${route}`, { method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  assert(response.ok, `${route}: HTTP ${response.status}`);
  return (await response.json()).data;
}
const ownerAccount = await fixtureLogin("play-alice@example.test");
const visitorAccount = await fixtureLogin("group-traveller-20@example.test");
const ownerId = ownerAccount.user.id;
const before = await api(ownerAccount.accessToken, "/vibe-checks/mine");
if (before.settings.revision) await api(ownerAccount.accessToken, "/vibe-checks/mine", {
  revision: before.settings.revision, enabled: false, autoMatch: false, threshold: 60, questions: [],
}, "PUT");
// Put Alice at the front of this fictional visitor's deck without changing other fixtures.
const deck = await api(visitorAccount.accessToken, "/discovery?limit=30");
for (const member of deck) if (member.id !== ownerId)
  await api(visitorAccount.accessToken, `/discovery/${member.id}/action`, { action: "pass" });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
async function login(page: Page, email: string) {
  page.setDefaultTimeout(45000);
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${origin}/auth`, { timeout: 120000 });
  await page.getByRole("textbox", { name: "Email address", exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill("Along-play-local-2026");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.getByRole("tab", { name: /Discover/ }).click();
}
try {
  const owner = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const visitor = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await login(owner, "play-alice@example.test");
  await owner.getByRole("button", { name: "My Vibe Check", exact: true }).click();
  await owner.getByRole("switch", { name: "Enable my Vibe Check", exact: true }).click();
  await owner.getByRole("switch", { name: "Automatically match with people who pass", exact: true }).click();
  const slider = owner.getByRole("slider", { name: "Vibe match threshold", exact: true });
  await slider.scrollIntoViewIfNeeded();
  const track = await slider.boundingBox();
  assert(track);
  // The web slider has a 20px thumb and uses pointer gestures.
  await slider.click({ position: { x: 10 + (track.width - 20) * 0.7, y: track.height / 2 } });
  await owner.getByText("Match threshold: 70%", { exact: true }).waitFor();
  const prompts = ["Your ideal weekend?", "Coffee or chai?", "Mountains or beaches?", "Your social energy?", "Plans or spontaneity?"];
  const choices = ["Cozy indoors", "Coffee", "Mountains", "Introvert", "Plan ahead"];
  for (let i = 0; i < prompts.length; i++) {
    await owner.getByRole("button", { name: `Add · ${prompts[i]}`, exact: true }).click();
    await owner.getByRole("radio", { name: choices[i], exact: true }).click();
  }
  await owner.getByRole("textbox", { name: "Your question", exact: true }).fill("How shall we spend Sunday?");
  await owner.getByRole("textbox", { name: "Custom option 1", exact: true }).fill("Board games");
  await owner.getByRole("textbox", { name: "Custom option 2", exact: true }).fill("A long walk");
  await owner.getByRole("radio", { name: "Board games", exact: true }).click();
  await owner.getByRole("button", { name: "Add custom question", exact: true }).click();
  await owner.getByRole("button", { name: "Save Vibe Check", exact: true }).click();
  await owner.getByText("Your Vibe Check is saved.", { exact: true }).waitFor();
  const mine = await api(ownerAccount.accessToken, "/vibe-checks/mine");
  assert.equal(mine.settings.questions.length, 6);
  assert.equal(mine.settings.threshold, 70);
  assert.equal(mine.settings.autoMatch, true);
  await owner.getByText("Make it yours", { exact: true }).scrollIntoViewIfNeeded();
  await owner.screenshot({ path: path.join(shots, "01-setup.png") });

  await login(visitor, "group-traveller-20@example.test");
  await visitor.getByRole("button", { name: "Vibe Check · 6 questions", exact: true }).waitFor();
  await visitor.screenshot({ path: path.join(shots, "02-discover.png") });
  await visitor.getByRole("button", { name: "Vibe Check · 6 questions", exact: true }).click();
  const check = await api(visitorAccount.accessToken, `/vibe-checks/profiles/${ownerId}`);
  assert(check.questions.every((q: object) => !("answer" in q)));
  for (const choice of [...choices, "A long walk"])
    await visitor.getByRole("radio", { name: choice, exact: true }).click();
  await visitor.getByRole("button", { name: "Submit Vibe Check", exact: true }).click();
  await visitor.getByText("83.3% shared choices", { exact: true }).waitFor();
  await visitor.getByRole("button", { name: "Keep Exploring", exact: true }).click();
  await visitor.getByRole("button", { name: "Open chat", exact: true }).waitFor();
  await visitor.screenshot({ path: path.join(shots, "03-result.png") });
  await visitor.getByRole("button", { name: "Open chat", exact: true }).click();
  await visitor.getByText(/Vibe Check: 5\/6 shared choices/).waitFor();
  await visitor.screenshot({ path: path.join(shots, "04-chat.png") });
  await owner.getByRole("button", { name: "Results & requests", exact: true }).click();
  await owner.getByRole("button", { name: "Refresh results", exact: true }).click();
  await owner.getByText("5/6 shared choices", { exact: true }).waitFor();
  await owner.getByText("Matched", { exact: true }).waitFor();
  await owner.screenshot({ path: path.join(shots, "05-owner-notification.png") });
  const after = await api(visitorAccount.accessToken, "/discovery?limit=30");
  assert(!after.some((m: { id: string }) => m.id === ownerId));
  assert.deepEqual(errors, []);
  console.log("Vibe Check browser QA passed: real setup, custom options, 70% slider, Discover entry, hidden answers, 83.3% auto-match, chat and owner notification.");
} finally { await browser.close(); }
