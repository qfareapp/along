import { before, after, test, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PassThrough } from "node:stream";
import mongoose from "mongoose";
import request from "supertest";
import sharp from "sharp";
import { v2 as cloudinary } from "cloudinary";
import { MongoMemoryServer } from "mongodb-memory-server";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.ADMIN_AUTH_MODE = "mfa";
process.env.PHOTO_STORAGE = "cloudinary";
process.env.CLOUDINARY_CLOUD_NAME = "fixture-cloud";
process.env.CLOUDINARY_API_KEY = "fixture-key";
process.env.CLOUDINARY_API_SECRET = "fixture-secret";
const { createApp } = await import("./app.js");
const { User, Profile, ProfilePhoto } = await import("./models.js");
const { tokens } = await import("./auth.js");
const app = createApp();
let db: MongoMemoryServer,
  token: string,
  otherToken: string,
  ownerId: string,
  photoId: string,
  image: Buffer;
let uploads = 0,
  providerFails = false,
  lastOptions: Record<string, unknown> = {},
  uploadedBytes: Buffer;
const removed: string[] = [];
before(
  async () => {
    db = await MongoMemoryServer.create();
    await mongoose.connect(db.getUri());
    const owner = await User.create({
      name: "Photo Owner",
      email: "owner@example.test",
      passwordHash: "fixture",
      birthDate: "1998-01-01",
    });
    ownerId = String(owner._id);
    await Profile.create({ user: owner._id });
    token = (await tokens(ownerId)).accessToken;
    const other = await User.create({
      name: "Other Adult",
      email: "other@example.test",
      passwordHash: "fixture",
      birthDate: "1998-01-01",
    });
    otherToken = (await tokens(String(other._id))).accessToken;
    image = await sharp({
      create: { width: 64, height: 40, channels: 3, background: "#174F54" },
    })
      .png()
      .toBuffer();
    mock.method(
      cloudinary.uploader,
      "upload_stream",
      (
        options: Record<string, unknown>,
        callback: (error: unknown, result?: { public_id: string }) => void,
      ) => {
        uploads++;
        lastOptions = options;
        const stream = new PassThrough(),
          chunks: Buffer[] = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("finish", () => {
          uploadedBytes = Buffer.concat(chunks);
          if (providerFails) callback(new Error("fixture provider failure"));
          else callback(null, { public_id: String(options.public_id) });
        });
        return stream;
      },
    );
    mock.method(cloudinary.uploader, "destroy", async (id: string) => {
      removed.push(id);
      return { result: "ok" };
    });
  },
  { timeout: 180000 },
);
after(async () => {
  mock.restoreAll();
  await mongoose.disconnect();
  if (db) await db.stop();
});
test("multipart image upload normalizes bytes and uses authenticated Cloudinary storage without exposing its ID", async () => {
  const r = await request(app)
    .post("/api/v1/profile/photos")
    .auth(token, { type: "bearer" })
    .attach("photo", image, {
      filename: "phone.png",
      contentType: "image/png",
    });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  photoId = r.body.data.id;
  assert.equal(lastOptions.type, "authenticated");
  assert.equal(lastOptions.overwrite, false);
  assert.equal((await sharp(uploadedBytes).metadata()).format, "jpeg");
  const photo = await ProfilePhoto.findById(photoId).select(
    "+bytes +cloudinaryPublicId",
  );
  assert.ok(
    photo?.cloudinaryPublicId?.startsWith(`along/profiles/${ownerId}/`),
  );
  assert.equal(photo?.bytes, undefined);
  assert.equal(
    (await ProfilePhoto.findById(photoId).lean())?.cloudinaryPublicId,
    undefined,
  );
  assert.equal(r.body.data.cloudinaryPublicId, undefined);
  assert.equal(r.body.data.url, undefined);
});
test("invalid images and oversized multipart bodies fail before contacting Cloudinary", async () => {
  const before = uploads;
  assert.equal(
    (
      await request(app)
        .post("/api/v1/profile/photos")
        .auth(token, { type: "bearer" })
        .attach("photo", Buffer.from("not an image"), {
          filename: "broken.jpg",
          contentType: "image/jpeg",
        })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(app)
        .post("/api/v1/profile/photos")
        .auth(token, { type: "bearer" })
        .attach("photo", Buffer.alloc(5 * 1024 * 1024 + 1), {
          filename: "large.jpg",
          contentType: "image/jpeg",
        })
    ).status,
    413,
  );
  assert.equal(uploads, before);
});
test("private Cloudinary reads are authorized before any signed asset request", async () => {
  assert.equal(
    (
      await request(app)
        .get(`/api/v1/profile/photos/${photoId}`)
        .auth(otherToken, { type: "bearer" })
    ).status,
    403,
  );
  assert.equal(
    (await request(app).get(`/api/v1/profile/photos/${photoId}`)).status,
    401,
  );
});
test("Cloudinary errors are actionable and never attach a phantom photo", async () => {
  providerFails = true;
  const count = await ProfilePhoto.countDocuments({ owner: ownerId });
  const r = await request(app)
    .post("/api/v1/profile/photos")
    .auth(token, { type: "bearer" })
    .attach("photo", image, {
      filename: "phone.png",
      contentType: "image/png",
    });
  assert.equal(r.status, 503);
  assert.match(r.body.error.message, /Cloudinary upload failed/);
  assert.equal(JSON.stringify(r.body).includes("fixture-secret"), false);
  assert.equal(await ProfilePhoto.countDocuments({ owner: ownerId }), count);
  providerFails = false;
});
test("only the owner can remove the Cloudinary asset; removal clears profile references", async () => {
  await request(app)
    .delete(`/api/v1/profile/photos/${photoId}`)
    .auth(otherToken, { type: "bearer" });
  assert.equal(removed.length, 0);
  assert.equal(
    (
      await request(app)
        .delete(`/api/v1/profile/photos/${photoId}`)
        .auth(token, { type: "bearer" })
    ).status,
    204,
  );
  assert.equal(removed.length, 1);
  assert.equal(await ProfilePhoto.findById(photoId), null);
  assert.equal(
    (await Profile.findOne({ user: ownerId }))?.photos.includes(photoId),
    false,
  );
});
