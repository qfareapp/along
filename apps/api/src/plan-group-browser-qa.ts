/** Uses the running npm run dev:groups Metro preview; never builds an APK or web export. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
const origin = "http://localhost:18098";
const shots = path.resolve("../../docs/plan-group-screenshots");
fs.mkdirSync(shots, { recursive: true });
for (const url of [origin, "http://127.0.0.1:4118/ready"]) {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(ready, "Start npm run dev:groups before running this check.");
}
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
async function login(page: Page, account: string) {
  page.setDefaultTimeout(45000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().includes("4118"))
      console.log(
        `API ${response.status()}: ${new URL(response.url()).pathname}`,
      );
  });
  await page.goto(`${origin}/auth`);
  await page
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill(account);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Password", { exact: true })
    .fill("Along-play-local-2026");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.getByRole("tab", { name: /Plans/ }).waitFor();
}
try {
  const organiser = await browser.newPage({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { "X-Forwarded-For": "198.51.100.121" },
  });
  const attendee = await browser.newPage({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { "X-Forwarded-For": "198.51.100.122" },
  });
  const pending = await browser.newPage({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { "X-Forwarded-For": "198.51.100.123" },
  });
  await login(organiser, "play-alice@example.test");
  await organiser.getByRole("tab", { name: /Plans/ }).click();
  await organiser
    .getByRole("button", { name: /Explore Travel & Holidays/ })
    .click();
  await organiser
    .getByRole("button", {
      name: "View Weekend mountain trip by QA Alice",
      exact: true,
    })
    .click();
  await organiser
    .getByRole("button", { name: "Create group chat", exact: true })
    .waitFor();
  await organiser.getByText(/^10 selected attendees\./).waitFor();
  await organiser.screenshot({
    path: path.join(shots, "01-create-group.png"),
    fullPage: true,
  });
  await organiser
    .getByRole("button", { name: "Create group chat", exact: true })
    .click();
  await organiser
    .getByRole("textbox", { name: "Group message", exact: true })
    .waitFor();
  await organiser.getByText(/11 members/).waitFor();
  await login(attendee, "play-bob@example.test");
  await attendee.getByRole("tab", { name: /Chat/ }).click();
  await attendee
    .getByRole("button", { name: /^Group chat: Weekend mountain trip/ })
    .click();
  await attendee
    .getByRole("textbox", { name: "Group message", exact: true })
    .fill("Hello everyone, excited for the trip!");
  await attendee
    .getByRole("button", { name: "Send group message", exact: true })
    .click();
  await organiser
    .getByText("Hello everyone, excited for the trip!", { exact: true })
    .waitFor();
  await organiser.getByText("QA Bob", { exact: true }).waitFor();
  await organiser.screenshot({
    path: path.join(shots, "02-everyone-chat.png"),
    fullPage: true,
  });
  await organiser
    .getByRole("button", { name: "Group members and settings", exact: true })
    .click();
  await organiser.getByText("Organiser · Admin", { exact: true }).waitFor();
  await organiser
    .getByRole("button", { name: "Only organiser can message", exact: true })
    .click();
  await attendee
    .getByText(
      "Only the organiser can send messages. You can read updates here.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await attendee
      .getByRole("textbox", { name: "Group message", exact: true })
      .count(),
    0,
  );
  await organiser
    .getByRole("textbox", { name: "Group message", exact: true })
    .fill("Meet at the station at 6 AM. Please arrive early.");
  await organiser
    .getByRole("button", { name: "Send group message", exact: true })
    .click();
  await attendee
    .getByText("Meet at the station at 6 AM. Please arrive early.", {
      exact: true,
    })
    .waitFor();
  await attendee.screenshot({
    path: path.join(shots, "03-announcements.png"),
    fullPage: true,
  });
  await attendee
    .getByRole("button", { name: "Group members and settings", exact: true })
    .click();
  await attendee.getByText("Organiser · Admin", { exact: true }).waitFor();
  assert.equal(
    await attendee
      .getByRole("button", { name: "Everyone can message", exact: true })
      .count(),
    0,
  );
  await organiser
    .getByRole("button", { name: "Everyone can message", exact: true })
    .click();
  await attendee
    .getByRole("textbox", { name: "Group message", exact: true })
    .waitFor();
  await attendee
    .getByRole("textbox", { name: "Group message", exact: true })
    .fill("Thanks, I will be there!");
  await attendee
    .getByRole("button", { name: "Send group message", exact: true })
    .click();
  await organiser
    .getByText("Thanks, I will be there!", { exact: true })
    .waitFor();
  await login(pending, "group-traveller-20@example.test");
  await pending.getByRole("tab", { name: /Chat/ }).click();
  assert.equal(
    await pending
      .getByRole("button", { name: /^Group chat: Weekend mountain trip/ })
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: organiser creates 11-member chat from 10 selected attendees, attendee messages, organiser-only mode, announcements, member roster, restoring everyone mode, and pending-applicant privacy.",
  );
} catch (error) {
  for (const [index, context] of browser.contexts().entries()) {
    const page = context.pages()[0];
    if (page) {
      await page
        .screenshot({
          path: path.join(shots, `failed-${index}.png`),
          fullPage: true,
        })
        .catch(() => {});
      console.log(
        `Browser ${index}: ${(await page.locator("body").innerText()).slice(-2200)}`,
      );
    }
  }
  throw error;
} finally {
  await browser.close();
}
