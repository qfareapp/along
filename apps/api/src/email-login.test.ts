import { before, beforeEach, after, afterEach, test, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import nodemailer from "nodemailer";
import bcrypt from "bcryptjs";
import { MongoMemoryReplSet } from "mongodb-memory-server";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.ADMIN_AUTH_MODE = "mfa";
process.env.SMTP_URL = "smtp://test.invalid";
process.env.EMAIL_FROM = "Along <sender@example.test>";
process.env.NODE_ENV = "test";
const { createApp } = await import("./app.js");
const { User, Profile, RefreshSession } = await import("./models.js");
const { EmailLoginChallenge } = await import("./email-login-models.js");
const { verifyMemberToken } = await import("./auth.js");
const { config } = await import("./config.js");
let db: MongoMemoryReplSet,
  app = createApp();
let deliveries: { to: string; text: string }[] = [];
before(
  async () => {
    db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(db.getUri());
    await Promise.all([
      User.init(),
      Profile.init(),
      RefreshSession.init(),
      EmailLoginChallenge.init(),
    ]);
  },
  { timeout: 180000 },
);
beforeEach(async () => {
  app = createApp();
  deliveries = [];
  await Promise.all([
    User.deleteMany({}),
    Profile.deleteMany({}),
    RefreshSession.deleteMany({}),
    EmailLoginChallenge.deleteMany({}),
  ]);
  mock.method(nodemailer, "createTransport", () => ({
    sendMail: async (message: { to: string; text: string }) => {
      deliveries.push(message);
    },
  }));
});
afterEach(() => mock.restoreAll());
after(async () => {
  await mongoose.disconnect();
  await db?.stop();
});
async function member(extra = {}) {
  return User.create({
    name: "OTP Member",
    email: "otp@example.test",
    passwordHash: "fixture",
    birthDate: "1995-01-01",
    emailVerified: true,
    ...extra,
  });
}
async function issue(email = "otp@example.test", target = app) {
  const result = await request(target)
    .post("/api/v1/auth/otp/request")
    .send({ email });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return {
    requestId: result.body.data.requestId as string,
    code:
      /code is (\d{6})/.exec(deliveries.at(-1)?.text ?? "")?.[1] ?? "000000",
    result,
  };
}
const verify = (input: object, target = app) =>
  request(target).post("/api/v1/auth/otp/verify").send(input);
const register = (signupToken: string, extra = {}, target = app) =>
  request(target)
    .post("/api/v1/auth/otp/register")
    .send({
      signupToken,
      name: "New Member",
      birthDate: "1995-01-01",
      acceptTerms: true,
      acceptGuidelines: true,
      ...extra,
    });
async function newGrant() {
  const challenge = await issue("new@example.test");
  const response = await verify({
    requestId: challenge.requestId,
    code: challenge.code,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.isNewUser, true);
  assert.equal(response.body.data.accessToken, undefined);
  assert.equal(await User.countDocuments(), 0);
  assert.equal(await RefreshSession.countDocuments(), 0);
  return response.body.data.signupToken as string;
}

test("new email proves ownership before account creation, then creates a verified adult account and one session", async () => {
  const grant = await newGrant();
  await assert.rejects(() => verifyMemberToken(grant));
  const result = await register(grant);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.data.isNewUser, true);
  const user = await User.findOne().select("+birthDate");
  assert.equal(user!.email, "new@example.test");
  assert.equal(user!.emailVerified, true);
  assert.equal(user!.birthDate!.toISOString().slice(0, 10), "1995-01-01");
  const profile = await Profile.findOne({ user: user!._id });
  assert.ok(profile!.consents!.termsAt);
  assert.ok(profile!.consents!.guidelinesAt);
  assert.equal(profile!.onboarding!.quickStartCompleted, false);
  assert.equal(await RefreshSession.countDocuments(), 1);
  assert.equal((await register(grant)).status, 400);
  assert.equal(await User.countDocuments(), 1);
});

test("new account requires adulthood, name and explicit consent; invalid details leave grant usable", async () => {
  const grant = await newGrant();
  for (const extra of [
    { birthDate: "2020-01-01" },
    { birthDate: "1995-02-31" },
    { name: "a" },
    { acceptTerms: false },
    { acceptGuidelines: false },
  ]) {
    assert.equal((await register(grant, extra)).status, 400);
    assert.equal(await User.countDocuments(), 0);
  }
  assert.equal((await register(grant)).status, 201);
});

test("expired and superseded signup grants cannot create accounts", async () => {
  const grant = await newGrant();
  await EmailLoginChallenge.updateOne(
    {},
    {
      $set: {
        signupExpiresAt: new Date(Date.now() - 1000),
        requestedAt: new Date(Date.now() - 61000),
      },
    },
  );
  assert.equal((await register(grant)).status, 400);
  const next = await issue("new@example.test", createApp());
  const verified = await verify({ requestId: next.requestId, code: next.code });
  const nextGrant = verified.body.data.signupToken;
  await EmailLoginChallenge.updateOne(
    {},
    { $set: { requestedAt: new Date(Date.now() - 61000) } },
  );
  await issue("new@example.test", createApp());
  assert.equal((await register(nextGrant)).status, 400);
  assert.equal(await User.countDocuments(), 0);
});

test("concurrent signup submissions create exactly one account and session", async () => {
  const grant = await newGrant();
  const results = await Promise.all([register(grant), register(grant)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 400]);
  assert.equal(await User.countDocuments(), 1);
  assert.equal(await Profile.countDocuments(), 1);
  assert.equal(await RefreshSession.countDocuments(), 1);
});

test("signup transaction failure rolls back account, profile and grant consumption", async () => {
  const grant = await newGrant();
  const fault = mock.method(RefreshSession, "create", async () => {
    throw new Error("Injected signup fault");
  });
  try {
    assert.equal((await register(grant)).status, 500);
  } finally {
    fault.mock.restore();
  }
  assert.equal(await User.countDocuments(), 0);
  assert.equal(await Profile.countDocuments(), 0);
  assert.equal((await register(grant)).status, 201);
});

test("an unverified legacy email owner signs into the same account and invalidates old passwords and sessions", async () => {
  const user = await member({
    emailVerified: false,
    passwordHash: await bcrypt.hash("old-password", 4),
  });
  const { tokens } = await import("./auth.js");
  const old = await tokens(String(user._id));
  const challenge = await issue();
  const result = await verify({
    requestId: challenge.requestId,
    code: challenge.code,
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.isNewUser, false);
  assert.equal(result.body.data.user.id, String(user._id));
  const claimed = await User.findById(user._id).select("+passwordHash");
  assert.equal(claimed!.emailVerified, true);
  assert.equal(
    await bcrypt.compare("old-password", claimed!.passwordHash),
    false,
  );
  await assert.rejects(() => verifyMemberToken(old.accessToken));
  assert.ok(await verifyMemberToken(result.body.data.accessToken));
  assert.equal(await User.countDocuments(), 1);
  assert.equal(await RefreshSession.countDocuments(), 1);
});

test("verified member signs in once; code is hashed, namespaced and absent from responses", async () => {
  const user = await member();
  const challenge = await issue(" OTP@EXAMPLE.TEST ");
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]!.to, user.email);
  assert.equal(challenge.result.body.data.expiresIn, 300);
  assert.equal(challenge.result.body.data.resendAfter, 60);
  assert.equal("code" in challenge.result.body.data, false);
  const stored = await EmailLoginChallenge.findOne().select(
    "+emailKey +codeHash",
  );
  assert.notEqual(stored!.codeHash, challenge.code);
  assert.notEqual(stored!.emailKey, user.email);
  const result = await verify({
    requestId: challenge.requestId,
    code: challenge.code,
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.user.id, String(user._id));
  assert.equal(
    String((await verifyMemberToken(result.body.data.accessToken))._id),
    String(user._id),
  );
  assert.equal(await RefreshSession.countDocuments({ user: user._id }), 1);
  assert.equal(
    (await verify({ requestId: challenge.requestId, code: challenge.code }))
      .status,
    400,
  );
  assert.equal(
    (await EmailLoginChallenge.findOne().select("+codeHash"))!.codeHash,
    undefined,
  );
});

test("restricted and admin emails receive the same public response without mail or sessions", async () => {
  const responses = [];
  for (const [i, extra] of [
    { status: "suspended" },
    { adminRole: "super_admin" },
  ].entries()) {
    await member({ ...extra, email: `denied-${i}@example.test` });
    const challenge = await issue(`denied-${i}@example.test`, createApp());
    const { requestId, ...metadata } = challenge.result.body.data;
    responses.push(metadata);
    assert.equal(requestId.length, 32);
    assert.equal(
      (await verify({ requestId, code: challenge.code }, createApp())).status,
      400,
    );
  }
  assert.ok(
    responses.every(
      (body) => JSON.stringify(body) === JSON.stringify(responses[0]),
    ),
  );
  assert.equal(deliveries.length, 0);
  assert.equal(await RefreshSession.countDocuments(), 0);
  assert.equal(await User.countDocuments(), 2);
});

test("five incorrect guesses exhaust a challenge; expired and malformed codes cannot sign in", async () => {
  await member();
  const challenge = await issue();
  const wrong = challenge.code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await verify({ requestId: challenge.requestId, code: wrong })).status,
      400,
    );
  assert.equal(
    (await verify({ requestId: challenge.requestId, code: challenge.code }))
      .status,
    400,
  );
  await EmailLoginChallenge.updateOne(
    { requestId: challenge.requestId },
    { $set: { attempts: 0, expiresAt: new Date(Date.now() - 1000) } },
  );
  assert.equal(
    (await verify({ requestId: challenge.requestId, code: challenge.code }))
      .status,
    400,
  );
  assert.equal(
    (await verify({ requestId: challenge.requestId, code: "123" })).status,
    400,
  );
  assert.equal(await RefreshSession.countDocuments(), 0);
});

