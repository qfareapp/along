import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
process.env.ADMIN_AUTH_MODE = "mfa";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.EMAIL_VERIFICATION_REQUIRED = "false";
const { createApp } = await import("./app.js");
const {
  Activity,
  ActivityInterest,
  ActivitySave,
  Block,
  Category,
  Conversation,
  Match,
  Profile,
  ProfilePhoto,
  User,
} = await import("./models.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const { tokens } = await import("./auth.js");
const app = createApp();
let db: MongoMemoryReplSet;
const ids: string[] = [],
  auth: string[] = [];
let plan: string;
const get = (path: string, who = 0) =>
  request(app).get(`/api/v1/${path}`).set("Authorization", auth[who]);
const post = (path: string, who = 0) =>
  request(app).post(`/api/v1/${path}`).set("Authorization", auth[who]);
const input = (overrides: Record<string, unknown> = {}) => ({
  creator: ids[1],
  category: "food",
  type: "together",
  title: "Coffee after work",
  description: "A relaxed coffee and good conversation.",
  zone: "Park Street",
  startsAt: new Date(Date.now() + 86400000),
  ...overrides,
});
before(
  async () => {
    db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(db.getUri());
    await Promise.all([
      Activity.init(),
      ActivityInterest.init(),
      ActivitySave.init(),
      Match.init(),
      Conversation.init(),
    ]);
    for (let i = 0; i < 5; i++) {
      const user = await User.create({
        name: `Plan member ${i}`,
        email: `plan${i}@example.test`,
        birthDate: "1997-01-01",
        passwordHash: "fixture",
      });
      ids.push(String(user._id));
      auth.push(`Bearer ${(await tokens(String(user._id))).accessToken}`);
      await eligibleProfile(user._id);
    }
    await Profile.updateMany(
      {},
      { approximateLocation: { type: "Point", coordinates: [88.36, 22.57] } },
    );
    await Category.create([
      { slug: "food", name: "Coffee & Food", coverAssetKey: "food" },
      { slug: "learning", name: "Study Together" },
      { slug: "disabled", name: "Disabled", active: false },
      { slug: "elsewhere", name: "Elsewhere", cities: ["Delhi"] },
    ]);
    plan = String((await Activity.create(input()))._id);
    await Activity.create([
      input({
        startsAt: new Date(Date.now() - 86400000),
        title: "Expired plan",
      }),
      input({ status: "paused" }),
      input({ status: "deleted" }),
      input({ category: "disabled" }),
      input({ category: "elsewhere" }),
    ]);
  },
  { timeout: 180000 },
);
after(async () => {
  await mongoose.disconnect();
  if (db) await db.stop();
});

test("Mongo categories count exactly the eligible live feed, including empty categories", async () => {
  const categories = await get("activities/categories");
  assert.equal(categories.status, 200, JSON.stringify(categories.body));
  assert.deepEqual(
    categories.body.data.map((c: any) => [c.slug, c.liveCount]).sort(),
    [
      ["food", 1],
      ["learning", 0],
    ],
  );
  const feed = await get("activities/browse?category=food");
  assert.equal(feed.body.data.total, 1);
  assert.equal(feed.body.data.items[0]._id, plan);
  assert.equal(feed.body.data.items[0].description, undefined);
  assert.equal(feed.body.data.items[0].approximateLocation, undefined);
  assert.equal(feed.body.data.items[0].creator.age > 18, true);
  assert.ok(feed.body.data.items[0].creator.photoId);
  assert.equal(feed.body.data.items[0].creator.email, undefined);
  assert.equal(feed.body.data.items[0].creator.birthDate, undefined);
  assert.equal(
    (await get(`activities/${plan}`)).body.data.description,
    input().description,
  );
  assert.equal(await Match.countDocuments(), 0);
});

test("legacy activity documents without new fields remain viewable and joinable", async () => {
  const legacy = await Activity.collection.insertOne({
    ...input(),
    creator: new mongoose.Types.ObjectId(ids[1]),
    status: "active",
  } as any);
  const detail = (await get(`activities/${legacy.insertedId}`)).body.data;
  assert.equal(detail.activityType, "one_on_one");
  assert.equal(detail.placesLeft, 1);
  assert.equal(
    (await post(`activities/${legacy.insertedId}/interests`)).status,
    201,
  );
  await ActivityInterest.deleteMany({ activity: legacy.insertedId });
  await Activity.deleteOne({ _id: legacy.insertedId });
});

test("plan visibility includes discovery fallback members while preserving their preferences", async () => {
  await Profile.updateOne({ user: ids[0] }, { "preferences.maxAge": 24 });
  try {
    const feed = await get("activities/browse?category=food");
    assert.equal(feed.status, 200, JSON.stringify(feed.body));
    assert.equal(feed.body.data.total, 1);
    assert.equal(feed.body.data.items[0]._id, plan);
    assert.equal(
      (await get("activities/categories")).body.data.find(
        (c: any) => c.slug === "food",
      ).liveCount,
      1,
    );
    assert.equal((await get(`activities/${plan}`)).status, 200);
    await Profile.updateOne(
      { user: ids[1] },
      { "preferences.genders": ["man"] },
    );
    assert.equal(
      (await get("activities/browse?category=food")).body.data.total,
      0,
    );
  } finally {
    await Profile.updateOne({ user: ids[0] }, { "preferences.maxAge": 100 });
    await Profile.updateOne(
      { user: ids[1] },
      {
        "preferences.genders": ["woman", "man", "nonbinary", "self_described"],
      },
    );
  }
});

test("owners can find and reschedule earlier plans without exposing expired plans to others", async () => {
  const expired = await Activity.findOne({ title: "Expired plan" });
  assert.ok(expired);
  const cats = (await get("activities/categories", 1)).body.data;
  assert.equal(cats.find((c: any) => c.slug === "food").ownPastCount, 1);
  const mine = (await get("activities/browse?category=food&owner=true", 1)).body
    .data;
  assert.equal(
    mine.items.some((p: any) => p._id === String(expired._id) && p.expired),
    true,
  );
  assert.equal(
    (await get("activities/browse?category=food&owner=true", 0)).body.data
      .total,
    0,
  );
  assert.equal(
    (await get(`activities/${expired._id}`, 1)).body.data.expired,
    true,
  );
  assert.equal((await get(`activities/${expired._id}`, 0)).status, 404);
  const changed = await request(app)
    .patch(`/api/v1/activities/${expired._id}`)
    .set("Authorization", auth[1])
    .send({
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: null,
    });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(
    (await get(`activities/${expired._id}`, 0)).body.data.expired,
    false,
  );
  assert.equal(
    (await get("activities/categories")).body.data.find(
      (c: any) => c.slug === "food",
    ).liveCount,
    2,
  );
  // Restore the existing expired fixture for the remaining expiry tests.
  await Activity.updateOne(
    { _id: expired._id },
    { startsAt: new Date(Date.now() - 86400000), endsAt: null },
  );
});

test("expiry, valid ongoing and recurring plans use the same rules for counts and lists", async () => {
  const ongoing = await Activity.create(
    input({
      startsAt: new Date(Date.now() - 3600000),
      endsAt: new Date(Date.now() + 3600000),
    }),
  );
  const recurring = await Activity.create(
    input({ startsAt: new Date(Date.now() - 86400000), recurring: true }),
  );
  const ended = await Activity.create(
    input({
      startsAt: new Date(Date.now() - 86400000),
      recurring: true,
      endsAt: new Date(Date.now() - 1000),
    }),
  );
  assert.equal(
    (await get("activities/browse?category=food")).body.data.total,
    3,
  );
  assert.equal((await get(`activities/${ended._id}`)).status, 404);
  await Activity.deleteMany({
    _id: { $in: [ongoing._id, recurring._id, ended._id] },
  });
});

test("blocks, suspensions, preferences and location hide plans and prevent interactions", async () => {
  await Block.create({ user: ids[1], target: ids[0] });
  assert.equal((await get("activities/browse")).body.data.total, 0);
  assert.equal((await get(`activities/${plan}`)).status, 404);
  assert.equal((await post(`activities/${plan}/interests`)).status, 404);
  await Block.deleteMany({});
  await User.updateOne({ _id: ids[1] }, { status: "suspended" });
  assert.equal((await get("activities/browse")).body.data.total, 0);
  await User.updateOne({ _id: ids[1] }, { status: "active" });
  await Profile.updateOne({ user: ids[1] }, { "preferences.genders": ["man"] });
  assert.equal((await get("activities/browse")).body.data.total, 0);
  await Profile.updateOne(
    { user: ids[1] },
    { "preferences.genders": ["woman", "man"] },
  );
  await Profile.updateOne({ user: ids[1] }, { city: "Delhi" });
  assert.equal((await get("activities/browse")).body.data.total, 0);
  await Profile.updateOne({ user: ids[1] }, { city: "Kolkata" });
});

test("search matches descriptions and category names, and filters compose", async () => {
  assert.equal(
    (await get("activities/categories?q=coffee")).body.data[0].slug,
    "food",
  );
  assert.equal(
    (
      await get(
        "activities/browse?q=conversation&category=food&kind=one_on_one",
      )
    ).body.data.total,
    1,
  );
  assert.equal(
    (await get("activities/browse?q=conversation&category=learning")).body.data
      .total,
    0,
  );
  assert.equal((await get("activities/browse?kind=group")).body.data.total, 0);
  assert.equal((await get("activities/browse?q=%5B.*")).body.data.total, 0);
  const local = new Date(Date.now() + 330 * 60000);
  const tonight = new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + 1,
    ) -
      330 * 60000 -
      1000,
  );
  const today = await Activity.create(
    input({ startsAt: tonight, activityType: "group", capacity: 3 }),
  );
  const filtered = (
    await get("activities/browse?when=today&kind=group&timezoneOffset=-330")
  ).body.data;
  assert.deepEqual(
    filtered.items.map((p: any) => p._id),
    [String(today._id)],
  );
  await Activity.deleteOne({ _id: today._id });
});

