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
const { User, Profile, ProfilePhoto, Match, Conversation, Message, Block } = await import("./models.js");
const { VibeCheck, VibeAttempt } = await import("./vibe-check-models.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const { tokens } = await import("./auth.js");
const { vibePresets } = await import("./vibe-check-bank.js");
let db: MongoMemoryReplSet, app = createApp();
let ids: string[] = [], access: string[] = [];
before(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri());
  await Promise.all([VibeCheck.init(), VibeAttempt.init(), Match.init(), Conversation.init(), Message.init()]);
}, { timeout: 180000 });
beforeEach(async () => {
  app = createApp(); ids = []; access = [];
  for (const model of [VibeCheck, VibeAttempt, Message, Conversation, Match, Block, ProfilePhoto, Profile, User]) await model.deleteMany({});
  for (let i = 0; i < 4; i++) {
    const u = await User.create({ name: `Member ${i}`, email: `vibe-${i}@example.test`, passwordHash: "fixture", birthDate: "1997-01-01" });
    ids.push(String(u._id));
    access.push((await tokens(String(u._id))).accessToken);
    await eligibleProfile(u._id);
  }
});
after(async () => { await mongoose.disconnect(); if (db) await db.stop(); });
const get = (path: string, who = 0) => request(app).get(`/api/v1/vibe-checks${path}`).auth(access[who], { type: "bearer" });
const post = (path: string, body: unknown = {}, who = 1) => request(app).post(`/api/v1/vibe-checks${path}`).auth(access[who], { type: "bearer" }).send(body);
const settings = (extra: object = {}) => ({ revision: 0, enabled: true, autoMatch: true, threshold: 60,
  questions: vibePresets.slice(0, 5).map(q => ({ id: q.id, answer: 0 })), ...extra });
const save = (extra: object = {}, who = 0) => request(app).put("/api/v1/vibe-checks/mine").auth(access[who], { type: "bearer" }).send(settings(extra));
const answers = (matches = 3, count = 5, revision = 1) => ({ revision,
  answers: vibePresets.slice(0, count).map((q, i) => ({ id: q.id, choice: i < matches ? 0 : 1 })) });
const submit = (body: unknown = answers(), who = 1) => post(`/profiles/${ids[0]}/attempt`, body, who);
const noKeys = (value: unknown) => {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!["answer", "answers", "correctAnswer", "passwordHash", "email"].includes(key), `Leaked ${key}`);
    noKeys(child);
  }
};

test("the catalog contains the exact 20 requested preset questions; setup is private", async () => {
  const own = await get("/mine");
  assert.equal(own.status, 200);
  assert.equal(own.body.data.presets.length, 20);
  assert.deepEqual(own.body.data.presets[0], { id: "preset_1", prompt: "Your ideal weekend?", options: ["Cozy indoors", "Explore outdoors"] });
  assert.equal(own.body.data.presets[19].prompt, "Relationship pace?");
  assert.equal((await save()).status, 200);
  assert.equal((await get("/mine")).body.data.settings.questions[0].answer, 0);
  assert.equal((await get("/mine", 1)).body.data.settings.questions.length, 0);
  const visible = await get(`/profiles/${ids[0]}`, 1);
  assert.equal(visible.status, 200, JSON.stringify(visible.body));
  noKeys(visible.body);
  const card = await request(app).get(`/api/v1/discovery/${ids[0]}`).auth(access[1], { type: "bearer" });
  assert.equal(card.body.data.vibeCheck.questionCount, 5);
  noKeys(card.body);
});

test("preset content is canonical; custom questions support two to four distinct choices", async () => {
  const custom = { id: "custom_food", prompt: "Pick a midnight snack?", options: ["Pizza", "Fruit", "Noodles"], answer: 2 };
  const configured = await save({ questions: [{ id: "preset_1", prompt: "Tampered question", options: ["Wrong", "Also wrong"], answer: 0 }, custom] });
  assert.equal(configured.status, 200, JSON.stringify(configured.body));
  const own = (await get("/mine")).body.data.settings;
  assert.equal(own.questions[0].prompt, "Your ideal weekend?");
  assert.deepEqual(own.questions[0].options, ["Cozy indoors", "Explore outdoors"]);
  const r = await submit({ revision: 1, answers: [{ id: "preset_1", choice: 0 }, { id: "custom_food", choice: 2 }] });
  assert.equal(r.body.data.score, 100);
  noKeys(r.body);
});

