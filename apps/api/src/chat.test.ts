import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import sharp from "sharp";
import { MongoMemoryServer } from "mongodb-memory-server";
process.env.ADMIN_AUTH_MODE = "mfa";
process.env.PHOTO_STORAGE = "mongodb";
const mediaDirectory = await mkdtemp(path.join(os.tmpdir(), "along-chat-"));
process.env.SOCIAL_MEDIA_DIR = mediaDirectory;
process.env.CHAT_MEDIA_DIR = mediaDirectory;
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.EMAIL_VERIFICATION_REQUIRED = "false";
const { createApp } = await import("./app.js");
const { User, ProfileSwipe, Match, Conversation } = await import("./models.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const { tokens } = await import("./auth.js");
const app = createApp();
let db: MongoMemoryServer;
const ids: Record<string, string> = {},
  access: Record<string, string> = {};
before(
  async () => {
    db = await MongoMemoryServer.create();
    await mongoose.connect(db.getUri());
    await ProfileSwipe.init();
    await Match.init();
    await Conversation.init();
    for (const key of ["asha", "ben", "cara", "dev", "esha"]) {
      const user = await User.create({
        name: key[0].toUpperCase() + key.slice(1),
        email: `${key}@example.test`,
        passwordHash: "fixture",
        birthDate: "1997-01-01",
      });
      ids[key] = String(user._id);
      access[key] = (await tokens(ids[key])).accessToken;
      await eligibleProfile(user._id);
    }
  },
  { timeout: 180000 },
);
after(async () => {
  await mongoose.disconnect();
  if (db) await db.stop();
  await rm(mediaDirectory, { recursive: true, force: true });
});
const as = (who: string) => ({ Authorization: `Bearer ${access[who]}` });
const like = (who: string, target: string) =>
  request(app)
    .post(`/api/v1/discovery/${ids[target]}/action`)
    .set(as(who))
    .send({ action: "like" });
const list = (who: string) =>
  request(app).get("/api/v1/conversations").set(as(who));
const send = (who: string, id: string, text: string) =>
  request(app)
    .post(`/api/v1/conversations/${id}/messages`)
    .set(as(who))
    .send({ text });
let conversationId = "";

test("a one-sided like opens no conversation", async () => {
  const r = await like("asha", "ben");
  assert.equal(r.status, 200);
  assert.equal(r.body.data.mutual, false);
  assert.equal(r.body.data.conversationId, null);
  assert.deepEqual((await list("asha")).body.data, []);
  const likedBen = await request(app)
    .get("/api/v1/discovery/liked-me")
    .set(as("ben"));
  assert.equal(likedBen.status, 200, JSON.stringify(likedBen.body));
  assert.deepEqual(
    likedBen.body.data.map((p: { id: string }) => p.id),
    [ids.asha],
  );
  assert.ok(likedBen.body.data[0].likedAt);
  assert.equal(likedBen.body.data[0].email, undefined);
  assert.deepEqual(
    (await request(app).get("/api/v1/discovery/liked-me").set(as("asha"))).body
      .data,
    [],
  );
});

test("a mutual like creates one match and conversation, returned to the liker", async () => {
  const r = await like("ben", "asha");
  assert.equal(r.body.data.mutual, true);
  conversationId = r.body.data.conversationId;
  assert.ok(conversationId);
  assert.equal(
    (await like("ben", "asha")).body.data.conversationId,
    conversationId,
  );
  assert.equal(await Match.countDocuments(), 1);
  assert.deepEqual(
    (await request(app).get("/api/v1/discovery/liked-me").set(as("ben"))).body
      .data,
    [],
  );
  assert.equal(await Conversation.countDocuments(), 1);
  const profile = await request(app)
    .get(`/api/v1/discovery/${ids.ben}`)
    .set(as("asha"));
  assert.equal(profile.body.data.conversationId, conversationId);
  const rows = (await list("asha")).body.data;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, conversationId);
  assert.equal(rows[0].member.id, ids.ben);
  assert.ok(rows[0].member.photoId);
});