test("pagination has stable order, accurate totals, and no duplicates", async () => {
  const extra = await Activity.create([
    input({ title: "Second coffee" }),
    input({ title: "Third coffee" }),
  ]);
  const one = (await get("activities/browse?limit=2")).body.data;
  const two = (await get(`activities/browse?limit=2&offset=${one.nextOffset}`))
    .body.data;
  assert.equal(one.total, 3);
  assert.equal(two.nextOffset, null);
  assert.equal(
    new Set([...one.items, ...two.items].map((p: any) => p._id)).size,
    3,
  );
  await Activity.deleteMany({ _id: { $in: extra.map((a) => a._id) } });
});

test("Nearby uses existing geospatial location and never exposes coordinates", async () => {
  const feed = await get("activities/browse?nearby=true&sort=nearest");
  assert.equal(feed.status, 200, JSON.stringify(feed.body));
  assert.equal(feed.body.data.total, 1);
  assert.equal(JSON.stringify(feed.body).includes("coordinates"), false);
  await Profile.updateOne(
    { user: ids[0] },
    { $unset: { approximateLocation: 1 } },
  );
  assert.equal((await get("activities/browse?sort=nearest")).status, 400);
  await Profile.updateOne(
    { user: ids[0] },
    { approximateLocation: { type: "Point", coordinates: [88.36, 22.57] } },
  );
});

