import { chromium } from "playwright-core";
import fs from "node:fs";
import assert from "node:assert/strict";
const baseURL = process.env.ALONG_MOBILE_QA_URL ?? "http://localhost:8081";
fs.mkdirSync("docs/screenshots", { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto(baseURL);
await page
  .getByRole("button", { name: "Explore the preview", exact: true })
  .waitFor();
await page.screenshot({ path: "docs/screenshots/01-welcome.png" });
await page
  .getByRole("button", { name: "Explore the preview", exact: true })
  .click();
await page.getByRole("button", { name: "Coffee dates", exact: true }).click();
await page.screenshot({ path: "docs/screenshots/02-onboarding.png" });
await page.getByRole("button", { name: "Continue", exact: true }).click();
await page
  .getByRole("button", { name: "Let's do something", exact: true })
  .click();
await page.getByRole("button", { name: "Continue", exact: true }).click();
await page
  .getByRole("button", { name: "Open to something meaningful", exact: true })
  .click();
await page.getByRole("button", { name: "Continue", exact: true }).click();
await page.getByRole("button", { name: "Kolkata", exact: true }).click();
await page.getByRole("button", { name: "Continue", exact: true }).click();
await page.getByRole("button", { name: "Skip for Now", exact: true }).click();
await page.getByRole("button", { name: "Explore Along", exact: true }).click();
await page.getByRole("button", { name: "Like Ananya", exact: true }).waitFor();
await page.screenshot({ path: "docs/screenshots/03-discover.png" });
await page.getByRole("button", { name: "Like Ananya", exact: true }).click();
await page
  .getByRole("button", { name: "Send a Message", exact: true })
  .waitFor();
await page.screenshot({ path: "docs/screenshots/04-match.png" });
await page.getByRole("button", { name: "Send a Message", exact: true }).click();
await page
  .getByRole("textbox", { name: "Message", exact: true })
  .fill("Looking forward to coffee!");
await page.getByRole("button", { name: "Send message", exact: true }).click();
await page.getByText("Looking forward to coffee!", { exact: true }).waitFor();
await page.screenshot({ path: "docs/screenshots/05-chat.png" });
await page.goto(`${baseURL}/plans`);
await page
  .getByRole("button", { name: "View Office Carpool", exact: true })
  .waitFor();
await page.screenshot({ path: "docs/screenshots/06-plans.png" });
await page
  .getByRole("textbox", { name: "Search plans", exact: true })
  .fill("Coffee");
await page
  .getByRole("button", { name: "View Coffee After Work", exact: true })
  .waitFor();
assert.equal(
  await page
    .getByRole("button", { name: "View Office Carpool", exact: true })
    .count(),
  0,
);
await page
  .getByRole("button", { name: "View Coffee After Work", exact: true })
  .click();
await page.getByRole("button", { name: "I’m Interested", exact: true }).click();
await page
  .getByRole("button", { name: "Interest Sent ✓", exact: true })
  .waitFor();
await page.screenshot({ path: "docs/screenshots/07-activity.png" });
await page.goto(`${baseURL}/create`);
await page
  .getByRole("textbox", { name: "What’s the plan?", exact: true })
  .fill("Saturday photography walk");
await page
  .getByRole("textbox", { name: "What are you looking for?", exact: true })
  .fill("Let’s explore the city and take photos together in a public park.");
await page
  .getByRole("button", { name: "Category: Commute", exact: true })
  .click();
await page
  .getByRole("button", { name: "Category: Commute", exact: true })
  .click();
await page.getByRole("button", { name: "Next", exact: true }).click();
await page
  .getByRole("textbox", { name: "Approximate area", exact: true })
  .fill("Victoria Memorial");
await page
  .getByRole("button", { name: "Publish Preview Plan", exact: true })
  .click();
await page.getByText("Saturday photography walk", { exact: true }).waitFor();
await page.reload();
await page.getByText("Saturday photography walk", { exact: true }).waitFor();
await page.goto(`${baseURL}/profile`);
await page.getByText("You", { exact: true }).waitFor();
await page.screenshot({ path: "docs/screenshots/08-profile.png" });
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${baseURL}/plans`);
await page
  .getByRole("button", { name: "View Office Carpool", exact: true })
  .waitFor();
await page.screenshot({ path: "docs/screenshots/09-desktop.png" });
assert.deepEqual(errors, []);
console.log(
  "PASS: onboarding, discovery, match, chat send, search, interest, plan creation, persistence, profile and responsive viewport. No page errors.",
);
await browser.close();
