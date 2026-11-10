import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readdir, unlink, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import request from "supertest";
import sharp from "sharp";
import { MongoMemoryReplSet } from "mongodb-memory-server";
process.env.ADMIN_AUTH_MODE = "mfa";
process.env.ADMIN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.EMAIL_VERIFICATION_REQUIRED = "false";
process.env.PHOTO_STORAGE = "mongodb";
const { createApp } = await import("./app.js");
const {
  User,
  Profile,
  ProfilePhoto,
  Match,
  Conversation,
  Message,
  Block,
  Report,
  Activity,
  ActivityInterest,
  ProfileSwipe,
  Category,
} = await import("./models.js");
const {
  SocialMoment,
  MomentReaction,
  MomentView,
  SocialSettings,
  SocialNotification,
  PlanInvitation,
} = await import("./social-models.js");
const { tokens } = await import("./auth.js");
const { ensureMatch, pairKey } = await import("./chat.js");
const { cleanupSocial, socialDefaults } = await import("./social.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const { provisionFirstAdmin } = await import("./admin/provision.js");
const { totpFor } = await import("./admin/security.js");
const { AuditLog } = await import("./admin/models.js");
let db: MongoMemoryReplSet,
  directory: string,
  app = createApp();
let users: Record<string, string> = {},
  access: Record<string, string> = {};
before(
  async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "along-social-test-"));
    process.env.SOCIAL_MEDIA_DIR = directory;
    db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(db.getUri());
    await Promise.all([
      User.init(),
      Match.init(),
      Conversation.init(),
      MomentReaction.init(),
      MomentView.init(),
      SocialSettings.init(),
      SocialNotification.init(),
    ]);
  },
  { timeout: 180000 },
);
beforeEach(async () => {
  app = createApp();
  users = {};
  access = {};
  for (const model of [
    SocialMoment,
    MomentReaction,
    MomentView,
    SocialSettings,
    SocialNotification,
    PlanInvitation,
    Message,
    Conversation,
    Match,
    Block,
    Report,
    Activity,
    ActivityInterest,
    ProfileSwipe,
    ProfilePhoto,
    Profile,
    Category,
    User,
  ])
    await model.deleteMany({});
  await Category.create({ slug: "food", name: "Food & Dining", active: true });
  for (const who of ["alice", "bob", "cara", "outsider"]) {
    const user = await User.create({
      name: who,
      email: `${who}@example.test`,
      birthDate: "1997-01-01",
      passwordHash: "fixture",
    });
    users[who] = String(user._id);
    access[who] = (await tokens(users[who])).accessToken;
    await eligibleProfile(user._id);
  }
  await ensureMatch(users.alice, users.bob);
  await ensureMatch(users.alice, users.cara);
});
after(async () => {
  await mongoose.disconnect();
  if (db) await db.stop();
  if (directory) {
    for (const file of await readdir(directory))
      await unlink(path.join(directory, file));
    await rmdir(directory);
  }
});
const auth = (who: string) => ({ Authorization: `Bearer ${access[who]}` });
const get = (who: string, route: string) =>
  request(app).get(`/api/v1/social/${route}`).set(auth(who));
const write = (who: string, route: string, body: object = {}) =>
  request(app).post(`/api/v1/social/${route}`).set(auth(who)).send(body);
