/** Run npm run dev:play first. Uses Metro development mode; never builds an app. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
const origin = "http://localhost:18098";
const shots = path.resolve("../../docs/play-screenshots");
fs.mkdirSync(shots, { recursive: true });
for (const url of [origin, "http://127.0.0.1:4118/ready"]) {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(ready, "Start npm run dev:play before running browser QA.");
}
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
async function login(page: Page, who: string) {
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
    .fill(`play-${who}@example.test`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Password", { exact: true })
    .fill("Along-play-local-2026");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.getByRole("tab", { name: /Chat/ }).click();
  await page.getByRole("button", { name: /Start chatting with/ }).click();
  await page
    .getByRole("button", { name: "Open This or That", exact: true })
    .waitFor();
  // The game stays hidden until the Play button opens it.
  assert.equal(await page.getByTestId("chat-play-start").count(), 0);
}
try {
  const a = await browser.newContext({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { "X-Forwarded-For": "198.51.100.111" },
  });
  const b = await browser.newContext({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { "X-Forwarded-For": "198.51.100.112" },
  });
  const alice = await a.newPage(),
    bob = await b.newPage();
  alice.setDefaultTimeout(45000);
  bob.setDefaultTimeout(45000);
  await login(alice, "alice");
  await login(bob, "bob");
  await alice
    .getByRole("button", { name: "Open This or That", exact: true })
    .click();
  await b.setOffline(true); // invitation sent while the recipient is offline
  await alice
    .getByRole("button", { name: "Send play invitation", exact: true })
    .click();
  await alice.getByText(/Invitation sent to QA Bob/).waitFor();
  await b.setOffline(false);
  // Bob never taps Play: the incoming invitation opens the panel for him.
  await bob.getByTestId("chat-play-invitation").waitFor();
  await bob.getByRole("button", { name: "Reject game", exact: true }).click();
  await alice
    .getByText("I declined this game invitation. We can keep chatting!", {
      exact: true,
    })
    .waitFor();
  await alice
    .getByRole("button", { name: "Send play invitation", exact: true })
    .click();
  await bob.getByRole("button", { name: "Accept game", exact: true }).click();
  await alice.getByTestId("play-option-A").waitFor();
  await bob.getByTestId("play-option-B").waitFor();
  assert.equal(
    await alice.getByText("Ready to play", { exact: true }).count(),
    0,
  );
  await alice.screenshot({
    path: path.join(shots, "01-chat-question.png"),
    fullPage: true,
  });
  // Bob closes the game; Alice's answer should bring it back on its own.
  await bob
    .getByRole("button", { name: "Close This or That", exact: true })
    .first()
    .click();
  await bob.getByTestId("chat-play-game").waitFor({ state: "detached" });
  await b.setOffline(true);
  await alice.getByTestId("play-option-A").click();
  await alice.getByText(/Your choice is saved/).waitFor();
  await b.setOffline(false);
  await bob.getByText(/QA Alice has answered/).waitFor();
  await bob.getByTestId("play-option-B").click();
  await alice.getByText("Question 2 of 15", { exact: true }).waitFor();
  await alice
    .getByTestId("chat-play-round-result")
    .getByText(/Different choices/)
    .waitFor();
  await bob.getByText("Question 2 of 15", { exact: true }).waitFor();
  await alice.screenshot({
    path: path.join(shots, "02-chat-reveal.png"),
    fullPage: true,
  });
  for (let index = 1; index < 15; index++) {
    await alice
      .getByText(`Question ${index + 1} of 15`, { exact: true })
      .waitFor();
    await bob
      .getByText(`Question ${index + 1} of 15`, { exact: true })
      .waitFor();
    await alice.getByTestId("play-option-A").click();
    await bob.getByTestId("play-option-A").click();
    if ((index + 1) % 5 === 0) console.log(`Submitted round ${index + 1}/15`);
  }
  await alice
    .getByTestId("chat-play-score")
    .getByText("93%", { exact: true })
    .waitFor();
  await bob
    .getByTestId("chat-play-score")
    .getByText("93%", { exact: true })
    .waitFor();
  assert(alice.url().includes("/conversation"));
  assert(bob.url().includes("/conversation"));
  await alice
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("That was fun!");
  await alice.getByRole("button", { name: "Send message", exact: true }).click();
  await bob.getByText("That was fun!", { exact: true }).waitFor();
  await alice.screenshot({
    path: path.join(shots, "03-chat-score.png"),
    fullPage: true,
  });
  await alice.getByRole("button", { name: "Go back", exact: true }).click();
  await alice.getByRole("tab", { name: /Social/ }).click();
  assert.equal(
    await alice
      .getByRole("button", { name: /Along Play|Play Together/ })
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: direct chat invite, offline delivery, rejection, acceptance without ready checks, offline turns, round reveals, 93% final score, normal chat, and no Social entry.",
  );
} catch (error) {
  for (const [i, context] of browser.contexts().entries()) {
    const page = context.pages()[0];
    if (page) {
      await page
        .screenshot({
          path: path.join(shots, `failed-${i}.png`),
          fullPage: true,
        })
        .catch(() => {});
      console.log(
        `Browser ${i}: ${(await page.locator("body").innerText()).slice(-2000)}`,
      );
    }
  }
  throw error;
} finally {
  await browser.close();
}