test("exact cutoff passes, unlocks a usable chat without likes, and notifies both members", async () => {
  await save();
  const r = await submit();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.score, 60);
  assert.equal(r.body.data.status, "matched");
  assert.ok(r.body.data.conversationId);
  assert.equal(await Match.countDocuments({ active: true }), 1);
  const list = await request(app).get("/api/v1/conversations").auth(access[1], { type: "bearer" });
  assert.equal(list.body.data[0].id, r.body.data.conversationId);
  const sent = await request(app).post(`/api/v1/conversations/${r.body.data.conversationId}/messages`).auth(access[1], { type: "bearer" }).send({ text: "We both love chai!" });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  for (const who of [0, 1]) {
    const inbox = await get("/inbox", who);
    assert.equal(inbox.body.data[0].readAt, null);
    assert.equal(inbox.body.data[0].status, "matched");
    noKeys(inbox.body);
  }
  const profile = await request(app).get(`/api/v1/discovery/${ids[0]}`).auth(access[1], { type: "bearer" });
  assert.equal(profile.body.data.mutual, true);
  assert.equal(profile.body.data.conversationId, r.body.data.conversationId);
  const deck = await request(app).get("/api/v1/discovery").auth(access[1], { type: "bearer" });
  assert(!deck.body.data.some((member: { id: string }) => member.id === ids[0]));
});

test("a 70 percent cutoff on five questions needs four matches", async () => {
  await save({ threshold: 70 });
  const below = await submit(answers(3));
  assert.equal(below.body.data.passed, false);
  assert.equal(below.body.data.status, "failed");
  assert.equal(await Conversation.countDocuments(), 0);
  const above = await submit(answers(4), 2);
  assert.equal(above.body.data.score, 80);
  assert.equal(above.body.data.status, "matched");
});

test("display rounding never turns two of three answers into a 67 percent pass", async () => {
  await save({ threshold: 67, questions: settings().questions.slice(0, 3) });
  const r = await submit(answers(2, 3));
  assert.equal(r.body.data.score, 66.7);
  assert.equal(r.body.data.passed, false);
});

test("zero allows any completed check; 100 requires every answer to agree", async () => {
  await save({ threshold: 0 });
  assert.equal((await submit(answers(0))).body.data.status, "matched");
  await save({ revision: 1, threshold: 100 });
  assert.equal((await submit(answers(4, 5, 2), 2)).body.data.status, "failed");
  assert.equal((await submit(answers(5, 5, 2), 3)).body.data.status, "matched");
});

test("approval mode requires the owner's decision; accepting is idempotent", async () => {
  await save({ autoMatch: false });
  const r = await submit();
  const id = r.body.data.id;
  assert.equal(r.body.data.status, "pending");
  assert.equal(await Conversation.countDocuments(), 0);
  assert.equal((await post(`/attempts/${id}/decision`, { accept: true }, 1)).status, 404);
  assert.equal((await post(`/attempts/${id}/decision`, { accept: true }, 2)).status, 404);
  const accepted = await post(`/attempts/${id}/decision`, { accept: true }, 0);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.data.status, "matched");
  assert.equal((await post(`/attempts/${id}/decision`, { accept: true }, 0)).body.data.conversationId, accepted.body.data.conversationId);
  assert.equal((await post(`/attempts/${id}/decision`, { accept: false }, 0)).status, 409);
  assert.equal(await Match.countDocuments(), 1);
  assert.equal(await Message.countDocuments(), 1);
});

test("declining does not open chat, and read positions are private to each participant", async () => {
  await save({ autoMatch: false });
  const id = (await submit()).body.data.id;
  const declined = await post(`/attempts/${id}/decision`, { accept: false }, 0);
  assert.equal(declined.body.data.status, "declined");
  assert.equal(await Conversation.countDocuments(), 0);
  assert.equal((await get("/inbox", 1)).body.data[0].readAt, null);
  assert.equal((await post(`/attempts/${id}/read`, {}, 2)).status, 404);
  assert.equal((await post(`/attempts/${id}/read`, {}, 1)).status, 204);
  assert.ok((await get("/inbox", 1)).body.data[0].readAt);
  assert.equal((await post(`/attempts/${id}/decision`, { accept: true }, 0)).status, 409);
});

test("concurrent owner approvals open exactly one chat and pending requests obey later blocks", async () => {
  await save({ autoMatch: false });
  const id = (await submit()).body.data.id;
  const accepted = await Promise.all([
    post(`/attempts/${id}/decision`, { accept: true }, 0),
    post(`/attempts/${id}/decision`, { accept: true }, 0),
  ]);
  assert.deepEqual(accepted.map(r => r.status), [200, 200]);
  assert.equal(accepted[0].body.data.conversationId, accepted[1].body.data.conversationId);
  assert.equal(await Message.countDocuments(), 1);
  const other = (await submit(answers(), 2)).body.data.id;
  await Block.create({ user: ids[2], target: ids[0] });
  assert.equal((await post(`/attempts/${other}/decision`, { accept: true }, 0)).status, 404);
  assert.equal((await get("/inbox", 2)).body.data.length, 0);
});

