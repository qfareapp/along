import express, { Router, type Response, type NextFunction } from "express";
import mongoose from "mongoose";
import crypto from "node:crypto";
import { emailTransport } from "./email.js";
import { compressPhoto } from "./compress-photo.js";
import multer from "multer";
import {
  storePhoto,
  deleteCloudinaryPhoto,
  readCloudinaryPhoto,
} from "./photos.js";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { memberRateKey, rateLimitMessage } from "./rate-limits.js";
import { authenticate, digest, type AuthedRequest } from "./auth.js";
import { Profile, User, ProfilePhoto, OnboardingEvent } from "./models.js";
import { isAdult } from "./validation.js";
import { config } from "./config.js";

export const vibes = [
  "coffee_dates",
  "weekend_exploring",
  "fitness_buddies",
  "movies_shows",
  "commute_together",
  "live_events",
  "food_adventures",
  "learn_something",
] as const;
export const vibeCategories: Record<string, string[]> = {
  coffee_dates: ["food"],
  weekend_exploring: ["travel"],
  fitness_buddies: ["fitness"],
  movies_shows: ["movies"],
  commute_together: ["commute"],
  live_events: ["events"],
  food_adventures: ["food"],
  learn_something: ["learning"],
};
export const fail = (status: number, message: string) =>
  Object.assign(new Error(message), { status });

