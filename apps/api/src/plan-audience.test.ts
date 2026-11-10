import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.ADMIN_AUTH_MODE = "mfa";
process.env.EMAIL_VERIFICATION_REQUIRED = "false";
const { createApp } = await import("./app.js");
const {
  User,
  Profile,
  ProfilePhoto,
  Category,
  Activity,
  ActivityInterest,
  Match,
  Conversation,
  Block,
} = await import("./models.js");
const { tokens } = await import("./auth.js");
const { eligibleProfile } = await import("./test-fixtures.js");
let database: MongoMemoryReplSet,
  app = createApp();
let ids: Record<string, string>,
  headers: Record<string, { Authorization: string }>;
before(
  async () => {
    database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(database.getUri());
    await Promise.all([
      Activity.init(),
      ActivityInterest.init(),
      Profile.init(),
    ]);
  },
  { timeout: 180000 },
);
beforeEach(async () => {
  app = createApp();
  ids = {};
  headers = {};
  for (const model of [
    ActivityInterest,
    Activity,
    Conversation,
    Match,
    Block,
    ProfilePhoto,
    Profile,
    Category,
    User,
  ])
    await model.deleteMany({});
  await Category.create({ slug: "food", name: "Food & Dining", active: true });
  for (const [who, gender] of [
    ["owner", "man"],
    ["male", "man"],
    ["female", "woman"],
    ["other", "nonbinary"],
    ["far", "woman"],
  ]) {
    const u = await User.create({
      name: `QA ${who}`,
      email: `${who}@example.test`,
      birthDate: "1997-01-01",
      passwordHash: "fixture",
    });
    ids[who] = String(u._id);
    headers[who] = {
      Authorization: `Bearer ${(await tokens(String(u._id))).accessToken}`,
    };
    await eligibleProfile(u._id);
    await Profile.updateOne(
      { user: u._id },
      {
        gender,
        approximateLocation: {
          type: "Point",
          coordinates: [who === "far" ? 89.36 : 88.36, 22.57],
        },
      },
    );
  }
});
after(async () => {
  await mongoose.disconnect();
  if (database) await database.stop();
});
const audience = {
  minAge: 18,
  maxAge: 120,
  gender: "both",
  maxDistanceKm: null,
  distanceUnit: "km",
};
const body = (extra: object = {}) => ({
  type: "together",
  category: "food",
  title: "Coffee in good company",
  description: "A relaxed coffee and good conversation.",
  zone: "Park Street",
  startsAt: new Date(Date.now() + 86400000).toISOString(),
  ...extra,
});
async function create(extra: object = {}) {
  const r = await request(app)
    .post("/api/v1/activities")
    .set(headers.owner)
    .send(body(extra));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return String(r.body.data._id);
}
const get = (path: string, who = "male") =>
  request(app).get(`/api/v1/${path}`).set(headers[who]);
const join = (plan: string, who = "male") =>
  request(app)
    .post(`/api/v1/activities/${plan}/interests`)
    .set(headers[who])
    .send({});

