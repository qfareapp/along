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
const { config } = await import("./config.js");
const { User, Profile, Category } = await import("./models.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const { tokens } = await import("./auth.js");
const { completion, discoveryUserIds } = await import("./onboarding.js");
const app = createApp();
let db: MongoMemoryServer,
  first: string,
  second: string,
  firstToken: string,
  secondToken: string;
before(
  async () => {
    db = await MongoMemoryServer.create();
    await mongoose.connect(db.getUri());
    for (const email of ["first@example.test", "second@example.test"]) {
      const user = await User.create({
        name: "Test Adult",
        email,
        passwordHash: "fixture",
        birthDate: "1998-01-01",
        emailVerified: false,
      });
      await eligibleProfile(user._id);
      const access = (await tokens(String(user._id))).accessToken;
      if (!first) {
        first = String(user._id);
        firstToken = access;
      } else {
        second = String(user._id);
        secondToken = access;
      }
    }
    await Category.create({ slug: "food", name: "Food", active: true });
  },
  { timeout: 180000 },
);
after(async () => {
  await mongoose.disconnect();
  if (db) await db.stop();
});

test("temporary bypass allows activation and shared-plan interactions without claiming verified email", async () => {
  const progress = await completion(first);
  assert.equal(progress.contactVerificationRequired, false);
  assert.equal(progress.checks.contact, true);
  assert.equal(progress.user.emailVerified, false);
  const activated = await request(app)
    .post("/api/v1/profile/activate-discovery")
    .auth(firstToken, { type: "bearer" });
  assert.equal(activated.status, 200, JSON.stringify(activated.body));
  const plan = await request(app)
    .post("/api/v1/activities")
    .auth(firstToken, { type: "bearer" })
    .send({
      type: "together",
      category: "food",
      title: "A public coffee plan",
      description: "A fictional plan for testing temporary email policy.",
      zone: "Kolkata",
      startsAt: "2099-01-01T18:00:00Z",
    });
  assert.equal(plan.status, 201, JSON.stringify(plan.body));
  assert.equal(
    (
      await request(app)
        .get("/api/v1/activities")
        .auth(secondToken, { type: "bearer" })
    ).body.data.length,
    1,
  );
  assert.equal(
    (
      await request(app)
        .post(`/api/v1/activities/${plan.body.data._id}/interests`)
        .auth(secondToken, { type: "bearer" })
    ).status,
    201,
  );
  assert.equal((await User.findById(first))?.emailVerified, false);
  assert.equal((await User.findById(second))?.emailVerified, false);
});
test("email bypass leaves age, consent, photo and account-status checks enforced", async () => {
  await User.updateOne({ _id: second }, { birthDate: "2020-01-01" });
  assert.equal((await completion(second)).eligible, false);
  await User.updateOne({ _id: second }, { birthDate: "1998-01-01" });
  await Profile.updateOne(
    { user: second },
    { $unset: { "consents.termsAt": 1 } },
  );
  assert.equal((await completion(second)).eligible, false);
  await Profile.updateOne(
    { user: second },
    { $set: { "consents.termsAt": new Date(), photos: [] } },
  );
  assert.equal((await completion(second)).eligible, false);
  await User.updateOne({ _id: second }, { status: "suspended" });
  assert.equal(
    (
      await request(app)
        .post("/api/v1/profile/activate-discovery")
        .auth(secondToken, { type: "bearer" })
    ).status,
    401,
  );
});
test("reenabling email verification immediately restores the requirement for existing activated accounts", async () => {
  config.EMAIL_VERIFICATION_REQUIRED = true;
  const progress = await completion(first);
  assert.equal(progress.contactVerificationRequired, true);
  assert.equal(progress.checks.contact, false);
  assert.equal(progress.activated, false);
  assert.equal(
    (
      await request(app)
        .get("/api/v1/activities")
        .auth(firstToken, { type: "bearer" })
    ).status,
    403,
  );
  assert.equal((await discoveryUserIds()).length, 0);
});