test("bookmarks persist per member and toggling never changes another member's save", async () => {
  assert.equal((await post(`activities/${plan}/save`)).status, 204);
  await post(`activities/${plan}/save`);
  assert.equal(await ActivitySave.countDocuments(), 1);
  assert.equal((await get("activities/browse?saved=true")).body.data.total, 1);
  assert.equal((await get(`activities/${plan}`)).body.data.saved, true);
  assert.equal(
    (await get("activities/browse?saved=true", 2)).body.data.total,
    0,
  );
  await request(app)
    .delete(`/api/v1/activities/${plan}/save`)
    .set("Authorization", auth[2]);
  assert.equal(await ActivitySave.countDocuments(), 1);
  await request(app)
    .delete(`/api/v1/activities/${plan}/save`)
    .set("Authorization", auth[0]);
  assert.equal((await get("activities/browse?saved=true")).body.data.total, 0);
});

test("requests require acceptance; duplicate requests persist once; only organizer may accept", async () => {
  assert.equal((await post(`activities/${plan}/interests`, 1)).status, 404);
  const r = await post(`activities/${plan}/interests`);
  const interestId = r.body.data._id;
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(
    (await post(`activities/${plan}/interests`)).body.data._id,
    interestId,
  );
  assert.equal(await ActivityInterest.countDocuments(), 1);
  assert.equal(await Conversation.countDocuments(), 0);
  assert.equal(
    (await post(`notifications/${interestId}/conversation`, 2)).status,
    404,
  );
  const accepted = await post(`notifications/${interestId}/conversation`, 1);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.ok(accepted.body.data.id);
  assert.equal(
    (await get(`activities/${plan}`)).body.data.interestStatus,
    "accepted",
  );
  const notifications = (await get("notifications")).body.data;
  assert.equal(notifications[0].role, "applicant");
  assert.equal(notifications[0].status, "accepted");
  assert.equal(notifications[0].readAt, null);
  assert.equal((await post(`notifications/${interestId}/read`)).status, 204);
  assert.ok((await get("notifications")).body.data[0].readAt);
  assert.equal((await post(`activities/${plan}/interests`, 2)).status, 409);
});

