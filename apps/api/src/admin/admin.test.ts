import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { eligibleProfile } from "../test-fixtures.js";

process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.ADMIN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.ADMIN_ORIGIN = "http://localhost:3000";
process.env.ADMIN_AUTH_MODE = "mfa";
const { createApp } = await import("../app.js");
const { User, Profile, Category, Activity, Report, RefreshSession } =
  await import("../models.js");
const { AdminSession, AuditLog, Verification, PlatformSetting } =
  await import("./models.js");
const { provisionFirstAdmin } = await import("./provision.js");
const { totpFor, encryptSecret } = await import("./security.js");
const { tokens, digest } = await import("../auth.js");
const app = createApp();
const origin = "http://localhost:3000";
const admin = request.agent(app);
let database: MongoMemoryReplSet;
let csrf = "";
let cookie = "";
let adminId = "";
let secret = "";
let recoveryCodes: string[] = [];
let alice: InstanceType<typeof User>;
let bob: InstanceType<typeof User>;
let aliceAccess = "";
let bobAccess = "";
let planId = "";
let categoryId = "";
const password = `Aa1!${crypto.randomBytes(20).toString("hex")}`;
const headers = () => ({ Origin: origin, "X-CSRF-Token": csrf });
before(
  async () => {
    database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(database.getUri());
    await Promise.all([
      User.init(),
      AdminSession.init(),
      PlatformSetting.init(),
    ]);
    const bootstrap = await provisionFirstAdmin(
      "operator@example.test",
      password,
      "Test Operator",
    );
    adminId = String(bootstrap.user._id);
    secret = bootstrap.secret;
    recoveryCodes = bootstrap.recoveryCodes;
    alice = await User.create({
      email: "alice@example.test",
      name: "Alice Adult",
      birthDate: "1998-01-01",
      passwordHash: await bcrypt.hash(password, 12),
      emailVerified: true,
    });
    bob = await User.create({
      email: "bob@example.test",
      name: "Bob Adult",
      birthDate: "1996-02-02",
      passwordHash: await bcrypt.hash(password, 12),
      emailVerified: true,
    });
    await Profile.create({ user: alice._id, city: "Kolkata" });
    await Profile.create({ user: bob._id, city: "Kolkata" });
    await eligibleProfile(alice._id);
    await eligibleProfile(bob._id);
    aliceAccess = (await tokens(String(alice._id))).accessToken;
    bobAccess = (await tokens(String(bob._id))).accessToken;
    const category = await Category.create({
      slug: "food",
      name: "Food & Dining",
      active: true,
    });
    categoryId = String(category._id);
    const plan = await Activity.create({
      creator: alice._id,
      category: "food",
      type: "together",
      title: "Coffee after work",
      description: "A public meeting at a neighbourhood cafe.",
      zone: "Park Street",
      startsAt: new Date(Date.now() + 86400000),
    });
    planId = String(plan._id);
  },
  { timeout: 180000 },
);
after(async () => {
  await mongoose.disconnect();
  if (database) await database.stop();
});