const distanceFields = {
  maxDistanceKm: z.number().min(1).max(500).nullable().optional(),
  distanceUnit: z.enum(["km", "mi"]).optional(),
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    })
    .strict()
    .optional(),
};
async function distanceUpdates(
  userId: string,
  b: {
    maxDistanceKm?: number | null;
    distanceUnit?: string;
    location?: { latitude: number; longitude: number };
  },
) {
  const profile = await Profile.findOne({ user: userId }).lean();
  const radius =
    b.maxDistanceKm === undefined
      ? profile?.preferences?.maxDistanceKm
      : b.maxDistanceKm;
  if (
    radius != null &&
    !b.location &&
    !profile?.approximateLocation?.coordinates?.length
  )
    throw fail(400, "Use your location before saving a distance range.");
  return {
    ...(b.maxDistanceKm !== undefined
      ? { "preferences.maxDistanceKm": b.maxDistanceKm }
      : {}),
    ...(b.distanceUnit ? { "preferences.distanceUnit": b.distanceUnit } : {}),
    ...(b.location
      ? {
          approximateLocation: {
            type: "Point",
            coordinates: [b.location.longitude, b.location.latitude].map(
              (v) => Math.round(v * 1000) / 1000,
            ),
          },
        }
      : {}),
  };
}
const genders = z.enum(["woman", "man", "nonbinary", "self_described"]);
const intent = z.enum(["do_something", "everyday_person", "just_exploring"]);
const relationship = z.enum(["serious", "meaningful", "casual", "exploring"]);
export async function recordEvent(
  user: string,
  name: string,
  step?: number,
  extra: { durationMs?: number; skipped?: boolean } = {},
) {
  await OnboardingEvent.updateOne(
    { user, name, step },
    { $setOnInsert: { user, name, step, ...extra } },
    { upsert: true },
  );
}
export async function ensureProfile(user: string) {
  return Profile.findOneAndUpdate(
    { user },
    { $setOnInsert: { user, "onboarding.startedAt": new Date() } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}
export async function completion(userId: string) {
  const [user, profile] = await Promise.all([
    User.findById(userId).select("+birthDate"),
    Profile.findOne({ user: userId }),
  ]);
  if (!user || user.adminRole) throw fail(404, "Member not found.");
  const o = profile?.onboarding;
  const ageOk =
    !!user.birthDate && isAdult(user.birthDate.toISOString().slice(0, 10));
  const photoOk =
    !!profile?.photos?.length &&
    (await ProfilePhoto.countDocuments({
      _id: {
        $in: profile.photos.filter((v) => mongoose.isObjectIdOrHexString(v)),
      },
      owner: userId,
    })) > 0;
  const checks = {
    quickStart:
      !!o?.quickStartCompleted &&
      !!o.vibes?.length &&
      !!o.firstPlanIntent &&
      !!o.relationshipIntent &&
      !!profile?.city,
    displayName: user.name.trim().length >= 2,
    adult: ageOk,
    gender: !!profile?.gender,
    preferences:
      !!profile?.preferences?.genders?.length &&
      (profile.preferences.minAge ?? 0) >= 18 &&
      (profile.preferences.maxAge ?? 0) >= (profile.preferences.minAge ?? 18),
    contact: !config.EMAIL_VERIFICATION_REQUIRED || !!user.emailVerified,
    photo: photoOk,
    consent: !!profile?.consents?.termsAt && !!profile.consents.guidelinesAt,
  };
  const eligible =
    user.status === "active" && Object.values(checks).every(Boolean);
  const state =
    user.status !== "active"
      ? "suspended"
      : !checks.quickStart
        ? "quick_start_incomplete"
        : !(
              checks.adult &&
              checks.gender &&
              checks.preferences &&
              checks.consent &&
              checks.contact
            )
          ? "eligibility_pending"
          : !checks.photo
            ? "profile_incomplete"
            : eligible && o?.fullyCompletedAt
              ? "ready_for_discovery"
              : "profile_incomplete";
  return {
    state,
    checks,
    eligible,
    contactVerificationRequired: config.EMAIL_VERIFICATION_REQUIRED,
    activated: state === "ready_for_discovery",
    missing: Object.entries(checks)
      .filter(([, ok]) => !ok)
      .map(([key]) => key),
    user: {
      name: user.name,
      emailVerified: user.emailVerified,
      hasBirthDate: !!user.birthDate,
    },
    profile,
  };
}
export async function requireReady(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
) {
  const result = await completion(req.userId!);
  if (!result.activated)
    throw fail(
      403,
      "Complete your profile and activate discovery before connecting with others.",
    );
  next();
}
async function persistStage(userId: string) {
  const result = await completion(userId);
  const stage =
    result.state === "quick_start_incomplete" ? "quick_start" : result.state;
  if (
    stage !== "suspended" &&
    result.profile?.onboarding?.currentStage !== stage
  ) {
    await Profile.updateOne(
      { user: userId },
      { $set: { "onboarding.currentStage": stage } },
    );
    if (result.profile?.onboarding)
      result.profile.onboarding.currentStage = stage as
        | "quick_start"
        | "eligibility_pending"
        | "profile_incomplete"
        | "ready_for_discovery";
  }
  return result;
}
export async function discoveryUserIds() {
  const now = new Date();
  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate()),
  );
  const oldest = new Date(Date.UTC(now.getUTCFullYear() - 120, 0, 1));
  // Check both account and profile requirements in one aggregation, without per-member queries.
  const rows = await Profile.aggregate([
    {
      $match: {
        "onboarding.fullyCompletedAt": { $type: "date" },
        "onboarding.quickStartCompleted": true,
        "onboarding.vibes.0": { $exists: true },
        "onboarding.firstPlanIntent": {
          $in: ["do_something", "everyday_person", "just_exploring"],
        },
        "onboarding.relationshipIntent": {
          $in: ["serious", "meaningful", "casual", "exploring"],
        },
        city: { $type: "string", $ne: "" },
        gender: { $type: "string", $ne: "" },
        "preferences.genders.0": { $exists: true },
        "preferences.minAge": { $gte: 18 },
        "consents.termsAt": { $type: "date" },
        "consents.guidelinesAt": { $type: "date" },
      },
    },
    {
      $match: {
        $expr: { $gte: ["$preferences.maxAge", "$preferences.minAge"] },
      },
    },
    {
      $lookup: {
        from: User.collection.name,
        localField: "user",
        foreignField: "_id",
        as: "account",
      },
    },
    { $unwind: "$account" },
    {
      $match: {
        "account.status": "active",
        "account.adminRole": null,
        ...(config.EMAIL_VERIFICATION_REQUIRED
          ? { "account.emailVerified": true }
          : {}),
        "account.birthDate": { $gte: oldest, $lte: cutoff },
        "account.name": { $regex: /\S.{1,}/ },
      },
    },
    {
      $lookup: {
        from: ProfilePhoto.collection.name,
        let: { owner: "$user", ids: "$photos" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$owner", "$$owner"] },
                  { $in: [{ $toString: "$_id" }, "$$ids"] },
                ],
              },
            },
          },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: "ownedPhoto",
      },
    },
    { $match: { "ownedPhoto.0": { $exists: true } } },
    { $project: { _id: 0, user: 1 } },
  ]);
  return rows.map((v) => v.user as mongoose.Types.ObjectId);
}
export function onboardingRouter() {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
    fileFilter: (_req, file, done) => {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype))
        done(fail(400, "Choose a JPEG, PNG or WebP photo."));
      else done(null, true);
    },
  });
  router.use(authenticate);
  router.use(rateLimit({
    windowMs: 60000,
    limit: 90,
    keyGenerator: memberRateKey,
    message: rateLimitMessage,
  }));
  router.get("/onboarding", async (req: AuthedRequest, res) => {
    const profile = await ensureProfile(req.userId!);
    if (!profile.onboarding?.startedAt)
      await Profile.updateOne(
        { _id: profile._id },
        { $set: { "onboarding.startedAt": new Date() } },
      );
    await recordEvent(req.userId!, "onboarding_started");
    res.json({ data: await completion(req.userId!) });
  });
  const steps = [
    {
      path: "vibes",
      step: 1,
      schema: z
        .object({
          vibes: z
            .array(z.enum(vibes))
            .min(1)
            .max(8)
            .transform((v) => [...new Set(v)]),
        })
        .strict(),
      event: "onboarding_vibe_completed",
    },
    {
      path: "first-plan",
      step: 2,
      schema: z.object({ firstPlanIntent: intent }).strict(),
      event: "onboarding_first_plan_completed",
    },
    {
      path: "relationship-intent",
      step: 3,
      schema: z.object({ relationshipIntent: relationship }).strict(),
      event: "onboarding_relationship_intent_completed",
    },
    {
      path: "location",
      step: 4,
      schema: z
        .object({
          city: z.string().trim().min(2).max(100),
          area: z.string().trim().max(80).nullable().optional(),
          country: z.string().trim().min(2).max(80).default("India"),
        })
        .strict(),
      event: "onboarding_city_completed",
    },
    {
      path: "personality",
      step: 5,
      schema: z
        .object({
          personalityPrompt: z
            .object({
              type: z.enum(["perfect_sunday", "get_along", "want_to_try"]),
              answer: z.string().trim().max(160),
            })
            .nullable()
            .optional(),
        })
        .strict(),
      event: "onboarding_personality_completed",
    },
  ];
  for (const step of steps)
    router.patch(
      `/onboarding/${step.path}`,
      async (req: AuthedRequest, res) => {
        const input = step.schema.parse(req.body);
        const previous = await ensureProfile(req.userId!);
        const o = previous.onboarding;
        if (
          (step.step > 1 && !o?.vibes.length) ||
          (step.step > 2 && !o?.firstPlanIntent) ||
          (step.step > 3 && !o?.relationshipIntent) ||
          (step.step > 4 && !previous.city)
        )
          throw fail(400, "Complete the previous onboarding steps first.");
        const set: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(input))
          set[step.path === "location" ? key : `onboarding.${key}`] = value;
        if (step.step === 5) set["onboarding.personalityCompleted"] = true;
        const profile = await Profile.findOneAndUpdate(
          { user: req.userId },
          {
            $set: set,
            $max: { "onboarding.currentStep": Math.min(step.step + 1, 6) },
          },
          { new: true, runValidators: true },
        );
        await recordEvent(req.userId!, step.event, step.step, {
          skipped:
            step.step === 5 &&
            !(input as { personalityPrompt?: unknown }).personalityPrompt,
        });
        res.json({ data: profile });
      },
    );
  router.post(
    "/onboarding/complete-quick-start",
    async (req: AuthedRequest, res) => {
      const p = await Profile.findOne({ user: req.userId });
      const o = p?.onboarding;
      if (
        !o?.vibes.length ||
        !o.firstPlanIntent ||
        !o.relationshipIntent ||
        !p?.city ||
        !o.personalityCompleted
      )
        throw fail(
          400,
          "Complete your vibe, first plan, intention and city, then continue or skip Make It You.",
        );
      await Profile.updateOne(
        { user: req.userId, "onboarding.quickStartCompleted": { $ne: true } },
        {
          $set: {
            "onboarding.quickStartCompleted": true,
            "onboarding.quickStartCompletedAt": new Date(),
            "onboarding.currentStage": "eligibility_pending",
            "onboarding.currentStep": 6,
          },
        },
      );
      await recordEvent(req.userId!, "onboarding_quick_start_completed");
      res.json({ data: await completion(req.userId!) });
    },
  );
  router.get("/profile/completion", async (req: AuthedRequest, res) =>
    res.json({ data: await completion(req.userId!) }),
  );
  router.patch(
    "/profile/dating-preferences",
    async (req: AuthedRequest, res) => {
      const b = z
        .object({
          genders: z.array(genders).min(1).max(4),
          minAge: z.number().int().min(18).max(120),
          maxAge: z.number().int().min(18).max(120),
          ...distanceFields,
        })
        .strict()
        .refine((v) => v.minAge <= v.maxAge, "Check your age range.")
        .parse(req.body);
      const distance = await distanceUpdates(req.userId!, b);
      await ensureProfile(req.userId!);
      await Profile.updateOne(
        { user: req.userId },
        {
          $set: {
            "preferences.genders": [...new Set(b.genders)],
            "preferences.minAge": b.minAge,
            "preferences.maxAge": b.maxAge,
            ...distance,
          },
        },
        { runValidators: true },
      );
      res.json({ data: await persistStage(req.userId!) });
    },
  );
  router.patch("/profile/eligibility", async (req: AuthedRequest, res) => {
    const b = z
      .object({
        name: z.string().trim().min(2).max(60),
        birthDate: z.iso
          .date()
          .refine((v) => isAdult(v), "Along is for adults aged 18 and over.")
          .optional(),
        gender: genders,
        genderDescription: z.string().trim().max(60).optional(),
        genders: z.array(genders).min(1).max(4),
        minAge: z.number().int().min(18).max(120),
        maxAge: z.number().int().min(18).max(120),
        ...distanceFields,
        acceptTerms: z.literal(true),
        acceptGuidelines: z.literal(true),
      })
      .strict()
      .refine((v) => v.minAge <= v.maxAge, "Check your age range.")
      .parse(req.body);
    const distance = await distanceUpdates(req.userId!, b);
    const owner = await User.findById(req.userId).select("+birthDate");
    if (!owner) throw fail(404, "Member not found.");
    const savedBirthDate = owner.birthDate?.toISOString().slice(0, 10);
    if (savedBirthDate && b.birthDate && savedBirthDate !== b.birthDate)
      throw fail(
        409,
        "Date of birth must match your registration. Contact support to correct it.",
      );
    const birthDate = savedBirthDate ?? b.birthDate;
    if (!birthDate) throw fail(400, "Enter your date of birth.");
    if (!isAdult(birthDate))
      throw fail(400, "Along is for adults aged 18 and over.");
    await recordEvent(req.userId!, "profile_unlock_started");
    await User.updateOne(
      { _id: req.userId, status: "active" },
      {
        $set: {
          name: b.name,
          ...(!savedBirthDate && {
            birthDate: new Date(`${birthDate}T00:00:00Z`),
          }),
        },
      },
      { runValidators: true },
    );
    await ensureProfile(req.userId!);
    await Profile.updateOne(
      { user: req.userId },
      {
        $set: {
          gender: b.gender,
          "preferences.genders": [...new Set(b.genders)],
          "preferences.minAge": b.minAge,
          "preferences.maxAge": b.maxAge,
          ...distance,
          "consents.termsAt": new Date(),
          "consents.guidelinesAt": new Date(),
          "consents.version": "2026-10-26",
        },
      },
      { runValidators: true },
    );
    await recordEvent(req.userId!, "profile_unlock_completed");
    res.json({ data: await persistStage(req.userId!) });
  });
  router.post(
    "/profile/activate-discovery",
    async (req: AuthedRequest, res) => {
      if (!(await completion(req.userId!)).eligible)
        throw fail(
          403,
          "Complete the required safety checks and add a profile photo before activating discovery.",
        );
      await Profile.updateOne(
        { user: req.userId, "onboarding.fullyCompletedAt": { $exists: false } },
        {
          $set: {
            "onboarding.fullyCompletedAt": new Date(),
            "onboarding.currentStage": "ready_for_discovery",
            onboardingComplete: true,
          },
        },
      );
      await recordEvent(req.userId!, "discovery_activated");
      res.json({ data: await persistStage(req.userId!) });
    },
  );
  router.patch("/profile/optional", async (req: AuthedRequest, res) => {
    const fields = [
      "education",
      "hobbies",
      "fitness",
      "food",
      "availability",
      "commute",
      "budget",
      "travel",
      "weekend",
      "lifestyle",
    ] as const;
    const body = z
      .object({
        occupation: z.string().trim().max(100).optional(),
        bio: z.string().trim().max(600).optional(),
        details: z
          .record(z.enum(fields), z.string().trim().max(160))
          .optional(),
      })
      .strict()
      .parse(req.body);
    const set: Record<string, string> = {};
    if (body.occupation !== undefined) set.occupation = body.occupation;
    if (body.bio !== undefined) set.bio = body.bio;
    for (const [key, value] of Object.entries(body.details ?? {}))
      set[`optionalDetails.${key}`] = value;
    await ensureProfile(req.userId!);
    res.json({
      data: await Profile.findOneAndUpdate(
        { user: req.userId },
        { $set: set },
        { new: true, runValidators: true },
      ),
    });
  });
  router.post("/onboarding/events", async (req: AuthedRequest, res) => {
    const b = z
      .object({
        name: z.enum([
          "onboarding_vibe_selected",
          "onboarding_abandoned",
          "step_timing",
          "photo_upload_success",
          "photo_upload_failure",
          "profile_unlock_started",
        ]),
        step: z.number().int().min(1).max(6).optional(),
        durationMs: z.number().int().min(0).max(86400000).optional(),
        skipped: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    await recordEvent(req.userId!, b.name, b.step, {
      durationMs: b.durationMs,
      skipped: b.skipped,
    });
    res.status(204).end();
  });
  router.post(
    "/auth/contact/request",
    rateLimit({
      windowMs: 60000,
      limit: 2,
      keyGenerator: memberRateKey,
      message: rateLimitMessage,
    }),
    async (req: AuthedRequest, res) => {
      const transport = emailTransport();
      if (!transport)
        throw fail(
          503,
          "Email delivery is not configured. Set the Brevo SMTP settings and EMAIL_FROM on the API to verify your email.",
        );
      const user = await User.findById(req.userId);
      if (user?.emailVerified) {
        res.json({ data: { sent: false, verified: true } });
        return;
      }
      const code = crypto.randomInt(100000, 1000000).toString();
      const hash = digest(`${req.userId}:${code}:${config.JWT_SECRET}`);
      await User.updateOne(
        { _id: req.userId },
        {
          $set: {
            contactCodeHash: hash,
            contactCodeExpiresAt: new Date(Date.now() + 600000),
            contactCodeAttempts: 0,
          },
        },
      );
      try {
        await transport.sendMail({
          from: config.EMAIL_FROM,
          to: user!.email,
          subject: "Your Along verification code",
          text: `Your Along code is ${code}. It expires in 10 minutes. If you did not request this, ignore this message.`,
        });
      } catch {
        await User.updateOne(
          { _id: req.userId, contactCodeHash: hash },
          { $unset: { contactCodeHash: 1, contactCodeExpiresAt: 1 } },
        );
        throw fail(
          503,
          "Email could not be delivered. Please try again later.",
        );
      }
      res.json({ data: { sent: true } });
    },
  );
  router.post(
    "/auth/contact/verify",
    rateLimit({
      windowMs: 60000,
      limit: 10,
      keyGenerator: memberRateKey,
      message: rateLimitMessage,
    }),
    async (req: AuthedRequest, res) => {
      const { code } = z
        .object({ code: z.string().regex(/^\d{6}$/) })
        .strict()
        .parse(req.body);
      // Increment attempts and consume the code atomically; retries cannot reuse it.
      const user = await User.findOneAndUpdate(
        {
          _id: req.userId,
          contactCodeExpiresAt: { $gt: new Date() },
          contactCodeAttempts: { $lt: 5 },
        },
        { $inc: { contactCodeAttempts: 1 } },
        { new: true },
      ).select("+contactCodeHash");
      if (
        !user ||
        user.contactCodeHash !==
          digest(`${req.userId}:${code}:${config.JWT_SECRET}`)
      )
        throw fail(400, "Code is incorrect or expired. Request a new code.");
      const verified = await User.updateOne(
        {
          _id: req.userId,
          contactCodeHash: user.contactCodeHash,
          contactCodeExpiresAt: { $gt: new Date() },
        },
        {
          $set: { emailVerified: true },
          $unset: { contactCodeHash: 1, contactCodeExpiresAt: 1 },
        },
      );
      if (!verified.modifiedCount)
        throw fail(400, "Code has already been used.");
      await persistStage(req.userId!);
      res.json({ data: { verified: true } });
    },
  );
  router.post(
    "/profile/photos",
    rateLimit({
      windowMs: 60000,
      limit: 10,
      keyGenerator: memberRateKey,
      message: rateLimitMessage,
    }),
    express.raw({
      type: ["image/jpeg", "image/png", "image/webp"],
      limit: "5mb",
    }),
    upload.single("photo"),
    async (req: AuthedRequest, res) => {
      const input = req.file?.buffer ?? req.body;
      if (!Buffer.isBuffer(input) || !input.length)
        throw fail(400, "Choose a JPEG, PNG or WebP photo up to 5 MB.");
      await ensureProfile(req.userId!);
      if ((await ProfilePhoto.countDocuments({ owner: req.userId })) >= 6)
        throw fail(400, "You can keep up to six photos. Remove a photo first.");
      let bytes: Buffer;
      try {
        bytes = await compressPhoto(input);
      } catch {
        throw fail(
          400,
          "This image could not be read. Choose another JPEG, PNG or WebP photo.",
        );
      }
      const stored = await storePhoto(bytes, req.userId!);
      let photo;
      try {
        photo = await ProfilePhoto.create({
          owner: req.userId,
          ...stored,
          contentType: "image/jpeg",
        });
      } catch (error) {
        if (stored.cloudinaryPublicId)
          await deleteCloudinaryPhoto(stored.cloudinaryPublicId);
        throw error;
      }
      const attached = await Profile.updateOne(
        {
          user: req.userId,
          $expr: { $lt: [{ $size: { $ifNull: ["$photos", []] } }, 6] },
        },
        { $addToSet: { photos: String(photo._id) } },
      );
      if (!attached.modifiedCount) {
        if (stored.cloudinaryPublicId)
          await deleteCloudinaryPhoto(stored.cloudinaryPublicId);
        await ProfilePhoto.deleteOne({ _id: photo._id });
        throw fail(400, "You can keep up to six photos. Remove a photo first.");
      }
      await recordEvent(req.userId!, "photo_upload_success");
      await persistStage(req.userId!);
      res.status(201).json({ data: { id: photo._id } });
    },
  );
  router.get("/profile/photos/:id", async (req: AuthedRequest, res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id))
      throw fail(404, "Photo unavailable.");
    const photo = await ProfilePhoto.findById(req.params.id).select(
      "+bytes +cloudinaryPublicId",
    );
    if (!photo) throw fail(404, "Photo unavailable.");
    if (String(photo.owner) !== req.userId) {
      if (
        !(await completion(req.userId!)).activated ||
        !(await completion(String(photo.owner))).activated
      )
        throw fail(403, "Photo unavailable until discovery is activated.");
      const { Block } = await import("./models.js");
      if (
        await Block.exists({
          $or: [
            { user: req.userId, target: photo.owner },
            { user: photo.owner, target: req.userId },
          ],
        })
      )
        throw fail(404, "Photo unavailable.");
    }
    const bytes = photo.cloudinaryPublicId
      ? await readCloudinaryPhoto(photo.cloudinaryPublicId)
      : photo.bytes;
    res
      .set({
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, no-store",
      })
      .send(bytes);
  });
  router.post("/profile/photos/:id/main", async (req: AuthedRequest, res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id))
      throw fail(404, "Photo unavailable.");
    const id = String(req.params.id);
    const profile = await Profile.findOne({ user: req.userId }).select(
      "photos",
    );
    if (
      !profile?.photos.includes(id) ||
      !(await ProfilePhoto.exists({ _id: id, owner: req.userId }))
    )
      throw fail(404, "Photo unavailable.");
    profile.photos = [id, ...profile.photos.filter((v) => v !== id)];
    await profile.save();
    res.json({ data: { photos: profile.photos } });
  });
  router.delete("/profile/photos/:id", async (req: AuthedRequest, res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id))
      throw fail(404, "Photo unavailable.");
    const photo = await ProfilePhoto.findOne({
      _id: req.params.id,
      owner: req.userId,
    }).select("+cloudinaryPublicId");
    if (photo?.cloudinaryPublicId)
      await deleteCloudinaryPhoto(photo.cloudinaryPublicId);
    await Profile.updateOne(
      { user: req.userId },
      { $pull: { photos: req.params.id } },
    );
    await ProfilePhoto.deleteOne({ _id: req.params.id, owner: req.userId });
    await persistStage(req.userId!);
    res.status(204).end();
  });
  return router;
}

