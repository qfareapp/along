import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { MulterError } from "multer";
import { config } from "./config.js";
import { appRateLimits } from "./rate-limits.js";
import { adminRouter } from "./admin/router.js";
import { discoveryRouter } from "./discovery.js";
import { chatRouter, pairKey } from "./chat.js";
import { notificationsRouter } from "./notifications.js";
import { socialRouter } from "./social.js";
import { playRouter } from "./play.js";
import { planGroupsRouter } from "./plan-groups.js";
import { preparePlanAudience } from "./plan-audience.js";
import { activitiesRouter, activityScope } from "./activities.js";
import {
  onboardingRouter,
  requireReady,
  completion,
  discoveryUserIds,
} from "./onboarding.js";
import { authenticate, digest, tokens, type AuthedRequest } from "./auth.js";
import {
  Activity,
  Block,
  Category,
  Match,
  Profile,
  RefreshSession,
  Report,
  User,
} from "./models.js";
import {
  activityInput,
  checkPlanDetails,
  credentials,
  profileInput,
  registration,
} from "./validation.js";

const fail = (status: number, message: string) =>
  Object.assign(new Error(message), { status });
const ageOn = (birth: Date, today = new Date()) => {
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  if (
    today.getUTCMonth() < birth.getUTCMonth() ||
    (today.getUTCMonth() === birth.getUTCMonth() &&
      today.getUTCDate() < birth.getUTCDate())
  )
    age--;
  return age;
};
const validId = (value: unknown) => {
  if (typeof value !== "string" || !mongoose.isObjectIdOrHexString(value))
    throw fail(400, "Invalid resource ID.");
  return value;
};

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (config.TRUST_PROXY_HOPS > 0)
    app.set("trust proxy", config.TRUST_PROXY_HOPS);
  app.use(helmet());
  app.use(
    cors({
      origin: [
        ...config.CORS_ORIGINS.split(",").map((v) => v.trim()),
        new URL(config.ADMIN_ORIGIN).origin,
      ],
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "32kb" }));
  app.use(...appRateLimits());
  app.get("/health", (_req, res) =>
    res.json({ status: "ok", service: "along-api" }),
  );
  app.get("/ready", (_req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "unavailable",
      database: ready ? "connected" : "disconnected",
    });
  });
  app.use("/api/v1", (_req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "Connect MongoDB before using the API.",
        },
      });
      return;
    }
    next();
  });
  const authLimit = rateLimit({ windowMs: 15 * 60000, limit: 20 });
  app.use("/api/v1/admin", adminRouter());
  app.use("/api/v1/discovery", discoveryRouter());
  app.use("/api/v1/conversations", chatRouter());
  app.use("/api/v1/notifications", notificationsRouter());
  app.use("/api/v1/social", socialRouter());
  app.use("/api/v1/games", playRouter());
  app.use("/api/v1/plan-groups", planGroupsRouter());
  app.use("/api/v1/activities", activitiesRouter());
  const onboarding = onboardingRouter();
  app.use("/api/v1", (req, res, next) => {
    if (
      /^\/(onboarding(?:\/|$)|profile\/(completion|eligibility|dating-preferences|activate-discovery|optional|photos)(?:\/|$)|auth\/contact(?:\/|$))/.test(
        req.path,
      )
    )
      onboarding(req, res, next);
    else next();
  });
  app.post("/api/v1/auth/register", authLimit, async (req, res) => {
    const body = registration.parse(req.body);
    if (!config.JWT_SECRET)
      throw fail(503, "Authentication is not configured.");
    const user = await User.create({
      email: body.email,
      passwordHash: await bcrypt.hash(body.password, 12),
      name: body.name,
      birthDate: body.birthDate,
    });
    await Profile.create({ user: user._id });
    res.status(201).json({
      data: {
        ...(await tokens(String(user._id))),
        user: { id: user._id, name: user.name, emailVerified: false },
      },
    });
  });
  app.post("/api/v1/auth/login", authLimit, async (req, res) => {
    const body = credentials.parse(req.body);
    const user = await User.findOne({
      email: body.email,
      status: "active",
      adminRole: null,
    }).select("+passwordHash");
    const fallback =
      "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxbzIhq75YQds5lzR2yVw0qcD1m";
    const ok = await bcrypt.compare(
      body.password,
      user?.passwordHash ?? fallback,
    );
    if (!user || !ok) throw fail(401, "Email or password is incorrect.");
    res.json({
      data: {
        ...(await tokens(String(user._id))),
        user: {
          id: user._id,
          name: user.name,
          emailVerified: user.emailVerified,
        },
      },
    });
  });
  app.post("/api/v1/auth/refresh", authLimit, async (req, res) => {
    const { refreshToken } = z
      .object({ refreshToken: z.string().min(40).max(200) })
      .parse(req.body);
    // Atomic consume prevents two concurrent refreshes reusing a token.
    const session = await RefreshSession.findOneAndDelete({
      tokenHash: digest(refreshToken),
      expiresAt: { $gt: new Date() },
    });
    if (
      !session ||
      !(await User.exists({ _id: session.user, status: "active" }))
    )
      throw fail(401, "Session expired.");
    res.json({ data: await tokens(String(session.user)) });
  });
  app.post("/api/v1/auth/logout", async (req, res) => {
    const { refreshToken } = z
      .object({ refreshToken: z.string().max(200) })
      .parse(req.body);
    await RefreshSession.deleteOne({ tokenHash: digest(refreshToken) });
    res.status(204).end();
  });
  app.get("/api/v1/categories", async (_req, res) =>
    res.json({
      data: await Category.find({ active: true })
        .select(
          "slug name icon description displayOrder cities riskLevel allowedTypes",
        )
        .sort({ displayOrder: 1, name: 1 })
        .lean(),
    }),
  );
  app.get("/api/v1/users/me", authenticate, async (req: AuthedRequest, res) => {
    const found = await User.findById(req.userId)
      .select(
        "name email emailVerified identityVerified status restrictions createdAt +birthDate",
      )
      .lean();
    const { birthDate, ...user } = found ?? {};
    const profile = await Profile.findOne({ user: req.userId }).lean();
    res.json({
      data: {
        user: found
          ? { ...user, age: birthDate ? ageOn(birthDate) : null }
          : null,
        profile,
        completion: await completion(req.userId!),
      },
    });
  });
  app.patch(
    "/api/v1/profiles/me",
    authenticate,
    async (req: AuthedRequest, res) => {
      res.json({
        data: await Profile.findOneAndUpdate(
          { user: req.userId },
          { $set: profileInput.parse(req.body) },
          { new: true, runValidators: true },
        ),
      });
    },
  );
  app.get(
    "/api/v1/activities",
    authenticate,
    requireReady,
    async (req: AuthedRequest, res) => {
      const query = z
        .object({
          category: z.string().max(50).optional(),
          cursor: z.string().optional(),
          q: z.string().max(100).optional(),
        })
        .parse(req.query);
      const scope = await activityScope(req.userId!);
      const filter: Record<string, unknown> = { ...scope.filter };
      if (query.category)
        filter.category = {
          $in: scope.categories
            .filter((c) => c.slug === query.category)
            .map((c) => c.slug),
        };
      if (query.cursor) filter._id = { $lt: validId(query.cursor) };
      if (query.q)
        filter.title = {
          $regex: query.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          $options: "i",
        };
      const data = await Activity.find(filter)
        .select("-approximateLocation -participants")
        .sort({ _id: -1 })
        .limit(21)
        .populate("creator", "name")
        .lean();
      const more = data.length > 20;
      if (more) data.pop();
      res.json({ data, nextCursor: more ? String(data.at(-1)!._id) : null });
    },
  );
  app.post(
    "/api/v1/activities",
    authenticate,
    requireReady,
    async (req: AuthedRequest, res) => {
      const user = await User.findById(req.userId);
      if (user?.restrictions?.posting)
        throw fail(403, "Posting is restricted. Contact support to appeal.");
      if (config.EMAIL_VERIFICATION_REQUIRED && !user?.emailVerified)
        throw fail(403, "Verify your email before publishing.");
      const input = activityInput.parse(req.body);
      const audience = await preparePlanAudience(input.audience, req.userId!);
      checkPlanDetails(input.category, input.categoryDetails);
      if (input.endsAt && new Date(input.endsAt) <= new Date(input.startsAt))
        throw fail(400, "End time must be after the start time.");
      const category = await Category.findOne({
        slug: input.category,
        active: true,
      });
      if (!category) throw fail(400, "Choose an enabled category.");
      if (!category.allowedTypes.includes(input.type))
        throw fail(
          400,
          "This post type is not enabled for the selected category.",
        );
      if (category.cities.length) {
        const profile = await Profile.findOne({ user: req.userId }).select(
          "city",
        );
        if (!profile?.city || !category.cities.includes(profile.city))
          throw fail(
            400,
            "This category is not available in your profile city.",
          );
      }
      res.status(201).json({
        data: await Activity.create({
          ...input,
          ...audience,
          creator: req.userId,
          status: category.moderationRequired ? "paused" : "active",
        }),
      });
    },
  );
  app.patch(
    "/api/v1/activities/:id",
    authenticate,
    requireReady,
    async (req: AuthedRequest, res) => {
      const input = activityInput
        .partial()
        .extend({ status: z.enum(["active", "paused"]).optional() })
        .parse(req.body);
      const owner = await User.findById(req.userId);
      if (owner?.restrictions?.posting)
        throw fail(403, "Posting is restricted. Contact support to appeal.");
      const existing = await Activity.findOne({
        _id: validId(req.params.id),
        creator: req.userId,
        status: { $ne: "deleted" },
      });
      if (!existing) throw fail(404, "Plan not found.");
      const audience = await preparePlanAudience(input.audience, req.userId!);
      if (existing.visibility === "private")
        throw fail(
          409,
          "This private plan was agreed together. Send a new private invitation to propose different details.",
        );
      if (input.status === "active" && existing.status !== "active")
        throw fail(
          409,
          "This plan needs moderation approval before it can go live.",
        );
      if (
        input.categoryDetails !== undefined ||
        (input.category && input.category !== existing.category)
      )
        checkPlanDetails(
          input.category ?? existing.category,
          input.categoryDetails ?? existing.categoryDetails,
        );
      const endsAt =
        input.endsAt !== undefined ? input.endsAt : existing.endsAt;
      if (
        endsAt &&
        new Date(endsAt) <= new Date(input.startsAt ?? existing.startsAt)
      )
        throw fail(400, "End time must be after the start time.");
      if (input.capacity && input.capacity < existing.participants.length)
        throw fail(
          400,
          "Capacity cannot be below the number of accepted participants.",
        );
      if (
        input.activityType === "one_on_one" &&
        existing.participants.length > 1
      )
        throw fail(
          400,
          "A plan with multiple accepted participants must remain a group plan.",
        );
      const category = await Category.findOne({
        slug: input.category ?? existing.category,
        active: true,
      });
      if (
        !category ||
        !category.allowedTypes.includes(input.type ?? existing.type)
      )
        throw fail(400, "Choose an enabled category and post type.");
      if (category.moderationRequired) input.status = "paused";
      if (
        input.category &&
        !(await Category.exists({ slug: input.category, active: true }))
      )
        throw fail(400, "Choose an enabled category.");
      const data = await Activity.findOneAndUpdate(
        {
          _id: validId(req.params.id),
          creator: req.userId,
          status: { $ne: "deleted" },
        },
        {
          $set: {
            ...input,
            ...audience,
            // Extending an expired or closed plan to a new date reopens it.
            ...(input.startsAt &&
            (existing.ownerState === "expired" ||
              existing.ownerState === "closed")
              ? { ownerState: "live" }
              : {}),
          },
        },
        { new: true, runValidators: true },
      );
      if (!data) throw fail(404, "Plan not found.");
      res.json({ data });
    },
  );
  app.delete(
    "/api/v1/activities/:id",
    authenticate,
    async (req: AuthedRequest, res) => {
      const data = await Activity.findOneAndUpdate(
        { _id: validId(req.params.id), creator: req.userId },
        { status: "deleted" },
      );
      if (!data) throw fail(404, "Plan not found.");
      res.status(204).end();
    },
  );
  app.post("/api/v1/blocks", authenticate, async (req: AuthedRequest, res) => {
    const { userId } = z.object({ userId: z.string() }).parse(req.body);
    validId(userId);
    if (userId === req.userId)
      throw fail(400, "Cannot block your own account.");
    await Block.updateOne(
      { user: req.userId, target: userId },
      { $setOnInsert: { user: req.userId, target: userId } },
      { upsert: true },
    );
    await Match.updateOne(
      { pairKey: pairKey(req.userId!, userId) },
      { $set: { active: false } },
    );
    res.status(204).end();
  });
  app.post("/api/v1/reports", authenticate, async (req: AuthedRequest, res) => {
    const body = z
      .object({
        userId: z.string(),
        reason: z.string().trim().min(10).max(1500),
        activityId: z.string().optional(),
      })
      .parse(req.body);
    await Report.create({
      reporter: req.userId,
      target: validId(body.userId),
      reason: body.reason,
      ...(body.activityId ? { activity: validId(body.activityId) } : {}),
    });
    res.status(201).json({ data: { received: true } });
  });
  app.use((_req, res) =>
    res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "Endpoint not found." } }),
  );
  const errors: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof MulterError) {
      res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        error: {
          code: "INVALID_PHOTO",
          message:
            err.code === "LIMIT_FILE_SIZE"
              ? "Choose a photo up to 5 MB."
              : "Send one photo at a time using the photo field.",
        },
      });
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Check the submitted fields.",
          issues: err.issues,
        },
      });
      return;
    }
    if (err.code === 11000) {
      res.status(409).json({
        error: { code: "CONFLICT", message: "This record already exists." },
      });
      return;
    }
    const status = err.status ?? 500;
    if (status === 500) console.error("API request failed:", err.name);
    res.status(status).json({
      error: {
        code: status === 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED",
        message:
          status === 500 ? "Something went wrong. Try again." : err.message,
      },
    });
  };
  app.use(errors);
  return app;
}
