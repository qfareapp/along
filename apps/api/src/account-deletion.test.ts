import { before, beforeEach, after, test, mock } from "node:test";
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
const { User, Profile, ProfilePhoto, Activity, RefreshSession, Message, Report, Match, Conversation, ProfileSwipe, OnboardingEvent } = await import("./models.js");
const { SocialMoment, MomentReaction, SocialSettings } = await import("./social-models.js");
const { MediaDeletion, AccountDeletion, eraseAccount, cleanupDeletedAccounts } = await import("./account-deletion.js");
const { VibeCheck } = await import("./vibe-check-models.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const { tokens } = await import("./auth.js");
const password = "Delete-me-locally-2026";
let db: MongoMemoryReplSet, app = createApp();
let userId = "", access = "", refresh = "";
before(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri());
  await Promise.all([MediaDeletion.init(), AccountDeletion.init(), User.init()]);
}, { timeout: 180000 });
beforeEach(async () => {
  app = createApp();
  for (const model of Object.values(mongoose.models)) await model.deleteMany({});
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
  const user = await User.findById(userId).select("+birthDate +passwordHash").lean();
  assert.equal(user!.status, "deleted");
  assert.equal(user!.name, "Deleted member");
  assert.equal(user!.email, `${userId}@deleted.invalid`);
  assert.equal(user!.birthDate, undefined);
  assert.equal(user!.passwordHash, "deleted");
  const profile = await Profile.findOne({ user: userId }).lean();
  assert.equal(profile, null);
  assert.equal(await ProfilePhoto.countDocuments({ owner: userId }), 0);
  assert.equal((await Activity.collection.findOne({ creator: user!._id }))!.status, "deleted");
  const check = await VibeCheck.findOne({ owner: userId }).lean();
  assert.equal(check, null);
  assert.equal(await RefreshSession.countDocuments({ user: userId }), 0);
  assert.equal((await request(app).get("/api/v1/users/me").auth(access, { type: "bearer" })).status, 401);
  assert.equal((await request(app).post("/api/v1/auth/refresh").send({ refreshToken: refresh })).status, 401);
  const login = await request(app).post("/api/v1/auth/login").send({ email: "leaving@example.test", password });
  assert.equal(login.status, 401);
});

test("deletion removes authored content, queues every asset, preserves other members and limits report retention", async () => {
  const other = await User.create({ name: "Remaining member", email: "other@example.test", birthDate: "1997-01-01", passwordHash: "fixture" });
  const match = await Match.create({ users: [userId, other._id], pairKey: `${userId}:${other._id}` });
  const thread = await Conversation.create({ match: match._id });
  await Message.create({ sender: userId, conversation: thread._id, text: "Private message", attachment: { kind: "file", asset: "cloudinary-raw:along/private-file", mimeType: "application/pdf" } });
  await Message.create({ sender: other._id, conversation: thread._id, text: "Other member's own text" });
  await ProfilePhoto.create({ owner: userId, cloudinaryPublicId: "along/private-photo", contentType: "image/jpeg" });
  const moment = await SocialMoment.create({ author: userId, type: "photo", text: "Private moment", media: "cloudinary:along/private-moment", publishedAt: new Date(), expiresAt: new Date(Date.now() + 86400000) });
  await MomentReaction.create({ user: other._id, moment: moment._id, emoji: "heart" });
  await SocialSettings.create({ user: other._id, closeCircle: [userId], hidden: [userId] });
  await ProfileSwipe.create({ user: other._id, target: userId, action: "like" });
  await OnboardingEvent.create({ user: userId, name: "started" });
  await Report.create({ reporter: other._id, target: userId, reason: "Safety concern for investigation", evidenceText: "Limited text evidence" });
  assert.equal((await remove({ password })).status, 204);
  assert.equal(await Message.countDocuments({ sender: userId }), 0);
  assert.equal(await Message.countDocuments({ sender: other._id }), 1);
  assert.equal((await Match.findById(match._id))!.active, false);
  assert.equal(await SocialMoment.countDocuments({ author: userId }), 0);
  assert.equal(await MomentReaction.countDocuments({ moment: moment._id }), 0);
  assert.deepEqual((await SocialSettings.findOne({ user: other._id }))!.closeCircle, []);
  assert.equal(await ProfileSwipe.countDocuments({ target: userId }), 0);
  assert.equal(await OnboardingEvent.countDocuments({ user: userId }), 0);
  const assets = await MediaDeletion.find().select("+asset");
  assert.equal(assets.length, 3);
  const report = await Report.findOne({ target: userId }).select("+evidenceText");
  assert.equal(report!.evidenceText, "Limited text evidence");
  assert.ok(report!.expiresAt! > new Date());
  assert.ok(+report!.expiresAt! <= Date.now() + 180 * 86400000);
  // Repeating the job is safe and never deletes another user's account/content.
  await eraseAccount(userId);
  assert.equal(await MediaDeletion.countDocuments(), 3);
  assert.equal((await User.findById(other._id))!.status, "active");
});

