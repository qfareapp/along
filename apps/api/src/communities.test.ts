import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { io as connect } from "socket.io-client";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.EMAIL_VERIFICATION_REQUIRED = "false";
process.env.ADMIN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.PHOTO_STORAGE = "mongodb";
process.env.PUSH_NOTIFICATIONS_ENABLED = "true";
const { createApp } = await import("./app.js");
const {
  User,
  Category,
  Activity,
  ActivityInterest,
  Block,
  Report,
  Match,
  Conversation,
} = await import("./models.js");
const {
  Community,
  CommunityMembership,
  CommunityMessage,
  CommunityReaction,
  CommunityModerationAction,
} = await import("./community-models.js");
const { seedCommunities } = await import("./community-seed.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const { tokens } = await import("./auth.js");
const { eraseAccount } = await import("./account-deletion.js");
const { PushDevice, PushJob, processPushJobs } = await import("./push.js");
const { attachPlaySockets } = await import("./play-sockets.js");
const { PlanGroup, PlanGroupReaction } = await import("./plan-group-models.js");
let db: MongoMemoryReplSet,
  app = createApp(),
  community: string;
let users: string[] = [],
  access: string[] = [];
before(
  async () => {
    db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(db.getUri());
    await Promise.all([
      Community.init(),
      CommunityMembership.init(),
      CommunityMessage.init(),
      CommunityReaction.init(),
      Activity.init(),
      ActivityInterest.init(),
      PlanGroupReaction.init(),
    ]);
  },
  { timeout: 180000 },
);
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections))
    await collection.deleteMany({});
  users = [];
  access = [];
  app = createApp();
  await seedCommunities();
  community = String((await Community.findOne({ slug: "travel-along" }))!._id);
  await Category.create({ slug: "food", name: "Food", active: true });
  for (let i = 0; i < 4; i++) {
    const user = await User.create({
      email: `community-${i}@example.test`,
      name: `Member ${i}`,
      passwordHash: "fixture",
      birthDate: "1995-01-01",
    });
    users.push(String(user._id));
    access.push((await tokens(String(user._id))).accessToken);
    await eligibleProfile(user._id);
  }
});
after(async () => {
  await mongoose.disconnect();
  await db?.stop();
});
const get = (path: string, who = 0) =>
  request(app).get(`/api/v1${path}`).auth(access[who], { type: "bearer" });
const post = (path: string, body = {}, who = 0) =>
  request(app)
    .post(`/api/v1${path}`)
    .auth(access[who], { type: "bearer" })
    .send(body);
const join = (who = 0) => post(`/communities/${community}/join`, {}, who);
const send = (text: string, who = 0, extra = {}) =>
  post(
    `/communities/${community}/messages`,
    { text, clientId: `msg_${crypto.randomUUID()}`, ...extra },
    who,
  );
const planBody = (extra = {}) => ({
  type: "together",
  category: "food",
  title: "Community brunch together",
  description: "Meet at a public cafe and enjoy brunch together.",
  zone: "Kolkata",
  startsAt: new Date(Date.now() + 86400000).toISOString(),
  activityType: "group",
  capacity: 2,
  communityId: community,
  clientId: `plan_${crypto.randomUUID()}`,
  audience: {
    minAge: 18,
    maxAge: 120,
    gender: "both",
    maxDistanceKm: null,
    distanceUnit: "km",
  },
  ...extra,
});
async function createPlan(extra = {}) {
  await join();
  const result = await post("/activities", planBody(extra));
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return String(result.body.data._id);
}