test("concurrent correct verifications create exactly one session", async () => {
  await member();
  const challenge = await issue();
  const results = await Promise.all(
    [1, 2].map(() =>
      verify({ requestId: challenge.requestId, code: challenge.code }),
    ),
  );
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 400]);
  assert.equal(await RefreshSession.countDocuments(), 1);
});

test("resend invalidates the previous request and retains persistent email cooldown/hourly quota", async () => {
  await member();
  let old = await issue();
  assert.equal(
    (
      await request(createApp())
        .post("/api/v1/auth/otp/request")
        .send({ email: "otp@example.test" })
    ).status,
    429,
  );
  for (let i = 0; i < 4; i++) {
    await EmailLoginChallenge.updateMany(
      {},
      { $set: { requestedAt: new Date(Date.now() - 61000) } },
    );
    const next = await issue("otp@example.test", createApp());
    assert.equal(
      (await verify({ requestId: old.requestId, code: old.code }, createApp()))
        .status,
      400,
    );
    old = next;
  }
  await EmailLoginChallenge.updateMany(
    {},
    { $set: { requestedAt: new Date(Date.now() - 61000) } },
  );
  assert.equal(
    (
      await request(createApp())
        .post("/api/v1/auth/otp/request")
        .send({ email: "otp@example.test" })
    ).status,
    429,
  );
  assert.equal(deliveries.length, 5);
  assert.equal(
    (await verify({ requestId: old.requestId, code: old.code }, createApp()))
      .status,
    200,
  );
});