test("both members can message; unread counts clear when read", async () => {
  const sent = await send("asha", conversationId, "  Coffee on Thursday?  ");
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.data.text, "Coffee on Thursday?");
  assert.equal(sent.body.data.own, true);
  assert.equal((await send("asha", conversationId, "   ")).status, 400);
  assert.equal((await list("ben")).body.data[0].unread, 1);
  const thread = await request(app)
    .get(`/api/v1/conversations/${conversationId}`)
    .set(as("ben"));
  assert.equal(thread.status, 200);
  assert.equal(thread.body.data.messages[0].own, false);
  assert.equal(thread.body.data.canSend, true);
  assert.equal((await list("ben")).body.data[0].unread, 0);
  const reply = await send("ben", conversationId, "Yes! 6 PM?");
  const newer = await request(app)
    .get(`/api/v1/conversations/${conversationId}?after=${sent.body.data.id}`)
    .set(as("asha"));
  assert.deepEqual(
    newer.body.data.messages.map((m: { id: string }) => m.id),
    [reply.body.data.id],
  );
});

test("members can send photos and documents that only the pair can open", async () => {
  const png = await sharp({
    create: { width: 40, height: 30, channels: 3, background: "#F47768" },
  })
    .png()
    .toBuffer();
  const photo = await request(app)
    .post(`/api/v1/conversations/${conversationId}/attachments`)
    .set(as("asha"))
    .field("text", "Our café")
    .attach("file", png, { filename: "cafe.png", contentType: "image/png" });
  assert.equal(photo.status, 201, JSON.stringify(photo.body));
  assert.equal(photo.body.data.text, "Our café");
  assert.equal(photo.body.data.attachment.kind, "image");
  assert.equal(photo.body.data.attachment.name, "cafe.jpg");
  assert.equal(photo.body.data.attachment.mimeType, "image/jpeg");
  assert.ok(photo.body.data.attachment.size < 100_000);
  assert.equal(photo.body.data.attachment.asset, undefined);
  const image = await request(app)
    .get(`/api/v1${photo.body.data.attachment.path}`)
    .set(as("ben"));
  assert.equal(image.status, 200);
  assert.ok(image.body.length < 100_000);
  assert.match(String(image.headers["content-type"]), /^image\/jpeg/);
  assert.equal((await sharp(image.body).metadata()).width, 40);
  assert.equal(
    (
      await request(app)
        .get(`/api/v1${photo.body.data.attachment.path}`)
        .set(as("cara"))
    ).status,
    404,
  );

  const pdf = Buffer.from("%PDF-1.4\n% Along test\n");
  const doc = await request(app)
    .post(`/api/v1/conversations/${conversationId}/attachments`)
    .set(as("ben"))
    .attach("file", pdf, {
      filename: "../../Itinerary.pdf",
      contentType: "application/pdf",
    });
  assert.equal(doc.status, 201, JSON.stringify(doc.body));
  assert.equal(doc.body.data.text, "");
  assert.equal(doc.body.data.attachment.kind, "file");
  assert.equal(doc.body.data.attachment.name, "Itinerary.pdf");
  const link = await request(app)
    .post(
      `/api/v1/conversations/${conversationId}/messages/${doc.body.data.id}/attachment-link`,
    )
    .set(as("asha"));
  assert.equal(link.status, 200);
  const download = await request(app).get(`/api/v1${link.body.data.path}`);
  assert.equal(download.status, 200);
  assert.match(
    String(download.headers["content-disposition"]),
    /^attachment; filename="?Itinerary.pdf"?$/,
  );
  assert.equal(Buffer.compare(download.body, pdf), 0);
  assert.equal(
    (await request(app).get("/api/v1/conversations/attachments/forged")).status,
    404,
  );
  assert.equal(
    (
      await request(app)
        .post(
          `/api/v1/conversations/${conversationId}/messages/${doc.body.data.id}/attachment-link`,
        )
        .set(as("cara"))
    ).status,
    404,
  );

  const thread = await request(app)
    .get(`/api/v1/conversations/${conversationId}`)
    .set(as("asha"));
  const last = thread.body.data.messages.at(-1);
  assert.equal(last.attachment.kind, "file");
  assert.equal(last.attachment.asset, undefined);

  // Executables, scripts and renamed files are refused.
  for (const [filename, contentType] of [
    ["setup.exe", "application/x-msdownload"],
    ["page.html", "text/html"],
    ["report.exe", "application/pdf"],
  ])
    assert.equal(
      (
        await request(app)
          .post(`/api/v1/conversations/${conversationId}/attachments`)
          .set(as("asha"))
          .attach("file", Buffer.from("x"), { filename, contentType })
      ).status,
      400,
      filename,
    );
  assert.equal(
    (
      await request(app)
        .post(`/api/v1/conversations/${conversationId}/attachments`)
        .set(as("asha"))
        .attach("file", Buffer.from("not an image"), {
          filename: "fake.png",
          contentType: "image/png",
        })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(app)
        .post(`/api/v1/conversations/${conversationId}/attachments`)
        .set(as("cara"))
        .attach("file", png, { filename: "x.png", contentType: "image/png" })
    ).status,
    404,
  );
});