test("six configurable communities seed idempotently and require authentication", async () => {
  await seedCommunities();
  assert.equal(await Community.countDocuments(), 6);
  assert.equal((await request(app).get("/api/v1/communities")).status, 401);
  const result = await get("/communities");
  assert.equal(result.status, 200);
  assert.equal(result.body.data.items.length, 6);
  assert.equal(result.body.data.items[0].memberCount, 0);
});
test("concurrent joins/leaves maintain one membership and exact counts without verification or matches", async () => {
  const responses = await Promise.all(Array.from({ length: 5 }, () => join()));
  assert.ok(
    responses.every((r) => r.status === 200),
    JSON.stringify(responses.map((r) => r.body)),
  );
  assert.equal(await CommunityMembership.countDocuments(), 1);
  assert.equal((await Community.findById(community))!.memberCount, 1);
  await Promise.all(
    Array.from({ length: 3 }, () => post(`/communities/${community}/leave`)),
  );
  assert.equal((await Community.findById(community))!.memberCount, 0);
  assert.equal(await Match.countDocuments(), 0);
  assert.equal(await Conversation.countDocuments(), 0);
});
test("nonmembers cannot chat; rejoining does not expose missed history", async () => {
  assert.equal((await get(`/communities/${community}/messages`)).status, 403);
  await join();
  await send("First message");
  await post(`/communities/${community}/leave`);
  await join(1);
  await send("While away", 1);
  await join();
  assert.deepEqual(
    (await get(`/communities/${community}/messages`)).body.data.items,
    [],
  );
});
test("messages are idempotent, paginated, readable and support replies/reactions", async () => {
  await join();
  await join(1);
  const input = { text: "Hello travel people", clientId: "same_message_key" };
  const first = await post(`/communities/${community}/messages`, input);
  const again = await post(`/communities/${community}/messages`, input);
  assert.equal(first.body.data.id, again.body.data.id);
  await send("Sounds good", 1, { replyTo: first.body.data.id });
  assert.equal(
    (
      await post(
        `/communities/${community}/messages/${first.body.data.id}/react`,
        { emoji: "👍" },
        1,
      )
    ).status,
    200,
  );
  const thread = await get(`/communities/${community}/messages`);
  assert.equal(thread.body.data.items.length, 2);
  assert.equal(thread.body.data.items[1].reply.text, input.text);
  assert.equal(thread.body.data.items[0].reactions[0].count, 1);
  assert.equal((await get(`/communities/${community}`)).body.data.unread, 1);
  await post(`/communities/${community}/read`, { sequence: 2 });
  assert.equal((await get(`/communities/${community}`)).body.data.unread, 0);
  await CommunityMessage.insertMany(
    Array.from({ length: 35 }, (_, i) => ({
      community,
      sender: users[1],
      text: `History ${i}`,
      sequence: i + 3,
      clientId: `history_${i}`,
    })),
  );
  const page = await get(`/communities/${community}/messages`);
  assert.equal(page.body.data.items.length, 30);
  assert.ok(page.body.data.nextBefore);
  const older = await get(
    `/communities/${community}/messages?before=${page.body.data.nextBefore}`,
  );
  assert.equal(older.body.data.items.length, 7);
});
test("blocked senders and quoted text do not leak into messages, member lists or unread", async () => {
  await join();
  await join(1);
  await join(2);
  const message = await send("Private from blocked person", 1);
  await send("A reply", 2, { replyTo: message.body.data.id });
  await Block.create({ user: users[0], target: users[1] });
  const result = await get(`/communities/${community}/messages`);
  assert.equal(result.body.data.items.length, 1);
  assert.equal(result.body.data.items[0].reply, null);
  const roster = await get(`/communities/${community}/members`);
  assert.ok(
    !roster.body.data.items.some((u: { id: string }) => u.id === users[1]),
  );
});
test("scoped moderators can pin, remove and suspend with audit; ordinary members cannot", async () => {
  await join();
  await join(1);
  const message = await send("Message to moderate", 1);
  assert.equal(
    (
      await post(
        `/communities/${community}/messages/${message.body.data.id}/pin`,
        { pinned: true },
      )
    ).status,
    403,
  );
  await CommunityMembership.updateOne(
    { community, user: users[0] },
    { role: "moderator" },
  );
  assert.equal(
    (
      await post(
        `/communities/${community}/messages/${message.body.data.id}/pin`,
        { pinned: true },
      )
    ).status,
    200,
  );
  const deleted = await request(app)
    .delete(`/api/v1/communities/${community}/messages/${message.body.data.id}`)
    .auth(access[0], { type: "bearer" });
  assert.equal(deleted.status, 200);
  assert.equal(
    (await get(`/communities/${community}/messages`)).body.data.items[0]
      .deleted,
    true,
  );
  assert.equal(
    (
      await post(`/communities/${community}/members/${users[1]}/moderate`, {
        action: "ban",
        reason: "Repeated harassment in chat.",
      })
    ).status,
    200,
  );
  assert.equal((await join(1)).status, 403);
  assert.equal((await send("Bypass ban", 1)).status, 403);
  assert.equal((await Community.findById(community))!.memberCount, 1);
  assert.ok((await CommunityModerationAction.countDocuments()) >= 3);
});
test("message reports capture private evidence and child safety priority", async () => {
  await join();
  await join(1);
  const message = await send("Reported message", 1);
  assert.equal(
    (
      await post(`/communities/${community}/report`, {
        messageId: message.body.data.id,
        reason: "Concerning content for safety review.",
        category: "child_safety",
      })
    ).status,
    201,
  );
  const report = await Report.findOne().select("+evidenceText");
  assert.equal(report!.priority, 100);
  assert.equal(report!.evidenceText, "Reported message");
});
test("unverified eligible member creates community plans and idempotent retries preserve limits", async () => {
  await join();
  const body = planBody();
  const first = await post("/activities", body);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const again = await post("/activities", body);
  assert.equal(again.body.data._id, first.body.data._id);
  await post("/activities", planBody({ title: "Second community plan" }));
  await post("/activities", planBody({ title: "Third community plan" }));
  const fourth = await post("/activities", planBody());
  assert.equal(fourth.status, 409);
  assert.equal(await Activity.countDocuments({ community }), 3);
  assert.equal(
    (await get(`/communities/${community}/plans`)).body.data.items.length,
    3,
  );
  assert.equal(await CommunityMessage.countDocuments(), 0);
});
test("open RSVP reserves capacity atomically, waitlists extras and never creates dating matches", async () => {
  const id = await createPlan({ participationPolicy: "open", capacity: 1 });
  await join(1);
  await join(2);
  const results = await Promise.all([
    post(`/activities/${id}/interests`, {}, 1),
    post(`/activities/${id}/interests`, {}, 2),
  ]);
  assert.ok(
    results.every((r) => r.status === 201),
    JSON.stringify(results.map((r) => r.body)),
  );
  assert.equal(
    await ActivityInterest.countDocuments({ activity: id, status: "accepted" }),
    1,
  );
  assert.equal(
    await ActivityInterest.countDocuments({
      activity: id,
      status: "waitlisted",
    }),
    1,
  );
  assert.equal((await Activity.findById(id))!.participants.length, 1);
  assert.equal(await Match.countDocuments(), 0);
  assert.equal(await Conversation.countDocuments(), 0);
  const group = await PlanGroup.findOne({ activity: id });
  assert.ok(group);
  const accepted = await ActivityInterest.findOne({
    activity: id,
    status: "accepted",
  });
  const waiting = await ActivityInterest.findOne({
    activity: id,
    status: "waitlisted",
  });
  const acceptedIndex = users.indexOf(String(accepted!.user)),
    waitingIndex = users.indexOf(String(waiting!.user));
  assert.equal(
    (await get(`/plan-groups/${group!._id}`, acceptedIndex)).status,
    200,
  );
  assert.equal(
    (await get(`/plan-groups/${group!._id}`, waitingIndex)).status,
    404,
  );
});
test("approval is organiser-only, event access revokes on removal and leave community preserves attendance", async () => {
  const id = await createPlan();
  await join(1);
  await post(`/activities/${id}/interests`, {}, 1);
  const path = `/communities/${community}/plans/${id}/participants/${users[1]}/approve`;
  assert.equal((await post(path, {}, 2)).status, 404);
  assert.equal((await post(path)).status, 200);
  const group = await PlanGroup.findOne({ activity: id });
  assert.ok(group);
  await post(`/communities/${community}/leave`, {}, 1);
  assert.equal((await get(`/plan-groups/${group!._id}`, 1)).status, 200);
  const removed = await request(app)
    .delete(
      `/api/v1/communities/${community}/plans/${id}/participants/${users[1]}`,
    )
    .auth(access[0], { type: "bearer" });
  assert.equal(removed.status, 200);
  assert.equal((await get(`/plan-groups/${group!._id}`, 1)).status, 404);
  assert.equal((await Activity.findById(id))!.participants.length, 0);
});
test("similar plan suggestions are nonblocking; cancelled plans close group access", async () => {
  const id = await createPlan({ participationPolicy: "open" });
  await join(1);
  await post(`/activities/${id}/interests`, {}, 1);
  const plan = await Activity.findById(id);
  const similar = await get(
    `/communities/${community}/plans/similar?title=Community%20brunch&startsAt=${plan!.startsAt.toISOString()}`,
  );
  assert.equal(similar.status, 200);
  assert.equal(similar.body.data.length, 1);
  const group = await PlanGroup.findOne({ activity: id });
  await Activity.updateOne({ _id: id }, { ownerState: "closed" });
  assert.equal((await get(`/plan-groups/${group!._id}`, 1)).status, 404);
});
test("account deletion removes community content and membership counts without retained reactions", async () => {
  await join();
  await join(1);
  const message = await send("Delete my content");
  await post(
    `/communities/${community}/messages/${message.body.data.id}/react`,
    { emoji: "❤️" },
    1,
  );
  await eraseAccount(users[0]);
  assert.equal(await CommunityMembership.countDocuments({ user: users[0] }), 0);
  assert.equal((await Community.findById(community))!.memberCount, 1);
  assert.equal(await CommunityMessage.countDocuments({ sender: users[0] }), 0);
  assert.equal(await CommunityReaction.countDocuments(), 0);
});
test(
  "socket subscription checks membership, broadcasts invalidations and revokes bans",
  async () => {
    await join();
    const server = app.listen(0);
    const sockets = attachPlaySockets(server);
    await new Promise<void>((resolve) =>
      server.once("listening", () => resolve()),
    );
    const port = (server.address() as { port: number }).port;
    const client = connect(`http://127.0.0.1:${port}/communities`, {
      transports: ["websocket"],
      auth: { token: access[0] },
      forceNew: true,
    });
    const outsider = connect(`http://127.0.0.1:${port}/communities`, {
      transports: ["websocket"],
      auth: { token: access[1] },
      forceNew: true,
    });
    const connected = (socket: typeof client) =>
      new Promise<void>((resolve, reject) => {
        socket.once("connect", () => resolve());
        socket.once("connect_error", reject);
      });
    const ack = (socket: typeof client) =>
      new Promise<{ ok: boolean }>((resolve) =>
        socket.emit("community:subscribe", { communityId: community }, resolve),
      );
    try {
      await Promise.all([connected(client), connected(outsider)]);
      assert.equal((await ack(client)).ok, true);
      assert.equal((await ack(outsider)).ok, false);
      const changed = new Promise<{ communityId: string }>((resolve) =>
        client.once("community:changed", resolve),
      );
      await send("Socket update");
      assert.equal((await changed).communityId, community);
      const revoked = new Promise((resolve) =>
        client.once("community:access-revoked", resolve),
      );
      await CommunityMembership.updateOne(
        { community, user: users[0] },
        { status: "banned" },
      );
      const { communityEvents } = await import("./community-service.js");
      communityEvents.emit("changed", community);
      await revoked;
    } finally {
      client.disconnect();
      outsider.disconnect();
      await sockets.close();
    }
  },
  { timeout: 20000 },
);