test("unknown emails have the same persistent cooldown, and IP throttling returns JSON", async () => {
  await issue("unknown@example.test");
  assert.equal(
    (
      await request(createApp())
        .post("/api/v1/auth/otp/request")
        .send({ email: "unknown@example.test" })
    ).status,
    429,
  );
  await issue("another@example.test");
  await issue("third@example.test");
  const limited = await request(app)
    .post("/api/v1/auth/otp/request")
    .send({ email: "fourth@example.test" });
  assert.equal(limited.status, 429);
  assert.equal(typeof limited.body.error.message, "string");
});

test("restrictions applied after delivery are checked before issuing a session", async () => {
  for (const [i, change] of [
    { status: "suspended" },
    { adminRole: "super_admin" },
  ].entries()) {
    const email = `change-${i}@example.test`,
      user = await member({ email });
    const challenge = await issue(email, createApp());
    await User.updateOne({ _id: user._id }, { $set: change });
    assert.equal(
      (
        await verify(
          { requestId: challenge.requestId, code: challenge.code },
          createApp(),
        )
      ).status,
      400,
    );
  }
  assert.equal(await RefreshSession.countDocuments(), 0);
});

test("session creation failure rolls back code consumption and permits a complete retry", async () => {
  await member();
  const challenge = await issue();
  const failure = mock.method(RefreshSession, "create", async () => {
    throw new Error("Injected session fault");
  });
  try {
    assert.equal(
      (await verify({ requestId: challenge.requestId, code: challenge.code }))
        .status,
      500,
    );
  } finally {
    failure.mock.restore();
  }
  assert.equal((await EmailLoginChallenge.findOne())!.consumed, false);
  assert.equal(
    (await verify({ requestId: challenge.requestId, code: challenge.code }))
      .status,
    200,
  );
  assert.equal(await RefreshSession.countDocuments(), 1);
});

