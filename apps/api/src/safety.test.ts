import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
process.env.NODE_ENV = "test";
process.env.ADMIN_AUTH_MODE = "mfa";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.EMAIL_VERIFICATION_REQUIRED = "false";
const { createApp } = await import("./app.js");
const { User, Profile, Report, Block, Match, Conversation, Message } = await import("./models.js");
const { tokens } = await import("./auth.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const { AirportConnection } = await import("./airport-models.js");
let db: MongoMemoryReplSet, app = createApp();
let ids: string[] = [], access: string[] = [], thread = "", otherThread = "", message = "", privateMessage = "";
before(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri());
}, { timeout: 180000 });
beforeEach(async () => {
  app = createApp(); ids = []; access = [];
  for (const model of Object.values(mongoose.models)) await model.deleteMany({});
  for (let i = 0; i < 3; i++) {
    const user = await User.create({ name: `Safety tester ${i}`, email: `safety-${i}@example.test`, passwordHash: "fixture", birthDate: "1997-01-01" });
    ids.push(String(user._id)); access.push((await tokens(String(user._id))).accessToken);
    await eligibleProfile(user._id);
  }
  const match = await Match.create({ users: ids.slice(0, 2), pairKey: ids.slice(0, 2).sort().join(":") });
  thread = String((await Conversation.create({ match: match._id }))._id);
  message = String((await Message.create({ conversation: thread, sender: ids[1], text: "Text available only to participants" }))._id);
  const other = await Match.create({ users: ids.slice(1), pairKey: ids.slice(1).sort().join(":") });
  otherThread = String((await Conversation.create({ match: other._id }))._id);
  privateMessage = String((await Message.create({ conversation: otherThread, sender: ids[2], text: "Private unrelated content" }))._id);
});
after(async () => { await mongoose.disconnect(); if (db) await db.stop(); });
const post = (path: string, data: object, who = 0) => request(app).post(`/api/v1${path}`).auth(access[who], { type: "bearer" }).send(data);

test("new-app registration records explicit policy agreement and rejects an explicit refusal", async () => {
  const body = { name: "New adult", email: "new-adult@example.test", birthDate: "1997-01-01", password: "Fixture-password-2026" };
  assert.equal((await request(app).post("/api/v1/auth/register").send({ ...body, acceptTerms: false })).status, 400);
  const registered = await request(app).post("/api/v1/auth/register").send({ ...body, acceptTerms: true });
  assert.equal(registered.status, 201);
  const profile = await Profile.findOne({ user: registered.body.data.user.id });
  assert.ok(profile!.consents?.termsAt);
  assert.ok(profile!.consents?.guidelinesAt);
  assert.equal(profile!.consents?.version, "2026-11-19");
});

test("general feedback and child-safety concerns are stored privately with a usable reference", async () => {
  const response = await post("/reports", { category: "child_safety", reason: "Please review this safety concern." });
  assert.equal(response.status, 201);
  const report = await Report.findById(response.body.data.reference);
  assert.equal(String(report!.reporter), ids[0]);
  assert.equal(report!.target, undefined);
  assert.equal(report!.severity, "critical");
  assert.equal(report!.priority, 100);
  assert.ok(report!.expiresAt);
  assert.equal((await request(app).get("/api/v1/reports").auth(access[0], { type: "bearer" })).status, 404);
  assert.equal((await request(app).post("/api/v1/reports").send({ reason: "Unauthenticated feedback" })).status, 401);
});

test("message reports use server text and reject unrelated private resources or spoofed targets", async () => {
  const valid = await post("/reports", { conversationId: thread, messageId: message, userId: ids[1], reason: "Please review the selected message." });
  assert.equal(valid.status, 201);
  const report = await Report.findById(valid.body.data.reference).select("+evidenceText");
  assert.equal(report!.evidenceText, "Text available only to participants");
  assert.equal((await post("/reports", { conversationId: thread, messageId: privateMessage, reason: "Report inaccessible message" })).status, 404);
  assert.equal((await post("/reports", { conversationId: otherThread, messageId: privateMessage, reason: "Report unrelated conversation" })).status, 404);
  assert.equal((await post("/reports", { conversationId: thread, userId: ids[2], reason: "Spoof the reported member" })).status, 404);
  assert.equal((await post("/reports", { userId: ids[1], reason: "Spoof message evidence", evidenceText: "forged" })).status, 400);
  assert.equal((await post("/reports", { userId: ids[0], reason: "A report of my own profile" })).status, 400);
  assert.equal(await Report.countDocuments(), 1);
});

test("blocking is persisted, closes direct access and cannot be undone by another member", async () => {
  const grant = await AirportConnection.create({ pairKey: ids.slice(0, 2).sort().join(":"), visitKey: "fixture-visit", users: ids.slice(0, 2), visits: ["one", "two"], airport: new mongoose.Types.ObjectId(), actor: ids[0], intent: "conversation", state: "connected", validUntil: new Date(Date.now() + 3600000), decisionUntil: new Date(Date.now() + 86400000) });
  assert.equal((await post("/blocks", { userId: ids[1] })).status, 204);
  assert.equal(await Block.countDocuments({ user: ids[0], target: ids[1] }), 1);
  for (const who of [0, 1]) assert.equal((await request(app).get(`/api/v1/conversations/${thread}`).auth(access[who], { type: "bearer" })).status, 404);
  const list = await request(app).get("/api/v1/blocks").auth(access[0], { type: "bearer" });
  assert.deepEqual(list.body.data.map((u: { id: string }) => u.id), [ids[1]]);
  await request(app).delete(`/api/v1/blocks/${ids[0]}`).auth(access[1], { type: "bearer" });
  assert.equal(await Block.countDocuments(), 1);
  await request(app).delete(`/api/v1/blocks/${ids[1]}`).auth(access[0], { type: "bearer" });
  assert.equal(await Block.countDocuments(), 0);
  assert.equal((await AirportConnection.findById(grant._id))!.state, "ended");
  // The pair-key convention used by Along is alphabetical with a colon.
  assert.equal((await request(app).get(`/api/v1/conversations/${thread}`).auth(access[0], { type: "bearer" })).status, 404);
});
