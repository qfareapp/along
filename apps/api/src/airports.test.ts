import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
process.env.ADMIN_AUTH_MODE = "mfa";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.EMAIL_VERIFICATION_REQUIRED = "false";
process.env.PUSH_NOTIFICATIONS_ENABLED = "true";
const { createApp } = await import("./app.js");
const { Airport, AirportConnection, AirportSession, AirportNotice } =
  await import("./airport-models.js");
const { User, Profile, Match, Conversation, Message, Block } =
  await import("./models.js");
const { tokens } = await import("./auth.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const { importAirports, parseAirportData } =
  await import("./airport-import.js");
const { withinAirport, distanceM } = await import("./airports.js");
const { authorizePlayPair } = await import("./play.js");
const { AdminRole, AdminSession, AuditLog } = await import("./admin/models.js");
const { digest } = await import("./auth.js");
const { validAirportBoundary } = await import("./admin/airports.js");
const { PushDevice, PushJob } = await import("./push.js");
async function decisionDevices() {
  for (let i = 0; i < 2; i++)
    await PushDevice.create({
      installationId: `airport_decision_fixture_${i}`,
      token: `ExpoPushToken[airport_decision_${i}]`,
      user: ids[i],
      sessionVersion: 0,
      expiresAt: new Date(Date.now() + 86400000),
    });
}
const app = createApp();
let db: MongoMemoryReplSet, airportId: string;
const ids: string[] = [],
  access: string[] = [];
const pos = () => ({
  latitude: 22.65,
  longitude: 88.45,
  accuracy: 20,
  timestamp: Date.now(),
});
const auth = (i: number) => ({ Authorization: `Bearer ${access[i]}` });
const api = (i: number, method: "get" | "post", path: string, data?: unknown) =>
  request(app)[method](`/api/v1${path}`).set(auth(i)).send(data);
before(
  async () => {
    db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(db.getUri());
    await Promise.all([
      Airport.init(),
      AirportSession.init(),
      AirportConnection.init(),
      AirportNotice.init(),
      PushDevice.init(),
      PushJob.init(),
      Conversation.init(),
      Match.init(),
    ]);
    for (let i = 0; i < 3; i++) {
      const user = await User.create({
        name: `Traveller ${i}`,
        email: `airport-${i}@example.test`,
        passwordHash: "fixture",
        birthDate: "1998-01-01",
      });
      ids.push(String(user._id));
      access.push((await tokens(ids[i])).accessToken);
      await eligibleProfile(user._id);
    }
  },
  { timeout: 180000 },
);
beforeEach(async () => {
  await Promise.all([
    Airport.deleteMany({}),
    AirportSession.deleteMany({}),
    AirportConnection.deleteMany({}),
    AirportNotice.deleteMany({}),
    PushDevice.deleteMany({}),
    PushJob.deleteMany({}),
    Match.deleteMany({}),
    Conversation.deleteMany({}),
    Message.deleteMany({}),
    Block.deleteMany({}),
  ]);
  await User.updateMany(
    {},
    { $set: { status: "active", "restrictions.messaging": false } },
  );
  await Profile.updateMany(
    {},
    {
      $set: {
        "preferences.genders": ["woman", "man", "nonbinary", "self_described"],
      },
    },
  );
  const airport = await Airport.create({
    sourceId: "fixture:airport",
    name: "Test airport",
    city: "Test city",
    iataCode: "TST",
    location: { type: "Point", coordinates: [88.45, 22.65] },
    enabled: true,
    radiusM: 500,
    zones: [
      { id: "landside", name: "Public area", compatibleWith: ["landside"] },
      { id: "international", name: "International", compatibleWith: [] },
    ],
  });
  airportId = String(airport._id);
});
after(async () => {
  await mongoose.disconnect();
  if (db) await db.stop();
});
async function checkIn(i: number, extra = {}) {
  return api(i, "post", "/airports/check-in", {
    airportId,
    zoneId: "landside",
    minutes: 90,
    intentions: ["coffee", "conversation", "dating", "games"],
    consent: true,
    location: pos(),
    ...extra,
  }).expect(201);
}
async function invitation(intent = "conversation") {
  await checkIn(0);
  await checkIn(1);
  const r = await api(0, "post", "/airports/connections", {
    userId: ids[1],
    intent,
  }).expect(201);
  return String(r.body.data._id);
}
async function connection(intent = "conversation") {
  const id = await invitation(intent);
  const accepted = await api(
    1,
    "post",
    `/airports/connections/${id}/decision`,
    { action: "accept" },
  ).expect(200);
  return { id, chat: accepted.body.data.conversationId as string };
}
test("spreadsheet import validates coordinates, skips duplicates and preserves configuration", async () => {
  const row = {
    id: "123",
    name: "Imported airport",
    iso_country: "IN",
    latitude_deg: "22.65",
    longitude_deg: "88.45",
    scheduled_service: "yes",
    type: "large_airport",
    iata_code: "abc",
  };
  assert.equal(
    parseAirportData([row, row, { ...row, id: "124", latitude_deg: "invalid" }])
      .skipped,
    2,
  );
  assert.deepEqual(await importAirports([row]), {
    inserted: 1,
    updated: 0,
    skipped: 0,
  });
  let airport = await Airport.findOne({ sourceId: "ourairports:123" });
  assert.equal(airport!.enabled, false);
  assert.deepEqual([...airport!.location!.coordinates], [88.45, 22.65]);
  await Airport.updateOne(
    { _id: airport!._id },
    {
      $set: {
        enabled: true,
        radiusM: 1234,
        configurationSource: "Manual review",
        zones: [{ id: "a", name: "Zone A", compatibleWith: [] }],
      },
    },
  );
  await importAirports([row]);
  airport = await Airport.findById(airport!._id);
  assert.equal(airport!.radiusM, 1234);
  assert.equal(airport!.enabled, true);
  assert.equal(airport!.zones[0].id, "a");
});
test("airport boundary uses inside polygon and 500m allowance, not only its reference point", () => {
  const a = {
    radiusM: 500,
    location: { coordinates: [88.45, 22.65] },
    boundary: [
      [88.44, 22.64],
      [88.46, 22.64],
      [88.46, 22.66],
      [88.44, 22.66],
      [88.44, 22.64],
    ],
  };
  assert.equal(withinAirport([88.459, 22.659], a), true);
  assert.equal(withinAirport([88.462, 22.65], a), true);
  assert.equal(withinAirport([88.48, 22.65], a), false);
  assert.ok(distanceM([88.45, 22.65], [88.45, 22.66]) > 1000);
  assert.equal(validAirportBoundary(a.boundary), true);
  assert.equal(
    validAirportBoundary([
      [0, 0],
      [1, 1],
      [0, 1],
      [1, 0],
      [0, 0],
    ]),
    false,
  );
  assert.equal(
    validAirportBoundary([
      [0, 0],
      [1, 1],
      [2, 2],
      [0, 0],
    ]),
    false,
  );
});
test("authentication and explicit consent are required", async () => {
  await request(app).get("/api/v1/airports/me").expect(401);
  await api(0, "post", "/airports/check-in", {
    airportId,
    zoneId: "landside",
    minutes: 60,
    intentions: ["coffee"],
    consent: false,
    location: pos(),
  }).expect(400);
});
test("check-in rejects stale, inaccurate, remote and manual-only locations", async () => {
  for (const location of [
    { ...pos(), timestamp: Date.now() - 180000 },
    { ...pos(), accuracy: 500 },
    { ...pos(), latitude: 23.5 },
    undefined,
  ]) {
    const r = await api(0, "post", "/airports/check-in", {
      airportId,
      zoneId: "landside",
      minutes: 60,
      intentions: ["conversation"],
      consent: true,
      location,
    });
    assert.ok([400, 403].includes(r.status));
  }
  assert.equal(await AirportSession.countDocuments(), 0);
});
test("disabled airport and unknown zones cannot activate", async () => {
  await Airport.updateOne({ _id: airportId }, { enabled: false });
  await api(0, "post", "/airports/check-in", {
    airportId,
    zoneId: "landside",
    minutes: 60,
    intentions: ["conversation"],
    consent: true,
    location: pos(),
  }).expect(403);
  await Airport.updateOne({ _id: airportId }, { enabled: true });
  await api(0, "post", "/airports/check-in", {
    airportId,
    zoneId: "unknown",
    minutes: 60,
    intentions: ["conversation"],
    consent: true,
    location: pos(),
  }).expect(400);
});
test("nearby response omits coordinates and detects configured proximity", async () => {
  const r = await api(0, "post", "/airports/nearby", pos()).expect(200);
  assert.equal(r.body.data[0].id, airportId);
  assert.equal(r.body.data[0].location, undefined);
});
test("only one session exists per user and no raw coordinates are retained", async () => {
  await checkIn(0);
  const old = await AirportSession.findOne({ user: ids[0] });
  await checkIn(0);
  const rows = await AirportSession.find({ user: ids[0] }).lean();
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].visitId, old!.visitId);
  assert.equal("location" in rows[0], false);
});
test("discovery excludes self, blocked, suspended, stale and expired visitors", async () => {
  await checkIn(0);
  await checkIn(1);
  await checkIn(2);
  const items = async () =>
    (await api(0, "get", "/airports/discover").expect(200)).body.data.items;
  assert.equal((await items()).length, 2);
  await Block.create({ user: ids[1], target: ids[0] });
  assert.equal((await items()).length, 1);
  await User.updateOne({ _id: ids[2] }, { status: "suspended" });
  assert.equal((await items()).length, 0);
  await User.updateOne({ _id: ids[2] }, { status: "active" });
  await AirportSession.updateOne(
    { user: ids[2] },
    { presenceUntil: new Date(0) },
  );
  assert.equal((await items()).length, 0);
  await AirportSession.updateOne(
    { user: ids[2] },
    {
      presenceUntil: new Date(Date.now() + 60000),
      availableUntil: new Date(0),
    },
  );
  assert.equal((await items()).length, 0);
});
test("social visibility does not imply dating eligibility", async () => {
  await checkIn(0);
  await checkIn(1);
  await Profile.updateOne({ user: ids[1] }, { "preferences.genders": ["man"] });
  const r = await api(0, "get", "/airports/discover").expect(200);
  assert.equal(r.body.data.items.length, 1);
  assert.equal(r.body.data.items[0].canDate, false);
  await api(0, "post", "/airports/connections", {
    userId: ids[1],
    intent: "dating",
  }).expect(403);
  await api(0, "post", "/airports/connections", {
    userId: ids[1],
    intent: "conversation",
  }).expect(201);
});
test("incompatible zones allow conversation but not coffee", async () => {
  await checkIn(0);
  await checkIn(1, { zoneId: "international" });
  const r = await api(0, "get", "/airports/discover").expect(200);
  assert.equal(r.body.data.items[0].canMeet, false);
  await api(0, "post", "/airports/connections", {
    userId: ids[1],
    intent: "coffee",
  }).expect(403);
  await api(0, "post", "/airports/connections", {
    userId: ids[1],
    intent: "conversation",
  }).expect(201);
});
test("acceptance rechecks changed zone compatibility", async () => {
  const id = await invitation("coffee");
  await Airport.updateOne(
    { _id: airportId },
    { $set: { "zones.0.compatibleWith": [] } },
  );
  await api(1, "post", `/airports/connections/${id}/decision`, {
    action: "accept",
  }).expect(403);
  assert.equal(await Conversation.countDocuments(), 0);
});
test("a sender or unrelated account cannot accept and duplicate requests are idempotent", async () => {
  const id = await invitation();
  await api(0, "post", `/airports/connections/${id}/decision`, {
    action: "accept",
  }).expect(403);
  await api(2, "post", `/airports/connections/${id}/decision`, {
    action: "accept",
  }).expect(404);
  await api(0, "post", "/airports/connections", {
    userId: ids[1],
    intent: "conversation",
  }).expect(201);
  assert.equal(await AirportConnection.countDocuments(), 1);
});
test("accepted airport connection uses existing chat without creating a Match", async () => {
  const { chat } = await connection();
  assert.equal(await Match.countDocuments(), 0);
  await api(0, "post", `/conversations/${chat}/messages`, {
    text: "Hello from the airport",
  }).expect(201);
  const r = await api(1, "get", `/conversations/${chat}`).expect(200);
  assert.equal(r.body.data.messages.length, 1);
  assert.equal(r.body.data.canSend, true);
  await api(2, "get", `/conversations/${chat}`).expect(404);
  const inbox = await api(0, "get", "/conversations").expect(200);
  assert.equal(inbox.body.data[0].id, chat);
});
test("checkout immediately removes presence, pauses chat and requests both choices", async () => {
  const { id, chat } = await connection();
  await api(0, "post", "/airports/check-out").expect(204);
  const r = await api(1, "get", `/conversations/${chat}`).expect(200);
  assert.equal(r.body.data.canSend, false);
  await api(0, "post", `/conversations/${chat}/messages`, {
    text: "Should not send",
  }).expect(403);
  const choices = await api(0, "get", "/airports/connections").expect(200);
  assert.equal(choices.body.data[0].needsDecision, true);
  await api(0, "post", `/airports/connections/${id}/decision`, {
    action: "keep",
  }).expect(200);
  assert.equal(await Match.countDocuments(), 0);
  await api(1, "post", `/airports/connections/${id}/decision`, {
    action: "keep",
  }).expect(200);
  assert.equal(await Match.countDocuments({ active: true }), 1);
  await api(0, "post", `/conversations/${chat}/messages`, {
    text: "Still connected",
  }).expect(201);
  await api(0, "get", `/conversations/${chat}`).expect(200);
});
test("ending connection revokes chat and cannot be reversed by keep", async () => {
  const { id, chat } = await connection();
  await api(1, "post", `/airports/connections/${id}/decision`, {
    action: "end",
  }).expect(200);
  await api(0, "get", `/conversations/${chat}`).expect(404);
  await api(0, "post", `/airports/connections/${id}/decision`, {
    action: "keep",
  }).expect(404);
});
test("unmatch and block revoke temporary chat", async () => {
  let c = await connection();
  await api(0, "post", `/conversations/${c.chat}/unmatch`).expect(204);
  await api(1, "get", `/conversations/${c.chat}`).expect(404);
  await AirportConnection.deleteMany({});
  c = await connection();
  await api(0, "post", "/blocks", { userId: ids[1] }).expect(204);
  await api(1, "get", `/conversations/${c.chat}`).expect(404);
});
test("decision timeout closes chat independently of a cleanup worker", async () => {
  const { id, chat } = await connection();
  await AirportConnection.updateOne(
    { _id: id },
    { validUntil: new Date(0), decisionUntil: new Date(0) },
  );
  await api(0, "get", `/conversations/${chat}`).expect(404);
});
test("departure debounce requires a second outside reading and cannot revive a departed visit", async () => {
  await checkIn(0);
  await api(0, "post", "/airports/presence", { ...pos(), latitude: 23 }).expect(
    200,
  );
  assert.equal((await api(0, "get", "/airports/me")).body.data.active, true);
  await AirportSession.updateOne(
    { user: ids[0] },
    { outsideSince: new Date(Date.now() - 61000) },
  );
  assert.equal(
    (await api(0, "post", "/airports/presence", { ...pos(), latitude: 23 }))
      .body.data.active,
    false,
  );
  assert.equal(
    (await api(0, "post", "/airports/presence", pos())).body.data.active,
    false,
  );
});
test("games reuse Along Play authorization and stop on departure", async () => {
  const c = await connection("games");
  assert.equal(String((await authorizePlayPair(ids[0], ids[1]))._id), c.chat);
  await api(0, "post", "/airports/check-out").expect(204);
  await assert.rejects(authorizePlayPair(ids[0], ids[1]));
});
test("concurrent acceptance creates only one conversation", async () => {
  const id = await invitation();
  const results = await Promise.all([
    api(1, "post", `/airports/connections/${id}/decision`, {
      action: "accept",
    }),
    api(1, "post", `/airports/connections/${id}/decision`, {
      action: "accept",
    }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 403]);
  assert.equal(await Conversation.countDocuments(), 1);
});
test("airport profile access is scoped to live visits or an accepted connection", async () => {
  await checkIn(0);
  await checkIn(1);
  await Profile.updateOne({ user: ids[1] }, { "preferences.genders": ["man"] });
  await api(0, "get", `/airports/profiles/${ids[1]}`).expect(200);
  await api(2, "get", `/airports/profiles/${ids[1]}`).expect(404);
  await api(1, "post", "/airports/check-out").expect(204);
  await api(0, "get", `/airports/profiles/${ids[1]}`).expect(404);
});
test("the first keep choice notifies only the other user and retrying is idempotent", async () => {
  const { id } = await connection();
  await decisionDevices();
  await api(0, "post", "/airports/check-out").expect(204);
  const choose = () =>
    api(0, "post", `/airports/connections/${id}/decision`, {
      action: "keep",
    }).expect(200);
  await choose();
  await choose();
  assert.equal(await AirportNotice.countDocuments({ kind: "keep" }), 1);
  const updates = await api(1, "get", "/airports/notices").expect(200);
  assert.equal(updates.body.data[0].kind, "keep");
  assert.match(
    updates.body.data[0].title,
    /Traveller 0 wants to stay connected/,
  );
  assert.equal(updates.body.data[0].presentedAt, null);
  assert.equal((await api(0, "get", "/airports/notices")).body.data.length, 0);
  assert.equal((await api(2, "get", "/airports/notices")).body.data.length, 0);
  const jobs = await PushJob.find({ key: /^airport-decision:/ });
  assert.equal(jobs.length, 1);
  assert.equal(String(jobs[0].user), ids[1]);
  assert.equal(jobs[0].kind, "notice");
});
test("mutual keep choices create one final notice per participant and supersede the earlier prompt", async () => {
  const { id, chat } = await connection();
  await decisionDevices();
  await api(0, "post", "/airports/check-out").expect(204);
  await api(0, "post", `/airports/connections/${id}/decision`, {
    action: "keep",
  }).expect(200);
  await api(1, "post", `/airports/connections/${id}/decision`, {
    action: "keep",
  }).expect(200);
  await api(1, "post", `/airports/connections/${id}/decision`, {
    action: "keep",
  }).expect(200);
  assert.equal(await AirportNotice.countDocuments({ kind: "connected" }), 2);
  assert.ok((await AirportNotice.findOne({ kind: "keep" }))!.presentedAt);
  for (const i of [0, 1]) {
    const updates = await api(i, "get", "/airports/notices").expect(200);
    const notice = updates.body.data.find(
      (v: { kind: string }) => v.kind === "connected",
    );
    assert.equal(notice.title, "Both chose to stay connected!");
    assert.equal(notice.conversationId, chat);
  }
  assert.equal(await PushJob.countDocuments({ key: /^airport-decision:/ }), 2);
});
test("an end choice notifies both participants with gentle wording and closes chat", async () => {
  const { id, chat } = await connection();
  await decisionDevices();
  await api(0, "post", "/airports/check-out").expect(204);
  await api(0, "post", `/airports/connections/${id}/decision`, {
    action: "keep",
  }).expect(200);
  await api(1, "post", `/airports/connections/${id}/decision`, {
    action: "end",
  }).expect(200);
  const received = (await api(0, "get", "/airports/notices").expect(200)).body
    .data[0];
  assert.equal(received.kind, "ended");
  assert.match(received.body, /Traveller 1 chose not to continue/);
  assert.equal(received.conversationId, null);
  const own = (await api(1, "get", "/airports/notices").expect(200)).body
    .data[0];
  assert.equal(own.own, true);
  assert.match(own.body, /You chose to leave this connection/);
  assert.ok((await AirportNotice.findOne({ kind: "keep" }))!.presentedAt);
  assert.equal(await AirportNotice.countDocuments({ kind: "ended" }), 2);
  await api(0, "get", `/conversations/${chat}`).expect(404);
  await api(1, "post", `/airports/connections/${id}/decision`, {
    action: "end",
  }).expect(404);
  assert.equal(await AirportNotice.countDocuments({ kind: "ended" }), 2);
});
test("notice acknowledgement belongs to its recipient and survives refetch without replay", async () => {
  const { id } = await connection();
  await api(0, "post", "/airports/check-out").expect(204);
  await api(0, "post", `/airports/connections/${id}/decision`, {
    action: "keep",
  }).expect(200);
  const notice = (await api(1, "get", "/airports/notices")).body.data[0];
  await api(0, "post", `/airports/notices/${notice.id}/presented`).expect(404);
  await api(2, "post", `/airports/notices/${notice.id}/presented`).expect(404);
  await api(1, "post", `/airports/notices/${notice.id}/presented`).expect(204);
  const refreshed = (await api(1, "get", "/airports/notices")).body.data[0];
  assert.ok(refreshed.presentedAt);
  assert.ok(refreshed.readAt);
  await api(1, "post", "/blocks", { userId: ids[0] }).expect(204);
  assert.equal((await api(1, "get", "/airports/notices")).body.data.length, 0);
});
test("dating respects the viewer's own age range", async () => {
  await checkIn(0);
  await checkIn(1);
  await Profile.updateOne({ user: ids[0] }, { "preferences.maxAge": 20 });
  await api(0, "post", "/airports/connections", {
    userId: ids[1],
    intent: "dating",
  }).expect(403);
  await Profile.updateOne({ user: ids[0] }, { "preferences.maxAge": 100 });
});
test("existing regular matches do not become temporary or receive departure choices", async () => {
  await checkIn(0);
  await checkIn(1);
  const { ensureMatch } = await import("./chat.js");
  const chat = await ensureMatch(ids[0], ids[1]);
  const response = await api(0, "post", "/airports/connections", {
    userId: ids[1],
    intent: "conversation",
  }).expect(200);
  assert.equal(response.body.data.conversationId, chat);
  await api(0, "post", "/airports/check-out").expect(204);
  assert.equal(
    (await api(0, "get", `/conversations/${chat}`).expect(200)).body.data
      .canSend,
    true,
  );
  assert.equal(
    (await api(0, "get", "/airports/connections").expect(200)).body.data.length,
    0,
  );
});
test("concurrent stay-connected votes promote exactly one match and retain chat history", async () => {
  const { id, chat } = await connection();
  await api(0, "post", `/conversations/${chat}/messages`, {
    text: "Before departure",
  }).expect(201);
  await api(0, "post", "/airports/check-out").expect(204);
  const responses = await Promise.all([
    api(0, "post", `/airports/connections/${id}/decision`, { action: "keep" }),
    api(1, "post", `/airports/connections/${id}/decision`, { action: "keep" }),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  assert.equal(await Match.countDocuments(), 1);
  assert.equal(await Conversation.countDocuments(), 1);
  const response = await api(0, "get", `/conversations/${chat}`).expect(200);
  assert.equal(response.body.data.messages[0].text, "Before departure");
  assert.equal(response.body.data.canSend, true);
});
test("admin airport configuration enforces RBAC, CSRF, valid zones and auditing", async () => {
  await request(app).get("/api/v1/admin/airports").set(auth(0)).expect(401);
  const role = await AdminRole.create({
    slug: `airport-admin-${crypto.randomUUID()}`,
    name: "Airport operator",
    permissions: ["settings.manage"],
  });
  const admin = await User.create({
    name: "Airport operator",
    email: `admin-${crypto.randomUUID()}@example.test`,
    passwordHash: "fixture",
    birthDate: "1990-01-01",
    adminRole: role.slug,
  });
  const secret = crypto.randomBytes(48).toString("base64url"),
    csrf = crypto.randomBytes(24).toString("hex");
  await AdminSession.create({
    user: admin._id,
    tokenHash: digest(secret),
    csrf,
    expiresAt: new Date(Date.now() + 600000),
    lastSeenAt: new Date(),
  });
  const headers = {
    Cookie: `along_admin=${secret}`,
    Origin: "http://localhost:3000",
    "X-CSRF-Token": csrf,
  };
  await request(app).get("/api/v1/admin/airports").set(headers).expect(200);
  const settings = {
    enabled: true,
    radiusM: 500,
    configurationSource: "Verified test-only zone configuration",
    zones: [{ id: "public", name: "Public area", compatibleWith: ["public"] }],
    reason: "Configure the isolated test airport",
  };
  await request(app)
    .patch(`/api/v1/admin/airports/${airportId}`)
    .set({ ...headers, "X-CSRF-Token": "wrong" })
    .send(settings)
    .expect(403);
  await request(app)
    .patch(`/api/v1/admin/airports/${airportId}`)
    .set(headers)
    .send({
      ...settings,
      zones: [
        { id: "public", name: "Public area", compatibleWith: ["unknown"] },
      ],
    })
    .expect(400);
  await request(app)
    .patch(`/api/v1/admin/airports/${airportId}`)
    .set(headers)
    .send(settings)
    .expect(200);
  assert.equal(
    await AuditLog.countDocuments({
      targetId: airportId,
      action: "airport.configure",
    }),
    1,
  );
  await AdminRole.updateOne({ _id: role._id }, { permissions: [] });
  await request(app).get("/api/v1/admin/airports").set(headers).expect(403);
});
