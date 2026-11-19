// Loopback-only UI checks. Airport locations, people and requests are fictional fixtures.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright-core";
const origin = "http://localhost:18100",
  apiOrigin = "http://127.0.0.1:4118";
const airportId = "a".repeat(24),
  travellerId = "b".repeat(24),
  chatId = "c".repeat(24);
const airport = {
  id: airportId,
  name: "QA Airport",
  city: "Test city",
  iataCode: "QA1",
  zones: [{ id: "public", name: "QA public zone", compatibleWith: ["public"] }],
  approximate: true,
};
const photo = fs.readFileSync("apps/mobile/assets/brand/ananya-photo.png");
fs.mkdirSync("docs/airport-screenshots", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
try {
  for (const width of [390, 820]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      permissions: ["geolocation"],
      geolocation: { latitude: 22.65, longitude: 88.45 },
      reducedMotion: width === 390 ? "no-preference" : "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    let active = false,
      invited = false,
      kept = false,
      nearbyEnabled = false;
    await page.route("**/api/v1/**", async (route) => {
      const url = new URL(route.request().url());
      assert.equal(
        url.origin,
        apiOrigin,
        "UI QA may only access the loopback API",
      );
      const path = url.pathname.replace("/api/v1", "");
      const data = (value) => route.fulfill({ json: { data: value } });
      if (path === "/airports/nearby")
        return data(nearbyEnabled ? [airport] : []);
      if (path === "/airports/notices") return data([]);
      if (path === "/airports/check-in") {
        const body = route.request().postDataJSON();
        assert.equal(body.consent, true);
        assert.equal(body.zoneId, "public");
        active = true;
        return data({ visitId: "qa-visit" });
      }
      if (path === "/airports/check-out") {
        active = false;
        return route.fulfill({ status: 204 });
      }
      if (path === "/airports/presence") return data({ active });
      if (path === "/airports/me")
        return data({
          active,
          airport,
          session: active
            ? {
                visitId: "qa-visit",
                zoneId: "public",
                intentions: ["conversation"],
                availableUntil: new Date(Date.now() + 3600000).toISOString(),
              }
            : null,
        });
      if (path === "/airports/discover")
        return data({
          items: invited
            ? []
            : [
                {
                  id: travellerId,
                  name: "QA Traveller",
                  age: 28,
                  occupation: "Designer",
                  city: "Test city",
                  identityVerified: false,
                  bio: "A fictional airport visitor for interface testing.",
                  vibes: ["coffee_dates"],
                  photoIds: ["airport-qa-photo"],
                  zone: "QA public zone",
                  intentions: ["conversation"],
                  availableMinutes: 60,
                  availableUntil: new Date(Date.now() + 3600000).toISOString(),
                  canMeet: true,
                  canDate: false,
                },
              ],
          nextCursor: null,
        });
      if (
        path === "/airports/connections" &&
        route.request().method() === "POST"
      ) {
        invited = true;
        return data({});
      }
      if (path === "/airports/connections")
        return data(
          invited
            ? [
                {
                  id: "d".repeat(24),
                  name: "QA Traveller",
                  intent: "conversation",
                  state: "connected",
                  incoming: false,
                  needsDecision: !active,
                  kept,
                  conversationId: chatId,
                },
              ]
            : [],
        );
      if (path.endsWith("/decision") && path.startsWith("/airports/")) {
        assert.equal(route.request().postDataJSON().action, "keep");
        kept = true;
        return data({ conversationId: chatId });
      }
      if (path === "/profile/photos/airport-qa-photo")
        return route.fulfill({ contentType: "image/png", body: photo });
      if (path.startsWith("/airports/"))
        throw new Error(`Unmocked airport path: ${path}`);
      const response = await route.fetch();
      return route.fulfill({
        response,
        headers: {
          ...response.headers(),
          "access-control-allow-origin": origin,
          "access-control-allow-credentials": "true",
        },
      });
    });
    await page.goto(`${origin}/auth`, { timeout: 120000 });
    await page
      .getByRole("textbox", { name: "Email address", exact: true })
      .fill("play-bob@example.test");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page
      .getByLabel("Password", { exact: true })
      .fill("Along-play-local-2026");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await page.getByRole("tab", { name: /Discover/ }).click();
    const flight = page.getByRole("button", {
      name: "Airport Mode",
      exact: true,
    });
    await flight.waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Open Airport Mode setup", exact: true })
        .count(),
      0,
      "Airport card should be hidden until tapped",
    );
    assert.equal(
      await page.getByTestId("airport-nearby-colour").count(),
      0,
      "Flight icon stays neutral away from airports",
    );
    const flightBounds = await flight.boundingBox(),
      vibeBounds = await page
        .getByRole("button", { name: "My Vibe Check", exact: true })
        .boundingBox();
    assert.ok(
      flightBounds &&
        vibeBounds &&
        flightBounds.x + flightBounds.width <= vibeBounds.x + 1,
      "Flight icon must be directly left of Vibe Check",
    );
    await page.screenshot({
      path: `docs/airport-screenshots/flight-header-neutral-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Airport Mode", exact: true })
      .click();
    await page.getByTestId("airport-floating-card").waitFor();
    assert.equal(
      new URL(page.url()).pathname.endsWith("/airport"),
      false,
      "Flight icon opens a card before navigation",
    );
    await page
      .getByRole("button", { name: "Close airport card", exact: true })
      .click();
    await flight.click();
    await page.getByTestId("airport-floating-card").waitFor();
    await page.waitForTimeout(350);
    await page.screenshot({
      path: `docs/airport-screenshots/flight-floating-card-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Open Airport Mode setup", exact: true })
      .click();
    nearbyEnabled = true;
    await page
      .getByRole("button", { name: "Detect my airport", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Test city · QA1", exact: true })
      .click();
    await page.getByText("QA public zone", { exact: true }).click();
    await page.getByRole("checkbox").click();
    await page
      .getByRole("button", { name: "Turn on Airport Mode", exact: true })
      .click();
    await page
      .getByText("People at your airport", { exact: true })
      .last()
      .waitFor();
    await page
      .getByRole("button", { name: "Like QA Traveller", exact: true })
      .waitFor();
    await page.screenshot({
      path: `docs/airport-screenshots/airport-mode-${width}.png`,
      fullPage: true,
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    assert.equal(overflow, false, "Airport Mode should fit the viewport");
    await page
      .getByRole("button", { name: "Like QA Traveller", exact: true })
      .click();
    await page.getByText(/Connection request sent to QA Traveller/).waitFor();
    await page
      .getByRole("button", { name: "Leave Airport Mode", exact: true })
      .click();
    await page.getByText("Stay connected?", { exact: true }).waitFor();
    await page.screenshot({
      path: `docs/airport-screenshots/stay-connected-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Stay connected", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Airport Mode", exact: true })
      .waitFor();
    await page.getByTestId("airport-nearby-colour").waitFor();
    const glyph = page.getByTestId("airport-flight-glyph");
    const firstTransform = await glyph.evaluate(
      (el) => getComputedStyle(el).transform,
    );
    await page.waitForTimeout(400);
    const nextTransform = await glyph.evaluate(
      (el) => getComputedStyle(el).transform,
    );
    if (width === 390)
      assert.notEqual(
        firstTransform,
        nextTransform,
        "Nearby flight icon should animate",
      );
    else
      assert.equal(
        firstTransform,
        nextTransform,
        "Reduced motion should keep the icon still",
      );
    await page.screenshot({
      path: `docs/airport-screenshots/flight-header-nearby-${width}.png`,
      fullPage: true,
    });
    assert.equal(kept, true);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Airport UI passed on phone and tablet: header icon order, neutral/colourful states, floating card, outside dismissal, activation, nearby animation/reduced motion, traveller cards, checkout and stay connected; no overflow or runtime errors.",
  );
} finally {
  await browser.close();
}