test("a Vibe Check does not bypass a profile's dating audience or allow self attempts", async () => {
  await save();
  assert.equal((await get(`/profiles/${ids[0]}`, 0)).status, 400);
  assert.equal((await get("/profiles/invalid", 1)).status, 404);
  await Profile.updateOne({ user: ids[0] }, { "preferences.genders": ["man"] });
  assert.equal((await get(`/profiles/${ids[0]}`, 1)).status, 404);
  assert.equal((await submit()).status, 404);
  assert.equal(await VibeAttempt.countDocuments(), 0);
});

test("one attempt per revision prevents guessing; identical concurrent retries produce one match", async () => {
  await save();
  const responses = await Promise.all([submit(), submit()]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]);
  assert.equal(responses[0].body.data.id, responses[1].body.data.id);
  assert.equal((await submit(answers(5))).status, 409);
  assert.equal(await VibeAttempt.countDocuments(), 1);
  assert.equal(await Match.countDocuments(), 1);
  assert.equal(await Message.countDocuments(), 1);
});

test("editing versions expires old pending requests and rejects stale submissions and saves", async () => {
  await save({ autoMatch: false });
  const id = (await submit()).body.data.id;
  assert.equal((await save({ revision: 1, autoMatch: false, threshold: 100 })).status, 200);
  assert.equal((await save({ revision: 1 })).status, 409);
  assert.equal((await submit(answers(5), 2)).status, 409);
  assert.equal((await get("/inbox")).body.data[0].status, "superseded");
  assert.equal((await post(`/attempts/${id}/decision`, { accept: true }, 0)).status, 409);
  const fresh = await submit(answers(5, 5, 2));
  assert.equal(fresh.body.data.status, "pending");
  assert.equal(await VibeAttempt.countDocuments(), 2);
});

test("disabled checks reject reads and submissions without removing existing chats", async () => {
  await save();
  const r = await submit();
  await save({ revision: 1, enabled: false });
  assert.equal((await get(`/profiles/${ids[0]}`, 2)).status, 404);
  assert.equal((await submit(answers(5, 5, 2), 2)).status, 409);
  assert.equal(await Conversation.countDocuments({ _id: r.body.data.conversationId }), 1);
});

test("blocks, unmatching, messaging restrictions and ineligible accounts cannot bypass safety", async () => {
  await save();
  await Block.create({ user: ids[0], target: ids[1] });
  assert.equal((await get(`/profiles/${ids[0]}`, 1)).status, 404);
  assert.equal((await submit()).status, 404);
  await Block.deleteMany({});
  await User.updateOne({ _id: ids[0] }, { "restrictions.messaging": true });
  assert.equal((await submit()).status, 403);
  await User.updateOne({ _id: ids[0] }, { "restrictions.messaging": false });
  assert.equal((await submit()).status, 200);
  await Match.updateMany({}, { active: false });
  assert.equal((await submit()).status, 404);
  assert.equal((await get("/inbox", 1)).body.data.length, 0);
  await Profile.updateOne({ user: ids[2] }, { "onboarding.quickStartCompleted": false });
  assert.equal((await submit(answers(), 2)).status, 403);
  await User.updateOne({ _id: ids[3] }, { status: "suspended" });
  assert.equal((await submit(answers(), 3)).status, 401);
});

test("answer completeness, option bounds, duplicate IDs and unknown questions are validated", async () => {
  await save();
  for (const body of [
    answers(3, 4),
    { ...answers(), answers: answers().answers.map((a, i) => i === 0 ? { ...a, choice: 2 } : a) },
    { ...answers(), answers: answers().answers.map((a, i) => i === 0 ? { ...a, id: "unknown" } : a) },
    { ...answers(), answers: answers().answers.map((a, i) => i === 0 ? answers().answers[1] : a) },
    { ...answers(), score: 100 },
  ]) assert.equal((await submit(body)).status, 400);
  assert.equal(await VibeAttempt.countDocuments(), 0);
});

test("settings validate ownership, custom content, bounds and unanswered selected questions", async () => {
  for (const extra of [
    { questions: [] }, { threshold: 101 }, { threshold: -1 },
    { owner: ids[1] }, { questions: [{ id: "preset_1", answer: -1 }] },
    { questions: [{ id: "preset_100", answer: 0 }] },
    { questions: [{ id: "custom_x", prompt: "Favourite snack?", options: ["Pizza", "pizza"], answer: 0 }] },
    { questions: [{ id: "custom_x", prompt: "Favourite snack?", options: ["Pizza", "Chips"], answer: 2 }] },
    { questions: [settings().questions[0], settings().questions[0]] },
  ]) assert.equal((await save(extra)).status, 400);
  const unauth = await request(app).get("/api/v1/vibe-checks/mine");
  assert.equal(unauth.status, 401);
  assert.equal(await VibeCheck.countDocuments(), 0);
});
