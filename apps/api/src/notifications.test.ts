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
  Block,
  Category,
  Conversation,
  Match,
  User,
} = await import("./models.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const { tokens } = await import("./auth.js");
const app = createApp();
let db: MongoMemoryReplSet;
const ids: string[] = [],
  auth: string[] = [];
let activity: string, notification: string, conversation: string;
const get = (path: string, who = 0) =>
  request(app).get(`/api/v1/${path}`).set("Authorization", auth[who]);
const post = (path: string, who = 0) =>
  request(app).post(`/api/v1/${path}`).set("Authorization", auth[who]);
before(
  async () => {
    db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(db.getUri());
    await Promise.all([
      ActivityInterest.init(),
      Match.init(),
      Conversation.init(),
    ]);
    for (let i = 0; i < 3; i++) {
      const user = await User.create({
        name: `Member ${i}`,
        email: `member${i}@example.test`,
        birthDate: "1997-01-01",
        passwordHash: "fixture",
      });
      ids.push(String(user._id));
      auth.push(`Bearer ${(await tokens(String(user._id))).accessToken}`);
      await eligibleProfile(user._id);
    }
    await Category.create({ slug: "coffee", name: "Coffee" });
    activity = String(
      (
        await Activity.create({
          creator: ids[0],
          type: "together",
          category: "coffee",
          title: "Weekend coffee",
          description: "Coffee together",
          zone: "Kolkata",
          startsAt: new Date(Date.now() + 86400000),
        })
      )._id,
    );
  },
  { timeout: 180000 },
);
after(async () => {
  await mongoose.disconnect();
  if (db) await db.stop();
});

test("activity likes notify only the owner, remain unread, and deduplicate", async () => {
  assert.equal((await post(`activities/${activity}/interests`, 1)).status, 201);
  assert.equal((await post(`activities/${activity}/interests`, 1)).status, 201);
  const response = await get("notifications");
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.length, 1);
  const row = response.body.data[0];
  notification = row.id;
  assert.equal(row.member.id, ids[1]);
  assert.equal(row.activityTitle, "Weekend coffee");
  assert.equal(row.readAt, null);
  assert.deepEqual((await get("notifications", 1)).body.data, []);
  assert.deepEqual((await get("notifications", 2)).body.data, []);
  assert.equal((await post(`activities/${activity}/interests`)).status, 404);
  const detail = (await get(`activities/${activity}`)).body.data;
  assert.equal(detail.isOwner, true);
  assert.equal(
    (await get(`activities/${activity}`, 1)).body.data.interested,
    true,
  );
});

test("only the owner may read the notification and initiate its chat", async () => {
  assert.equal(
    (await post(`notifications/${notification}/read`, 1)).status,
    404,
  );
  assert.equal(
    (await post(`notifications/${notification}/conversation`, 1)).status,
    404,
  );
  assert.equal(
    (await post(`notifications/${notification}/conversation`, 2)).status,
    404,
  );
  await User.updateOne({ _id: ids[0] }, { "restrictions.messaging": true });
  assert.equal(
    (await post(`notifications/${notification}/conversation`)).status,
    403,
  );
  await User.updateOne({ _id: ids[0] }, { "restrictions.messaging": false });
  const response = await post(`notifications/${notification}/conversation`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  conversation = response.body.data.id;
  assert.ok(conversation);
  assert.equal(
    (await post(`notifications/${notification}/conversation`)).body.data.id,
    conversation,
  );
  assert.ok((await get("notifications")).body.data[0].readAt);
  await post(`activities/${activity}/interests`, 1);
  assert.ok((await get("notifications")).body.data[0].readAt);
  assert.deepEqual((await get("conversations", 1)).body.data, []);
  assert.equal(
    (await get(`conversations/${conversation}`, 1)).body.data.canSend,
    false,
  );
  assert.equal(
    (
      await post(`conversations/${conversation}/messages`, 1).send({
        text: "Liker first",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post(`conversations/${conversation}/messages`).send({
        text: "Coffee tomorrow?",
      })
    ).status,
    201,
  );
  assert.equal((await get("conversations", 1)).body.data[0].unread, 1);
  assert.equal(
    (
      await post(`conversations/${conversation}/messages`, 1).send({
        text: "Yes!",
      })
    ).status,
    201,
  );
  assert.equal((await get(`conversations/${conversation}`, 2)).status, 404);
});

test("closed chats cannot be reopened through an activity notification", async () => {
  assert.equal(
    (await post(`conversations/${conversation}/unmatch`)).status,
    204,
  );
  assert.equal(
    (await post(`notifications/${notification}/conversation`)).status,
    404,
  );
});

test("blocked members and unavailable activities are hidden and cannot start chat", async () => {
  await Block.create({ user: ids[1], target: ids[0] });
  assert.deepEqual((await get("notifications")).body.data, []);
  assert.equal((await post(`notifications/${notification}/read`)).status, 404);
  assert.equal(
    (await post(`notifications/${notification}/conversation`)).status,
    404,
  );
  await Block.deleteMany({});
  await Activity.updateOne({ _id: activity }, { status: "deleted" });
  assert.deepEqual((await get("notifications")).body.data, []);
  assert.equal(
    (await post(`notifications/${notification}/conversation`)).status,
    404,
  );
});
