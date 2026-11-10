import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
process.env.ADMIN_AUTH_MODE = "mfa";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.EMAIL_VERIFICATION_REQUIRED = "false";
const { createApp } = await import("./app.js");
const { Activity, Category, Profile, User } = await import("./models.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const { tokens } = await import("./auth.js");
const app = createApp();
let db: MongoMemoryReplSet;
const ids: string[] = [],
  auth: string[] = [];
const get = (path: string, who = 0) =>
  request(app).get(`/api/v1/${path}`).set("Authorization", auth[who]);
const input = (overrides: Record<string, unknown> = {}) => ({
  creator: ids[0],
  category: "food",
  type: "together",
  title: "Coffee after work",
  description: "A relaxed coffee and good conversation.",
  zone: "Park Street",
  startsAt: new Date(Date.now() + 86400000),
  ...overrides,
});
before(
  async () => {
    db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(db.getUri());
    await Activity.init();
    for (let i = 0; i < 2; i++) {
      const user = await User.create({
        name: `Expiry member ${i}`,
        email: `expiry${i}@example.test`,
        birthDate: "1997-01-01",
        passwordHash: "fixture",
      });
      ids.push(String(user._id));
      auth.push(`Bearer ${(await tokens(String(user._id))).accessToken}`);
      await eligibleProfile(user._id);
    }
    await Profile.updateMany(
      {},
      { approximateLocation: { type: "Point", coordinates: [88.36, 22.57] } },
    );
    await Category.create({ slug: "food", name: "Coffee & Food" });
  },
  { timeout: 180000 },
);
after(async () => {
  await mongoose.disconnect();
  if (db) await db.stop();
});
test("ended plans prompt the owner until extended, closed or expired, and sink in Your plans", async () => {
  const past = (days: number) => new Date(Date.now() - days * 86400000);
  const [future, ended, toClose, toExpire, ongoing] = await Activity.create([
    input({ creator: ids[0], title: "Future owner plan" }),
    input({ creator: ids[0], title: "Ended plan", startsAt: past(2) }),
    input({ creator: ids[0], title: "Plan to close", startsAt: past(3) }),
    input({ creator: ids[0], title: "Plan to expire", startsAt: past(4) }),
    input({
      creator: ids[0],
      title: "Ongoing range",
      startsAt: past(1),
      endsAt: new Date(Date.now() + 86400000),
    }),
  ]);
  const mineIds = [future, ended, toClose, toExpire, ongoing].map((p) =>
    String(p._id),
  );
  const prompts = async () => {
    const res = await get("activities/expiring", 0);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return (res.body.data as any[])
      .map((p) => p._id)
      .filter((id) => mineIds.includes(id));
  };
  assert.deepEqual(
    new Set(await prompts()),
    new Set([ended, toClose, toExpire].map((p) => String(p._id))),
  );
  assert.deepEqual(
    await (async () =>
      (await get("activities/expiring", 1)).body.data.filter((p: any) =>
        mineIds.includes(p._id),
      ))(),
    [],
  );
  const setState = (id: unknown, state: string, who = 0) =>
    request(app)
      .patch(`/api/v1/activities/${id}/state`)
      .set("Authorization", auth[who])
      .send({ state });
  // Only the owner may decide, and live plans cannot be marked expired.
  assert.equal((await setState(toExpire._id, "expired", 1)).status, 404);
  assert.equal((await setState(future._id, "expired")).status, 404);
  assert.equal((await setState(toClose._id, "closed")).status, 200);
  assert.equal((await setState(toExpire._id, "expired")).status, 200);
  assert.deepEqual(await prompts(), [String(ended._id)]);
  assert.equal(
    (await get(`activities/${toExpire._id}`, 0)).body.data.ownerState,
    "expired",
  );
  // Extending to a future date reopens the plan and clears the prompt.
  const extended = await request(app)
    .patch(`/api/v1/activities/${ended._id}`)
    .set("Authorization", auth[0])
    .send({ startsAt: new Date(Date.now() + 2 * 86400000).toISOString() });
  assert.equal(extended.status, 200, JSON.stringify(extended.body));
  assert.deepEqual(await prompts(), []);
  const reopened = await request(app)
    .patch(`/api/v1/activities/${toClose._id}`)
    .set("Authorization", auth[0])
    .send({ startsAt: new Date(Date.now() + 3 * 86400000).toISOString() });
  assert.equal(reopened.status, 200);
  assert.equal((await Activity.findById(toClose._id))!.ownerState, "live");
  await setState(toClose._id, "closed");
  // Your plans lists active plans first and ended ones at the bottom.
  const items = (
    await get("activities/browse?owner=true&sort=soon&limit=30", 0)
  ).body.data.items.filter((p: any) => mineIds.includes(p._id));
  const titles = items.map((p: any) => p.title);
  assert.deepEqual(titles.slice(-2).sort(), [
    "Plan to close",
    "Plan to expire",
  ]);
  assert.equal(
    titles.indexOf("Ongoing range") < titles.indexOf("Plan to close"),
    true,
  );
  // Closed and expired plans never appear to other members.
  for (const id of [toClose._id, toExpire._id])
    assert.equal((await get(`activities/${id}`, 1)).status, 404);
});