test("no public admin registration; mobile bearer credentials cannot enter admin", async () => {
  assert.equal((await request(app).get("/api/v1/admin/dashboard")).status, 401);
  assert.equal(
    (
      await request(app)
        .get("/api/v1/admin/dashboard")
        .auth(aliceAccess, { type: "bearer" })
    ).status,
    401,
  );
  const reg = await request(app).post("/api/v1/auth/register").send({
    name: "Ordinary Adult",
    email: "ordinary@example.test",
    password,
    birthDate: "1995-01-01",
    adminRole: "super-admin",
  });
  assert.equal(reg.status, 201);
  assert.equal(
    (await User.findOne({ email: "ordinary@example.test" }))?.adminRole,
    null,
  );
  await assert.rejects(
    provisionFirstAdmin("another@example.test", password, "Another Admin"),
    /already claimed/,
  );
});
test("MFA is mandatory; OTP replay is rejected; cookies are HTTP-only", async () => {
  const bad = await admin
    .post("/api/v1/admin/auth/login")
    .set("Origin", origin)
    .send({ email: "operator@example.test", password, code: "000000" });
  assert.equal(bad.status, 401);
  const code = totpFor(secret).generate();
  const login = await admin
    .post("/api/v1/admin/auth/login")
    .set("Origin", origin)
    .send({ email: "operator@example.test", password, code });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  csrf = login.body.data.csrf;
  cookie = (login.headers["set-cookie"] as unknown as string[])[0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(login.body.data.accessToken, undefined);
  const replay = await request(app)
    .post("/api/v1/admin/auth/login")
    .set("Origin", origin)
    .send({ email: "operator@example.test", password, code });
  assert.equal(replay.status, 401);
  const me = await admin.get("/api/v1/admin/auth/me");
  assert.equal(me.body.data.role, "super-admin");
  assert.equal(me.body.data.mfaSecretEncrypted, undefined);
});
test("CSRF and strict Origin checks deny unsafe writes", async () => {
  const url = `/api/v1/admin/users/${alice._id}/action`;
  const body = {
    action: "suspend",
    reason: "Investigating a credible abuse report.",
  };
  assert.equal((await admin.post(url).send(body)).status, 403);
  assert.equal(
    (
      await admin
        .post(url)
        .set({ ...headers(), Origin: "https://attacker.example" })
        .send(body)
    ).status,
    403,
  );
  assert.equal((await User.findById(alice._id))?.status, "active");
});
test("analyst role cannot browse user PII or suspend accounts", async () => {
  const recovery = crypto.randomBytes(12).toString("hex");
  await User.create({
    email: "analyst@example.test",
    name: "Data Analyst",
    adminRole: "analyst",
    passwordHash: await bcrypt.hash(password, 12),
    mfaSecretEncrypted: encryptSecret(secret),
    recoveryHashes: [digest(recovery)],
  });
  const analyst = request.agent(app);
  const login = await analyst
    .post("/api/v1/admin/auth/login")
    .set("Origin", origin)
    .send({ email: "analyst@example.test", password, code: recovery });
  assert.equal(login.status, 200);
  assert.equal((await analyst.get("/api/v1/admin/dashboard")).status, 200);
  assert.equal((await analyst.get("/api/v1/admin/users")).status, 403);
  assert.equal(
    (
      await analyst
        .post(`/api/v1/admin/users/${alice._id}/action`)
        .set({ Origin: origin, "X-CSRF-Token": login.body.data.csrf })
        .send({
          action: "ban",
          reason: "This role has no enforcement permission.",
        })
    ).status,
    403,
  );
  const users = await admin.get("/api/v1/admin/users");
  assert.equal(users.status, 200);
  assert.equal(users.body.data.items[0].passwordHash, undefined);
  assert.equal(users.body.data.items[0].birthDate, undefined);
  // Permissions are reloaded from the database on every request, and Operations cannot undo a permanent ban.
  await User.updateOne(
    { email: "analyst@example.test" },
    { adminRole: "operations" },
  );
  await User.updateOne({ _id: bob._id }, { status: "banned" });
  await analyst
    .post(`/api/v1/admin/users/${bob._id}/action`)
    .set({ Origin: origin, "X-CSRF-Token": login.body.data.csrf })
    .send({
      action: "reactivate",
      reason: "An operations role must not undo a permanent ban.",
    })
    .expect(403);
  await User.updateOne({ _id: bob._id }, { status: "active" });
  await User.updateOne(
    { email: "analyst@example.test" },
    { adminRole: "analyst" },
  );
});
test("suspension updates shared User, revokes mobile sessions and creates atomic audit", async () => {
  const res = await admin
    .post(`/api/v1/admin/users/${alice._id}/action`)
    .set(headers())
    .send({
      action: "suspend",
      reason: "Investigating a credible safety concern.",
    });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await User.findById(alice._id))?.status, "suspended");
  assert.equal(await RefreshSession.countDocuments({ user: alice._id }), 0);
  assert.equal(
    (
      await request(app)
        .get("/api/v1/users/me")
        .auth(aliceAccess, { type: "bearer" })
    ).status,
    401,
  );
  assert.equal(
    (
      await request(app)
        .get("/api/v1/activities")
        .auth(bobAccess, { type: "bearer" })
    ).body.data.length,
    0,
  );
  assert.equal(
    await AuditLog.countDocuments({
      action: "user.suspend",
      targetId: String(alice._id),
    }),
    1,
  );
  await admin
    .post(`/api/v1/admin/users/${alice._id}/action`)
    .set(headers())
    .send({
      action: "reactivate",
      reason: "Review completed; account appeal accepted.",
    })
    .expect(200);
  assert.equal(
    (
      await request(app)
        .get("/api/v1/users/me")
        .auth(aliceAccess, { type: "bearer" })
    ).status,
    401,
    "old credentials remain invalid after reactivation",
  );
  aliceAccess = (await tokens(String(alice._id))).accessToken;
});
test("verification review changes mobile profile identity status without changing email ownership", async () => {
  await User.updateOne({ _id: alice._id }, { emailVerified: false });
  const verification = await Verification.create({
    user: alice._id,
    type: "identity",
    providerReference: "test-reference",
  });
  await admin
    .post(`/api/v1/admin/verifications/${verification._id}/review`)
    .set(headers())
    .send({
      status: "approved",
      reason: "Provider evidence meets the identity policy.",
    })
    .expect(200);
  const me = await request(app)
    .get("/api/v1/users/me")
    .auth(aliceAccess, { type: "bearer" });
  assert.equal(me.body.data.user.identityVerified, true);
  assert.equal(me.body.data.user.emailVerified, false);
  await User.updateOne({ _id: alice._id }, { emailVerified: true });
});
test("disabled category hides existing plans and rejects new mobile posts", async () => {
  await admin
    .patch(`/api/v1/admin/categories/${categoryId}`)
    .set(headers())
    .send({
      active: false,
      reason: "Pausing this category during policy review.",
    })
    .expect(200);
  const list = await request(app)
    .get("/api/v1/activities")
    .auth(bobAccess, { type: "bearer" });
  assert.equal(list.body.data.length, 0);
  assert.equal(
    (
      await request(app)
        .get(`/api/v1/activities/${planId}`)
        .auth(bobAccess, { type: "bearer" })
    ).status,
    404,
  );
  await request(app)
    .post("/api/v1/activities")
    .auth(aliceAccess, { type: "bearer" })
    .send({
      category: "food",
      type: "together",
      title: "Another coffee plan",
      description: "A public meeting at the cafe.",
      zone: "Park Street",
      startsAt: "2099-01-01T18:00:00Z",
    })
    .expect(400);
  await admin
    .patch(`/api/v1/admin/categories/${categoryId}`)
    .set(headers())
    .send({
      active: true,
      coverAssetKey: "coffee",
      coverImageUrl: "https://example.test/cafe.png",
      reason: "Category review is complete and approved.",
    })
    .expect(200);
  const categories = await request(app)
    .get("/api/v1/activities/categories")
    .auth(bobAccess, { type: "bearer" });
  const updated = categories.body.data.find(
    (c: { slug: string }) => c.slug === "food",
  );
  assert.equal(updated.coverAssetKey, "coffee");
  assert.equal(updated.coverImageUrl, "https://example.test/cafe.png");
});
test("activity removal immediately disappears from mobile discovery", async () => {
  await admin
    .post(`/api/v1/admin/activities/${planId}/action`)
    .set(headers())
    .send({
      status: "deleted",
      reason: "The listing violates our activity policy.",
    })
    .expect(200);
  assert.equal(
    (
      await request(app)
        .get("/api/v1/activities")
        .auth(bobAccess, { type: "bearer" })
    ).body.data.length,
    0,
  );
});
test("mobile abuse report appears in admin queue and review is audited", async () => {
  await request(app)
    .post("/api/v1/reports")
    .auth(bobAccess, { type: "bearer" })
    .send({
      userId: String(alice._id),
      reason: "Please review this concerning behaviour.",
    })
    .expect(201);
  const reports = await admin.get("/api/v1/admin/reports");
  assert.equal(reports.body.data.total, 1);
  const target = reports.body.data.items[0]._id;
  await admin
    .post(`/api/v1/admin/reports/${target}/review`)
    .set(headers())
    .send({
      status: "resolved",
      severity: "medium",
      reason: "Investigation complete and the reporter supported.",
    })
    .expect(200);
  assert.equal((await Report.findById(target))?.status, "resolved");
  assert.equal(
    await AuditLog.countDocuments({
      action: "report.resolved",
      targetId: target,
    }),
    1,
  );
});
test("matching weights are validated, versioned and protected against stale updates", async () => {
  const value = {
    romantic: 35,
    activity: 30,
    location: 20,
    lifestyle: 15,
    radiusKm: 25,
    minScore: 40,
    frequencyHours: 24,
    expiresDays: 14,
  };
  await admin
    .put("/api/v1/admin/matching")
    .set(headers())
    .send({
      version: 0,
      value: { ...value, romantic: 99 },
      reason: "Invalid weights must never be accepted.",
    })
    .expect(400);
  const saved = await admin.put("/api/v1/admin/matching").set(headers()).send({
    version: 0,
    value,
    reason: "Initial conservative matching configuration.",
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.version, 1);
  await admin
    .put("/api/v1/admin/matching")
    .set(headers())
    .send({
      version: 0,
      value,
      reason: "Stale updates must not overwrite a version.",
    })
    .expect(409);
});
test("dashboard statistics use the same MongoDB and missing services are not fabricated", async () => {
  const onboarding = await admin.get("/api/v1/admin/onboarding/analytics");
  assert.equal(onboarding.status, 200);
  assert.equal(onboarding.body.data.completed, 2);
  assert.equal(onboarding.body.data.relationshipIntent.length, 0);
  const details = await admin.get(`/api/v1/admin/users/${alice._id}`);
  assert.equal(details.status, 200);
  assert.equal(details.body.data.onboarding.quickStartCompleted, true);
  assert.equal(details.body.data.onboarding.checks.adult, true);
  const res = await admin.get("/api/v1/admin/dashboard");
  assert.equal(res.status, 200);
  assert.equal(
    res.body.data.metrics.totalUsers,
    await User.countDocuments({ adminRole: null }),
  );
  assert.equal(res.body.data.metrics.monthlyRevenue, null);
});
test("logout revokes session, and replaying its cookie fails", async () => {
  await admin.post("/api/v1/admin/auth/logout").set(headers()).expect(204);
  await request(app)
    .get("/api/v1/admin/auth/me")
    .set("Cookie", cookie.split(";")[0])
    .expect(401);
  assert.equal(
    await AdminSession.countDocuments({
      user: adminId,
      revokedAt: { $ne: null },
    }),
    1,
  );
});
test("one-time recovery resets password, revokes sessions and cannot be replayed", async () => {
  const replacement = `Bb2!${crypto.randomBytes(20).toString("hex")}`;
  const body = {
    email: "operator@example.test",
    recoveryCode: recoveryCodes[0],
    password: replacement,
  };
  await request(app)
    .post("/api/v1/admin/auth/recover")
    .set("Origin", origin)
    .send(body)
    .expect(204);
  await request(app)
    .post("/api/v1/admin/auth/recover")
    .set("Origin", origin)
    .send(body)
    .expect(401);
  const agent = request.agent(app);
  const login = await agent
    .post("/api/v1/admin/auth/login")
    .set("Origin", origin)
    .send({
      email: "operator@example.test",
      password: replacement,
      code: recoveryCodes[1],
    });
  assert.equal(login.status, 200);
  await agent
    .post("/api/v1/admin/auth/revoke-sessions")
    .set({ Origin: origin, "X-CSRF-Token": login.body.data.csrf })
    .expect(204);
  await agent.get("/api/v1/admin/auth/me").expect(401);
  assert.equal(
    await AuditLog.countDocuments({ action: "admin.password_recovered" }),
    1,
  );
});
test("repeated failed admin logins trigger an account lockout", async () => {
  const recovery = crypto.randomBytes(12).toString("hex");
  const user = await User.create({
    email: "locked@example.test",
    name: "Locked Admin",
    adminRole: "support",
    passwordHash: await bcrypt.hash(password, 12),
    mfaSecretEncrypted: encryptSecret(secret),
    recoveryHashes: [digest(recovery)],
  });
  for (let i = 0; i < 5; i++)
    await request(app)
      .post("/api/v1/admin/auth/login")
      .set("Origin", origin)
      .send({
        email: user.email,
        password: "Incorrect-password-123",
        code: recovery,
      })
      .expect(401);
  const locked = await User.findById(user._id).select("+adminLockedUntil");
  assert.ok(locked?.adminLockedUntil && locked.adminLockedUntil > new Date());
  await request(app)
    .post("/api/v1/admin/auth/login")
    .set("Origin", origin)
    .send({ email: user.email, password, code: recovery })
    .expect(401);
});