test("outsiders cannot read or post in a conversation", async () => {
  assert.equal(
    (
      await request(app)
        .get(`/api/v1/conversations/${conversationId}`)
        .set(as("cara"))
    ).status,
    404,
  );
  assert.equal((await send("cara", conversationId, "hi")).status, 404);
});

test("messaging restrictions block sending but not reading", async () => {
  await User.updateOne({ _id: ids.asha }, { "restrictions.messaging": true });
  assert.equal((await send("asha", conversationId, "hello")).status, 403);
  const thread = await request(app)
    .get(`/api/v1/conversations/${conversationId}`)
    .set(as("asha"));
  assert.equal(thread.status, 200);
  assert.equal(thread.body.data.canSend, false);
  await User.updateOne({ _id: ids.asha }, { "restrictions.messaging": false });
});

test("blocking ends the match and hides the conversation for both", async () => {
  await like("cara", "dev");
  const id = (await like("dev", "cara")).body.data.conversationId;
  assert.ok(id);
  const blocked = await request(app)
    .post("/api/v1/blocks")
    .set(as("cara"))
    .send({ userId: ids.dev });
  assert.equal(blocked.status, 204);
  assert.equal((await send("dev", id, "hello?")).status, 404);
  assert.deepEqual((await list("dev")).body.data, []);
  assert.deepEqual((await list("cara")).body.data, []);
});

test("unmatching is final, even if both like again", async () => {
  assert.equal(
    (
      await request(app)
        .post(`/api/v1/conversations/${conversationId}/unmatch`)
        .set(as("ben"))
    ).status,
    204,
  );
  assert.deepEqual((await list("asha")).body.data, []);
  assert.equal((await send("asha", conversationId, "hi")).status, 404);
  assert.equal((await like("asha", "ben")).body.data.conversationId, null);
});

test("mutual likes from before chat existed are backfilled into conversations", async () => {
  await ProfileSwipe.create([
    { user: ids.esha, target: ids.cara, action: "like" },
    { user: ids.cara, target: ids.esha, action: "like" },
  ]);
  const rows = (await list("esha")).body.data;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].member.id, ids.cara);
});

test("passing on someone who liked you removes them from liked-you", async () => {
  await ProfileSwipe.create({
    user: ids.dev,
    target: ids.esha,
    action: "like",
  });
  const before = await request(app)
    .get("/api/v1/discovery/liked-me")
    .set(as("esha"));
  assert.ok(before.body.data.some((p: { id: string }) => p.id === ids.dev));
  await request(app)
    .post(`/api/v1/discovery/${ids.dev}/action`)
    .set(as("esha"))
    .send({ action: "pass" });
  const after = await request(app)
    .get("/api/v1/discovery/liked-me")
    .set(as("esha"));
  assert.ok(!after.body.data.some((p: { id: string }) => p.id === ids.dev));
});