test("event chat supports replies, reactions, organiser pins, sender deletion and mute", async () => {
  const id = await createPlan({ participationPolicy: "open" });
  await join(1);
  await post(`/activities/${id}/interests`, {}, 1);
  const group = await PlanGroup.findOne({ activity: id });
  const path = `/plan-groups/${group!._id}`;
  const original = await post(`${path}/messages`, {
    text: "Meet near the public entrance",
    clientId: "event_message_original",
  });
  assert.equal(original.status, 201);
  const message = original.body.data.id;
  assert.equal(
    (
      await post(
        `${path}/messages`,
        {
          text: "See you there",
          clientId: "event_message_reply",
          replyTo: message,
        },
        1,
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await post(
        `${path}/messages/${message}/action`,
        { action: "react", emoji: "🎉" },
        1,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await post(
        `${path}/messages/${message}/action`,
        { action: "pin", pinned: true },
        1,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post(`${path}/messages/${message}/action`, {
        action: "pin",
        pinned: true,
      })
    ).status,
    200,
  );
  const thread = await get(path, 1);
  const chat = thread.body.data.messages.filter(
    (m: { kind: string }) => m.kind === "message",
  );
  assert.equal(chat[0].pinned, true);
  assert.equal(chat[0].reactions[0].count, 1);
  assert.equal(chat[1].reply.text, "Meet near the public entrance");
  assert.equal(
    (
      await request(app)
        .patch(`/api/v1${path}/preferences`)
        .auth(access[1], { type: "bearer" })
        .send({ muted: true })
    ).status,
    200,
  );
  assert.equal((await get(path, 1)).body.data.muted, true);
  await post(`${path}/messages/${message}/action`, { action: "delete" });
  const after = (await get(path, 1)).body.data.messages.filter(
    (m: { kind: string }) => m.kind === "message",
  );
  assert.equal(after[0].deleted, true);
  assert.equal(after[1].reply, null);
});
test("leaving an open event and explicitly rejoining restores access with a fresh history boundary", async () => {
  const id = await createPlan({ participationPolicy: "open" });
  await join(1);
  await post(`/activities/${id}/interests`, {}, 1);
  const group = await PlanGroup.findOne({ activity: id });
  const path = `/plan-groups/${group!._id}`;
  await request(app)
    .delete(
      `/api/v1/communities/${community}/plans/${id}/participants/${users[1]}`,
    )
    .auth(access[1], { type: "bearer" });
  await post(`${path}/messages`, {
    text: "While you were away",
    clientId: "event_message_away",
  });
  await post(`/activities/${id}/interests`, {}, 1);
  const result = await get(path, 1);
  assert.equal(result.status, 200);
  assert.ok(
    !result.body.data.messages.some(
      (m: { text: string }) => m.text === "While you were away",
    ),
  );
});
test("reopening and rescheduling cannot bypass the per-organiser plan limit", async () => {
  const first = await createPlan();
  await post(
    "/activities",
    planBody({ title: "Second active community plan" }),
  );
  await post("/activities", planBody({ title: "Third active community plan" }));
  await request(app)
    .patch(`/api/v1/activities/${first}/state`)
    .auth(access[0], { type: "bearer" })
    .send({ state: "closed" });
  assert.equal(
    (
      await post(
        "/activities",
        planBody({ title: "Fourth plan fills released slot" }),
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await request(app)
        .patch(`/api/v1/activities/${first}/state`)
        .auth(access[0], { type: "bearer" })
        .send({ state: "live" })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(app)
        .patch(`/api/v1/activities/${first}`)
        .auth(access[0], { type: "bearer" })
        .send({ startsAt: new Date(Date.now() + 172800000).toISOString() })
    ).status,
    409,
  );
});
test("community reports are scoped; ordinary members cannot read private evidence", async () => {
  await join();
  await join(1);
  const msg = await send("A reportable message", 1);
  await post(`/communities/${community}/report`, {
    messageId: msg.body.data.id,
    reason: "Please review this rule violation.",
  });
  assert.equal((await get(`/communities/${community}/reports`)).status, 403);
  await CommunityMembership.updateOne(
    { community, user: users[0] },
    { role: "moderator" },
  );
  const queue = await get(`/communities/${community}/reports`);
  assert.equal(queue.status, 200);
  assert.equal(queue.body.data[0].evidenceText, "A reportable message");
  assert.equal(queue.body.data[0].reporter, undefined);
  const reportId = queue.body.data[0].id;
  assert.equal(
    (
      await post(`/communities/${community}/reports/${reportId}/resolve`, {
        reason: "Reviewed and handled under community rules.",
      })
    ).status,
    200,
  );
  assert.equal((await Report.findById(reportId))!.status, "resolved");
});
test("the Event Hub paginates 50 plans without generating main-chat announcements", async () => {
  await join();
  await Activity.insertMany(
    Array.from({ length: 50 }, (_, i) => ({
      ...planBody({
        title: `Trip number ${i}`,
        startsAt: new Date(Date.now() + (i + 1) * 86400000),
        communityRequestKey: `load_test_${i}`,
      }),
      creator: users[0],
      community,
      participationPolicy: "approval",
    })),
  );
  const first = await get(`/communities/${community}/plans`);
  assert.equal(first.body.data.items.length, 20);
  const second = await get(
    `/communities/${community}/plans?cursor=${first.body.data.next}`,
  );
  assert.equal(second.body.data.items.length, 20);
  const third = await get(
    `/communities/${community}/plans?cursor=${second.body.data.next}`,
  );
  assert.equal(third.body.data.items.length, 10);
  assert.equal(third.body.data.next, null);
  assert.equal(await CommunityMessage.countDocuments(), 0);
});

test("community delivery keeps nonmessages generic, omits chat text and rechecks mute at send time", async (t) => {
  await join();
  await join(1);
  await PushDevice.create({
    installationId: "community-qa-device",
    token: "ExpoPushToken[community-qa-device]",
    user: users[0],
    sessionVersion: 0,
    expiresAt: new Date(Date.now() + 86400000),
  });
  const payloads: Record<string, unknown>[] = [];
  const provider: typeof fetch = async (_url, init) => {
    payloads.push(...JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({
        data: [{ status: "ok", id: `ticket-${payloads.length}` }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const original = await send("A message without a push to every member");
  const retryBody = {
    text: "Secret reply text stays inside Along",
    replyTo: original.body.data.id,
    clientId: "reply_retry_after_queue_failure",
  };
  const enqueueFailure = t.mock.method(PushJob, "updateOne", () => {
    throw new Error("Simulated queue failure");
  });
  const failed = await post(`/communities/${community}/messages`, retryBody, 1);
  enqueueFailure.mock.restore();
  assert.equal(failed.status, 500);
  assert.equal(
    (await post(`/communities/${community}/messages`, retryBody, 1)).status,
    201,
  );
  await processPushJobs(provider);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].body, "Open Along to read it.");
  assert.ok(!JSON.stringify(payloads).includes("Secret reply"));
  const id = await createPlan();
  await post(`/activities/${id}/interests`, {}, 1);
  await processPushJobs(provider);
  assert.equal(payloads.length, 2);
  assert.equal(payloads[1].title, "Along");
  assert.equal(payloads[1].body, "1 new notification from Along");
  await send("Queued before mute", 1, { replyTo: original.body.data.id });
  await CommunityMembership.updateOne(
    { community, user: users[0] },
    { muted: true },
  );
  await processPushJobs(provider);
  assert.equal(payloads.length, 2);
});

test("community requests use event approvals and cannot open legacy one-to-one chats", async () => {
  const id = await createPlan();
  await join(1);
  await post(`/activities/${id}/interests`, {}, 1);
  const interest = await ActivityInterest.findOne({
    activity: id,
    user: users[1],
  });
  const notifications = await get("/notifications");
  assert.equal(notifications.status, 200);
  assert.ok(
    !notifications.body.data.some(
      (n: { activityId: string }) => n.activityId === id,
    ),
  );
  assert.equal(
    (await post(`/notifications/${interest!._id}/conversation`)).status,
    404,
  );
  assert.equal(
    (await ActivityInterest.findById(interest!._id))!.status,
    "pending",
  );
  assert.equal(
    (
      await post(
        `/communities/${community}/plans/${id}/participants/${users[1]}/approve`,
      )
    ).status,
    200,
  );
  assert.equal(await Conversation.countDocuments(), 0);
  assert.equal(await Match.countDocuments(), 0);
});
