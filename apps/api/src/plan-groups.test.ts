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
process.env.TRUST_PROXY_HOPS = "1";
const { createApp } = await import("./app.js");
const {
  Activity,
  ActivityInterest,
  Block,
  Category,
  Match,
  Conversation,
  Profile,
  User,
} = await import("./models.js");
const { PlanGroup, PlanGroupMember, PlanGroupMessage } =
  await import("./plan-group-models.js");
const { acceptActivityInterest } = await import("./activities.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const { tokens } = await import("./auth.js");
const app = createApp();
let db: MongoMemoryReplSet,
  plan: string,
  sequence = 0;
const ids: string[] = [],
  access: string[] = [];
const get = (path: string, who = 0) =>
  request(app)
    .get(`/api/v1/plan-groups${path}`)
    .set("X-Forwarded-For", `198.51.100.${sequence}`)
    .auth(access[who], { type: "bearer" });
const post = (path: string, body: unknown = {}, who = 0) =>
  request(app)
    .post(`/api/v1/plan-groups${path}`)
    .set("X-Forwarded-For", `198.51.100.${sequence}`)
    .auth(access[who], { type: "bearer" })
    .send(body);
const mode = (id: string, value: "everyone" | "organiser_only", who = 0) =>
  request(app)
    .patch(`/api/v1/plan-groups/${id}/settings`)
    .set("X-Forwarded-For", `198.51.100.${sequence}`)
    .auth(access[who], { type: "bearer" })
    .send({ messagingMode: value });
const send = (
  id: string,
  who = 1,
  clientId = crypto.randomUUID(),
  text = "Looking forward to our trip!",
) => post(`/${id}/messages`, { text, clientId }, who);
async function selected(count = 2) {
  const participants = ids.slice(1, count + 1);
  await Activity.updateOne({ _id: plan }, { participants });
  await ActivityInterest.updateMany(
    { activity: plan, user: { $in: participants } },
    { status: "accepted" },
  );
}
async function group(value: "everyone" | "organiser_only" = "everyone") {
  const response = await post("", { activityId: plan, messagingMode: value });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id as string;
}
before(
  async () => {
    db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(db.getUri());
    await Promise.all([
      Activity.init(),
      ActivityInterest.init(),
      PlanGroup.init(),
      PlanGroupMember.init(),
      PlanGroupMessage.init(),
      Match.init(),
      Conversation.init(),
    ]);
    await Category.create({ slug: "travel", name: "Travel" });
    for (let i = 0; i < 22; i++) {
      const user = await User.create({
        name: i ? `Traveller ${i}` : "Trip organiser",
        email: `group-${i}@example.test`,
        birthDate: "1997-01-01",
        passwordHash: "fixture",
      });
      ids.push(String(user._id));
      access.push((await tokens(String(user._id))).accessToken);
      await eligibleProfile(user._id);
    }
    await Profile.updateMany(
      {},
      { approximateLocation: { type: "Point", coordinates: [88.36, 22.57] } },
    );
  },
  { timeout: 180000 },
);
beforeEach(async () => {
  sequence++;
  await Promise.all([
    PlanGroup.deleteMany({}),
    PlanGroupMember.deleteMany({}),
    PlanGroupMessage.deleteMany({}),
    Activity.deleteMany({}),
    ActivityInterest.deleteMany({}),
    Block.deleteMany({}),
    Match.deleteMany({}),
    Conversation.deleteMany({}),
  ]);
  await User.updateMany(
    {},
    { status: "active", restrictions: {}, sessionVersion: 0 },
  );
  plan = String(
    (
      await Activity.create({
        creator: ids[0],
        category: "travel",
        type: "together",
        activityType: "group",
        capacity: 10,
        title: "Weekend mountain trip",
        description: "A group trip with selected attendees.",
        zone: "Park Street",
        startsAt: new Date(Date.now() + 7 * 86400000),
      })
    )._id,
  );
  await ActivityInterest.create(
    ids
      .slice(1, 21)
      .map((user) => ({ user, activity: plan, status: "pending" })),
  );
});
after(async () => {
  await mongoose.disconnect();
  if (db) await db.stop();
});

test("10 accepted out of 20 applicants create exactly 11 group members including the organiser", async () => {
  const applicants = await ActivityInterest.find({ activity: plan }).sort({
    _id: 1,
  });
  for (const interest of applicants.slice(0, 10))
    await acceptActivityInterest(ids[0], String(interest._id));
  const id = await group();
  const response = await get(`/${id}`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.memberCount, 11);
  assert.equal(
    response.body.data.members.filter(
      (m: { isOrganiser: boolean }) => m.isOrganiser,
    ).length,
    1,
  );
  assert.equal(await PlanGroupMember.countDocuments({ group: id }), 11);
  assert.equal(
    await ActivityInterest.countDocuments({
      activity: plan,
      status: "pending",
    }),
    10,
  );
  assert.equal((await get(`/${id}`, 11)).status, 404);
  await assert.rejects(
    acceptActivityInterest(ids[0], String(applicants[10]!._id)),
    /Activity Full/,
  );
});
test("only the organiser creates a group and only for a group plan with accepted attendees", async () => {
  assert.equal((await post("", { activityId: plan })).status, 409);
  await selected();
  assert.equal((await post("", { activityId: plan }, 1)).status, 404);
  assert.equal((await post("", { activityId: plan }, 3)).status, 404);
  await Activity.updateOne({ _id: plan }, { activityType: "one_on_one" });
  assert.equal((await post("", { activityId: plan })).status, 404);
});
test("concurrent create requests are idempotent and cannot reset the chosen messaging mode", async () => {
  await selected();
  const responses = await Promise.all([
    post("", { activityId: plan, messagingMode: "organiser_only" }),
    post("", { activityId: plan, messagingMode: "organiser_only" }),
  ]);
  assert(
    responses.every((r) => [200, 201].includes(r.status)),
    JSON.stringify(responses.map((r) => r.body)),
  );
  assert.equal(responses[0].body.data.id, responses[1].body.data.id);
  assert.equal(await PlanGroup.countDocuments(), 1);
  assert.equal(await PlanGroupMessage.countDocuments({ kind: "created" }), 1);
  await post("", { activityId: plan, messagingMode: "everyone" });
  assert.equal((await PlanGroup.findOne())!.messagingMode, "organiser_only");
});
test("pending, declined, and nonapplicant users cannot discover, read, post, or mark a group read", async () => {
  await selected();
  const id = await group();
  await ActivityInterest.updateOne(
    { activity: plan, user: ids[4] },
    { status: "declined" },
  );
  for (const who of [3, 4, 21]) {
    assert.deepEqual((await get("", who)).body.data, []);
    assert.equal((await get(`/for-plan/${plan}`, who)).status, 404);
    assert.equal((await get(`/${id}`, who)).status, 404);
    assert.equal((await send(id, who)).status, 404);
    assert.equal(
      (await post(`/${id}/read`, { throughSequence: 1 }, who)).status,
      404,
    );
  }
});
test("everyone mode supports conversation with participant names and organiser identity", async () => {
  await selected();
  const id = await group();
  assert.equal((await send(id, 1)).status, 201);
  assert.equal((await send(id, 2)).status, 201);
  const thread = (await get(`/${id}`)).body.data;
  assert.equal(
    thread.messages.filter((m: { kind: string }) => m.kind === "message")
      .length,
    2,
  );
  assert.equal(thread.messages.at(-1).sender.name, "Traveller 2");
  assert.equal(thread.messages.at(-1).sender.isOrganiser, false);
  assert.equal(thread.members[0].email, undefined);
  assert.equal(thread.members[0].restrictions, undefined);
});
test("only the organiser can change permissions; attendees remain able to read announcements", async () => {
  await selected();
  const id = await group();
  assert.equal((await mode(id, "organiser_only", 1)).status, 403);
  assert.equal((await mode(id, "organiser_only")).status, 200);
  assert.equal((await send(id, 1)).status, 403);
  assert.equal((await get(`/${id}`, 1)).body.data.canSend, false);
  assert.equal((await send(id, 0)).status, 201);
  assert.equal(
    (await get(`/${id}`, 1)).body.data.messages.at(-1).sender.isOrganiser,
    true,
  );
  assert.equal((await mode(id, "everyone")).status, 200);
  assert.equal((await send(id, 1)).status, 201);
});
test("a mode change racing a participant send has a consistent transactional ordering", async () => {
  await selected();
  const id = await group();
  const [changed, message] = await Promise.all([
    mode(id, "organiser_only"),
    send(id, 1),
  ]);
  assert.equal(changed.status, 200);
  assert([201, 403].includes(message.status), JSON.stringify(message.body));
  const permission = await PlanGroupMessage.findOne({
    group: id,
    kind: "permissions",
  });
  if (message.status === 201)
    assert(message.body.data.sequence < permission!.sequence);
  assert.equal((await send(id, 2)).status, 403);
});
test("retrying a message concurrently persists one message and rejects altered retry text", async () => {
  await selected();
  const id = await group();
  const key = crypto.randomUUID();
  const replies = await Promise.all([send(id, 1, key), send(id, 1, key)]);
  assert(
    replies.every((r) => r.status === 201),
    JSON.stringify(replies.map((r) => r.body)),
  );
  assert.equal(replies[0].body.data.id, replies[1].body.data.id);
  assert.equal(await PlanGroupMessage.countDocuments({ clientId: key }), 1);
  assert.equal((await PlanGroup.findById(id))!.lastSequence, 2);
  assert.equal((await send(id, 1, key, "Different message")).status, 409);
});
test("newly accepted attendees join automatically without access to earlier messages", async () => {
  await selected(1);
  const id = await group();
  await send(id, 0, crypto.randomUUID(), "Earlier conversation");
  const interest = await ActivityInterest.findOne({
    activity: plan,
    user: ids[2],
  });
  await acceptActivityInterest(ids[0], String(interest!._id));
  const thread = (await get(`/${id}`, 2)).body.data;
  assert.equal(thread.memberCount, 3);
  assert(thread.messages.some((m: { kind: string }) => m.kind === "joined"));
  assert(
    !thread.messages.some(
      (m: { text: string }) => m.text === "Earlier conversation",
    ),
  );
  await acceptActivityInterest(ids[0], String(interest!._id));
  assert.equal(
    await PlanGroupMessage.countDocuments({ group: id, kind: "joined" }),
    1,
  );
  assert.equal((await send(id, 2)).status, 201);
});
test("group creation racing an acceptance still includes the newly selected user exactly once", async () => {
  await selected(1);
  const interest = await ActivityInterest.findOne({
    activity: plan,
    user: ids[2],
  });
  const [created] = await Promise.all([
    post("", { activityId: plan }),
    acceptActivityInterest(ids[0], String(interest!._id)),
  ]);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(
    await PlanGroupMember.countDocuments({
      group: created.body.data.id,
      user: ids[2],
    }),
    1,
  );
  assert.equal((await get(`/${created.body.data.id}`, 2)).status, 200);
});
test("unread counts and read positions are per member and cannot skip future messages", async () => {
  await selected();
  const id = await group();
  for (const who of [0, 1, 2])
    await post(`/${id}/read`, { throughSequence: 999999 }, who);
  await send(id, 1);
  assert.equal((await get("", 0)).body.data[0].unread, 1);
  assert.equal((await get("", 1)).body.data[0].unread, 0);
  assert.equal((await get("", 2)).body.data[0].unread, 1);
  await post(`/${id}/read`, { throughSequence: 2 }, 2);
  assert.equal((await get("", 2)).body.data[0].unread, 0);
  assert.equal((await get("", 0)).body.data[0].unread, 1);
  await send(id, 1);
  assert.equal((await get("", 2)).body.data[0].unread, 1);
});
test("history is paginated in order and never crosses into another group", async () => {
  await selected();
  const id = await group();
  for (let i = 0; i < 5; i++)
    await send(id, 0, crypto.randomUUID(), `Message ${i}`);
  const latest = (await get(`/${id}?limit=2`)).body.data;
  assert.deepEqual(
    latest.messages.map((m: { sequence: number }) => m.sequence),
    [5, 6],
  );
  const earlier = (await get(`/${id}?limit=2&before=${latest.nextBefore}`)).body
    .data;
  assert.deepEqual(
    earlier.messages.map((m: { sequence: number }) => m.sequence),
    [3, 4],
  );
  assert.equal((await get(`/${id}?limit=101`)).status, 400);
  assert.equal(
    (await get(`/${crypto.randomBytes(12).toString("hex")}`)).status,
    404,
  );
});
test("revoked selection, organiser blocks, suspensions and moderation removal revoke access", async () => {
  await selected();
  const id = await group();
  await Activity.updateOne({ _id: plan }, { $pull: { participants: ids[1] } });
  assert.equal((await get(`/${id}`, 1)).status, 404);
  await Block.create({ user: ids[0], target: ids[2] });
  assert.equal((await send(id, 2)).status, 404);
  assert.deepEqual((await get("", 2)).body.data, []);
  await Block.deleteMany({});
  await User.updateOne({ _id: ids[0] }, { status: "suspended" });
  assert.equal((await get(`/${id}`, 2)).status, 404);
  await User.updateOne({ _id: ids[0] }, { status: "active" });
  await Activity.updateOne({ _id: plan }, { status: "paused" });
  assert.equal((await get(`/${id}`, 2)).status, 404);
  await Activity.updateOne({ _id: plan }, { status: "deleted" });
  assert.equal((await get(`/${id}`)).status, 404);
});
test("completed or past-date plans retain selected-member coordination; messaging restrictions still apply", async () => {
  await selected();
  const id = await group();
  await Activity.updateOne(
    { _id: plan },
    { startsAt: new Date(Date.now() - 86400000), ownerState: "successful" },
  );
  assert.equal((await get(`/${id}`, 1)).status, 200);
  await User.updateOne({ _id: ids[1] }, { "restrictions.messaging": true });
  assert.equal((await get(`/${id}`, 1)).body.data.canSend, false);
  assert.equal((await send(id, 1)).status, 403);
});
test("members cannot add outsiders, spoof senders, elevate themselves, or submit invalid messages", async () => {
  await selected();
  const id = await group();
  assert.equal(
    (
      await post(
        `/${id}/messages`,
        { text: "hi", clientId: "valid-key", sender: ids[0] },
        1,
      )
    ).status,
    400,
  );
  assert.equal(
    (await post(`/${id}/messages`, { text: " ", clientId: "valid-key" }, 1))
      .status,
    400,
  );
  assert.equal(
    (
      await post(
        `/${id}/messages`,
        { text: "x".repeat(2001), clientId: "valid-key" },
        1,
      )
    ).status,
    400,
  );
  assert.equal(
    (await post("", { activityId: plan, members: [ids[21]] })).status,
    400,
  );
  assert.equal((await get("/invalid")).status, 404);
});