test("concurrent group acceptances cannot exceed capacity or partially open a chat", async () => {
  const group = await Activity.create(
    input({ activityType: "group", capacity: 1 }),
  );
  const a = (await post(`activities/${group._id}/interests`, 2)).body.data._id;
  const b = (await post(`activities/${group._id}/interests`, 3)).body.data._id;
  const responses = await Promise.all([
    post(`notifications/${a}/conversation`, 1),
    post(`notifications/${b}/conversation`, 1),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await Activity.findById(group._id))!.participants.length, 1);
  assert.equal(
    await ActivityInterest.countDocuments({
      activity: group._id,
      status: "accepted",
    }),
    1,
  );
  assert.equal(
    await ActivityInterest.countDocuments({
      activity: group._id,
      status: "pending",
    }),
    1,
  );
});

test("declining is private, durable and cannot subsequently open a conversation", async () => {
  const target = await Activity.create(input());
  const interest = (await post(`activities/${target._id}/interests`, 4)).body
    .data._id;
  assert.equal(
    (await post(`activities/${target._id}/interests/${interest}/decline`, 2))
      .status,
    404,
  );
  assert.equal(
    (await post(`activities/${target._id}/interests/${interest}/decline`, 1))
      .status,
    204,
  );
  assert.equal(
    (await get(`activities/${target._id}`, 4)).body.data.interestStatus,
    "declined",
  );
  assert.equal(
    (await post(`notifications/${interest}/conversation`, 1)).status,
    409,
  );
});

test("admin category metadata changes reach mobile and disabled categories disappear", async () => {
  await Category.updateOne(
    { slug: "food" },
    {
      name: "New cafe name",
      coverAssetKey: "coffee",
      coverImageUrl: "https://example.test/cover.png",
    },
  );
  const c = (await get("activities/categories")).body.data.find(
    (c: any) => c.slug === "food",
  );
  assert.equal(c.name, "New cafe name");
  assert.equal(c.coverAssetKey, "coffee");
  assert.equal(c.coverImageUrl, "https://example.test/cover.png");
  await Category.updateOne({ slug: "food" }, { active: false });
  assert.equal(
    (await get("activities/browse?category=food")).body.data.total,
    0,
  );
  assert.equal((await post(`activities/${plan}/save`)).status, 404);
  await Category.updateOne({ slug: "food" }, { active: true });
});

