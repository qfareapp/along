import crypto from "node:crypto";
import type { Session as AdminSessionDto } from "../../../../packages/shared-types/admin.js";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import mongoose, { type ClientSession } from "mongoose";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { completion, onboardingAnalytics } from "../onboarding.js";
import {
  User,
  Profile,
  Activity,
  Category,
  Report,
  Match,
  Conversation,
  RefreshSession,
} from "../models.js";
import { digest } from "../auth.js";
import {
  AdminRole,
  AdminSession,
  AuditLog,
  Verification,
  PlatformSetting,
  SupportTicket,
  CMSContent,
} from "./models.js";
import {
  adminAuth,
  adminCookie,
  audit,
  cookieOptions,
  decryptSecret,
  fail,
  permit,
  requireOrigin,
  totpFor,
  environmentCredentialVersion,
  type AdminRequest,
} from "./security.js";
import { strongPassword } from "./provision.js";
import { socialAdminRouter } from "./social.js";
import { config } from "../config.js";
import {
  ensureEnvironmentAdmin,
  matchesEnvironmentCredentials,
} from "./environment.js";

const id = (value: unknown) => {
  if (typeof value !== "string" || !mongoose.isObjectIdOrHexString(value))
    throw fail(400, "Invalid resource ID.");
  return value;
};
const reasonInput = z
  .string()
  .trim()
  .min(10, "Provide an actionable reason of at least 10 characters.")
  .max(1500);
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pagination = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).default(""),
});
const userFields =
  "name email status emailVerified identityVerified restrictions adminRole createdAt lastActiveAt";