test("delivery failure invalidates the code; missing email configuration never creates a challenge", async () => {
  await member();
  mock.restoreAll();
  mock.method(nodemailer, "createTransport", () => ({
    sendMail: async () => {
      throw new Error("Injected mail fault");
    },
  }));
  const challenge = await issue();
  for (
    let i = 0;
    i < 30 && !(await EmailLoginChallenge.findOne())!.consumed;
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal((await EmailLoginChallenge.findOne())!.consumed, true);
  assert.equal(
    (await verify({ requestId: challenge.requestId, code: challenge.code }))
      .status,
    400,
  );
  const previous = { SMTP_URL: config.SMTP_URL, SMTP_HOST: config.SMTP_HOST };
  config.SMTP_URL = undefined;
  config.SMTP_HOST = undefined;
  try {
    assert.equal(
      (
        await request(createApp())
          .post("/api/v1/auth/otp/request")
          .send({ email: "absent@example.test" })
      ).status,
      503,
    );
  } finally {
    Object.assign(config, previous);
  }
  assert.equal(await EmailLoginChallenge.countDocuments(), 1);
});

test("password reset invalidates pending sign-in codes and password login remains available", async () => {
  await member();
  const challenge = await issue();
  assert.equal(
    (
      await request(app)
        .post("/api/v1/auth/password/request")
        .send({ email: "otp@example.test" })
    ).status,
    200,
  );
  const recoveryCode = /code is ([a-f0-9]{12})/.exec(
    deliveries.at(-1)!.text,
  )![1];
  const password = "new-otp-test-password";
  const reset = await request(app)
    .post("/api/v1/auth/password/reset")
    .send({ email: "otp@example.test", code: recoveryCode, password });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.equal(
    (await verify({ requestId: challenge.requestId, code: challenge.code }))
      .status,
    400,
  );
  assert.equal(
    (
      await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "otp@example.test", password })
    ).status,
    200,
  );
});

test("account deletion removes pending login challenges", async () => {
  const user = await member();
  const challenge = await issue();
  const { eraseAccount } = await import("./account-deletion.js");
  await eraseAccount(String(user._id));
  assert.equal(await EmailLoginChallenge.countDocuments({ user: user._id }), 0);
  assert.equal(
    (await verify({ requestId: challenge.requestId, code: challenge.code }))
      .status,
    400,
  );
});
