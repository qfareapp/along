import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
process.env.NODE_ENV = "test";
process.env.ADMIN_AUTH_MODE = "mfa";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.EMAIL_VERIFICATION_REQUIRED = "false";
const { createApp } = await import("./app.js");
const { User, Profile, ProfilePhoto, Activity, RefreshSession } = await import("./models.js");
const { VibeCheck } = await import("./vibe-check-models.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const { tokens } = await import("./auth.js");
const password = "Delete-me-locally-2026";
let db: MongoMemoryReplSet, app = createApp();
let userId = "", access = "", refresh = "";
before(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri());
}, { timeout: 180000 });
beforeEach(async () => {
  app = createApp();
  for (const model of [VibeCheck, Activity, RefreshSession, ProfilePhoto, Profile, User]) await model.deleteMany({});
  const user = await User.create({ name: "Leaving Member", email: "leaving@example.test",
    passwordHash: await bcrypt.hash(password, 4), birthDate: "1997-01-01" });
  userId = String(user._id);
  await eligibleProfile(user._id);
  await Profile.updateOne({ user: user._id }, { $set: { bio: "Private bio", occupation: "Designer", "optionalDetails.hobbies": "Pottery" } });
  await VibeCheck.create({ owner: user._id, enabled: true, autoMatch: true, questions: [{ id: "q1", prompt: "Coffee or chai?", options: ["Coffee", "Chai"], answer: 0 }] });
  await Activity.collection.insertOne({ creator: user._id, title: "Sunday walk", status: "active" });
  ({ accessToken: access, refreshToken: refresh } = await tokens(userId));
});
after(async () => { await mongoose.disconnect(); if (db) await db.stop(); });
const remove = (body: object, token = access) =>
  request(app).delete("/api/v1/users/me").auth(token, { type: "bearer" }).send(body);

test("a wrong password leaves the account untouched without ending the session", async () => {
  const res = await remove({ password: "not-the-password" });
  assert.equal(res.status, 400);
  assert.equal((await User.findById(userId))!.status, "active");
  assert.equal((await request(app).get("/api/v1/users/me").auth(access, { type: "bearer" })).status, 200);
});

test("deleting erases personal profile content, revokes sessions and hides the member", async () => {
  assert.equal((await remove({ password })).status, 204);
  const user = await User.findById(userId).lean();
  assert.equal(user!.status, "deleted");
  assert.equal(user!.name, "Deleted member");
  assert.equal(user!.email, "leaving@example.test");
  const profile = await Profile.findOne({ user: userId }).lean();
  assert.deepEqual(profile!.photos, []);
  for (const field of ["bio", "occupation", "city", "gender", "optionalDetails", "approximateLocation"] as const)
    assert.equal(profile![field], undefined, field);
  assert.equal(await ProfilePhoto.countDocuments({ owner: userId }), 0);
  assert.equal((await Activity.collection.findOne({ creator: user!._id }))!.status, "deleted");
  const check = await VibeCheck.findOne({ owner: userId }).lean();
  assert.equal(check!.enabled, false);
  assert.equal(check!.questions.length, 0);
  assert.equal(await RefreshSession.countDocuments({ user: userId }), 0);
  assert.equal((await request(app).get("/api/v1/users/me").auth(access, { type: "bearer" })).status, 401);
  assert.equal((await request(app).post("/api/v1/auth/refresh").send({ refreshToken: refresh })).status, 401);
  const login = await request(app).post("/api/v1/auth/login").send({ email: "leaving@example.test", password });
  assert.equal(login.status, 401);
});
