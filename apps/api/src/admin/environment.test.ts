import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";

process.env.ADMIN_AUTH_MODE = "env";
process.env.NODE_ENV = "test";
process.env.ADMIN_EMAIL = "environment-admin@example.test";
process.env.ADMIN_PASSWORD = "Ab1!xy";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.ADMIN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.ADMIN_ORIGIN = "http://localhost:3000";
const { createApp } = await import("../app.js");
const { User } = await import("../models.js");
const { AuditLog } = await import("./models.js");
const { config } = await import("../config.js");
const app = createApp();
const agent = request.agent(app);
const origin = "http://localhost:3000";
let database: MongoMemoryReplSet;
let csrf = "";
let adminId = "";
before(
  async () => {
    database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(database.getUri());
    await User.init();
  },
  { timeout: 180000 },
);
after(async () => {
  await mongoose.disconnect();
  if (database) await database.stop();
});

test("login config exposes the mode, without exposing environment credentials", async () => {
  const res = await request(app).get("/api/v1/admin/auth/config");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, { mode: "env", mfaRequired: false });
});
test("invalid credentials cannot provision an admin or bypass login", async () => {
  await request(app)
    .post("/api/v1/admin/auth/login")
    .set("Origin", origin)
    .send({ email: config.ADMIN_EMAIL, password: "incorrect" })
    .expect(401);
  await request(app)
    .post("/api/v1/admin/auth/login")
    .set("Origin", origin)
    .send({ email: "other@example.test", password: config.ADMIN_PASSWORD })
    .expect(401);
  assert.equal(await User.countDocuments(), 0);
  await request(app).get("/api/v1/admin/dashboard").expect(401);
});
test("six-character environment password signs in without OTP and retains private cookies and RBAC", async () => {
  const res = await agent
    .post("/api/v1/admin/auth/login")
    .set("Origin", origin)
    .send({ email: config.ADMIN_EMAIL, password: config.ADMIN_PASSWORD });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  csrf = res.body.data.csrf;
  assert.match(res.headers["set-cookie"][0], /HttpOnly/);
  const me = await agent.get("/api/v1/admin/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.data.authMode, "env");
  assert.equal(me.body.data.role, "super-admin");
  assert.equal(me.body.data.password, undefined);
  assert.equal(me.body.data.passwordHash, undefined);
  adminId = me.body.data.id;
  await agent.get("/api/v1/admin/dashboard").expect(200);
  await agent
    .post("/api/v1/admin/auth/logout")
    .set("Origin", origin)
    .expect(403);
  assert.equal(
    await AuditLog.countDocuments({ action: "admin.environment_provisioned" }),
    1,
  );
});
test("password changes invalidate existing sessions and the .env password remains authoritative", async () => {
  const previous = config.ADMIN_PASSWORD!;
  config.ADMIN_PASSWORD = "New6!xy";
  await agent.get("/api/v1/admin/auth/me").expect(401);
  await agent
    .post("/api/v1/admin/auth/login")
    .set("Origin", origin)
    .send({ email: config.ADMIN_EMAIL, password: previous })
    .expect(401);
  const login = await agent
    .post("/api/v1/admin/auth/login")
    .set("Origin", origin)
    .send({ email: config.ADMIN_EMAIL, password: config.ADMIN_PASSWORD });
  assert.equal(login.status, 200);
  csrf = login.body.data.csrf;
  await agent.get("/api/v1/admin/auth/me").expect(200);
  assert.equal(await User.countDocuments({ email: config.ADMIN_EMAIL }), 1);
});
test("environment login cannot reactivate a suspended admin", async () => {
  await User.updateOne({ _id: adminId }, { status: "suspended" });
  await agent
    .post("/api/v1/admin/auth/login")
    .set("Origin", origin)
    .send({ email: config.ADMIN_EMAIL, password: config.ADMIN_PASSWORD })
    .expect(401);
  await agent.get("/api/v1/admin/auth/me").expect(401);
  await User.updateOne({ _id: adminId }, { status: "active" });
});
test("environment login never promotes a mobile account with the configured email", async () => {
  const account = await User.create({
    name: "Mobile Adult",
    email: "mobile@example.test",
    birthDate: "1998-01-01",
    passwordHash: await bcrypt.hash("Mobile-password-123", 12),
  });
  const previous = config.ADMIN_EMAIL;
  config.ADMIN_EMAIL = account.email;
  await request(app)
    .post("/api/v1/admin/auth/login")
    .set("Origin", origin)
    .send({ email: config.ADMIN_EMAIL, password: config.ADMIN_PASSWORD })
    .expect(409);
  assert.equal((await User.findById(account._id))?.adminRole, null);
  config.ADMIN_EMAIL = previous;
});
test("environment recovery uses configuration rather than MFA recovery, and logout revokes the session", async () => {
  await agent
    .post("/api/v1/admin/auth/recover")
    .set("Origin", origin)
    .send({})
    .expect(409);
  const login = await agent
    .post("/api/v1/admin/auth/login")
    .set("Origin", origin)
    .send({ email: config.ADMIN_EMAIL, password: config.ADMIN_PASSWORD });
  assert.equal(login.status, 200);
  csrf = login.body.data.csrf;
  await agent
    .post("/api/v1/admin/auth/logout")
    .set({ Origin: origin, "X-CSRF-Token": csrf })
    .expect(204);
  await agent.get("/api/v1/admin/auth/me").expect(401);
});
