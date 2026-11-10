import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "./app.js";
import { isAdult, activityInput, registration } from "./validation.js";
import { activitySchema, profileSchema, userSchema } from "./models.js";

test("health works independently of MongoDB; database routes fail closed", async () => {
  const app = createApp();
  const health = await request(app).get("/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.service, "along-api");
  assert.equal((await request(app).get("/ready")).status, 503);
  const activities = await request(app).get("/api/v1/activities");
  assert.equal(activities.status, 503);
  assert.equal(activities.body.error.code, "DATABASE_UNAVAILABLE");
});
test("HTTP security headers and consistent unknown-route errors", async () => {
  const res = await request(createApp()).get("/missing");
  assert.equal(res.status, 404);
  assert.ok(res.headers["x-content-type-options"]);
  assert.equal(res.headers["x-powered-by"], undefined);
  assert.equal(res.body.error.code, "NOT_FOUND");
});
test("adult gate handles birthday boundaries and impossible dates", () => {
  const now = new Date("2026-10-25T12:00:00Z");
  assert.equal(isAdult("2008-10-25", now), true);
  assert.equal(isAdult("2008-10-26", now), false);
  assert.equal(isAdult("2000-02-30", now), false);
  assert.equal(isAdult("2030-01-01", now), false);
});
test("registration validates passwords and rejects underage profiles", () => {
  assert.equal(
    registration.safeParse({
      email: "x@example.com",
      password: "weak",
      name: "Adult",
      birthDate: "2000-01-01",
    }).success,
    false,
  );
  assert.equal(
    registration.safeParse({
      email: "x@example.com",
      password: "valid-password-123",
      name: "Teen",
      birthDate: "2020-01-01",
    }).success,
    false,
  );
});
test("activity validation rejects past dates and strips ownership injection", () => {
  const base = {
    type: "together",
    category: "food",
    title: "Coffee after work",
    description: "Meet at a public cafe after work.",
    zone: "Park Street",
    startsAt: "2099-01-01T12:00:00Z",
    creator: "attacker",
  };
  const parsed = activityInput.parse(base);
  assert.equal("creator" in parsed, false);
  assert.equal(
    activityInput.safeParse({ ...base, startsAt: "2000-01-01T12:00:00Z" })
      .success,
    false,
  );
});
test("sensitive fields are excluded and location/discovery indexes exist", () => {
  assert.equal(userSchema.path("passwordHash").options.select, false);
  assert.equal(userSchema.path("birthDate").options.select, false);
  assert.ok(
    profileSchema
      .indexes()
      .some(([keys]) => keys.approximateLocation === "2dsphere"),
  );
  assert.ok(
    activitySchema
      .indexes()
      .some(([keys]) => keys.status === 1 && keys.category === 1),
  );
});
