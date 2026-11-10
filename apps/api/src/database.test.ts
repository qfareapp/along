import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { eligibleProfile } from "./test-fixtures.js";
import { initializeCategories, seedCategories } from "./categories.js";

process.env.JWT_SECRET = "test-only-not-a-deployment-secret-0000000000";
const { createApp } = await import("./app.js");
const { User, Category, ActivityInterest } = await import("./models.js");
let database: MongoMemoryServer;
const app = createApp();
before(
  async () => {
    database = await MongoMemoryServer.create();
    await mongoose.connect(database.getUri());
    await Promise.all([User.init(), Category.init(), ActivityInterest.init()]);
  },
  { timeout: 180000 },
);
after(async () => {
  await mongoose.disconnect();
  if (database) await database.stop();
});

test("category initialization fills an empty catalog without resetting disabled or customized categories", async () => {
  await initializeCategories();
  assert.equal(await Category.countDocuments(), 12);
  await Category.updateOne(
    { slug: "food" },
    {
      $set: {
        name: "Custom Food",
        active: false,
        allowedTypes: ["offer"],
        cities: ["Kolkata"],
      },
    },
  );
  await initializeCategories();
  await seedCategories();
  assert.equal(await Category.countDocuments(), 12);
  const food = await Category.findOne({ slug: "food" });
  assert.equal(food?.name, "Custom Food");
  assert.equal(food?.active, false);
  assert.deepEqual(food?.allowedTypes, ["offer"]);
  assert.deepEqual(food?.cities, ["Kolkata"]);
  // Restore only this isolated fixture before the existing activity test.
  await Category.deleteMany({});
});

test("startup preserves an intentionally disabled existing category catalog", async () => {
  await Category.create({
    slug: "custom",
    name: "Custom Category",
    active: false,
  });
  await initializeCategories();
  assert.equal(await Category.countDocuments(), 1);
  assert.equal(await Category.countDocuments({ active: true }), 0);
  await Category.deleteMany({});
});

test("real Mongo: authentication, rotation, ownership, privacy and block enforcement", async () => {
  assert.equal((await request(app).get("/ready")).status, 200);
  const register = async (email: string) => {
    const r = await request(app).post("/api/v1/auth/register").send({
      email,
      password: "strong-test-password-123",
      name: "Fictional Adult",
      birthDate: "1998-01-01",
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.data;
  };
  const alice = await register("alice@example.test");
  const bob = await register("bob@example.test");
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const headers = auth(alice.accessToken);
  const bobHeaders = auth(bob.accessToken);
  assert.equal((await request(app).get("/api/v1/activities")).status, 401);
  const me = await request(app).get("/api/v1/users/me").set(headers);
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.passwordHash, undefined);
  assert.equal(me.body.data.user.birthDate, undefined);
  assert.equal(typeof me.body.data.user.age, "number");
  await Category.create({ slug: "food", name: "Food & Dining", active: true });
  const payload = {
    type: "together",
    category: "food",
    title: "Coffee after work",
    description: "Let us meet at a public cafe on Park Street.",
    zone: "Park Street",
    startsAt: "2099-01-01T18:00:00Z",
  };
  assert.equal(
    (await request(app).post("/api/v1/activities").set(headers).send(payload))
      .status,
    403,
  );
  // Test fixture verification only; the public API has no verification bypass.
  await User.updateMany({}, { emailVerified: true });
  await eligibleProfile(alice.user.id);
  await eligibleProfile(bob.user.id);
  const created = await request(app)
    .post("/api/v1/activities")
    .set(headers)
    .send({ ...payload, creator: bob.user.id });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.data._id;
  assert.equal(String(created.body.data.creator), String(alice.user.id));
  assert.equal(
    (
      await request(app)
        .patch(`/api/v1/activities/${id}`)
        .set(bobHeaders)
        .send({ title: "Unauthorized edit" })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(app)
        .post(`/api/v1/activities/${id}/interests`)
        .set(bobHeaders)
    ).status,
    201,
  );
  assert.equal(
    (
      await request(app)
        .post(`/api/v1/activities/${id}/interests`)
        .set(bobHeaders)
    ).status,
    201,
  );
  assert.equal(await ActivityInterest.countDocuments(), 1);
  assert.equal(
    (await request(app).get("/api/v1/activities").set(bobHeaders)).body.data
      .length,
    1,
  );
  assert.equal(
    (
      await request(app)
        .post("/api/v1/blocks")
        .set(bobHeaders)
        .send({ userId: alice.user.id })
    ).status,
    204,
  );
  assert.equal(
    (await request(app).get("/api/v1/activities").set(bobHeaders)).body.data
      .length,
    0,
  );
  assert.equal(
    (await request(app).get(`/api/v1/activities/${id}`).set(bobHeaders)).status,
    404,
  );
  assert.equal(
    (
      await request(app)
        .post(`/api/v1/activities/${id}/interests`)
        .set(bobHeaders)
    ).status,
    404,
  );
  const refresh = await request(app)
    .post("/api/v1/auth/refresh")
    .send({ refreshToken: alice.refreshToken });
  assert.equal(refresh.status, 200);
  assert.equal(
    (
      await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: alice.refreshToken })
    ).status,
    401,
  );
  assert.equal(
    (
      await request(app)
        .post("/api/v1/auth/logout")
        .send({ refreshToken: refresh.body.data.refreshToken })
    ).status,
    204,
  );
  assert.equal(
    (
      await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: refresh.body.data.refreshToken })
    ).status,
    401,
  );
});
