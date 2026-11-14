import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";

process.env.NODE_ENV = "test";
process.env.ADMIN_AUTH_MODE = "mfa";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.TRUST_PROXY_HOPS = "1";
const { createApp } = await import("./app.js");
const { User } = await import("./models.js");
const { tokens } = await import("./auth.js");
let db: MongoMemoryServer;
const ids: string[] = [], access: string[] = [];
const sharedIp = "198.51.100.25";

before(async () => {
  db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
  for (let i = 0; i < 4; i++) {
    const user = await User.create({
      name: `Member ${i}`,
      email: `rate-${i}@example.test`,
      passwordHash: "fixture",
      birthDate: "1997-01-01",
    });
    ids.push(String(user._id));
    access.push((await tokens(ids[i])).accessToken);
  }
}, { timeout: 180000 });
after(async () => {
  await mongoose.disconnect();
  if (db) await db.stop();
});

test("four accounts on one network do not share the 120-request quota", async () => {
  const app = createApp();
  // Interleave normal background requests from four devices on one Wi-Fi.
  for (let round = 0; round < 40; round++) {
    const responses = await Promise.all(access.map((token) =>
      request(app).get("/health").set("X-Forwarded-For", sharedIp)
        .auth(token, { type: "bearer" }),
    ));
    for (const response of responses)
      assert.equal(response.status, 200, JSON.stringify(response.body));
  }
});

test("one account is still limited across IPs and token refreshes without blocking its neighbour", async () => {
  const app = createApp();
  for (let i = 0; i < 120; i++) {
    const response = await request(app).get("/health")
      .set("X-Forwarded-For", sharedIp).auth(access[0], { type: "bearer" });
    assert.equal(response.status, 200);
  }
  const refreshed = (await tokens(ids[0])).accessToken;
  const blocked = await request(app).get("/health")
    .set("X-Forwarded-For", "198.51.100.26").auth(refreshed, { type: "bearer" });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, "RATE_LIMITED");
  assert.ok(Number(blocked.headers["retry-after"]) > 0);
  const neighbour = await request(app).get("/health")
    .set("X-Forwarded-For", sharedIp).auth(access[1], { type: "bearer" });
  assert.equal(neighbour.status, 200);
});

test("forged identities cannot bypass the anonymous IP quota or consume a member quota", async () => {
  const app = createApp();
  for (let i = 0; i < 121; i++) {
    const forged = jwt.sign({ sub: i % 2 ? ids[0] : new mongoose.Types.ObjectId().toString() },
      "wrong-signing-key", { issuer: "along", audience: "along-mobile" });
    const response = await request(app).get("/health")
      .set("X-Forwarded-For", sharedIp).auth(forged, { type: "bearer" });
    assert.equal(response.status, i < 120 ? 200 : 429);
  }
  const member = await request(app).get("/health")
    .set("X-Forwarded-For", sharedIp).auth(access[0], { type: "bearer" });
  assert.equal(member.status, 200);
});

test("contact verification attempts remain limited per account on a shared network", async () => {
  const app = createApp();
  for (let round = 0; round < 10; round++) {
    for (const token of access) {
      const response = await request(app).post("/api/v1/auth/contact/verify")
        .set("X-Forwarded-For", sharedIp).auth(token, { type: "bearer" })
        .send({ code: "000000" });
      assert.equal(response.status, 400, JSON.stringify(response.body));
    }
  }
  const blocked = await request(app).post("/api/v1/auth/contact/verify")
    .set("X-Forwarded-For", sharedIp).auth(access[0], { type: "bearer" })
    .send({ code: "000000" });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, "RATE_LIMITED");
});

test("account revocation is checked again on the next HTTP request", async () => {
  const app = createApp();
  const endpoint = () => request(app).get("/api/v1/users/me")
    .set("X-Forwarded-For", sharedIp).auth(access[3], { type: "bearer" });
  const first = await endpoint();
  assert.equal(first.status, 200, JSON.stringify(first.body));
  await User.updateOne({ _id: ids[3] }, { $inc: { sessionVersion: 1 } });
  try {
    assert.equal((await endpoint()).status, 401);
  } finally {
    await User.updateOne({ _id: ids[3] }, { $set: { sessionVersion: 0 } });
  }
});

test("sign-in attempts still have the stricter IP limit", async () => {
  const app = createApp();
  for (let i = 0; i < 20; i++) {
    const response = await request(app).post("/api/v1/auth/login")
      .set("X-Forwarded-For", sharedIp)
      .send({ email: "missing@example.test", password: "Wrong-password-123!" });
    assert.equal(response.status, 401, JSON.stringify(response.body));
  }
  const blocked = await request(app).post("/api/v1/auth/login")
    .set("X-Forwarded-For", sharedIp).auth(access[0], { type: "bearer" })
    .send({ email: "missing@example.test", password: "Wrong-password-123!" });
  assert.equal(blocked.status, 429);
});