async function publish(who = "alice", extra: object = {}) {
  const r = await write(who, "moments", {
    type: "text",
    text: "Coffee and a little sunshine ☕",
    ...extra,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data.id as string;
}
const settings = (who: string, extra: object) =>
  request(app)
    .patch("/api/v1/social/settings")
    .set(auth(who))
    .send({ ...socialDefaults, ...extra });
const react = (who: string, moment: string, emoji = "❤️") =>
  request(app)
    .put(`/api/v1/social/moments/${moment}/reaction`)
    .set(auth(who))
    .send({ emoji });

async function socialPlan(who: string, extra: Record<string, unknown> = {}) {
  return Activity.create({
    creator: users[who],
    type: "together",
    category: "food",
    title: `${who}'s coffee plan`,
    description: "Coffee and a walk together.",
    zone: "Kolkata",
    startsAt: new Date(Date.now() + 86400000),
    ...extra,
  });
}

test("mixed Social feed includes live plans and statuses, paginates both together and opens existing details", async () => {
  const plan = await socialPlan("bob");
  const moment = await publish("bob");
  const own = await socialPlan("alice");
  const first = await get("alice", "feed?includePlans=true&limit=2");
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(
    first.body.data.items.map((item: { id: string }) => item.id),
    [String(own._id), moment],
  );
  assert.equal(first.body.data.items[0].kind, "plan");
  assert.equal(first.body.data.items[1].kind, "moment");
  const second = await get(
    "alice",
    `feed?includePlans=true&limit=2&before=${first.body.data.next}`,
  );
  assert.deepEqual(
    second.body.data.items.map((item: { id: string }) => item.id),
    [String(plan._id)],
  );
  assert.equal(second.body.data.next, null);
  assert.equal(second.body.data.items[0].plan.creator.name, "bob");
  assert.equal(second.body.data.items[0].plan.isOwner, false);
  assert.equal(
    (
      await request(app)
        .get(`/api/v1/activities/${plan._id}`)
        .set(auth("alice"))
    ).status,
    200,
  );
  assert.deepEqual(
    (await get("alice", "feed")).body.data.items.map(
      (item: { id: string }) => item.id,
    ),
    [moment],
  );
  assert.deepEqual(
    (
      await get("alice", `feed?includePlans=true&author=${users.bob}`)
    ).body.data.items.map((item: { id: string }) => item.id),
    [moment, String(plan._id)],
  );
});

test("missing plan location does not prevent reading status updates", async () => {
  const moment = await publish("bob");
  await socialPlan("bob");
  await Profile.updateOne(
    { user: users.alice },
    {
      $set: { "preferences.maxDistanceKm": 10 },
      $unset: { approximateLocation: 1 },
    },
  );
  const result = await get("alice", "feed?includePlans=true");
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(
    result.body.data.items.map((item: { id: string }) => item.id),
    [moment],
  );
});

test("Social plans follow Matches/Discover scope and do not expire after 24 hours", async () => {
  const matched = await socialPlan("bob", {
    createdAt: new Date(Date.now() - 3 * 86400000),
  });
  const discover = await socialPlan("outsider");
  const matches = await get("alice", "feed?includePlans=true");
  assert.deepEqual(
    matches.body.data.items.map((item: { id: string }) => item.id),
    [String(matched._id)],
  );
  const all = await get("alice", "feed?includePlans=true&scope=discover");
  assert.deepEqual(
    all.body.data.items.map((item: { id: string }) => item.id).sort(),
    [String(matched._id), String(discover._id)].sort(),
  );
  await Profile.updateOne({ user: users.outsider }, { city: "Delhi" });
  assert.equal(
    (await get("alice", "feed?includePlans=true&scope=discover")).body.data
      .items.length,
    1,
  );
});

test("Social never exposes private, expired, paused, deleted or audience-restricted plans", async () => {
  const live = await socialPlan("bob");
  await socialPlan("bob", {
    visibility: "private",
    participants: [users.alice, users.bob],
  });
  await socialPlan("bob", { startsAt: new Date(Date.now() - 86400000) });
  await socialPlan("bob", { ownerState: "paused" });
  await socialPlan("bob", { status: "deleted" });
  await socialPlan("bob", {
    audience: { minAge: 60, maxAge: 80, gender: "both" },
  });
  await socialPlan("bob", { category: "inactive-category" });
  const result = await get("alice", "feed?includePlans=true");
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(
    result.body.data.items.map((item: { id: string }) => item.id),
    [String(live._id)],
  );
});

test("Social plans disappear when muted, hidden, blocked, suspended or Social is disabled", async () => {
  await socialPlan("bob");
  assert.equal(
    (await get("alice", "feed?includePlans=true")).body.data.items.length,
    1,
  );
  await settings("alice", { muted: [users.bob] });
  assert.equal(
    (await get("alice", "feed?includePlans=true")).body.data.items.length,
    0,
  );
  await settings("alice", {});
  await settings("bob", { hidden: [users.alice] });
  assert.equal(
    (await get("alice", "feed?includePlans=true")).body.data.items.length,
    0,
  );
  await settings("bob", { enabled: false });
  assert.equal(
    (await get("alice", "feed?includePlans=true")).body.data.items.length,
    0,
  );
  await settings("bob", {});
  await Block.create({ user: users.bob, target: users.alice, reason: "test" });
  assert.equal(
    (await get("alice", "feed?includePlans=true&scope=discover")).body.data
      .items.length,
    0,
  );
  await Block.deleteMany({});
  await User.updateOne({ _id: users.bob }, { status: "suspended" });
  assert.equal(
    (await get("alice", "feed?includePlans=true&scope=discover")).body.data
      .items.length,
    0,
  );
});

test("feed toggle adds only preference-compatible, explicitly Discover-shared Moments and tray authors", async () => {
  const matched = await publish("bob");
  const discover = await publish("outsider", { audience: "discover" });
  const privateMoment = await publish("outsider");
  await publish("outsider", { audience: "only_me" });
  const circle = await publish("alice", {
    audience: "close_circle",
    allowed: [users.bob],
  });
  assert.deepEqual(
    (await get("bob", "feed")).body.data.items
      .map((m: { id: string }) => m.id)
      .sort(),
    [matched, circle].sort(),
  );
  const all = await get("bob", "feed?scope=discover");
  assert.deepEqual(
    all.body.data.items.map((m: { id: string }) => m.id).sort(),
    [matched, circle, discover].sort(),
  );
  assert.equal(
    all.body.data.items.find((m: { id: string }) => m.id === discover).canReply,
    false,
  );
  assert.equal(
    (await get("bob", "tray")).body.data.some(
      (m: { author: { id: string } }) => m.author.id === users.outsider,
    ),
    false,
  );
  assert.equal(
    (await get("bob", "tray?scope=discover")).body.data.some(
      (m: { author: { id: string } }) => m.author.id === users.outsider,
    ),
    true,
  );
  assert.equal((await get("bob", `moments/${privateMoment}`)).status, 404);
  assert.equal((await get("bob", `moments/${discover}`)).status, 200);
  assert.equal(
    (await write("bob", `moments/${discover}/replies`, { text: "Hello" }))
      .status,
    404,
  );
  assert.equal(await Match.countDocuments(), 2);
  assert.equal((await get("bob", "feed?scope=invalid")).status, 400);
  assert.equal((await get("bob", "tray?scope=invalid")).status, 400);
});

test("Discover updates obey age, gender, reciprocal preferences, city and saved distance without swipe exclusions", async () => {
  const moment = await publish("outsider", { audience: "discover" });
  const hasMoment = async () =>
    (await get("bob", "feed?scope=discover")).body.data.items.some(
      (m: { id: string }) => m.id === moment,
    );
  assert.equal(await hasMoment(), true);
  await ProfileSwipe.create({
    user: users.bob,
    target: users.outsider,
    action: "pass",
  });
  assert.equal(await hasMoment(), true);
  await Profile.updateOne({ user: users.bob }, { "preferences.maxAge": 20 });
  assert.equal(await hasMoment(), false);
  assert.equal((await get("bob", `moments/${moment}`)).status, 404);
  await Profile.updateOne(
    { user: users.bob },
    { "preferences.maxAge": 100, "preferences.genders": ["man"] },
  );
  assert.equal(await hasMoment(), false);
  await Profile.updateOne(
    { user: users.bob },
    { "preferences.genders": ["woman"] },
  );
  await Profile.updateOne(
    { user: users.outsider },
    { "preferences.genders": ["man"] },
  );
  assert.equal(await hasMoment(), false);
  await Profile.updateOne(
    { user: users.outsider },
    {
      "preferences.genders": ["woman"],
      city: "Nearby city",
      approximateLocation: { type: "Point", coordinates: [88.37, 22.57] },
    },
  );
  assert.equal(await hasMoment(), false);
  await Profile.updateOne(
    { user: users.bob },
    {
      "preferences.maxDistanceKm": 10,
      approximateLocation: { type: "Point", coordinates: [88.36, 22.57] },
    },
  );
  assert.equal(await hasMoment(), true);
  await Profile.updateOne(
    { user: users.outsider },
    { approximateLocation: { type: "Point", coordinates: [89.36, 22.57] } },
  );
  assert.equal(await hasMoment(), false);
  await Profile.updateOne({ user: users.bob }, { approximateLocation: null });
  assert.equal(await hasMoment(), false);
});

test("Discover mode narrows existing connections to preferences while matched mode retains them", async () => {
  const moment = await publish("alice");
  await Profile.updateOne(
    { user: users.bob },
    { "preferences.genders": ["man"] },
  );
  assert.equal((await get("bob", "feed")).body.data.items[0].id, moment);
  assert.equal(
    (await get("bob", "feed?scope=discover")).body.data.items.length,
    0,
  );
});

test("Discover access is revoked for disabled Social, blocked, suspended, hidden and expired updates", async () => {
  const moment = await publish("outsider", { audience: "discover" });
  await settings("outsider", { enabled: false });
  assert.equal((await get("bob", `moments/${moment}`)).status, 404);
  await settings("outsider", { enabled: true });
  await Block.create({ user: users.outsider, target: users.bob });
  assert.equal((await get("bob", `moments/${moment}`)).status, 404);
  await Block.deleteMany({});
  await User.updateOne({ _id: users.outsider }, { status: "suspended" });
  assert.equal((await get("bob", `moments/${moment}`)).status, 404);
  await User.updateOne({ _id: users.outsider }, { status: "active" });
  await SocialMoment.updateOne({ _id: moment }, { excluded: [users.bob] });
  assert.equal((await get("bob", `moments/${moment}`)).status, 404);
  await SocialMoment.updateOne(
    { _id: moment },
    { excluded: [], expiresAt: new Date(Date.now() - 1) },
  );
  assert.equal((await get("bob", `moments/${moment}`)).status, 404);
  assert.equal(
    (await get("bob", "feed?scope=discover")).body.data.items.length,
    0,
  );
});

test("Discover photo access, reactions and views use current audience permissions", async () => {
  const image = await sharp({
    create: { width: 20, height: 20, channels: 3, background: "#F47768" },
  })
    .png()
    .toBuffer();
  const created = await request(app)
    .post("/api/v1/social/moments")
    .set(auth("outsider"))
    .field("payload", JSON.stringify({ type: "photo", audience: "discover" }))
    .attach("photo", image, {
      filename: "moment.png",
      contentType: "image/png",
    });
  assert.equal(created.status, 201);
  const moment = created.body.data.id;
  assert.equal((await get("bob", `moments/${moment}/media`)).status, 200);
  assert.equal((await react("bob", moment)).status, 200);
  assert.equal((await write("bob", `moments/${moment}/views`)).status, 204);
  assert.equal(
    (await get("outsider", `moments/${moment}/reactions`)).body.data[0].id,
    users.bob,
  );
  assert.equal(
    (await get("outsider", `moments/${moment}/views`)).body.data[0].id,
    users.bob,
  );
  assert.equal(
    (await get("outsider", "notifications")).body.data[0].kind,
    "reaction",
  );
  await SocialMoment.updateOne({ _id: moment }, { audience: "matches" });
  assert.equal((await get("bob", `moments/${moment}/media`)).status, 404);
  assert.equal((await react("bob", moment)).status, 404);
});

test("text Moments use server publication time, exactly 24 hours, and expose only authorized cards", async () => {
  const moment = await publish();
  const m = await SocialMoment.findById(moment);
  assert.equal(+m!.expiresAt - +m!.publishedAt, 86400000);
  assert.equal((await get("bob", `moments/${moment}`)).status, 200);
  assert.equal((await get("outsider", `moments/${moment}`)).status, 404);
  const r = await get("bob", "feed");
  assert.equal(r.body.data.items.length, 1);
  assert.equal((await get("bob", "tray")).body.data[0].author.id, users.alice);
  for (const privateKey of ["allowed", "excluded", "media", "birthDate"])
    assert.equal(r.body.data.items[0][privateKey], undefined);
  assert.equal(
    (
      await write("alice", "moments", {
        type: "text",
        text: "Hello",
        expiresAt: "2099-01-01",
      })
    ).status,
    400,
  );
});
test("one-sided likes and pending activity requests do not grant access", async () => {
  const moment = await publish();
  await ProfileSwipe.create({
    user: users.alice,
    target: users.outsider,
    action: "like",
  });
  const plan = await Activity.create({
    creator: users.alice,
    category: "food",
    type: "together",
    title: "Coffee",
    description: "Coffee together",
    zone: "Park Street",
    startsAt: new Date(Date.now() + 86400000),
  });
  await ActivityInterest.create({ activity: plan._id, user: users.outsider });
  assert.equal((await get("outsider", `moments/${moment}`)).status, 404);
  const accepted = await request(app)
    .post(`/api/v1/activities/${plan._id}/interests`)
    .set(auth("outsider"))
    .send({});
  assert.ok([201, 409].includes(accepted.status));
});
test("activity connection reuses Match and preserves the owner's first-message rule", async () => {
  await Match.deleteMany({});
  await Conversation.deleteMany({});
  const plan = await Activity.create({
    creator: users.alice,
    category: "food",
    type: "together",
    title: "Coffee",
    description: "Coffee together",
    zone: "Park Street",
    startsAt: new Date(Date.now() + 86400000),
  });
  await ensureMatch(users.alice, users.bob, String(plan._id));
  const moment = await publish();
  assert.equal((await get("bob", `moments/${moment}`)).status, 200);
  assert.equal(
    (await write("bob", `moments/${moment}/replies`, { text: "Hi" })).status,
    403,
  );
  const conversation = await Conversation.findOne({});
  await request(app)
    .post(`/api/v1/conversations/${conversation!._id}/messages`)
    .set(auth("alice"))
    .send({ text: "Hello first" })
    .expect(201);
  assert.equal(
    (
      await write("bob", `moments/${moment}/replies`, {
        text: "Now I can reply",
      })
    ).status,
    201,
  );
  assert.equal(await Match.countDocuments(), 1);
  assert.equal(await Conversation.countDocuments(), 1);
});
test("blocks, unmatches, suspension and lost eligibility revoke views and interactions", async () => {
  const moment = await publish();
  await Block.create({ user: users.bob, target: users.alice });
  assert.equal((await get("bob", `moments/${moment}`)).status, 404);
  assert.equal((await react("bob", moment)).status, 404);
  await Block.deleteMany({});
  await Match.updateOne(
    { pairKey: pairKey(users.alice, users.bob) },
    { active: false },
  );
  assert.equal((await get("bob", `moments/${moment}`)).status, 404);
  await Match.updateOne(
    { pairKey: pairKey(users.alice, users.bob) },
    { active: true },
  );
  await User.updateOne({ _id: users.alice }, { status: "suspended" });
  assert.equal((await get("bob", `moments/${moment}`)).status, 404);
  await User.updateOne({ _id: users.alice }, { status: "active" });
  await Profile.updateOne({ user: users.alice }, { photos: [] });
  assert.equal((await get("bob", `moments/${moment}`)).status, 404);
  await User.updateOne({ _id: users.bob }, { status: "suspended" });
  assert.equal((await react("bob", moment)).status, 401);
});
test("Close Circle, exclusions, Only Me and global visibility are enforced server-side", async () => {
  const circle = await publish("alice", {
    audience: "close_circle",
    allowed: [users.bob],
  });
  assert.equal((await get("bob", `moments/${circle}`)).status, 200);
  assert.equal((await get("cara", `moments/${circle}`)).status, 404);
  const excluded = await publish("alice", { excluded: [users.bob] });
  assert.equal((await get("bob", `moments/${excluded}`)).status, 404);
  const own = await publish("alice", { audience: "only_me" });
  assert.equal((await get("bob", `moments/${own}`)).status, 404);
  assert.equal(
    (
      await write("alice", "moments", {
        type: "text",
        text: "Hello",
        audience: "close_circle",
        allowed: [users.outsider],
      })
    ).status,
    400,
  );
  await settings("alice", { hidden: [users.bob] });
  assert.equal((await get("bob", `moments/${circle}`)).status, 404);
  await settings("alice", { enabled: false });
  assert.equal((await get("cara", `moments/${excluded}`)).status, 404);
});
test("expiry is immediate even before cleanup; archives stay creator-only", async () => {
  const moment = await publish();
  await SocialMoment.updateOne(
    { _id: moment },
    { expiresAt: new Date(Date.now() - 1) },
  );
  assert.equal((await get("bob", "feed")).body.data.items.length, 0);
  assert.equal((await get("bob", `moments/${moment}`)).status, 404);
  assert.equal((await react("bob", moment)).status, 404);
  assert.equal((await write("bob", `moments/${moment}/views`)).status, 404);
  assert.equal(
    (await write("bob", `moments/${moment}/share`, { recipient: users.cara }))
      .status,
    404,
  );
  assert.equal(
    (await write("bob", `moments/${moment}/replies`, { text: "Too late" }))
      .status,
    404,
  );
  assert.equal((await get("bob", "my-archive")).body.data.length, 0);
  assert.equal((await get("alice", "my-archive")).body.data.length, 1);
  await cleanupSocial();
  assert.equal((await SocialMoment.findById(moment))!.status, "expired");
});
test("cleanup preserves archives and reported evidence without starving eligible deletions", async () => {
  const publishedAt = new Date(Date.now() - 32 * 86400000);
  const expiresAt = new Date(+publishedAt + 86400000);
  const content = {
    type: "text",
    text: "A retained memory",
    publishedAt,
    expiresAt,
    status: "expired",
  };
  await SocialMoment.insertMany(
    Array.from({ length: 100 }, () => ({ ...content, author: users.alice })),
  );
  await settings("bob", { archive: false });
  const [evidence, removable] = await SocialMoment.create([
    { ...content, author: users.bob },
    { ...content, author: users.bob },
  ]);
  await Report.create({
    reporter: users.alice,
    target: users.bob,
    moment: evidence._id,
    reason: "Retain this reported evidence.",
  });
  await MomentReaction.create({
    moment: removable._id,
    user: users.alice,
    emoji: "☕",
  });
  await MomentView.create({ moment: removable._id, user: users.alice });
  await cleanupSocial();
  assert.equal(await SocialMoment.countDocuments({ author: users.alice }), 100);
  assert.ok(await SocialMoment.findById(evidence._id));
  assert.equal(await SocialMoment.findById(removable._id), null);
  assert.equal(
    await MomentReaction.countDocuments({ moment: removable._id }),
    0,
  );
  assert.equal(await MomentView.countDocuments({ moment: removable._id }), 0);
});
test("reactions are unique, replaceable and removable without leaking other matches", async () => {
  const moment = await publish();
  await react("bob", moment);
  await react("bob", moment, "🔥");
  assert.equal(await MomentReaction.countDocuments({ moment }), 1);
  assert.equal((await MomentReaction.findOne({ moment }))!.emoji, "🔥");
  assert.equal(
    (await get("cara", `moments/${moment}`)).body.data.reaction,
    null,
  );
  await request(app)
    .delete(`/api/v1/social/moments/${moment}/reaction`)
    .set(auth("bob"))
    .expect(204);
  assert.equal(await MomentReaction.countDocuments({ moment }), 0);
  assert.equal(
    await SocialNotification.countDocuments({
      recipient: users.alice,
      kind: "reaction",
    }),
    1,
  );
});
test("views are deduplicated and creator-only; revoked matches leave the viewer list", async () => {
  const moment = await publish();
  await write("bob", `moments/${moment}/views`);
  await write("bob", `moments/${moment}/views`);
  assert.equal(await MomentView.countDocuments({ moment }), 1);
  assert.equal(
    (await get("alice", `moments/${moment}/views`)).body.data.length,
    1,
  );
  assert.equal((await get("cara", `moments/${moment}/views`)).status, 404);
  await Match.updateOne(
    { pairKey: pairKey(users.alice, users.bob) },
    { active: false },
  );
  assert.equal(
    (await get("alice", `moments/${moment}/views`)).body.data.length,
    0,
  );
});
test("disabled view receipts retain personal seen state without exposing a viewer", async () => {
  const moment = await publish();
  await settings("bob", { viewReceipts: false });
  await write("bob", `moments/${moment}/views`);
  assert.equal(
    (await get("alice", `moments/${moment}/views`)).body.data.length,
    0,
  );
  assert.equal((await get("bob", "tray")).body.data[0].viewed, true);
});
test("audience changes immediately revoke access and blocked users cannot enter Close Circle", async () => {
  const moment = await publish();
  await request(app)
    .patch(`/api/v1/social/moments/${moment}/audience`)
    .set(auth("alice"))
    .send({
      audience: "only_me",
      allowed: [],
      excluded: [],
      allowReshare: false,
    })
    .expect(204);
  assert.equal((await get("bob", `moments/${moment}`)).status, 404);
  assert.equal((await get("bob", "notifications")).body.data.length, 0);
  await Block.create({ user: users.alice, target: users.bob });
  assert.equal(
    (await settings("alice", { closeCircle: [users.bob] })).status,
    400,
  );
});
test("private replies arrive in the existing conversation without public comment threads", async () => {
  const moment = await publish();
  const reply = await write("bob", `moments/${moment}/replies`, {
    text: "Coffee sounds lovely",
  });
  assert.equal(reply.status, 201);
  assert.equal(await Conversation.countDocuments(), 2);
  const thread = await request(app)
    .get(`/api/v1/conversations/${reply.body.data.conversationId}`)
    .set(auth("alice"));
  assert.equal(thread.body.data.messages[0].text, "Coffee sounds lovely");
  assert.equal(thread.body.data.messages[0].socialMomentId, moment);
  assert.equal(
    (
      await request(app)
        .get(`/api/v1/conversations/${reply.body.data.conversationId}`)
        .set(auth("cara"))
    ).status,
    404,
  );
  assert.equal(
    (await get("cara", `moments/${moment}`)).body.data.comments,
    undefined,
  );
});
test("sharing requires opt-in, recipient authorization and an existing eligible conversation", async () => {
  const moment = await publish("alice", { allowReshare: true });
  assert.equal(
    (
      await write("bob", `moments/${moment}/share`, {
        recipient: users.outsider,
      })
    ).status,
    404,
  );
  await ensureMatch(users.bob, users.cara);
  assert.equal(
    (await write("bob", `moments/${moment}/share`, { recipient: users.cara }))
      .status,
    201,
  );
  const circle = await publish("alice", {
    allowReshare: true,
    audience: "close_circle",
    allowed: [users.bob],
  });
  assert.equal(
    (await write("bob", `moments/${circle}/share`, { recipient: users.cara }))
      .status,
    404,
  );
  const noShare = await publish();
  assert.equal(
    (await write("bob", `moments/${noShare}/share`, { recipient: users.cara }))
      .status,
    403,
  );
});
test("private media is normalized and revoked on unmatch; videos and malformed photos are rejected", async () => {
  const image = await sharp({
    create: { width: 80, height: 80, channels: 3, background: "#174F54" },
  })
    .png()
    .toBuffer();
  const r = await request(app)
    .post("/api/v1/social/moments")
    .set(auth("alice"))
    .field(
      "payload",
      JSON.stringify({ type: "photo", caption: "A little sunshine" }),
    )
    .attach("photo", image, {
      filename: "moment.png",
      contentType: "image/png",
    });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const moment = r.body.data.id;
  const media = await get("bob", `moments/${moment}/media`);
  assert.equal(media.status, 200);
  assert.ok(media.body.length < 100_000);
  assert.equal(media.headers["cache-control"], "private, no-store");
  assert.equal((await sharp(media.body).metadata()).exif, undefined);
  assert.equal(
    (await SocialMoment.findById(moment).select("+media"))!.media?.startsWith(
      "local:",
    ),
    true,
  );
  await Match.updateOne(
    { pairKey: pairKey(users.alice, users.bob) },
    { active: false },
  );
  assert.equal((await get("bob", `moments/${moment}/media`)).status, 404);
  assert.equal(
    (await write("alice", "moments", { type: "video", text: "Video" })).status,
    400,
  );
  const bad = await request(app)
    .post("/api/v1/social/moments")
    .set(auth("alice"))
    .field("payload", JSON.stringify({ type: "photo" }))
    .attach("photo", Buffer.from("not an image"), {
      filename: "bad.jpg",
      contentType: "image/jpeg",
    });
  assert.equal(bad.status, 400);
});
test("Make a Plan requires mutual acceptance; changes invalidate old acceptance and public lists stay private", async () => {
  const moment = await publish();
  const body = {
    title: "Coffee together",
    category: "food",
    zone: "Park Street",
    startsAt: new Date(Date.now() + 86400000).toISOString(),
  };
  const created = await write("bob", `moments/${moment}/make-plan`, body);
  assert.equal(created.status, 201);
  const invitation = created.body.data.id;
  assert.equal(await Activity.countDocuments(), 0);
  assert.equal(
    (
      await write("outsider", `invitations/${invitation}/respond`, {
        action: "accept",
        version: 0,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await write("alice", `invitations/${invitation}/respond`, {
        action: "changes",
        version: 0,
        proposal: { ...body, title: "Tea together" },
      })
    ).status,
    204,
  );
  assert.equal(
    (
      await write("alice", `invitations/${invitation}/respond`, {
        action: "accept",
        version: 0,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await write("bob", `invitations/${invitation}/respond`, {
        action: "accept",
        version: 1,
      })
    ).status,
    204,
  );
  const plan = await Activity.findOne({});
  assert.equal(plan!.visibility, "private");
  assert.equal(plan!.participants.length, 2);
  assert.equal(
    (await request(app).get("/api/v1/activities/browse").set(auth("outsider")))
      .body.data.items.length,
    0,
  );
  assert.equal(
    (
      await request(app)
        .get(`/api/v1/activities/${plan!._id}`)
        .set(auth("outsider"))
    ).status,
    404,
  );
  for (const who of ["alice", "bob"]) {
    assert.equal(
      (await request(app).get(`/api/v1/activities/${plan!._id}`).set(auth(who)))
        .status,
      200,
    );
    assert.equal(
      (
        await request(app)
          .get("/api/v1/activities/browse?owner=true")
          .set(auth(who))
      ).body.data.items.length,
      1,
    );
  }
  assert.equal(
    (
      await write("bob", `invitations/${invitation}/respond`, {
        action: "accept",
        version: 1,
      })
    ).status,
    409,
  );
  assert.equal(await Activity.countDocuments(), 1);
  const publicProfile = await request(app)
    .get(`/api/v1/discovery/${users.bob}`)
    .set(auth("cara"));
  assert.equal(publicProfile.body.data.plans.length, 0);
  assert.equal(
    (
      await request(app)
        .patch(`/api/v1/activities/${plan!._id}`)
        .set(auth("alice"))
        .send({ title: "Unilateral change" })
    ).status,
    409,
  );
  await Match.updateOne(
    { pairKey: pairKey(users.alice, users.bob) },
    { active: false },
  );
  assert.equal(
    (await request(app).get(`/api/v1/activities/${plan!._id}`).set(auth("bob")))
      .status,
    404,
  );
});
test("notifications and muting honor current privacy settings", async () => {
  await settings("bob", { notifications: false });
  await publish();
  assert.equal((await get("bob", "notifications")).body.data.length, 0);
  await settings("bob", { muted: [users.alice] });
  assert.equal((await get("bob", "feed")).body.data.items.length, 0);
  await settings("bob", {});
  const moment = await publish();
  assert.equal((await get("bob", "notifications")).body.data.length, 1);
  await SocialMoment.updateOne({ _id: moment }, { status: "removed" });
  assert.equal((await get("bob", "notifications")).body.data.length, 0);
});
test("admin content access is report-scoped, permission-checked and audited; removal revokes access", async () => {
  const moment = await publish();
  await write("bob", `moments/${moment}/report`, {
    reason: "This Moment contains prohibited content.",
  });
  const report = await Report.findOne({ moment });
  const password = `Aa1!${crypto.randomBytes(20).toString("hex")}`;
  const bootstrap = await provisionFirstAdmin(
    "social-admin@example.test",
    password,
    "Social Moderator",
  );
  const agent = request.agent(app);
  const login = await agent
    .post("/api/v1/admin/auth/login")
    .set("Origin", "http://localhost:3000")
    .send({
      email: "social-admin@example.test",
      password,
      code: totpFor(bootstrap.secret).generate(),
    });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const csrf = login.body.data.csrf;
  assert.equal(
    (await agent.get(`/api/v1/admin/social/reports/${report!._id}`)).status,
    400,
  );
  const detail = await agent.get(
    `/api/v1/admin/social/reports/${report!._id}?reason=Investigating%20reported%20content`,
  );
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.data.moment.text, "Coffee and a little sunshine ☕");
  const unreported = await publish();
  assert.equal(
    (
      await agent.get(
        `/api/v1/admin/social/reports/${unreported}?reason=Investigating%20reported%20content`,
      )
    ).status,
    404,
  );
  const removed = await agent
    .post(`/api/v1/admin/social/reports/${report!._id}/moderate`)
    .set({ Origin: "http://localhost:3000", "X-CSRF-Token": csrf })
    .send({
      action: "remove",
      reason: "Confirmed breach of community guidelines.",
    });
  assert.equal(removed.status, 204, JSON.stringify(removed.body));
  assert.equal((await get("bob", `moments/${moment}`)).status, 404);
  assert.equal(
    await AuditLog.countDocuments({ action: "social.report_content_viewed" }),
    1,
  );
  assert.equal(await AuditLog.countDocuments({ action: "social.remove" }), 1);
  assert.equal(
    (await request(app).get("/api/v1/admin/social/reports").set(auth("bob")))
      .status,
    401,
  );
});