export async function onboardingAnalytics() {
  const members = await User.find({ adminRole: null }).distinct("_id");
  const scope = { user: { $in: members } };
  const started = await Profile.countDocuments({
    ...scope,
    "onboarding.startedAt": { $exists: true },
  });
  const completed = await Profile.countDocuments({
    ...scope,
    "onboarding.quickStartCompleted": true,
  });
  const unlocked = await Profile.countDocuments({
    ...scope,
    "onboarding.fullyCompletedAt": { $exists: true },
  });
  const aggregate = async (field: string, unwind = false) =>
    Profile.aggregate([
      { $match: scope },
      ...(unwind ? [{ $unwind: `$onboarding.${field}` }] : []),
      { $group: { _id: `$onboarding.${field}`, count: { $sum: 1 } } },
      { $match: { _id: { $ne: null } } },
      { $sort: { count: -1 } },
    ]);
  const timing = await Profile.aggregate([
    {
      $match: {
        ...scope,
        "onboarding.quickStartCompletedAt": { $exists: true },
        "onboarding.startedAt": { $exists: true },
      },
    },
    {
      $group: {
        _id: null,
        value: {
          $avg: {
            $subtract: [
              "$onboarding.quickStartCompletedAt",
              "$onboarding.startedAt",
            ],
          },
        },
      },
    },
  ]);
  const dropOff = await Profile.aggregate([
    {
      $match: {
        ...scope,
        "onboarding.startedAt": { $exists: true },
        "onboarding.quickStartCompleted": { $ne: true },
      },
    },
    { $group: { _id: "$onboarding.currentStep", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  const relationships = await aggregate("relationshipIntent");
  return {
    started,
    completed,
    quickStartCompletionRate: started ? completed / started : 0,
    averageCompletionMs: timing[0]?.value ?? null,
    eligibilityCompletionRate: completed ? unlocked / completed : 0,
    readyForDiscovery: (await discoveryUserIds()).length,
    pendingVerification: await User.countDocuments({
      _id: { $in: members },
      emailVerified: false,
      status: "active",
    }),
    dropOff,
    vibes: await aggregate("vibes", true),
    firstPlans: await aggregate("firstPlanIntent"),
    relationshipIntent: relationships.filter((v) => v.count >= 5),
    suppressedRelationshipCount: relationships
      .filter((v) => v.count < 5)
      .reduce((s, v) => s + v.count, 0),
    events: await OnboardingEvent.aggregate([
      { $match: scope },
      {
        $group: {
          _id: { name: "$name", step: "$step", skipped: "$skipped" },
          count: { $sum: 1 },
          averageDurationMs: { $avg: "$durationMs" },
        },
      },
    ]),
  };
}