test("provider failure remains queued and a later retry removes the key", async () => {
  await ProfilePhoto.create({ owner: userId, cloudinaryPublicId: "along/retry-photo", contentType: "image/jpeg" });
  assert.equal((await remove({ password })).status, 204);
  const now = new Date();
  await cleanupDeletedAccounts(now, async () => { throw new Error("provider unavailable"); });
  const job = await MediaDeletion.findOne().select("+asset");
  assert.equal(job!.asset, "cloudinary:along/retry-photo");
  assert.equal(job!.attempts, 1);
  assert.ok(job!.availableAt > now);
  await cleanupDeletedAccounts(new Date(+now + 3600000), async asset => { assert.equal(asset, job!.asset); });
  assert.equal(await MediaDeletion.countDocuments(), 0);
});

test("public deletion requires confirmation and credentials, blocks cross-origin forms and supports suspended members", async () => {
  const page = await request(app).get("/delete-account");
  assert.equal(page.status, 200);
  assert.match(page.text, /thousandshare\.1k@gmail\.com/);
  assert.match(page.text, /method="post"/);
  assert.equal((await request(app).post("/delete-account").type("form").send({ email: "leaving@example.test", password })).status, 400);
  assert.equal((await request(app).post("/delete-account").set("Origin", "https://unrelated.example").type("form").send({ email: "leaving@example.test", password, confirm: "yes" })).status, 403);
  assert.equal((await User.findById(userId))!.status, "active");
  await User.updateOne({ _id: userId }, { status: "suspended" });
  const removed = await request(app).post("/delete-account").type("form").send({ email: "leaving@example.test", password, confirm: "yes" });
  assert.equal(removed.status, 200);
  assert.match(removed.text, /account has been deleted/);
  assert.doesNotMatch(removed.text, /<form/);
  assert.equal(await User.countDocuments({ email: "leaving@example.test" }), 0);
});

test("public policies work without a session and do not expose credentials", async () => {
  for (const path of ["/terms", "/privacy", "/child-safety"]) {
    const response = await request(app).get(path);
    assert.equal(response.status, 200);
    assert.match(response.headers["content-type"], /text\/html/);
    assert.match(response.text, /Along/);
    assert.doesNotMatch(response.text, /leaving@example\.test|Delete-me-locally/);
  }
});

test("a cleanup failure rolls back deletion and the durable storage queue together", async () => {
  await ProfilePhoto.create({ owner: userId, cloudinaryPublicId: "along/atomic-photo", contentType: "image/jpeg" });
  const failure = mock.method(Profile, "deleteMany", () => { throw new Error("Simulated database write failure"); });
  try {
    assert.equal((await remove({ password })).status, 500);
    assert.equal((await User.findById(userId))!.status, "active");
    assert.equal((await User.findById(userId))!.email, "leaving@example.test");
    assert.ok(await Profile.exists({ user: userId }));
    assert.equal(await MediaDeletion.countDocuments(), 0);
    assert.equal(await AccountDeletion.countDocuments(), 0);
  } finally { failure.mock.restore(); }
});

test("a late in-flight upload is swept and safety retention is not extended on retries", async () => {
  await Report.create({ reporter: userId, reason: "An existing concern to retain briefly" });
  assert.equal((await remove({ password })).status, 204);
  const expires = (await Report.findOne())!.expiresAt;
  await Message.create({ sender: userId, conversation: new mongoose.Types.ObjectId(), text: "Late write", attachment: { kind: "file", asset: "cloudinary-raw:along/late-upload" } });
  const removed: string[] = [];
  await cleanupDeletedAccounts(new Date(Date.now() + 120000), async asset => { removed.push(asset); });
  assert.equal(await Message.countDocuments({ sender: userId }), 0);
  assert.deepEqual(removed, ["cloudinary-raw:along/late-upload"]);
  assert.equal(+(await Report.findOne())!.expiresAt!, +expires!);
});