test("posting remains compatible and eligibility and optional fields are server validated", async () => {
  const { creator, ...body } = input({
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    activityType: "group",
    capacity: 5,
    highlight: "A short highlight",
  });
  const r = await post("activities").send(body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.creator, ids[0]);
  assert.equal(r.body.data.activityType, "group");
  assert.equal(r.body.data.capacity, 5);
  assert.equal(
    (await post("activities").send({ ...body, capacity: 0 })).status,
    400,
  );
  assert.equal(
    (
      await post("activities").send({
        ...body,
        endsAt: new Date(Date.now() - 1000).toISOString(),
      })
    ).status,
    400,
  );
  await User.updateOne({ _id: ids[0] }, { "restrictions.posting": true });
  assert.equal((await post("activities").send(body)).status, 403);
  await User.updateOne({ _id: ids[0] }, { "restrictions.posting": false });
  assert.equal(
    (await request(app).get("/api/v1/activities/categories")).status,
    401,
  );
  await Profile.updateOne({ user: ids[4] }, { photos: [] });
  assert.equal((await get("activities/browse", 4)).status, 403);
});

test("category details persist, appear on the public detail and validate owner edits", async () => {
  await Category.create({ slug: "commute", name: "Office Commute" });
  const categoryDetails = {
    source: "Salt Lake",
    destination: "New Town",
    departureTime: "08:30",
    returnTime: "18:30",
    workingDays: ["Mon", "Wed", "Fri"],
    transport: "Carpool",
  };
  const body = {
    ...input({ category: "commute", recurring: true }),
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    categoryDetails,
  };
  const created = await post("activities").send(body);
  assert.equal(created.status, 201);
  const id = created.body.data._id;
  assert.deepEqual(
    (await get(`activities/${id}`)).body.data.categoryDetails,
    categoryDetails,
  );
  assert.deepEqual(
    (await Activity.findById(id))!.categoryDetails,
    categoryDetails,
  );
  assert.equal(
    (
      await post("activities").send({
        ...body,
        categoryDetails: { ...categoryDetails, workingDays: [] },
      })
    ).status,
    400,
  );
  assert.equal(
    (await post("activities").send({ ...body, category: "food" })).status,
    400,
  );
  assert.equal(
    (
      await request(app)
        .patch(`/api/v1/activities/${id}`)
        .set("Authorization", auth[0])
        .send({
          categoryDetails: { ...categoryDetails, departureTime: "28:00" },
        })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(app)
        .patch(`/api/v1/activities/${id}`)
        .set("Authorization", auth[0])
        .send({ categoryDetails: { ...categoryDetails, returnTime: "19:00" } })
    ).status,
    200,
  );
  assert.equal(
    (await get(`activities/${id}`)).body.data.categoryDetails.returnTime,
    "19:00",
  );
});