async function atomic<T>(
  req: AdminRequest,
  action: string,
  entity: string,
  target: string,
  reason: string,
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    return (await session.withTransaction(async () => {
      const result = await work(session);
      await AuditLog.create(
        [
          {
            admin: req.admin!.id,
            action,
            targetType: entity,
            targetId: target,
            reason,
            requestId: req.requestId,
            outcome: "success",
          },
        ],
        { session },
      );
      return result;
    })) as T;
  } finally {
    await session.endSession();
  }
}
export function adminRouter() {
  const router = Router();
  router.use((req: AdminRequest, res, next) => {
    req.requestId = crypto.randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get("/auth/config", (_req, res) =>
    res.json({
      data: {
        mode: config.ADMIN_AUTH_MODE,
        mfaRequired: config.ADMIN_AUTH_MODE === "mfa",
      },
    }),
  );
  router.post(
    "/auth/login",
    requireOrigin,
    rateLimit({ windowMs: 15 * 60000, limit: 20 }),
    async (req: AdminRequest, res) => {
      const body = z
        .object({
          email: z
            .email()
            .max(254)
            .transform((v) => v.toLowerCase()),
          password: z.string().min(1).max(72),
          code: z.string().trim().min(6).max(48).optional(),
        })
        .parse(req.body);
      const environmentMode = config.ADMIN_AUTH_MODE === "env";
      let user = await User.findOne({
        email: environmentMode ? config.ADMIN_EMAIL : body.email,
        adminRole: { $ne: null },
      }).select(
        "+passwordHash +mfaSecretEncrypted +recoveryHashes +failedAdminLogins +adminLockedUntil +mfaLastStep",
      );
      const fallback =
        "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxbzIhq75YQds5lzR2yVw0qcD1m";
      const passwordOk = environmentMode
        ? matchesEnvironmentCredentials(body.email, body.password)
        : await bcrypt.compare(body.password, user?.passwordHash ?? fallback);
      if (environmentMode && passwordOk && !user)
        user = await ensureEnvironmentAdmin();
      const allowed =
        user?.status === "active" &&
        (!user.adminLockedUntil || user.adminLockedUntil < new Date());
      let mfaOk = environmentMode && passwordOk;
      if (
        !environmentMode &&
        user &&
        passwordOk &&
        allowed &&
        user.mfaSecretEncrypted &&
        body.code
      ) {
        if (/^\d{6}$/.test(body.code)) {
          const delta = totpFor(
            decryptSecret(user.mfaSecretEncrypted),
          ).validate({ token: body.code, window: 1 });
          const step = Math.floor(Date.now() / 30000) + (delta ?? 0);
          if (delta !== null)
            mfaOk = !!(await User.findOneAndUpdate(
              {
                _id: user._id,
                $or: [
                  { mfaLastStep: { $lt: step } },
                  { mfaLastStep: { $exists: false } },
                ],
              },
              { mfaLastStep: step },
            ));
        } else
          mfaOk = !!(await User.findOneAndUpdate(
            { _id: user._id, recoveryHashes: digest(body.code) },
            { $pull: { recoveryHashes: digest(body.code) } },
          ));
      }
      if (!user || !passwordOk || !allowed || !mfaOk) {
        if (user) {
          const updated = await User.findOneAndUpdate(
            { _id: user._id },
            { $inc: { failedAdminLogins: 1 } },
            { new: true },
          ).select("+failedAdminLogins");
          if (updated && updated.failedAdminLogins >= 5)
            await User.updateOne(
              { _id: user._id },
              { adminLockedUntil: new Date(Date.now() + 15 * 60000) },
            );
        }
        await AuditLog.create({
          admin: user?._id,
          action: "admin.login",
          targetType: "AdminSession",
          outcome: "denied",
          requestId: req.requestId,
        });
        throw fail(
          401,
          environmentMode
            ? "Invalid email or password, or account temporarily locked."
            : "Invalid credentials or authenticator code, or account temporarily locked.",
        );
      }
      if (!(await AdminRole.exists({ slug: user.adminRole })))
        throw fail(403, "Administrative role is unavailable.");
      const token = crypto.randomBytes(48).toString("base64url");
      const csrf = crypto.randomBytes(32).toString("hex");
      await AdminSession.create({
        user: user._id,
        authMode: config.ADMIN_AUTH_MODE,
        ...(environmentMode
          ? { credentialVersion: environmentCredentialVersion() }
          : {}),
        tokenHash: digest(token),
        csrf,
        expiresAt: new Date(Date.now() + 8 * 3600000),
        lastSeenAt: new Date(),
      });
      await User.updateOne(
        { _id: user._id },
        { failedAdminLogins: 0, $unset: { adminLockedUntil: 1 } },
      );
      await AuditLog.create({
        admin: user._id,
        action: "admin.login",
        targetType: "AdminSession",
        outcome: "success",
        requestId: req.requestId,
      });
      res.cookie(adminCookie, token, cookieOptions()).json({ data: { csrf } });
    },
  );
  router.post(
    "/auth/recover",
    requireOrigin,
    rateLimit({ windowMs: 15 * 60000, limit: 5 }),
    async (req: AdminRequest, res) => {
      if (config.ADMIN_AUTH_MODE === "env")
        throw fail(
          409,
          "Environment login is enabled. Update ADMIN_PASSWORD in the backend environment file and restart the API.",
        );
      const body = z
        .object({
          email: z.email().transform((v) => v.toLowerCase()),
          recoveryCode: z.string().regex(/^[a-f0-9]{24}$/),
          password: strongPassword,
        })
        .parse(req.body);
      const session = await mongoose.startSession();
      try {
        const passwordHash = await bcrypt.hash(body.password, 12);
        await session.withTransaction(async () => {
          const user = await User.findOneAndUpdate(
            {
              email: body.email,
              status: "active",
              adminRole: { $ne: null },
              recoveryHashes: digest(body.recoveryCode),
            },
            {
              $set: { passwordHash, failedAdminLogins: 0 },
              $unset: { adminLockedUntil: 1 },
              $pull: { recoveryHashes: digest(body.recoveryCode) },
              $inc: { sessionVersion: 1 },
            },
            { session, new: true },
          );
          if (!user)
            throw fail(
              401,
              "The recovery details are invalid or have already been used.",
            );
          await AdminSession.updateMany(
            { user: user._id },
            { revokedAt: new Date() },
            { session },
          );
          await RefreshSession.deleteMany({ user: user._id }, { session });
          await AuditLog.create(
            [
              {
                admin: user._id,
                action: "admin.password_recovered",
                targetType: "User",
                targetId: String(user._id),
                requestId: req.requestId,
                reason: "One-time offline recovery code consumed",
              },
            ],
            { session },
          );
        });
      } finally {
        await session.endSession();
      }
      res
        .clearCookie(adminCookie, { ...cookieOptions(), maxAge: undefined })
        .status(204)
        .end();
    },
  );
  router.use(adminAuth);
  router.use("/social", socialAdminRouter());
  router.get("/auth/me", (req: AdminRequest, res) =>
    res.json({
      data: {
        ...req.admin!,
        csrf: req.session!.csrf,
      } satisfies AdminSessionDto,
    }),
  );
  router.post("/auth/logout", async (req: AdminRequest, res) => {
    await AdminSession.updateOne(
      { _id: req.session!.id },
      { revokedAt: new Date() },
    );
    await audit(req, "admin.logout", "AdminSession", req.session!.id);
    res
      .clearCookie(adminCookie, { ...cookieOptions(), maxAge: undefined })
      .status(204)
      .end();
  });
  router.post("/auth/revoke-sessions", async (req: AdminRequest, res) => {
    await AdminSession.updateMany(
      { user: req.admin!.id, revokedAt: null },
      { revokedAt: new Date() },
    );
    await audit(req, "admin.sessions_revoked", "User", req.admin!.id);
    res
      .clearCookie(adminCookie, { ...cookieOptions(), maxAge: undefined })
      .status(204)
      .end();
  });
  router.get(
    "/onboarding/analytics",
    permit("dashboard.read"),
    async (_req, res) => res.json({ data: await onboardingAnalytics() }),
  );
  router.get("/dashboard", permit("dashboard.read"), async (req, res) => {
    const query = z
      .object({
        days: z.coerce.number().int().min(1).max(366).default(30),
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
        city: z.string().max(100).optional(),
        category: z.string().max(50).optional(),
      })
      .parse(req.query);
    const now = new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(Date.now() - query.days * 86400000);
    const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : now;
    if (to < from || to.getTime() - from.getTime() > 366 * 86400000)
      throw fail(400, "Choose a date range of up to 366 days.");
    const window = { $gte: from, $lte: to };
    const scopedUsers = query.city
      ? await Profile.find({ city: query.city }).distinct("user")
      : undefined;
    const users: Record<string, unknown> = {
      adminRole: null,
      ...(scopedUsers ? { _id: { $in: scopedUsers } } : {}),
    };
    const activities: Record<string, unknown> = {
      ...(scopedUsers ? { creator: { $in: scopedUsers } } : {}),
      ...(query.category ? { category: query.category } : {}),
    };
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    const [
      totalUsers,
      newUsers,
      todayUsers,
      dailyActive,
      monthlyActive,
      verified,
      suspended,
      activePlans,
      matches,
      conversations,
      pendingReports,
      pendingVerifications,
      growth,
      distribution,
      geography,
      severity,
      recent,
    ] = await Promise.all([
      User.countDocuments(users),
      User.countDocuments({ ...users, createdAt: window }),
      User.countDocuments({ ...users, createdAt: { $gte: today } }),
      User.countDocuments({
        ...users,
        lastActiveAt: { $gte: new Date(Date.now() - 86400000) },
      }),
      User.countDocuments({
        ...users,
        lastActiveAt: { $gte: new Date(Date.now() - 30 * 86400000) },
      }),
      User.countDocuments({ ...users, identityVerified: true }),
      User.countDocuments({
        ...users,
        status: { $in: ["suspended", "banned"] },
      }),
      Activity.countDocuments({ ...activities, status: "active" }),
      Match.countDocuments({ active: true }),
      Conversation.countDocuments(),
      Report.countDocuments({
        status: { $in: ["pending", "new", "under_review", "escalated"] },
      }),
      Verification.countDocuments({ status: { $in: ["pending", "appealed"] } }),
      User.aggregate([
        { $match: { ...users, createdAt: window } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Activity.aggregate([
        { $match: { ...activities, createdAt: window } },
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Profile.aggregate([
        { $match: { city: query.city ?? { $type: "string" } } },
        { $group: { _id: "$city", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      Report.aggregate([
        { $match: { createdAt: window } },
        {
          $group: {
            _id: { $ifNull: ["$severity", "unclassified"] },
            count: { $sum: 1 },
          },
        },
      ]),
      AuditLog.find()
        .sort({ _id: -1 })
        .limit(7)
        .select("action targetType createdAt outcome")
        .lean(),
    ]);
    res.json({
      data: {
        scope: {
          from,
          to,
          city: query.city ?? "All cities",
          category: query.category ?? "All categories",
        },
        metrics: {
          totalUsers,
          newUsers,
          todayUsers,
          dailyActive,
          monthlyActive,
          verified,
          suspended,
          activePlans,
          matches,
          conversations,
          pendingReports,
          pendingVerifications,
          confirmedMeetings: null,
          premiumSubscribers: null,
          monthlyRevenue: null,
          cancellations: null,
        },
        growth: growth.map((v) => ({ date: v._id, users: v.count })),
        categories: distribution.map((v) => ({ name: v._id, count: v.count })),
        geography,
        severity,
        recent,
        notes: {
          activity:
            "Active user counts reflect recorded authenticated requests. Matching, report and verification totals are platform-wide.",
          billing: "Billing and confirmed meeting tracking are not enabled.",
        },
      },
    });
  });
  router.get("/users", permit("users.read"), async (req, res) => {
    const query = pagination
      .extend({
        status: z.enum(["active", "suspended", "banned", "deleted"]).optional(),
        verified: z.enum(["true", "false"]).optional(),
        city: z.string().max(100).optional(),
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
      })
      .parse(req.query);
    const filter: Record<string, unknown> = { adminRole: null };
    if (query.q)
      filter.$or = [
        { name: { $regex: escaped(query.q), $options: "i" } },
        { email: { $regex: escaped(query.q), $options: "i" } },
        ...(mongoose.isObjectIdOrHexString(query.q)
          ? [{ _id: new mongoose.Types.ObjectId(query.q) }]
          : []),
      ];
    if (query.status) filter.status = query.status;
    if (query.verified) filter.identityVerified = query.verified === "true";
    if (query.city)
      filter._id = {
        $in: await Profile.find({ city: query.city }).distinct("user"),
      };
    if (query.from || query.to)
      filter.createdAt = {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(`${query.to}T23:59:59Z`) } : {}),
      };
    const [data, total] = await Promise.all([
      User.find(filter)
        .select(userFields)
        .sort({ _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      User.countDocuments(filter),
    ]);
    const profiles = await Profile.find({
      user: { $in: data.map((v) => v._id) },
    })
      .select("user city area onboardingComplete")
      .lean();
    const byId = new Map(profiles.map((p) => [String(p.user), p]));
    res.json({
      data: {
        items: data.map((v) => ({
          ...v,
          profile: byId.get(String(v._id)) ?? null,
        })),
        total,
        page: query.page,
        limit: query.limit,
      },
    });
  });
  router.get(
    "/users/:id",
    permit("users.read"),
    async (req: AdminRequest, res) => {
      const userId = id(req.params.id);
      const user = await User.findOne({ _id: userId, adminRole: null })
        .select(userFields)
        .lean();
      if (!user) throw fail(404, "User not found.");
      const [profile, activities, matches, history] = await Promise.all([
        Profile.findOne({ user: userId })
          .select(
            "bio occupation city area interests photos onboardingComplete",
          )
          .lean(),
        Activity.find({ creator: userId, status: "active" })
          .select("title category zone status")
          .limit(20)
          .lean(),
        Match.countDocuments({ users: userId }),
        AuditLog.find({ targetId: userId })
          .sort({ _id: -1 })
          .limit(20)
          .select("action reason createdAt outcome")
          .lean(),
      ]);
      await audit(req, "user.viewed", "User", userId);
      const progress = await completion(userId);
      res.json({
        data: {
          user,
          profile,
          activities,
          matchCount: matches,
          history,
          onboarding: {
            state: progress.state,
            checks: progress.checks,
            eligible: progress.eligible,
            currentStep: progress.profile?.onboarding?.currentStep ?? 1,
            quickStartCompleted:
              progress.profile?.onboarding?.quickStartCompleted ?? false,
          },
        },
      });
    },
  );
  router.post("/users/:id/action", async (req: AdminRequest, res) => {
    const body = z
      .object({
        action: z.enum([
          "suspend",
          "reactivate",
          "ban",
          "restrict_posting",
          "restore_posting",
          "restrict_messaging",
          "restore_messaging",
        ]),
        reason: reasonInput,
      })
      .parse(req.body);
    const current = await User.findById(id(req.params.id)).select("status");
    const permission =
      body.action === "ban" ||
      (body.action === "reactivate" && current?.status === "banned")
        ? "users.ban"
        : "users.suspend";
    if (!req.admin!.permissions.includes(permission)) {
      await audit(
        req,
        "access.denied",
        "permission",
        permission,
        undefined,
        undefined,
        "denied",
      );
      throw fail(403, "Your role does not permit this action.");
    }
    const userId = id(req.params.id);
    const data = await atomic(
      req,
      `user.${body.action}`,
      "User",
      userId,
      body.reason,
      async (session) => {
        const status =
          body.action === "suspend"
            ? "suspended"
            : body.action === "ban"
              ? "banned"
              : body.action === "reactivate"
                ? "active"
                : undefined;
        const update = status
          ? { status }
          : {
              [`restrictions.${body.action.includes("posting") ? "posting" : "messaging"}`]:
                body.action.startsWith("restrict"),
            };
        const user = await User.findOneAndUpdate(
          {
            _id: userId,
            adminRole: null,
            status: {
              $nin:
                body.action === "reactivate" &&
                !req.admin!.permissions.includes("users.ban")
                  ? ["deleted", "banned"]
                  : ["deleted"],
            },
          },
          { $set: update, $inc: { sessionVersion: 1 } },
          { new: true, session },
        )
          .select(userFields)
          .lean();
        if (!user) throw fail(404, "User not found.");
        await RefreshSession.deleteMany({ user: userId }, { session });
        return user;
      },
    );
    res.json({ data });
  });
  router.get(
    "/users-export",
    permit("users.export"),
    async (req: AdminRequest, res) => {
      const users = await User.find({ adminRole: null })
        .select("status identityVerified createdAt")
        .sort({ _id: -1 })
        .limit(10000)
        .lean();
      await audit(
        req,
        "users.exported",
        "User",
        "aggregate-report",
        "Limited non-identifying user report",
        { count: users.length },
      );
      res.json({
        data: {
          headers: [
            "account_status",
            "identity_verified",
            "registration_month",
          ],
          rows: users.map((u) => [
            u.status,
            u.identityVerified,
            u.createdAt.toISOString().slice(0, 7),
          ]),
        },
      });
    },
  );
  router.get(
    "/verifications",
    permit("verification.review"),
    async (req, res) => {
      const { page, limit } = pagination.parse(req.query);
      const [items, total] = await Promise.all([
        Verification.find()
          .populate("user", "name email identityVerified")
          .sort({ _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Verification.countDocuments(),
      ]);
      res.json({ data: { items, total, page, limit } });
    },
  );
  router.post(
    "/verifications/:id/review",
    permit("verification.review"),
    async (req: AdminRequest, res) => {
      const body = z
        .object({
          status: z.enum(["approved", "rejected", "more_info"]),
          reason: reasonInput,
        })
        .parse(req.body);
      const target = id(req.params.id);
      const data = await atomic(
        req,
        `verification.${body.status}`,
        "Verification",
        target,
        body.reason,
        async (session) => {
          const verification = await Verification.findOneAndUpdate(
            {
              _id: target,
              status: { $in: ["pending", "appealed", "more_info"] },
            },
            {
              status: body.status,
              reason: body.reason,
              reviewedBy: req.admin!.id,
            },
            { session, new: true },
          );
          if (!verification)
            throw fail(409, "This verification is no longer awaiting review.");
          if (verification.type === "identity")
            await User.updateOne(
              { _id: verification.user },
              { identityVerified: body.status === "approved" },
              { session },
            );
          return verification;
        },
      );
      res.json({ data });
    },
  );
  router.get("/activities", permit("activities.moderate"), async (req, res) => {
    const query = pagination
      .extend({
        category: z.string().max(50).optional(),
        status: z.enum(["active", "paused", "deleted"]).optional(),
        type: z.enum(["need", "offer", "together"]).optional(),
      })
      .parse(req.query);
    const filter = {
      ...(query.q
        ? { title: { $regex: escaped(query.q), $options: "i" } }
        : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
    };
    const [items, total] = await Promise.all([
      Activity.find(filter)
        .select("-approximateLocation")
        .populate("creator", "name status")
        .sort({ _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Activity.countDocuments(filter),
    ]);
    res.json({ data: { items, total, page: query.page, limit: query.limit } });
  });
  router.post(
    "/activities/:id/action",
    permit("activities.moderate"),
    async (req: AdminRequest, res) => {
      const body = z
        .object({
          status: z.enum(["active", "paused", "deleted"]),
          reason: reasonInput,
        })
        .parse(req.body);
      const target = id(req.params.id);
      const data = await atomic(
        req,
        `activity.${body.status}`,
        "ActivityPost",
        target,
        body.reason,
        async (session) => {
          const doc = await Activity.findByIdAndUpdate(
            target,
            { status: body.status },
            { new: true, session },
          );
          if (!doc) throw fail(404, "Activity not found.");
          return doc;
        },
      );
      res.json({ data });
    },
  );
  router.get("/categories", permit("categories.manage"), async (_req, res) => {
    const { liveActivityFilter } = await import("../activities.js");
    const { discoveryUserIds } = await import("../onboarding.js");
    const counts = await Activity.aggregate([
      {
        $match: {
          ...liveActivityFilter(),
          creator: { $in: await discoveryUserIds() },
        },
      },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]);
    const bySlug = new Map(counts.map((c) => [c._id, c.count]));
    res.json({
      data: (
        await Category.find().sort({ displayOrder: 1, name: 1 }).lean()
      ).map((c) => ({
        ...c,
        liveCount: c.active ? (bySlug.get(c.slug) ?? 0) : 0,
      })),
    });
  });
  const categoryInput = z.object({
    name: z.string().trim().min(2).max(80),
    slug: z.string().regex(/^[a-z][a-z0-9-]{1,49}$/),
    description: z.string().max(500).default(""),
    coverAssetKey: z
      .enum([
        "coffee",
        "commute",
        "travel",
        "food",
        "shopping",
        "fitness",
        "movies",
        "hobbies",
        "sports",
        "learning",
        "events",
        "culture",
        "volunteering",
      ])
      .optional(),
    coverImageUrl: z
      .union([
        z.literal(""),
        z
          .url()
          .max(2000)
          .refine((v) => v.startsWith("https://"), "Use an HTTPS image URL."),
      ])
      .optional(),
    icon: z.string().max(60).default("sparkles-outline"),
    active: z.boolean(),
    displayOrder: z.number().int().min(0).max(1000).default(0),
    cities: z.array(z.string().max(100)).max(50).default([]),
    riskLevel: z.enum(["low", "medium", "high"]).default("low"),
    allowedTypes: z
      .array(z.enum(["need", "offer", "together"]))
      .min(1)
      .default(["need", "offer", "together"]),
    moderationRequired: z.boolean().default(false),
    reason: reasonInput,
  });
  router.post(
    "/categories",
    permit("categories.manage"),
    async (req: AdminRequest, res) => {
      const { reason, ...body } = categoryInput.parse(req.body);
      if (/room|accommodat/i.test(body.slug) && body.active)
        throw fail(400, "Accommodation is not enabled in the MVP.");
      const data = await atomic(
        req,
        "category.created",
        "Category",
        body.slug,
        reason,
        async (session) => (await Category.create([body], { session }))[0],
      );
      res.status(201).json({ data });
    },
  );
  router.patch(
    "/categories/:id",
    permit("categories.manage"),
    async (req: AdminRequest, res) => {
      const { reason, ...parsed } = categoryInput
        .omit({ slug: true })
        .partial()
        .extend({ reason: reasonInput })
        .parse(req.body);
      // Partial updates must never reset omitted fields to creation defaults.
      const body = Object.fromEntries(
        Object.entries(parsed).filter(([key]) =>
          Object.prototype.hasOwnProperty.call(req.body, key),
        ),
      );
      const target = id(req.params.id);
      const data = await atomic(
        req,
        "category.updated",
        "Category",
        target,
        reason,
        async (session) => {
          const original = await Category.findById(target).session(session);
          if (!original) throw fail(404, "Category not found.");
          if (/room|accommodat/i.test(original.slug) && body.active)
            throw fail(400, "Accommodation is not enabled in the MVP.");
          return Category.findByIdAndUpdate(
            target,
            { $set: body },
            { new: true, session, runValidators: true },
          );
        },
      );
      res.json({ data });
    },
  );
  router.get("/reports", permit("reports.review"), async (req, res) => {
    const { page, limit } = pagination.parse(req.query);
    const [items, total] = await Promise.all([
      Report.find()
        .populate("reporter target", "name status")
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Report.countDocuments(),
    ]);
    res.json({ data: { items, total, page, limit } });
  });
  router.post(
    "/reports/:id/review",
    permit("reports.review"),
    async (req: AdminRequest, res) => {
      const body = z
        .object({
          status: z.enum([
            "under_review",
            "escalated",
            "action_taken",
            "resolved",
            "dismissed",
          ]),
          severity: z.enum(["low", "medium", "high", "critical"]),
          reason: reasonInput,
        })
        .parse(req.body);
      const target = id(req.params.id);
      const data = await atomic(
        req,
        `report.${body.status}`,
        "Report",
        target,
        body.reason,
        async (session) => {
          const report = await Report.findByIdAndUpdate(
            target,
            {
              status: body.status,
              severity: body.severity,
              $push: {
                notes: { text: body.reason, by: req.admin!.id, at: new Date() },
              },
              assignedTo: req.admin!.id,
            },
            { new: true, session },
          );
          if (!report) throw fail(404, "Report not found.");
          return report;
        },
      );
      res.json({ data });
    },
  );
  const matchingInput = z
    .object({
      romantic: z.number().min(0).max(100),
      activity: z.number().min(0).max(100),
      location: z.number().min(0).max(100),
      lifestyle: z.number().min(0).max(100),
      radiusKm: z.number().min(1).max(100),
      minScore: z.number().min(0).max(100),
      frequencyHours: z.number().int().min(1).max(168),
      expiresDays: z.number().int().min(1).max(90),
    })
    .refine(
      (v) => v.romantic + v.activity + v.location + v.lifestyle === 100,
      "Compatibility weights must total 100%.",
    );
  router.get("/matching", permit("matching.configure"), async (_req, res) =>
    res.json({
      data: (await PlatformSetting.findOne({ key: "matching" }).lean()) ?? {
        key: "matching",
        version: 0,
        value: {
          romantic: 35,
          activity: 30,
          location: 20,
          lifestyle: 15,
          radiusKm: 25,
          minScore: 40,
          frequencyHours: 24,
          expiresDays: 14,
        },
        history: [],
      },
    }),
  );
  router.put(
    "/matching",
    permit("matching.configure"),
    async (req: AdminRequest, res) => {
      const body = z
        .object({
          version: z.number().int().min(0),
          value: matchingInput,
          reason: reasonInput,
        })
        .parse(req.body);
      const data = await atomic(
        req,
        "matching.configured",
        "PlatformSetting",
        "matching",
        body.reason,
        async (session) => {
          let doc = await PlatformSetting.findOne({ key: "matching" }).session(
            session,
          );
          if ((doc?.version ?? 0) !== body.version)
            throw fail(409, "Configuration changed. Reload before saving.");
          if (!doc)
            doc = new PlatformSetting({
              key: "matching",
              version: 0,
              value: body.value,
              history: [],
            });
          if (doc.version > 0)
            doc.history.push({
              version: doc.version,
              value: doc.value,
              reason: body.reason,
              admin: new mongoose.Types.ObjectId(req.admin!.id),
              at: new Date(),
            });
          doc.value = body.value;
          doc.version++;
          await doc.save({ session });
          return doc;
        },
      );
      res.json({ data });
    },
  );
  router.get("/audit-logs", permit("audit.read"), async (req, res) => {
    const { page, limit, q } = pagination.parse(req.query);
    const filter = q ? { action: { $regex: escaped(q), $options: "i" } } : {};
    const [items, total] = await Promise.all([
      AuditLog.find(filter)
        .populate("admin", "name")
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ data: { items, total, page, limit } });
  });
  router.get("/roles", permit("admins.manage"), async (_req, res) =>
    res.json({
      data: {
        roles: await AdminRole.find().lean(),
        admins: await User.find({ adminRole: { $ne: null } })
          .select("name email adminRole status")
          .lean(),
      },
    }),
  );
  router.get("/system-health", permit("system.read"), async (_req, res) =>
    res.json({
      data: {
        database:
          mongoose.connection.readyState === 1 ? "connected" : "disconnected",
        uptimeSeconds: Math.floor(process.uptime()),
        now: new Date(),
        memoryMb: Math.round(process.memoryUsage().heapUsed / 1048576),
        socketService: "not implemented",
        billing: "disabled",
        emailDelivery: "not configured",
      },
    }),
  );
  return router;
}
