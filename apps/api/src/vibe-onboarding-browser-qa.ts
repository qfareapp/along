/** Checks optional post-activation navigation using only the isolated loopback fixture.
 * Completion is intercepted until activation to model the just-completed profile UI;
 * the real fixture API still handles login, activation, Vibe Check reads and saves.
 */
import assert from "node:assert/strict";
import { chromium, type Page } from "playwright-core";
const origin = "http://localhost:18098";
const base = "http://127.0.0.1:4118/api/v1";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
async function newProfilePrompt(page: Page, email: string) {
  assert(email.startsWith("group-traveller-") && email.endsWith("@example.test"));
  page.setDefaultTimeout(45000);
  page.on("pageerror", error => errors.push(error.message));
  let activated = false;
  page.on("response", response => {
    if (response.url() === `${base}/profile/activate-discovery` && response.ok()) activated = true;
  });
  await page.route(`${base}/profile/completion`, async route => {
    const response = await route.fetch();
    const body = await response.json();
    if (!activated && body.data) body.data.activated = false;
    await route.fulfill({ response, json: body });
  });
  await page.goto(`${origin}/auth`, { timeout: 120000 });
  await page.getByRole("textbox", { name: "Email address", exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill("Along-play-local-2026");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.getByRole("button", { name: "Complete Profile to Connect", exact: true }).click();
  await page.getByRole("button", { name: "Activate Discovery", exact: true }).click();
  await page.getByText("Set up your Vibe Check?", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Do it now", exact: true }).waitFor();
  await page.getByRole("button", { name: "Later", exact: true }).waitFor();
}
async function assertInApp(page: Page) {
  await page.getByRole("button", { name: "My Vibe Check", exact: true }).waitFor();
  await page.getByRole("tab", { name: /Profile/ }).click();
  await page.getByRole("button", { name: "Set up Vibe Check", exact: true }).click();
  await page.getByText("Make it yours", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Later", exact: true }).count(), 0);
}
try {
  const later = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await newProfilePrompt(later, "group-traveller-18@example.test");
  await later.getByRole("button", { name: "Later", exact: true }).click();
  await assertInApp(later);

  const now = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await newProfilePrompt(now, "group-traveller-17@example.test");
  await now.getByRole("button", { name: "Do it now", exact: true }).click();
  await now.getByText("Make it yours", { exact: true }).waitFor();
  await now.getByRole("button", { name: "Later", exact: true }).waitFor();
  await now.getByRole("switch", { name: "Enable my Vibe Check", exact: true }).click();
  await now.getByRole("button", { name: "Add · Coffee or chai?", exact: true }).click();
  await now.getByRole("radio", { name: "Chai", exact: true }).click();
  await now.getByRole("button", { name: "Save Vibe Check", exact: true }).click();
  await assertInApp(now);
  await now.getByRole("button", { name: "Selected · Coffee or chai?", exact: true }).waitFor();

  const deferred = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await newProfilePrompt(deferred, "group-traveller-16@example.test");
  await deferred.getByRole("button", { name: "Do it now", exact: true }).click();
  await deferred.getByText("Make it yours", { exact: true }).waitFor();
  await deferred.getByRole("button", { name: "Later", exact: true }).click();
  await assertInApp(deferred);
  assert.deepEqual(errors, []);
  console.log("Vibe onboarding browser QA passed: prompt after activation, Later, setup now and save, deferring from setup, and persistent Profile entry.");
} finally { await browser.close(); }