test("only the owner can pause, resume or mark success; non-live plans stay privately manageable", async () => {
  const activity = await Activity.create(
    input({
      creator: ids[0],
      title: "Owner status lifecycle",
      activityType: "group",
      capacity: 4,
      participants: [ids[1]],
    }),
  );
  const id = String(activity._id);
  const set = (state: string, who = 0) =>
    request(app)
      .patch(`/api/v1/activities/${id}/state`)
      .set("Authorization", auth[who])
      .send({ state })
      .timeout(10000);
  const match = await Match.create({
    pairKey: `status-${id}`,
    users: [ids[0], ids[1]],
    activity: activity._id,
    active: true,
  });
  const conversation = String(
    (await Conversation.create({ match: match._id, firstSender: ids[0] }))._id,
  );
  await ActivityInterest.create({
    activity: activity._id,
    user: ids[1],
    status: "accepted",
    conversation,
  });
  const pending = (await post(`activities/${id}/interests`, 2)).body.data._id;
  assert.equal((await set("paused", 1)).status, 404);
  assert.equal((await set("deleted")).status, 400);
  const liveCount = (await get("activities/categories", 1)).body.data.find(
    (c: any) => c.slug === "food",
  ).liveCount;
  assert.equal((await set("paused")).status, 200);
  assert.equal((await get(`activities/${id}`)).body.data.ownerState, "paused");
  assert.equal((await get(`activities/${id}`, 1)).status, 404);
  assert.equal(
    (await get(`activities/browse?q=Owner%20status%20lifecycle`, 1)).body.data
      .total,
    0,
  );
  assert.equal(
    (await get(`activities/browse?owner=true&q=Owner%20status%20lifecycle`))
      .body.data.items[0].ownerState,
    "paused",
  );
  assert.equal(
    (await get("activities/categories", 1)).body.data.find(
      (c: any) => c.slug === "food",
    ).liveCount,
    liveCount - 1,
  );
  assert.ok(
    (await get("activities/categories")).body.data.find(
      (c: any) => c.slug === "food",
    ).ownManagedCount >= 1,
  );
  assert.equal((await post(`activities/${id}/interests`, 3)).status, 404);
  assert.equal(
    (await post(`notifications/${pending}/conversation`, 0)).status,
    404,
  );
  assert.ok(await Conversation.exists({ _id: conversation }));
  const chat = await Conversation.findById(conversation).lean();
  assert.ok(chat);
  assert.ok(await Match.exists({ _id: chat.match, active: true }));
  assert.equal((await get(`conversations/${conversation}`, 1)).status, 200);
  assert.equal(
    (
      await post(`conversations/${conversation}/messages`).send({
        text: "We can still chat while the plan is paused.",
      })
    ).status,
    201,
  );
  assert.equal((await set("successful")).status, 200);
  assert.equal((await set("successful")).status, 200);
  assert.equal(
    (await get(`activities/${id}`)).body.data.ownerState,
    "successful",
  );
  assert.equal((await get(`activities/${id}`, 1)).status, 404);
  assert.equal((await get(`conversations/${conversation}`, 1)).status, 200);
  assert.equal((await set("live")).status, 200);
  assert.equal((await get(`activities/${id}`, 1)).body.data.ownerState, "live");
  assert.equal(
    (await get("activities/categories", 1)).body.data.find(
      (c: any) => c.slug === "food",
    ).liveCount,
    liveCount,
  );
  assert.ok(await Match.exists({ _id: chat.match, active: true }));
  await Activity.updateOne({ _id: activity._id }, { status: "deleted" });
  assert.equal((await set("live")).status, 404);
});

test("going live cannot bypass expiry, moderation, disabled categories or posting restrictions", async () => {
  const activity = await Activity.create(
    input({
      creator: ids[0],
      ownerState: "paused",
      startsAt: new Date(Date.now() - 86400000),
    }),
  );
  const id = String(activity._id);
  const set = (state: string) =>
    request(app)
      .patch(`/api/v1/activities/${id}/state`)
      .set("Authorization", auth[0])
      .send({ state })
      .timeout(10000);
  assert.equal((await set("live")).status, 409);
  assert.equal((await Activity.findById(id))!.ownerState, "paused");
  await Activity.updateOne(
    { _id: id },
    { startsAt: new Date(Date.now() + 86400000), status: "paused" },
  );
  assert.equal((await set("live")).status, 409);
  assert.equal(
    (await get(`activities/${id}`)).body.data.publicationStatus,
    "paused",
  );
  assert.equal(
    (
      await request(app)
        .patch(`/api/v1/activities/${id}`)
        .set("Authorization", auth[0])
        .send({ status: "active" })
    ).status,
    409,
  );
  await Activity.updateOne({ _id: id }, { status: "active" });
  await Category.updateOne({ slug: "food" }, { active: false });
  assert.equal((await set("live")).status, 409);
  await Category.updateOne({ slug: "food" }, { active: true });
  await User.updateOne({ _id: ids[0] }, { "restrictions.posting": true });
  assert.equal((await set("live")).status, 403);
  assert.equal((await set("successful")).status, 200);
  await User.updateOne({ _id: ids[0] }, { "restrictions.posting": false });
  assert.equal((await set("live")).status, 200);
  assert.equal((await get(`activities/${id}`, 1)).status, 200);
});
