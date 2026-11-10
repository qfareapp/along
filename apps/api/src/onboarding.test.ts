import { after, before, test, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import nodemailer from "nodemailer";
import sharp from "sharp";
import { MongoMemoryServer } from "mongodb-memory-server";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.ADMIN_AUTH_MODE = "mfa";
process.env.PHOTO_STORAGE = "mongodb";
process.env.EMAIL_VERIFICATION_REQUIRED = "true";
process.env.SMTP_URL = "smtp://test.invalid";
const { createApp } = await import("./app.js");
const { User, Profile, ProfilePhoto, OnboardingEvent, Activity, Category } =
  await import("./models.js");
const { completion, onboardingAnalytics } = await import("./onboarding.js");
const { tokens } = await import("./auth.js");
const app = createApp();
let db: MongoMemoryServer,
  access: string,
  id: string,
  photoId: string,
  code: string;
const auth = () => ({ Authorization: `Bearer ${access}` });
before(
  async () => {
    db = await MongoMemoryServer.create();
    await mongoose.connect(db.getUri());
    await Promise.all([
      User.init(),
      Profile.init(),
      ProfilePhoto.init(),
      OnboardingEvent.init(),
    ]);
    mock.method(nodemailer, "createTransport", () => ({
      sendMail: async (message: { text: string }) => {
        code = message.text.match(/\d{6}/)![0];
        return {};
      },
    }));
    const r = await request(app).post("/api/v1/auth/register").send({
      name: "Test Adult",
      email: "onboarding@example.test",
      password: "test-password-12345",
      birthDate: "1998-01-01",
    });
    assert.equal(r.status, 201);
    access = r.body.data.accessToken;
    id = r.body.data.user.id;
  },
  { timeout: 180000 },
);
after(async () => {
  mock.restoreAll();
  await mongoose.disconnect();
  if (db) await db.stop();
});
test("new member begins onboarding in the existing unique profile", async () => {
  const r = await request(app).get("/api/v1/onboarding").set(auth());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.state, "quick_start_incomplete");
  assert.equal(r.body.data.profile.onboarding.currentStep, 1);
  assert.equal(await Profile.countDocuments({ user: id }), 1);
});
test("zero vibes and unknown enum values cannot continue", async () => {
  for (const vibes of [[], ["unknown"]])
    assert.equal(
      (
        await request(app)
          .patch("/api/v1/onboarding/vibes")
          .set(auth())
          .send({ vibes })
      ).status,
      400,
    );
  assert.equal(
    (
      await request(app)
        .patch("/api/v1/onboarding/first-plan")
        .set(auth())
        .send({ firstPlanIntent: "do_something" })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(app)
        .post("/api/v1/onboarding/complete-quick-start")
        .set(auth())
    ).status,
    400,
  );
});
test("multiple stable vibes persist; retries do not create duplicate profiles or events", async () => {
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await request(app)
          .patch("/api/v1/onboarding/vibes")
          .set(auth())
          .send({ vibes: ["coffee_dates", "food_adventures", "coffee_dates"] })
      ).status,
      200,
    );
  const p = await Profile.findOne({ user: id });
  assert.deepEqual(p?.onboarding?.vibes, ["coffee_dates", "food_adventures"]);
  assert.equal(await Profile.countDocuments({ user: id }), 1);
  assert.equal(
    await OnboardingEvent.countDocuments({
      user: id,
      name: "onboarding_vibe_completed",
    }),
    1,
  );
  assert.equal(await Category.countDocuments(), 0);
});
test("first-plan and relationship choices persist without creating a public post", async () => {
  assert.equal(
    (
      await request(app)
        .patch("/api/v1/onboarding/first-plan")
        .set(auth())
        .send({ firstPlanIntent: "everyday_person" })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(app)
        .patch("/api/v1/onboarding/relationship-intent")
        .set(auth())
        .send({ relationshipIntent: "meaningful" })
    ).status,
    200,
  );
  const p = await Profile.findOne({ user: id });
  assert.equal(p?.onboarding?.firstPlanIntent, "everyday_person");
  assert.equal(p?.onboarding?.relationshipIntent, "meaningful");
  assert.equal(await Activity.countDocuments(), 0);
});
test("city persists; optional approximate area can be null", async () => {
  assert.equal(
    (
      await request(app)
        .patch("/api/v1/onboarding/location")
        .set(auth())
        .send({ city: "  Kolkata  ", area: null, country: "India" })
    ).status,
    200,
  );
  assert.equal((await Profile.findOne({ user: id }))?.city, "Kolkata");
  assert.equal(
    (
      await request(app)
        .patch("/api/v1/onboarding/location")
        .set(auth())
        .send({ city: "", coordinates: [1, 2] })
    ).status,
    400,
  );
});
test("photo and prompt can be skipped for quick start but photo stays required for discovery", async () => {
  assert.equal(
    (
      await request(app)
        .patch("/api/v1/onboarding/personality")
        .set(auth())
        .send({ personalityPrompt: null })
    ).status,
    200,
  );
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await request(app)
          .post("/api/v1/onboarding/complete-quick-start")
          .set(auth())
      ).status,
      200,
    );
  const p = await Profile.findOne({ user: id });
  assert.equal(p?.onboarding?.quickStartCompleted, true);
  assert.equal(p?.onboarding?.currentStage, "eligibility_pending");
  assert.equal(p?.photos.length, 0);
  assert.equal(p?.onboardingComplete, false);
});
test("going back preserves later selections, existing biography and authoritative resume stage", async () => {
  await Profile.updateOne(
    { user: id },
    { $set: { bio: "My existing biography", occupation: "Designer" } },
  );
  const r = await request(app)
    .patch("/api/v1/onboarding/vibes")
    .set(auth())
    .send({ vibes: ["fitness_buddies"] });
  assert.equal(r.status, 200);
  const resumed = await request(createApp())
    .get("/api/v1/onboarding")
    .set(auth());
  assert.equal(resumed.body.data.profile.bio, "My existing biography");
  assert.equal(
    resumed.body.data.profile.onboarding.firstPlanIntent,
    "everyday_person",
  );
  assert.equal(resumed.body.data.profile.onboarding.currentStep, 6);
});
test("invalid input and unauthenticated requests do not destroy saved progress", async () => {
  const before = await Profile.findOne({ user: id }).lean();
  assert.equal(
    (
      await request(app)
        .patch("/api/v1/onboarding/vibes")
        .set(auth())
        .send({ vibes: [] })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(app)
        .patch("/api/v1/onboarding/vibes")
        .send({ vibes: ["coffee_dates"] })
    ).status,
    401,
  );
  const after = await Profile.findOne({ user: id }).lean();
  assert.deepEqual(after?.onboarding, before?.onboarding);
});
test("incomplete members cannot read identifiable activities, publish, join, or set readiness", async () => {
  assert.equal(
    (await request(app).get("/api/v1/activities").set(auth())).status,
    403,
  );
  assert.equal(
    (
      await request(app)
        .get(`/api/v1/activities/${new mongoose.Types.ObjectId()}`)
        .set(auth())
    ).status,
    403,
  );
  assert.equal(
    (await request(app).post("/api/v1/activities").set(auth()).send({})).status,
    403,
  );
  assert.equal(
    (
      await request(app)
        .post(`/api/v1/activities/${new mongoose.Types.ObjectId()}/interests`)
        .set(auth())
    ).status,
    403,
  );
  assert.equal(
    (
      await request(app)
        .post("/api/v1/profile/activate-discovery")
        .set(auth())
        .send({ readyForDiscovery: true })
    ).status,
    403,
  );
  await request(app)
    .patch("/api/v1/profiles/me")
    .set(auth())
    .send({ onboardingComplete: true, emailVerified: true, photos: ["fake"] });
  assert.equal((await completion(id)).activated, false);
  assert.equal(
    (
      await request(app)
        .post("/api/v1/messages")
        .set(auth())
        .send({ text: "blocked" })
    ).status,
    404,
  );
});
const eligibility = {
  name: "Test Adult",
  birthDate: "1998-01-01",
  gender: "nonbinary",
  genders: ["woman", "man"],
  minAge: 18,
  maxAge: 50,
  acceptTerms: true,
  acceptGuidelines: true,
};
test("underage, invalid age preferences and missing consent are rejected server-side", async () => {
  for (const change of [
    { birthDate: "2020-01-01" },
    { minAge: 17 },
    { minAge: 50, maxAge: 30 },
    { acceptTerms: false },
  ])
    assert.equal(
      (
        await request(app)
          .patch("/api/v1/profile/eligibility")
          .set(auth())
          .send({ ...eligibility, ...change })
      ).status,
      400,
    );
  assert.equal(
    (
      await request(app).post("/api/v1/auth/register").send({
        name: "Teen",
        email: "teen@example.test",
        password: "test-password-12345",
        birthDate: "2020-01-01",
      })
    ).status,
    400,
  );
});
test("mandatory details persist without inferring gender preferences from relationship intent", async () => {
  const { birthDate: registeredBirthDate, ...details } = eligibility;
  const r = await request(app)
    .patch("/api/v1/profile/eligibility")
    .set(auth())
    .send(details);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.data.profile.preferences.genders, ["woman", "man"]);
  assert.equal(r.body.data.checks.consent, true);
  assert.equal(r.body.data.user.birthDate, undefined);
  assert.equal(r.body.data.user.hasBirthDate, true);
  assert.equal(
    (await User.findById(id).select("+birthDate"))?.birthDate
      ?.toISOString()
      .slice(0, 10),
    registeredBirthDate,
  );
});
test("saved birthdays cannot be replaced during profile completion", async () => {
  const r = await request(app)
    .patch("/api/v1/profile/eligibility")
    .set(auth())
    .send({ ...eligibility, birthDate: "1997-01-01" });
  assert.equal(r.status, 409);
});
test("legacy accounts must supply a birthday once and stored underage dates remain blocked", async (t) => {
  const user = await User.create({
    name: "Legacy Member",
    email: "legacy-birthday@example.test",
    passwordHash: "unused",
    birthDate: eligibility.birthDate,
  });
  t.after(async () => {
    await Promise.all([
      User.deleteOne({ _id: user._id }),
      Profile.deleteOne({ user: user._id }),
      OnboardingEvent.deleteMany({ user: user._id }),
    ]);
  });
  // Simulate an older persisted account that predates required registration DOB.
  await User.collection.updateOne(
    { _id: user._id },
    { $unset: { birthDate: "" } },
  );
  const headers = {
    Authorization: `Bearer ${(await tokens(String(user._id))).accessToken}`,
  };
  const { birthDate, ...details } = eligibility;
  const save = (body: object) =>
    request(app).patch("/api/v1/profile/eligibility").set(headers).send(body);
  assert.equal((await completion(String(user._id))).user.hasBirthDate, false);
  assert.equal((await save(details)).status, 400);
  assert.equal(
    (await save({ ...details, birthDate: "2020-01-01" })).status,
    400,
  );
  assert.equal((await save({ ...details, birthDate })).status, 200);
  assert.equal((await completion(String(user._id))).user.hasBirthDate, true);
  assert.equal((await save(details)).status, 200);
  await User.updateOne(
    { _id: user._id },
    { $set: { birthDate: new Date("2020-01-01T00:00:00Z") } },
  );
  assert.equal((await save(details)).status, 400);
});
test("email verification uses expiring hashed single-use codes and never returns the code", async () => {
  const sent = await request(app)
    .post("/api/v1/auth/contact/request")
    .set(auth());
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.data.code, undefined);
  const owner = await User.findById(id).select("+contactCodeHash");
  assert.notEqual(owner?.contactCodeHash, code);
  assert.equal(
    (
      await request(app)
        .post("/api/v1/auth/contact/verify")
        .set(auth())
        .send({ code: "000000" })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(app)
        .post("/api/v1/auth/contact/verify")
        .set(auth())
        .send({ code })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(app)
        .post("/api/v1/auth/contact/verify")
        .set(auth())
        .send({ code })
    ).status,
    400,
  );
});
test("photo endpoint requires auth, validates content and saves owner-bound private normalized images", async () => {
  assert.equal(
    (
      await request(app)
        .post("/api/v1/profile/photos")
        .set("Content-Type", "image/jpeg")
        .send(Buffer.from("bad"))
    ).status,
    401,
  );
  assert.equal(
    (
      await request(app)
        .post("/api/v1/profile/photos")
        .set(auth())
        .set("Content-Type", "image/jpeg")
        .send(Buffer.from("bad"))
    ).status,
    400,
  );
  const image = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "#174F54" },
  })
    .png()
    .toBuffer();
  const r = await request(app)
    .post("/api/v1/profile/photos")
    .set(auth())
    .set("Content-Type", "image/png")
    .send(image);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  photoId = r.body.data.id;
  const photo = await ProfilePhoto.findById(photoId).select("+bytes");
  assert.equal(photo?.contentType, "image/jpeg");
  assert.ok(photo!.bytes!.length < 100_000);
  assert.equal((await sharp(photo!.bytes!).metadata()).format, "jpeg");
  assert.equal(
    (await request(app).get(`/api/v1/profile/photos/${photoId}`).set(auth()))
      .status,
    200,
  );
});
test("another incomplete member cannot view the private photo", async () => {
  const u = await User.create({
    name: "Other Adult",
    email: "other@example.test",
    passwordHash: "fixture",
    birthDate: "1995-01-01",
  });
  const t = (await tokens(String(u._id))).accessToken;
  assert.equal(
    (
      await request(app)
        .get(`/api/v1/profile/photos/${photoId}`)
        .auth(t, { type: "bearer" })
    ).status,
    403,
  );
});
test("eligible verified member activates discovery with optional fields empty", async () => {
  const r = await request(app)
    .post("/api/v1/profile/activate-discovery")
    .set(auth());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.state, "ready_for_discovery");
  assert.equal(
    (await request(app).get("/api/v1/activities").set(auth())).status,
    200,
  );
  assert.equal((await Profile.findOne({ user: id }))?.occupation, "Designer");
});
test("members can add more photos and choose which one is shown first", async () => {
  const image = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "#F47768" },
  })
    .png()
    .toBuffer();
  const second = await request(app)
    .post("/api/v1/profile/photos")
    .set(auth())
    .set("Content-Type", "image/png")
    .send(image);
  assert.equal(second.status, 201, JSON.stringify(second.body));
  const secondId = second.body.data.id;
  const main = await request(app)
    .post(`/api/v1/profile/photos/${secondId}/main`)
    .set(auth());
  assert.equal(main.status, 200, JSON.stringify(main.body));
  assert.deepEqual(main.body.data.photos, [secondId, photoId]);
  assert.deepEqual((await Profile.findOne({ user: id }))?.photos, [
    secondId,
    photoId,
  ]);
  assert.equal(
    (
      await request(app)
        .post(`/api/v1/profile/photos/${new mongoose.Types.ObjectId()}/main`)
        .set(auth())
    ).status,
    404,
  );
  assert.equal(
    (
      await request(app)
        .delete(`/api/v1/profile/photos/${secondId}`)
        .set(auth())
    ).status,
    204,
  );
  assert.deepEqual((await Profile.findOne({ user: id }))?.photos, [photoId]);
});
test("six profile photos are allowed and a seventh is rejected", async () => {
  const photoApp = createApp();
  const image = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "#174F54" },
  })
    .png()
    .toBuffer();
  const added: string[] = [];
  for (let i = 0; i < 5; i++) {
    const response = await request(photoApp)
      .post("/api/v1/profile/photos")
      .set(auth())
      .attach("photo", image, {
        filename: "photo.png",
        contentType: "image/png",
      });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    added.push(response.body.data.id);
  }
  assert.equal((await Profile.findOne({ user: id }))?.photos.length, 6);
  const seventh = await request(photoApp)
    .post("/api/v1/profile/photos")
    .set(auth())
    .attach("photo", image, {
      filename: "photo.png",
      contentType: "image/png",
    });
  assert.equal(seventh.status, 400);
  for (const photo of added)
    await request(photoApp)
      .delete(`/api/v1/profile/photos/${photo}`)
      .set(auth())
      .expect(204);
});

