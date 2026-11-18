import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
process.env.NODE_ENV = "test";
process.env.ADMIN_AUTH_MODE = "mfa";
process.env.EMAIL_VERIFICATION_REQUIRED = "false";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.PUSH_NOTIFICATIONS_ENABLED = "true";
const { createApp } = await import("./app.js");
const { tokens } = await import("./auth.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const { ensureMatch } = await import("./chat.js");
const { PushDevice, PushJob, enqueuePush, processPushJobs } =
  await import("./push.js");
const {
  User,
  Message,
  Match,
  Conversation,
  Block,
  ProfileSwipe,
  Activity,
  ActivityInterest,
  Category,
} = await import("./models.js");
const { PlanGroup, PlanGroupMember, PlanGroupMessage } =
  await import("./plan-group-models.js");
const app = createApp();
let db: MongoMemoryReplSet;
const ids: string[] = [],
  auth: string[] = [];
const installations = [
  "push_installation_000",
  "push_installation_001",
  "push_installation_002",
];
const token = (who: number) => `ExpoPushToken[fixture_${who}]`;
const as = (who: number) => ({ Authorization: `Bearer ${auth[who]}` });
const register = (
  who = 1,
  installation = installations[who],
  value = token(who),
) =>
  request(app)
    .put("/api/v1/push-devices")
    .set(as(who))
    .send({ installationId: installation, token: value, platform: "android" });
const sent: Record<string, unknown>[][] = [];
const transport = (
  handler?: (path: string, body: unknown) => unknown | Promise<unknown>,
) =>
  (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    assert(url.startsWith("https://exp.host/--/api/v2/push/"));
    const body = JSON.parse(String(init?.body));
    if (url.endsWith("/send")) sent.push(body);
    const data = handler
      ? await handler(url, body)
      : { data: [{ status: "ok", id: "ticket-1" }] };
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
async function queuedMessage() {
  await register();
  const conversation = await ensureMatch(ids[0], ids[1]);
  const message = await Message.create({
    conversation,
    sender: ids[0],
    text: "Private message content",
  });
  await enqueuePush({
    key: `message:${message._id}`,
    user: ids[1],
    actor: ids[0],
    kind: "message",
    target: conversation!,
    message: String(message._id),
  });
  return { conversation, message };
}
before(
  async () => {
    db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(db.getUri());
    await Promise.all([
      PushDevice.init(),
      PushJob.init(),
      Match.init(),
      Conversation.init(),
      ProfileSwipe.init(),
      ActivityInterest.init(),
      PlanGroup.init(),
      PlanGroupMember.init(),
      PlanGroupMessage.init(),
    ]);
    await Category.create({ slug: "coffee", name: "Coffee" });
    for (let index = 0; index < 3; index++) {
      const user = await User.create({
        name: `Push Member ${index}`,
        email: `push-${index}@example.test`,
        birthDate: "1997-01-01",
        passwordHash: "fixture",
      });
      ids.push(String(user._id));
      auth.push((await tokens(String(user._id))).accessToken);
      await eligibleProfile(user._id);
    }
  },
  { timeout: 180000 },
);
beforeEach(async () => {
  sent.length = 0;
  await Promise.all([
    PushDevice.deleteMany({}),
    PushJob.deleteMany({}),
    Message.deleteMany({}),
    Conversation.deleteMany({}),
    Match.deleteMany({}),
    Block.deleteMany({}),
    ProfileSwipe.deleteMany({}),
    Activity.deleteMany({}),
    ActivityInterest.deleteMany({}),
    PlanGroup.deleteMany({}),
    PlanGroupMember.deleteMany({}),
    PlanGroupMessage.deleteMany({}),
  ]);
  await User.updateMany(
    {},
    { status: "active", sessionVersion: 0, restrictions: {} },
  );
});
after(async () => {
  await mongoose.disconnect();
  if (db) await db.stop();
});

test("registration is authenticated, validates tokens, and derives the owner from the session", async () => {
  assert.equal(
    (await request(app).put("/api/v1/push-devices").send({})).status,
    401,
  );
  assert.equal(
    (
      await request(app)
        .put("/api/v1/push-devices")
        .set(as(1))
        .send({
          installationId: installations[1],
          token: token(1),
          platform: "android",
          user: ids[0],
        })
    ).status,
    400,
  );
  assert.equal(
    (await register(1, installations[1], "invalid-token")).status,
    400,
  );
  assert.equal((await register()).status, 204);
  assert.equal(String((await PushDevice.findOne())!.user), ids[1]);
  assert.equal(
    (
      await request(app)
        .delete(`/api/v1/push-devices/${installations[1]}`)
        .set(as(0))
    ).status,
    204,
  );
  assert.equal(await PushDevice.countDocuments(), 1);
  assert.equal(
    (
      await request(app)
        .delete(`/api/v1/push-devices/${installations[1]}`)
        .set(as(1))
    ).status,
    204,
  );
  assert.equal(await PushDevice.countDocuments(), 0);
});

test("account switching reassigns one installation and skips its previous owner's queued alert", async () => {
  await register();
  await enqueuePush({ key: "old-notice", user: ids[1], actor: ids[0] });
  assert.equal((await register(2, installations[1], token(1))).status, 204);
  assert.equal(await PushDevice.countDocuments(), 1);
  assert.equal(String((await PushDevice.findOne())!.user), ids[2]);
  await processPushJobs(transport());
  assert.equal(sent.length, 0);
  assert.equal((await PushJob.findOne())!.state, "skipped");
});

test("new chat messages enqueue only the recipient and do not expose private text on the lock screen", async () => {
  await register(0);
  await register(1);
  const conversation = await ensureMatch(ids[0], ids[1]);
  const reply = await request(app)
    .post(`/api/v1/conversations/${conversation}/messages`)
    .set(as(0))
    .send({ text: "Private message content" });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  assert.equal(await PushJob.countDocuments(), 1);
  await processPushJobs(transport());
  assert.equal(sent.length, 1);
  const payload = sent[0][0];
  assert.equal(payload.to, token(1));
  assert.equal(payload.title, "New message from Push Member 0");
  assert.equal(payload.body, "Open Along to read it.");
  assert.deepEqual(payload.data, {
    kind: "message",
    recipientId: ids[1],
    conversationId: conversation,
  });
  assert(!JSON.stringify(payload).includes("Private message content"));
  await processPushJobs(transport());
  assert.equal(
    sent.length,
    1,
    "A ticket awaiting its receipt must not be resent.",
  );
  await PushJob.updateMany(
    {},
    { availableAt: new Date(0), leaseUntil: new Date(0) },
  );
  await processPushJobs(
    transport(() => ({ data: { "ticket-1": { status: "ok" } } })),
  );
  assert.equal((await PushJob.findOne())!.state, "delivered");
});

test("likes use the exact generic wording and duplicate action retries do not create more jobs", async () => {
  await register();
  for (let index = 0; index < 2; index++) {
    const reply = await request(app)
      .post(`/api/v1/discovery/${ids[1]}/action`)
      .set(as(0))
      .send({ action: "like" });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
  }
  assert.equal(await PushJob.countDocuments(), 1);
  await processPushJobs(transport());
  assert.deepEqual(sent[0][0].data, { kind: "notice", recipientId: ids[1] });
  assert.equal(sent[0][0].title, "Along");
  assert.equal(sent[0][0].body, "1 new notification from Along");
  assert.equal(sent[0][0].channelId, "updates");
});

test("plan requests and acceptances enqueue generic alerts for the correct side", async () => {
  await register(0);
  await register(1);
  const activity = await Activity.create({
    creator: ids[0],
    category: "coffee",
    type: "together",
    title: "Coffee plan",
    description: "Coffee together",
    zone: "Kolkata",
    startsAt: new Date(Date.now() + 86400000),
  });
  const interest = await request(app)
    .post(`/api/v1/activities/${activity._id}/interests`)
    .set(as(1))
    .send({});
  assert.equal(interest.status, 201, JSON.stringify(interest.body));
  const accepted = await request(app)
    .post(`/api/v1/notifications/${interest.body.data._id}/conversation`)
    .set(as(0))
    .send({});
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(
    await PushJob.countDocuments({ kind: "notice", user: ids[0] }),
    1,
  );
  assert.equal(
    await PushJob.countDocuments({ kind: "notice", user: ids[1] }),
    1,
  );
});

for (const condition of [
  "read",
  "blocked",
  "suspended",
  "revoked",
  "unmatched",
])
  test(`${condition} messages are skipped before contacting Expo`, async () => {
    const { message } = await queuedMessage();
    if (condition === "read")
      await Message.updateOne({ _id: message._id }, { readAt: new Date() });
    if (condition === "blocked")
      await Block.create({ user: ids[1], target: ids[0] });
    if (condition === "suspended")
      await User.updateOne({ _id: ids[1] }, { status: "suspended" });
    if (condition === "revoked")
      await User.updateOne({ _id: ids[1] }, { $inc: { sessionVersion: 1 } });
    if (condition === "unmatched")
      await Match.updateMany({}, { active: false });
    await processPushJobs(transport());
    assert.equal(sent.length, 0);
    assert.equal((await PushJob.findOne())!.state, "skipped");
  });

test("group chat alerts open the group and removed members lose pending delivery", async () => {
  await register();
  const activity = await Activity.create({
    creator: ids[0],
    category: "coffee",
    type: "together",
    activityType: "group",
    participants: [ids[1]],
    capacity: 5,
    title: "Group coffee",
    description: "Coffee together",
    zone: "Kolkata",
    startsAt: new Date(Date.now() + 86400000),
  });
  await ActivityInterest.create({
    activity: activity._id,
    user: ids[1],
    status: "accepted",
  });
  const created = await request(app)
    .post("/api/v1/plan-groups")
    .set(as(0))
    .send({ activityId: String(activity._id) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const group = created.body.data.id;
  await PushJob.deleteMany({});
  const send = () =>
    request(app)
      .post(`/api/v1/plan-groups/${group}/messages`)
      .set(as(0))
      .send({ text: "Group message", clientId: crypto.randomUUID() });
  assert.equal((await send()).status, 201);
  await processPushJobs(transport());
  assert.deepEqual(sent[0][0].data, {
    kind: "group",
    recipientId: ids[1],
    groupId: group,
  });
  await PushJob.deleteMany({});
  sent.length = 0;
  assert.equal((await send()).status, 201);
  assert.equal(
    (
      await request(app)
        .delete(`/api/v1/plan-groups/${group}/members/${ids[1]}`)
        .set(as(0))
    ).status,
    204,
  );
  await processPushJobs(transport());
  assert.equal(sent.length, 0);
});

test("temporary provider failures retry later and concurrent workers claim only one copy", async () => {
  await register();
  await enqueuePush({ key: "retry", user: ids[1], actor: ids[0] });
  await processPushJobs((async () => {
    throw new Error("Network unavailable");
  }) as typeof fetch);
  let job = await PushJob.findOne();
  assert.equal(job!.state, "pending");
  assert.equal(job!.attempts, 1);
  assert(job!.availableAt > new Date());
  await PushJob.updateMany(
    {},
    { availableAt: new Date(0), leaseUntil: new Date(0) },
  );
  const fetcher = transport(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { data: [{ status: "ok", id: "ticket-1" }] };
  });
  await Promise.all([processPushJobs(fetcher), processPushJobs(fetcher)]);
  assert.equal(sent.length, 1);
  job = await PushJob.findOne();
  assert.equal(job!.state, "receipt");
});

test("invalid-token receipts cannot delete a replacement token", async () => {
  await register();
  await enqueuePush({ key: "receipt", user: ids[1], actor: ids[0] });
  await processPushJobs(transport());
  assert.equal(
    (await register(1, installations[1], "ExpoPushToken[replacement]")).status,
    204,
  );
  await PushJob.updateMany(
    {},
    { availableAt: new Date(0), leaseUntil: new Date(0) },
  );
  await processPushJobs(
    transport(() => ({
      data: {
        "ticket-1": {
          status: "error",
          details: { error: "DeviceNotRegistered" },
        },
      },
    })),
  );
  assert.equal(
    (await PushDevice.findOne())!.token,
    "ExpoPushToken[replacement]",
  );
  await enqueuePush({ key: "invalid", user: ids[1], actor: ids[0] });
  await processPushJobs(
    transport(() => ({
      data: [{ status: "error", details: { error: "DeviceNotRegistered" } }],
    })),
  );
  assert.equal(await PushDevice.countDocuments(), 0);
});

test("rolled-back business transactions never publish a notification", async () => {
  await register();
  await assert.rejects(
    mongoose.connection.transaction(async (session) => {
      await enqueuePush(
        { key: "aborted", user: ids[1], actor: ids[0] },
        session,
      );
      throw new Error("abort fixture");
    }),
    /abort fixture/,
  );
  assert.equal(await PushJob.countDocuments(), 0);
});
