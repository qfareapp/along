import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
process.env.ADMIN_AUTH_MODE = "mfa";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.EMAIL_VERIFICATION_REQUIRED = "false";
const { createApp } = await import("./app.js");
const { User, Profile, ProfileSwipe, Block } = await import("./models.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const { tokens } = await import("./auth.js");
const app = createApp();
let db: MongoMemoryServer;
const ids: Record<string, string> = {},
  access: Record<string, string> = {};
before(
  async () => {
    db = await MongoMemoryServer.create();
    await mongoose.connect(db.getUri());
    await ProfileSwipe.init();
    for (const key of [
      "viewer",
      "like",
      "pass",
      "save",
      "blocked",
      "suspended",
      "incomplete",
      "gender",
      "age",
      "mutualAge",
      "elsewhere",
    ]) {
      const user = await User.create({
        name: `Member ${key}`,
        email: `${key}@example.test`,
        passwordHash: "fixture",
        birthDate: key === "age" ? "1960-01-01" : "1998-01-01",
      });
      ids[key] = String(user._id);
      access[key] = (await tokens(ids[key])).accessToken;
      await eligibleProfile(user._id);
    }
    await Profile.updateOne({ user: ids.viewer }, { "preferences.maxAge": 40 });
    await Profile.updateOne(
      { user: ids.gender },
      { "preferences.genders": ["man"] },
    );
    await Profile.updateOne(
      { user: ids.mutualAge },
      { "preferences.minAge": 50 },
    );
    await Profile.updateOne({ user: ids.incomplete }, { $set: { photos: [] } });
    await User.updateOne({ _id: ids.suspended }, { status: "suspended" });
    await Profile.updateOne({ user: ids.elsewhere }, { city: "Mumbai" });
    await Block.create({ user: ids.blocked, target: ids.viewer });
  },
  { timeout: 180000 },
);
after(async () => {
  await mongoose.disconnect();
  if (db) await db.stop();
});
const get = (path: string, who = "viewer") =>
  request(app)
    .get(`/api/v1/discovery${path}`)
    .auth(access[who], { type: "bearer" });
const act = (who: string, target: string, action: string) =>
  request(app)
    .post(`/api/v1/discovery/${ids[target]}/action`)
    .auth(access[who], { type: "bearer" })
    .send({ action });
test("discovery shows mutual preference matches first, then members open to the viewer, with no private fields", async () => {
  const r = await get("");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const mutual = r.body.data.filter(
    (p: { mutualMatch: boolean }) => p.mutualMatch,
  );
  assert.deepEqual(
    mutual.map((p: { id: string }) => p.id).sort(),
    [ids.like, ids.pass, ids.save].sort(),
  );
  // Outside the viewer's age range but open to the viewer: shown after every mutual match.
  assert.deepEqual(
    r.body.data.slice(mutual.length).map((p: { id: string }) => p.id),
    [ids.age],
  );
  assert.equal(r.body.data.at(-1).mutualMatch, false);
  // Members whose own preferences exclude the viewer are never shown.
  for (const key of ["gender", "mutualAge"])
    assert.ok(!r.body.data.some((p: { id: string }) => p.id === ids[key]), key);
  const card = r.body.data[0];
  assert.ok(card.photoIds.length);
  assert.ok(card.age >= 18);
  for (const field of [
    "birthDate",
    "email",
    "passwordHash",
    "preferences",
    "approximateLocation",
  ])
    assert.equal(card[field], undefined);
  assert.equal((await get("?cityOnly=false")).body.data.length, 5);
  assert.equal((await get("?limit=2")).body.data.length, 2);
  assert.ok(
    (await get("?limit=2")).body.data.every(
      (p: { mutualMatch: boolean }) => p.mutualMatch,
    ),
  );
});
test("incomplete members cannot fetch cards, read details or express interest", async () => {
  assert.equal((await get("", "incomplete")).status, 403);
  assert.equal((await get(`/${ids.like}`, "incomplete")).status, 403);
  assert.equal((await act("incomplete", "like", "like")).status, 403);
});
test("profile detail rejects blocked, incompatible and non-discoverable users", async () => {
  const like = await get(`/${ids.like}`);
  assert.equal(like.status, 200);
  assert.equal(like.body.data.mutualMatch, true);
  const outsideMyRange = await get(`/${ids.age}`);
  assert.equal(outsideMyRange.status, 200);
  assert.equal(outsideMyRange.body.data.mutualMatch, false);
  for (const key of [
    "blocked",
    "suspended",
    "incomplete",
    "gender",
    "mutualAge",
    "viewer",
  ])
    assert.equal((await get(`/${ids[key]}`)).status, 404, key);
});
test("dating distance persists, validates location and restricts both discovery groups across city boundaries", async () => {
  const save = (body: object) =>
    request(app)
      .patch("/api/v1/profile/dating-preferences")
      .auth(access.viewer, { type: "bearer" })
      .send({
        genders: ["woman", "man", "nonbinary", "self_described"],
        minAge: 18,
        maxAge: 40,
        ...body,
      });
  try {
    assert.equal((await save({ maxDistanceKm: 25 })).status, 400);
    for (const change of [
      { maxDistanceKm: -1 },
      { maxDistanceKm: 501 },
      { location: { latitude: 91, longitude: 88 } },
      { location: { latitude: 22, longitude: -181 } },
      { distanceUnit: "yards" },
      { minAge: 40, maxAge: 20 },
    ])
      assert.equal((await save(change)).status, 400);
    const saved = await save({
      maxDistanceKm: 25,
      distanceUnit: "mi",
      location: { latitude: 22.572645, longitude: 88.363892 },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.data.profile.preferences.maxDistanceKm, 25);
    assert.equal(saved.body.data.profile.preferences.distanceUnit, "mi");
    assert.deepEqual(
      saved.body.data.profile.approximateLocation.coordinates,
      [88.364, 22.573],
    );
    for (const key of ["like", "elsewhere", "age"])
      await Profile.updateOne(
        { user: ids[key] },
        {
          $set: {
            approximateLocation: { type: "Point", coordinates: [88.37, 22.58] },
          },
        },
      );
    await Profile.updateOne(
      { user: ids.pass },
      {
        $set: {
          approximateLocation: { type: "Point", coordinates: [77.2, 28.6] },
        },
      },
    );
    for (const query of ["", "?cityOnly=false"]) {
      const result = await get(query);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.deepEqual(
        result.body.data.map((p: { id: string }) => p.id).sort(),
        [ids.like, ids.elsewhere, ids.age].sort(),
      );
      assert.equal(result.body.data.at(-1).mutualMatch, false);
      for (const card of result.body.data)
        assert.equal(card.approximateLocation, undefined);
    }
    // Unit and age edits retain the saved location; disabling the radius restores city filtering.
    assert.equal((await save({ distanceUnit: "km" })).status, 200);
    assert.equal((await save({ maxDistanceKm: null })).status, 200);
    assert.equal((await get("")).body.data.length, 4);
  } finally {
    await Profile.updateMany(
      { user: { $in: Object.values(ids) } },
      {
        $unset: {
          approximateLocation: 1,
          "preferences.maxDistanceKm": 1,
          "preferences.distanceUnit": 1,
        },
      },
    );
  }
});

test("pass, like and save persist with idempotent retries and disappear from the swipe feed", async () => {
  for (const action of ["pass", "like", "save"]) {
    assert.equal((await act("viewer", action, action)).status, 200);
    assert.equal((await act("viewer", action, action)).status, 200);
  }
  assert.equal(await ProfileSwipe.countDocuments({ user: ids.viewer }), 3);
  assert.deepEqual(
    (await get("")).body.data.map((p: { id: string }) => p.id),
    [ids.age],
  );
  const likes = await get("/likes");
  assert.deepEqual(
    likes.body.data.map((p: { id: string }) => p.id).sort(),
    [ids.like, ids.save].sort(),
  );
  assert.ok(likes.body.data.every((p: { mutual: boolean }) => !p.mutual));
});
test("mutual likes are real and reloading the feed preserves past actions", async () => {
  const result = await act("like", "viewer", "like");
  assert.equal(result.status, 200);
  assert.equal(result.body.data.mutual, true);
  const likes = await get("/likes");
  assert.equal(
    likes.body.data.find((p: { id: string }) => p.id === ids.like).mutual,
    true,
  );
  const reloaded = await request(createApp())
    .get("/api/v1/discovery")
    .auth(access.viewer, { type: "bearer" });
  assert.deepEqual(
    reloaded.body.data.map((p: { id: string }) => p.id),
    [ids.age],
  );
});
test("profile detail shares chosen details and plans but keeps area and gender private", async () => {
  await Profile.updateOne(
    { user: ids.like },
    {
      $set: {
        area: "Ballygunge",
        "optionalDetails.hobbies": "Pottery",
        "optionalDetails.food": " ",
      },
    },
  );
  const r = await get(`/${ids.like}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.data.details, { hobbies: "Pottery" });
  assert.ok(r.body.data.memberSince);
  assert.ok(Array.isArray(r.body.data.plans));
  assert.equal(r.body.data.action, "like");
  assert.equal(r.body.data.mutual, true);
  for (const field of ["area", "gender", "preferences", "email"])
    assert.equal(r.body.data[field], undefined, field);
});
test("blocks, eligibility loss and suspension remove saved profiles immediately", async () => {
  await Block.create({ user: ids.viewer, target: ids.like });
  assert.equal((await act("viewer", "like", "like")).status, 404);
  assert.equal((await get("/likes")).body.data.length, 1);
  await Profile.updateOne({ user: ids.save }, { $set: { photos: [] } });
  assert.equal((await get("/likes")).body.data.length, 0);
  await User.updateOne({ _id: ids.viewer }, { status: "suspended" });
  assert.equal((await get("")).status, 401);
});
