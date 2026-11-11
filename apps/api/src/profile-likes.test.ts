import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";

process.env.ADMIN_AUTH_MODE = "mfa";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.EMAIL_VERIFICATION_REQUIRED = "false";
const { createApp } = await import("./app.js");
const { User, Profile, ProfileSwipe, Block, Match, Conversation } =
  await import("./models.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const { tokens } = await import("./auth.js");
const app = createApp();
let db: MongoMemoryServer;
const ids: string[] = [],
  access: string[] = [];
let notificationId: string;
const get = (path: string, who = 1) =>
  request(app)
    .get(`/api/v1/discovery${path}`)
    .auth(access[who], { type: "bearer" });
const act = (who: number, target: number, action: string) =>
  request(app)
    .post(`/api/v1/discovery/${ids[target]}/action`)
    .auth(access[who], { type: "bearer" })
    .send({ action });
const read = (who = 1, id = notificationId) =>
  request(app)
    .post(`/api/v1/discovery/like-notifications/${id}/read`)
    .auth(access[who], { type: "bearer" });

before(
  async () => {
    db = await MongoMemoryServer.create();
    await mongoose.connect(db.getUri());
    await Promise.all([ProfileSwipe.init(), Match.init(), Conversation.init()]);
    for (let i = 0; i < 3; i++) {
      const user = await User.create({
        name: `Member ${i}`,
        email: `like-${i}@example.test`,
        birthDate: i === 1 ? "1960-01-01" : "1998-01-01",
        passwordHash: "fixture",
      });
      ids.push(String(user._id));
      access.push((await tokens(ids[i])).accessToken);
      await eligibleProfile(user._id);
      await Profile.updateOne(
        { user: user._id },
        {
          $set: {
            city: i === 0 ? "Kolkata" : "Other city",
            approximateLocation: {
              type: "Point",
              coordinates: i === 0 ? [88.36, 22.57] : [86.36, 22.57],
            },
            "preferences.maxDistanceKm": i === 0 ? 500 : 25,
            "preferences.maxAge": i === 0 ? 40 : 100,
          },
        },
      );
    }
  },
  { timeout: 180000 },
);
after(async () => {
  await mongoose.disconnect();
  if (db) await db.stop();
});

test("a long-distance fallback like becomes visible to its recipient despite asymmetric age preferences", async () => {
  assert.equal((await get(`/${ids[0]}`)).status, 404);
  assert(
    !(await get("")).body.data.some((p: { id: string }) => p.id === ids[0]),
  );
  assert(
    (await get("", 0)).body.data.some((p: { id: string }) => p.id === ids[1]),
  );
  assert.equal((await act(0, 1, "like")).status, 200);
  assert.equal((await get("/liked-me")).body.data[0].id, ids[0]);
  const feed = await get("?limit=1");
  assert.equal(feed.body.data[0].id, ids[0]);
  assert.equal(feed.body.data[0].likedYou, true);
  assert.equal(feed.body.data[0].mutualMatch, false);
  assert.equal((await get(`/${ids[0]}`)).status, 200);
});

test("profile likes notify only their recipient, preserve read state on retries, and reset for a new like", async () => {
  // Likes stored before profile notifications existed must also appear unread.
  await ProfileSwipe.updateOne(
    { user: ids[0], target: ids[1] },
    { $unset: { notificationReadAt: 1 } },
  );
  const notifications = await get("/like-notifications");
  assert.equal(notifications.status, 200);
  assert.equal(notifications.body.data.length, 1);
  const row = notifications.body.data[0];
  notificationId = row.id;
  assert.equal(row.member.id, ids[0]);
  assert.equal(row.readAt, null);
  assert.deepEqual((await get("/like-notifications", 0)).body.data, []);
  assert.deepEqual((await get("/like-notifications", 2)).body.data, []);
  assert.equal((await read(0)).status, 404);
  assert.equal((await read(2)).status, 404);
  assert.equal((await read(1, "invalid")).status, 404);
  const before = await ProfileSwipe.findById(notificationId).lean();
  assert.equal((await read()).status, 204);
  assert.equal(
    +(await ProfileSwipe.findById(notificationId))!.updatedAt,
    +before!.updatedAt,
  );
  assert.equal((await act(0, 1, "like")).status, 200);
  assert((await get("/like-notifications")).body.data[0].readAt);
  assert.equal(
    await ProfileSwipe.countDocuments({ user: ids[0], target: ids[1] }),
    1,
  );
  await act(0, 1, "pass");
  assert.deepEqual((await get("/like-notifications")).body.data, []);
  assert.equal((await get(`/${ids[0]}`)).status, 404);
  await act(0, 1, "like");
  assert.equal((await get("/like-notifications")).body.data[0].readAt, null);
});

test("blocks in either direction, eligibility loss and suspension hide incoming likes and notifications", async () => {
  for (const [user, target] of [
    [ids[0], ids[1]],
    [ids[1], ids[0]],
  ]) {
    await Block.create({ user, target });
    assert.deepEqual((await get("/liked-me")).body.data, []);
    assert.deepEqual((await get("/like-notifications")).body.data, []);
    assert.equal((await get(`/${ids[0]}`)).status, 404);
    assert.equal((await act(1, 0, "like")).status, 404);
    assert.equal((await read()).status, 404);
    await Block.deleteMany({});
  }
  const profile = await Profile.findOne({ user: ids[0] });
  await Profile.updateOne({ user: ids[0] }, { $set: { photos: [] } });
  assert.deepEqual((await get("/liked-me")).body.data, []);
  assert.deepEqual((await get("/like-notifications")).body.data, []);
  await Profile.updateOne(
    { user: ids[0] },
    { $set: { photos: profile!.photos } },
  );
  await User.updateOne({ _id: ids[0] }, { status: "suspended" });
  assert.deepEqual((await get("/liked-me")).body.data, []);
  assert.deepEqual((await get("/like-notifications")).body.data, []);
  await User.updateOne({ _id: ids[0] }, { status: "active" });
});

test("the recipient can pass or like back outside their radius; matching removes the pending notification", async () => {
  assert.equal((await act(1, 0, "pass")).status, 200);
  assert.deepEqual((await get("/liked-me")).body.data, []);
  assert.deepEqual((await get("/like-notifications")).body.data, []);
  assert(
    !(await get("")).body.data.some((p: { id: string }) => p.id === ids[0]),
  );
  const match = await act(1, 0, "like");
  assert.equal(match.status, 200, JSON.stringify(match.body));
  assert.equal(match.body.data.mutual, true);
  assert(match.body.data.conversationId);
  assert.deepEqual((await get("/liked-me")).body.data, []);
  assert.deepEqual((await get("/like-notifications")).body.data, []);
});