test("per-plan preferences persist and appear without private coordinates in public cards or details", async () => {
  const plan = await create({
    audience: {
      ...audience,
      minAge: 25,
      maxAge: 45,
      maxDistanceKm: 25,
      location: { latitude: 22.57077, longitude: 88.36077 },
    },
  });
  const stored = await Activity.findById(plan);
  assert.deepEqual(stored!.approximateLocation!.coordinates, [88.361, 22.571]);
  assert.equal(
    (stored!.audience as unknown as { location?: unknown }).location,
    undefined,
  );
  const detail = await get(`activities/${plan}`);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.data.audience.minAge, 25);
  assert.equal(detail.body.data.audience.maxAge, 45);
  assert.equal(detail.body.data.audience.maxDistanceKm, 25);
  assert.equal(detail.body.data.approximateLocation, undefined);
  const browse = await get("activities/browse");
  assert.equal(browse.body.data.items[0].audience.gender, "both");
  assert.equal(browse.body.data.items[0].approximateLocation, undefined);
});
test("male/female choices filter counts, lists, details, profile plans and direct interest requests", async () => {
  const plan = await create({ audience: { ...audience, gender: "female" } });
  for (const who of ["male", "other"]) {
    assert.equal(
      (await get("activities/browse", who)).body.data.items.length,
      0,
    );
    assert.equal(
      (await get("activities/categories", who)).body.data[0].liveCount,
      0,
    );
    assert.equal((await get(`activities/${plan}`, who)).status, 404);
    assert.equal((await join(plan, who)).status, 404);
    assert.equal(
      (await get(`discovery/${ids.owner}`, who)).body.data.plans.length,
      0,
    );
    assert.equal((await get("activities", who)).body.data.length, 0);
  }
  assert.equal((await get(`activities/${plan}`, "female")).status, 200);
  assert.equal((await join(plan, "female")).status, 201);
  const changed = await request(app)
    .patch(`/api/v1/activities/${plan}`)
    .set(headers.owner)
    .send({ audience: { ...audience, gender: "male" } });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal((await get(`activities/${plan}`, "male")).status, 200);
  assert.equal((await get(`activities/${plan}`, "female")).status, 404);
});
test("age limits include exact boundaries and owners can always manage their own plan", async () => {
  const user = await User.findById(ids.male).select("+birthDate");
  const now = new Date(),
    birth = user!.birthDate!;
  const age =
    now.getUTCFullYear() -
    birth.getUTCFullYear() -
    Number(
      now.getUTCMonth() < birth.getUTCMonth() ||
        (now.getUTCMonth() === birth.getUTCMonth() &&
          now.getUTCDate() < birth.getUTCDate()),
    );
  const plan = await create({
    audience: { ...audience, minAge: age, maxAge: age },
  });
  assert.equal((await get(`activities/${plan}`)).status, 200);
  await User.updateOne(
    { _id: ids.male },
    { birthDate: new Date("1980-01-01T00:00:00Z") },
  );
  assert.equal((await get(`activities/${plan}`)).status, 404);
  assert.equal((await join(plan)).status, 404);
  assert.equal((await get(`activities/${plan}`, "owner")).status, 200);
  assert.equal(
    (await get("activities/browse?owner=true", "owner")).body.data.items.length,
    1,
  );
});
test("plan distance rejects distant or missing viewer locations and remains tied to the saved plan origin", async () => {
  const plan = await create({ audience: { ...audience, maxDistanceKm: 10 } });
  assert.equal((await get(`activities/${plan}`, "female")).status, 200);
  assert.equal((await get(`activities/${plan}`, "far")).status, 404);
  assert.equal((await join(plan, "far")).status, 404);
  await Profile.updateOne(
    { user: ids.female },
    { $unset: { approximateLocation: "" } },
  );
  assert.equal((await get(`activities/${plan}`, "female")).status, 404);
  await Profile.updateOne(
    { user: ids.owner },
    { approximateLocation: { type: "Point", coordinates: [89.36, 22.57] } },
  );
  assert.equal((await get(`activities/${plan}`, "male")).status, 200);
  assert.equal((await get(`activities/${plan}`, "owner")).status, 200);
});
test("invalid ranges, genders, distance and coordinates cannot be submitted directly to the API", async () => {
  for (const change of [
    { minAge: 17 },
    { maxAge: 121 },
    { minAge: 50, maxAge: 30 },
    { minAge: 20.5 },
    { gender: "invalid" },
    { maxDistanceKm: 0 },
    { maxDistanceKm: 501 },
    { location: { latitude: 91, longitude: 0 } },
  ]) {
    const r = await request(app)
      .post("/api/v1/activities")
      .set(headers.owner)
      .send(body({ audience: { ...audience, ...change } }));
    assert.equal(r.status, 400, JSON.stringify(r.body));
  }
  await Profile.updateOne(
    { user: ids.owner },
    { $unset: { approximateLocation: "" } },
  );
  const r = await request(app)
    .post("/api/v1/activities")
    .set(headers.owner)
    .send(body({ audience: { ...audience, maxDistanceKm: 10 } }));
  assert.equal(r.status, 400);
});
test("Both and legacy plans stay open to all gender identities, with no radius requirement", async () => {
  const legacy = await create();
  const open = await create({ audience });
  await Profile.updateOne(
    { user: ids.other },
    { $unset: { approximateLocation: "" } },
  );
  for (const plan of [legacy, open])
    assert.equal((await get(`activities/${plan}`, "other")).status, 200);
});
test("acceptance rechecks the applicant against updated plan preferences", async () => {
  const plan = await create({ audience });
  const interest = await join(plan);
  assert.equal(interest.status, 201);
  await request(app)
    .patch(`/api/v1/activities/${plan}`)
    .set(headers.owner)
    .send({ audience: { ...audience, gender: "female" } })
    .expect(200);
  const response = await request(app)
    .post(`/api/v1/notifications/${interest.body.data._id}/conversation`)
    .set(headers.owner)
    .send({});
  assert.equal(response.status, 404);
  assert.equal(await Match.countDocuments(), 0);
});