test("removing the required photo immediately revokes discovery access", async () => {
  assert.equal(
    (await request(app).delete(`/api/v1/profile/photos/${photoId}`).set(auth()))
      .status,
    204,
  );
  assert.equal(
    (await request(app).get("/api/v1/activities").set(auth())).status,
    403,
  );
  assert.equal((await completion(id)).state, "profile_incomplete");
});
test("suspension revokes tokens and cannot be bypassed through onboarding", async () => {
  await User.updateOne({ _id: id }, { $set: { status: "suspended" } });
  assert.equal((await completion(id)).state, "suspended");
  for (const route of [
    "/api/v1/onboarding",
    "/api/v1/profile/completion",
    "/api/v1/activities",
  ])
    assert.equal((await request(app).get(route).set(auth())).status, 401);
  assert.equal(
    (await request(app).post("/api/v1/profile/activate-discovery").set(auth()))
      .status,
    401,
  );
});
test("analytics reflect persisted stages and suppress small relationship groups", async () => {
  const a = await onboardingAnalytics();
  assert.equal(a.started, 1);
  assert.equal(a.completed, 1);
  assert.equal(a.readyForDiscovery, 0);
  assert.equal(a.relationshipIntent.length, 0);
  assert.equal(a.suppressedRelationshipCount, 1);
  assert.ok(a.events.length > 0);
});
