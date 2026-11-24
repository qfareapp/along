import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { authenticate, type AuthedRequest } from "./auth.js";
import { requireReady, fail, vibeCategories } from "./onboarding.js";
import { Activity, ActivityInterest, Profile, Report, User } from "./models.js";
import {
  Community,
  CommunityMembership,
  CommunityMessage,
  CommunityReaction,
  CommunityModerationAction,
  CommunityNotice,
} from "./community-models.js";
import {
  changeCommunityMembership,
  communityAccess,
  communityEvents,
  communityId,
  communityMessages,
  communitySummary,
  escapeSearch,
  hiddenCommunityUsers,
  sendCommunityMessage,
  communityPlanFilter,
} from "./community-service.js";
import { acceptActivityInterest, serializePlans } from "./activities.js";
import { removeCommunityParticipant } from "./community-plans.js";
import { announceCommunityPlan } from "./community-notifications.js";

export const communityMessageInput = z
  .object({
    text: z.string().trim().min(1).max(2000),
    clientId: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/),
    replyTo: z.string().optional(),
  })
  .strict();
const pageInput = z.object({
  q: z.string().trim().max(100).default(""),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export async function moderateCommunityMember(
  communityIdValue: string,
  target: string,
  actor: string,
  action: string,
  reason: string,
  platformAdmin = false,
) {
  await mongoose.connection.transaction(async (session) => {
    const community = await Community.findById(
      communityId(communityIdValue),
    ).session(session);
    if (!community) throw fail(404, "Community unavailable.");
    const access = platformAdmin
      ? null
      : await communityAccess(actor, communityIdValue, true, session);
    if (!platformAdmin && !access?.moderator)
      throw fail(403, "Community moderator permission required.");
    const member = await CommunityMembership.findOne({
      community: community._id,
      user: communityId(target),
    }).session(session);
    if (
      !member ||
      target === actor ||
      (!platformAdmin && member.role !== "member")
    )
      throw fail(403, "This member cannot be changed by you.");
    const wasActive = member.status === "active";
    if (action === "mute") member.mutedUntil = new Date(Date.now() + 86400000);
    else if (action === "unmute") member.mutedUntil = undefined;
    else if (action === "restore") {
      member.status = "left";
      member.role = "member";
    } else if (action === "moderator" || action === "member") {
      member.role = action;
    } else member.status = action === "ban" ? "banned" : "suspended";
    await member.save({ session });
    await Community.updateOne(
      { _id: community._id },
      {
        $inc: {
          revision: 1,
          memberCount:
            (member.status === "active" ? 1 : 0) - (wasActive ? 1 : 0),
        },
      },
      { session },
    );
    await CommunityModerationAction.create(
      [
        {
          community: community._id,
          moderator: actor,
          targetUser: target,
          action,
          reason,
        },
      ],
      { session },
    );
  });
  communityEvents.emit("changed", communityIdValue);
  communityEvents.emit("privacy-changed");
}
export function communitiesRouter() {
  const router = Router();
  router.use(authenticate, requireReady);
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  const write = rateLimit({
    windowMs: 60000,
    limit: 40,
    keyGenerator: (req) => (req as AuthedRequest).userId!,
    message: {
      error: { message: "Please wait a moment before trying again." },
    },
  });
  router.get("/", async (req: AuthedRequest, res) => {
    const p = pageInput
      .extend({ scope: z.enum(["all", "mine", "suggested"]).default("all") })
      .parse(req.query);
    const mine = await CommunityMembership.find({ user: req.userId }).lean();
    const restricted = mine
      .filter((m) => ["banned", "suspended"].includes(m.status))
      .map((m) => m.community);
    const filter: Record<string, unknown> = {
      status: "active",
      visibility: "public",
      _id: { $nin: restricted },
    };
    if (p.scope === "mine")
      filter._id = {
        $in: mine.filter((m) => m.status === "active").map((m) => m.community),
      };
    if (p.cursor)
      filter._id = { ...(filter._id as object), $gt: communityId(p.cursor) };
    if (p.q)
      filter.$or = [
        { name: new RegExp(escapeSearch(p.q), "i") },
        { description: new RegExp(escapeSearch(p.q), "i") },
      ];
    const rows = await Community.find(filter)
      .sort({ _id: 1 })
      .limit(p.limit + 1)
      .lean();
    const more = rows.length > p.limit;
    if (more) rows.pop();
    const counts = await Activity.aggregate([
      {
        $match: {
          community: { $in: rows.map((c) => c._id) },
          status: "active",
          ownerState: "live",
          startsAt: { $gt: new Date() },
        },
      },
      { $group: { _id: "$community", count: { $sum: 1 } } },
    ]);
    const profile =
      p.scope === "suggested"
        ? await Profile.findOne({ user: req.userId })
            .select("interests onboarding.vibes")
            .lean()
        : null;
    const interests = [
      ...(profile?.interests ?? []),
      ...(profile?.onboarding?.vibes ?? []),
    ]
      .join(" ")
      .toLowerCase();
    const items = rows.map((c) => {
      const m = mine.find((m) => String(m.community) === String(c._id));
      return {
        id: String(c._id),
        name: c.name,
        slug: c.slug,
        description: c.description,
        icon: c.icon,
        coverImage: c.coverImage,
        category: c.category,
        memberCount: c.memberCount,
        upcomingEvents:
          counts.find((a) => String(a._id) === String(c._id))?.count ?? 0,
        joined: m?.status === "active",
        muted: m?.muted ?? false,
        suggested: interests.includes(c.category),
      };
    });
    if (p.scope === "suggested")
      items.sort((a, b) => Number(b.suggested) - Number(a.suggested));
    res.json({ data: { items, next: more ? String(rows.at(-1)!._id) : null } });
  });
  router.get("/notices", async (req: AuthedRequest, res) => {
    const hidden = await hiddenCommunityUsers(req.userId!);
    const permitted = await CommunityMembership.find({
      user: req.userId,
      status: "active",
    }).distinct("community");
    const items = await CommunityNotice.find({
      recipient: req.userId,
      actor: { $nin: hidden },
      community: { $in: permitted },
    })
      .sort({ _id: -1 })
      .limit(30)
      .lean();
    res.json({
      data: items.map((n) => ({
        id: String(n._id),
        communityId: String(n.community),
        text: n.text,
        read: !!n.readAt,
        createdAt: n.createdAt,
      })),
    });
  });
  router.post("/notices/read", async (req: AuthedRequest, res) => {
    await CommunityNotice.updateMany(
      { recipient: req.userId, readAt: null },
      { readAt: new Date() },
    );
    res.json({ data: { ok: true } });
  });
  router.get("/:id", async (req: AuthedRequest, res) =>
    res.json({ data: await communitySummary(req.userId!, req.params.id) }),
  );
  for (const [path, joining] of [
    ["join", true],
    ["leave", false],
  ] as const)
    router.post(`/:id/${path}`, write, async (req: AuthedRequest, res) => {
      await changeCommunityMembership(req.userId!, req.params.id, joining);
      res.json({ data: await communitySummary(req.userId!, req.params.id) });
    });
  router.patch("/:id/preferences", write, async (req: AuthedRequest, res) => {
    const { member } = await communityAccess(req.userId!, req.params.id);
    const { muted } = z.object({ muted: z.boolean() }).strict().parse(req.body);
    await CommunityMembership.updateOne({ _id: member!._id }, { muted });
    res.json({ data: { muted } });
  });
  router.get("/:id/members", async (req: AuthedRequest, res) => {
    const { community } = await communityAccess(req.userId!, req.params.id);
    const p = pageInput.parse(req.query);
    const hidden = await hiddenCommunityUsers(req.userId!);
    const users = p.q
      ? await User.find({
          name: new RegExp(escapeSearch(p.q), "i"),
          status: "active",
        })
          .limit(200)
          .distinct("_id")
      : null;
    const rows = await CommunityMembership.find({
      community: community._id,
      status: "active",
      user: { $nin: hidden, ...(users ? { $in: users } : {}) },
      ...(p.cursor ? { _id: { $gt: communityId(p.cursor) } } : {}),
    })
      .sort({ _id: 1 })
      .limit(p.limit + 1)
      .lean();
    const more = rows.length > p.limit;
    if (more) rows.pop();
    const names = await User.find({
      _id: { $in: rows.map((m) => m.user) },
      status: "active",
      adminRole: null,
    })
      .select("name")
      .lean();
    const profiles = await Profile.find({
      user: { $in: names.map((u) => u._id) },
    })
      .select("user photos")
      .lean();
    res.json({
      data: {
        items: rows
          .filter((m) => names.some((u) => String(u._id) === String(m.user)))
          .map((m) => ({
            id: String(m.user),
            name: names.find((u) => String(u._id) === String(m.user))!.name,
            role: m.role,
            photoId:
              profiles.find((p) => String(p.user) === String(m.user))
                ?.photos?.[0] ?? null,
          })),
        next: more ? String(rows.at(-1)!._id) : null,
      },
    });
  });
  router.get("/:id/messages", async (req: AuthedRequest, res) => {
    const p = z
      .object({ before: z.coerce.number().int().positive().optional() })
      .parse(req.query);
    res.json({
      data: await communityMessages(req.userId!, req.params.id, p.before),
    });
  });
  router.post("/:id/messages", write, async (req: AuthedRequest, res) =>
    res.status(201).json({
      data: await sendCommunityMessage(
        req.userId!,
        req.params.id,
        communityMessageInput.parse(req.body),
      ),
    }),
  );
  router.post("/:id/read", async (req: AuthedRequest, res) => {
    const { community, member } = await communityAccess(
      req.userId!,
      req.params.id,
    );
    const { sequence } = z
      .object({ sequence: z.number().int().nonnegative() })
      .parse(req.body);
    await CommunityMembership.updateOne(
      { _id: member!._id },
      {
        $max: { lastReadSequence: Math.min(sequence, community.lastSequence) },
      },
    );
    res.json({ data: { ok: true } });
  });
  router.post(
    "/:id/messages/:messageId/react",
    write,
    async (req: AuthedRequest, res) => {
      const { community, member } = await communityAccess(
        req.userId!,
        req.params.id,
      );
      const { emoji } = z
        .object({ emoji: z.enum(["❤️", "👍", "😂", "🎉", "🔥"]).nullable() })
        .parse(req.body);
      const hidden = await hiddenCommunityUsers(req.userId!);
      const message = await CommunityMessage.findOne({
        _id: communityId(req.params.messageId),
        community: community._id,
        deletedAt: null,
        sender: { $nin: hidden },
        sequence: { $gt: member!.joinedAfter },
      });
      if (!message) throw fail(404, "Message unavailable.");
      if (emoji)
        await CommunityReaction.updateOne(
          { message: message._id, user: req.userId },
          { $set: { emoji } },
          { upsert: true },
        );
      else
        await CommunityReaction.deleteOne({
          message: message._id,
          user: req.userId,
        });
      communityEvents.emit("changed", String(community._id));
      res.json({ data: { ok: true } });
    },
  );
  router.delete(
    "/:id/messages/:messageId",
    write,
    async (req: AuthedRequest, res) => {
      await mongoose.connection.transaction(async (session) => {
        const { community, moderator } = await communityAccess(
          req.userId!,
          req.params.id,
          true,
          session,
        );
        const message = await CommunityMessage.findOne({
          _id: communityId(req.params.messageId),
          community: community._id,
        }).session(session);
        if (!message || (!moderator && String(message.sender) !== req.userId))
          throw fail(403, "You cannot remove this message.");
        message.text = "Message removed";
        message.deletedAt = new Date();
        message.pinnedAt = undefined;
        await message.save({ session });
        await CommunityReaction.deleteMany(
          { message: message._id },
          { session },
        );
        await Community.updateOne(
          { _id: community._id },
          { $inc: { revision: 1, contentRevision: 1 } },
          { session },
        );
        if (moderator && String(message.sender) !== req.userId)
          await CommunityModerationAction.create(
            [
              {
                community: community._id,
                moderator: req.userId,
                message: message._id,
                action: "delete_message",
                reason: "Removed for a community rules violation.",
              },
            ],
            { session },
          );
      });
      communityEvents.emit("changed", String(req.params.id));
      res.json({ data: { ok: true } });
    },
  );
  router.post(
    "/:id/messages/:messageId/pin",
    write,
    async (req: AuthedRequest, res) => {
      const { community, moderator } = await communityAccess(
        req.userId!,
        req.params.id,
      );
      if (!moderator) throw fail(403, "Moderator permission required.");
      const { pinned } = z.object({ pinned: z.boolean() }).parse(req.body);
      const message = await CommunityMessage.findOneAndUpdate(
        {
          _id: communityId(req.params.messageId),
          community: community._id,
          deletedAt: null,
        },
        { pinnedAt: pinned ? new Date() : null },
        { new: true },
      );
      if (!message) throw fail(404, "Message unavailable.");
      await CommunityModerationAction.create({
        community: community._id,
        moderator: req.userId,
        message: message._id,
        action: pinned ? "pin" : "unpin",
        reason: "Community announcement.",
      });
      communityEvents.emit("changed", String(community._id));
      res.json({ data: { ok: true } });
    },
  );
  router.post(
    "/:id/members/:userId/moderate",
    write,
    async (req: AuthedRequest, res) => {
      const input = z
        .object({
          action: z.enum(["mute", "unmute", "suspend", "ban", "restore"]),
          reason: z.string().trim().min(10).max(1500),
        })
        .parse(req.body);
      await moderateCommunityMember(
        String(req.params.id),
        String(req.params.userId),
        req.userId!,
        input.action,
        input.reason,
      );
      res.json({ data: { ok: true } });
    },
  );
  router.post("/:id/report", write, async (req: AuthedRequest, res) => {
    const { community, member } = await communityAccess(
      req.userId!,
      req.params.id,
    );
    const input = z
      .object({
        reason: z.string().trim().min(10).max(1500),
        messageId: z.string().optional(),
        target: z.string().optional(),
        category: z
          .enum([
            "other",
            "harassment",
            "scam",
            "explicit_content",
            "child_safety",
            "privacy",
          ])
          .default("other"),
      })
      .parse(req.body);
    const message = input.messageId
      ? await CommunityMessage.findOne({
          _id: communityId(input.messageId),
          community: community._id,
          sequence: { $gt: member!.joinedAfter },
        })
      : null;
    if (input.messageId && !message) throw fail(404, "Message unavailable.");
    const target =
      message?.sender ?? (input.target ? communityId(input.target) : undefined);
    if (
      target &&
      !(await CommunityMembership.exists({
        community: community._id,
        user: target,
      }))
    )
      throw fail(404, "Member unavailable.");
    await Report.create({
      reporter: req.userId,
      target,
      community: community._id,
      communityMessage: message?._id,
      reason: input.reason,
      category: input.category,
      severity: input.category === "child_safety" ? "critical" : "medium",
      priority: input.category === "child_safety" ? 100 : 0,
      evidenceText: message?.text,
    });
    res.status(201).json({ data: { ok: true } });
  });
  router.get("/:id/reports", async (req: AuthedRequest, res) => {
    const { community, moderator } = await communityAccess(
      req.userId!,
      req.params.id,
    );
    if (!moderator) throw fail(403, "Community moderator permission required.");
    const rows = await Report.find({
      community: community._id,
      status: "pending",
    })
      .select("+evidenceText")
      .sort({ priority: -1, _id: -1 })
      .limit(50)
      .lean();
    res.json({
      data: rows.map((r) => ({
        id: String(r._id),
        reason: r.reason,
        evidenceText: r.evidenceText,
        messageId: r.communityMessage ? String(r.communityMessage) : null,
        status: r.status,
        severity: r.severity,
      })),
    });
  });
  router.post(
    "/:id/reports/:reportId/resolve",
    write,
    async (req: AuthedRequest, res) => {
      const { reason } = z
        .object({ reason: z.string().trim().min(10).max(1500) })
        .parse(req.body);
      await mongoose.connection.transaction(async (session) => {
        const { community, moderator } = await communityAccess(
          req.userId!,
          req.params.id,
          true,
          session,
        );
        if (!moderator)
          throw fail(403, "Community moderator permission required.");
        const report = await Report.findOneAndUpdate(
          { _id: communityId(req.params.reportId), community: community._id },
          { status: "resolved" },
          { new: true, session },
        );
        if (!report) throw fail(404, "Report unavailable.");
        await CommunityModerationAction.create(
          [
            {
              community: community._id,
              moderator: req.userId,
              action: "resolve_report",
              reason,
            },
          ],
          { session },
        );
      });
      res.json({ data: { ok: true } });
    },
  );
  router.post(
    "/:id/plans/:planId/remove",
    write,
    async (req: AuthedRequest, res) => {
      const { reason } = z
        .object({ reason: z.string().trim().min(10).max(1500) })
        .parse(req.body);
      await mongoose.connection.transaction(async (session) => {
        const { community, moderator } = await communityAccess(
          req.userId!,
          req.params.id,
          true,
          session,
        );
        if (!moderator)
          throw fail(403, "Community moderator permission required.");
        const activity = await Activity.findOneAndUpdate(
          { _id: communityId(req.params.planId), community: community._id },
          { status: "deleted", ownerState: "closed" },
          { new: true, session },
        );
        if (!activity) throw fail(404, "Plan unavailable.");
        await CommunityModerationAction.create(
          [
            {
              community: community._id,
              moderator: req.userId,
              action: "remove_plan",
              reason,
            },
          ],
          { session },
        );
      });
      await announceCommunityPlan(
        req.params.planId,
        req.userId!,
        "A community plan you followed was removed by a moderator.",
        `plan-moderated:${req.params.planId}`,
      );
      communityEvents.emit("changed", String(req.params.id));
      res.json({ data: { ok: true } });
    },
  );
  router.get("/:id/plans/similar", async (req: AuthedRequest, res) => {
    const { community } = await communityAccess(req.userId!, req.params.id);
    const p = z
      .object({
        title: z.string().trim().min(3).max(100),
        startsAt: z.iso.datetime(),
        zone: z.string().max(100).default(""),
      })
      .parse(req.query);
    const words = p.title
      .split(/\s+/)
      .filter((w) => w.length >= 4)
      .slice(0, 5)
      .map(escapeSearch);
    if (!words.length) return res.json({ data: [] });
    const filter = await communityPlanFilter(req.userId!);
    const rows = await Activity.find({
      $and: [
        filter,
        {
          community: community._id,
          startsAt: {
            $gte: new Date(+new Date(p.startsAt) - 86400000),
            $lte: new Date(+new Date(p.startsAt) + 86400000),
          },
          title: new RegExp(words.join("|"), "i"),
          ...(p.zone ? { zone: new RegExp(escapeSearch(p.zone), "i") } : {}),
        },
      ],
    })
      .select("title startsAt zone")
      .limit(5)
      .lean();
    res.json({ data: rows });
  });
  router.get(
    "/:id/plans/:planId/participants",
    async (req: AuthedRequest, res) => {
      await communityAccess(req.userId!, req.params.id, false);
      const activity = await Activity.findOne({
        _id: communityId(req.params.planId),
        community: communityId(req.params.id),
        creator: req.userId,
        status: { $ne: "deleted" },
      });
      if (!activity)
        throw fail(403, "Only the organiser can manage participants.");
      const p = pageInput.parse(req.query);
      const rows = await ActivityInterest.find({
        activity: activity._id,
        ...(p.cursor ? { _id: { $gt: communityId(p.cursor) } } : {}),
      })
        .sort({ _id: 1 })
        .limit(p.limit + 1)
        .lean();
      const more = rows.length > p.limit;
      if (more) rows.pop();
      const users = await User.find({
        _id: { $in: rows.map((r) => r.user) },
        status: "active",
      })
        .select("name")
        .lean();
      res.json({
        data: {
          items: rows
            .filter((r) => users.some((u) => String(u._id) === String(r.user)))
            .map((r) => ({
              id: String(r._id),
              userId: String(r.user),
              name: users.find((u) => String(u._id) === String(r.user))!.name,
              status: r.status,
            })),
          next: more ? String(rows.at(-1)!._id) : null,
        },
      });
    },
  );
  router.delete(
    "/:id/plans/:planId/participants/:userId",
    write,
    async (req: AuthedRequest, res) => {
      const activity = await Activity.findOne({
        _id: communityId(req.params.planId),
        community: communityId(req.params.id),
      });
      if (!activity) throw fail(404, "Plan unavailable.");
      await removeCommunityParticipant(
        req.userId!,
        req.params.planId,
        String(req.params.userId),
      );
      res.json({ data: { ok: true } });
    },
  );
  router.post(
    "/:id/plans/:planId/participants/:userId/approve",
    write,
    async (req: AuthedRequest, res) => {
      const activity = await Activity.findOne({
        _id: communityId(req.params.planId),
        community: communityId(req.params.id),
        creator: req.userId,
      });
      const interest =
        activity &&
        (await ActivityInterest.findOne({
          activity: activity._id,
          user: communityId(req.params.userId),
        }));
      if (!interest) throw fail(404, "Request unavailable.");
      await acceptActivityInterest(req.userId!, String(interest._id));
      res.json({ data: { ok: true } });
    },
  );
  router.get("/:id/plans", async (req: AuthedRequest, res) => {
    const { community } = await communityAccess(
      req.userId!,
      req.params.id,
      false,
    );
    const p = pageInput
      .extend({
        section: z
          .enum(["upcoming", "for-you", "popular", "mine"])
          .default("upcoming"),
        city: z.string().max(100).default(""),
        category: z.string().max(50).default(""),
        policy: z.enum(["open", "approval"]).optional(),
        available: z.enum(["true", "false"]).optional(),
        from: z.iso.datetime().optional(),
        to: z.iso.datetime().optional(),
      })
      .parse(req.query);
    const scope = await communityPlanFilter(req.userId!, p.section === "mine");
    const filter: Record<string, unknown> = {
      community: community._id,
      ...(p.q ? { title: new RegExp(escapeSearch(p.q), "i") } : {}),
      ...(p.city ? { zone: new RegExp(escapeSearch(p.city), "i") } : {}),
      ...(p.category ? { category: p.category } : {}),
    };
    if (p.section === "mine") {
      const ids = await ActivityInterest.find({ user: req.userId }).distinct(
        "activity",
      );
      filter.$or = [
        { creator: new mongoose.Types.ObjectId(req.userId) },
        { _id: { $in: ids } },
      ];
    }
    if (p.from || p.to)
      filter.startsAt = {
        ...(p.from ? { $gte: new Date(p.from) } : {}),
        ...(p.to ? { $lte: new Date(p.to) } : {}),
      };
    if (p.available === "true")
      filter.$expr = {
        $lt: [{ $size: { $ifNull: ["$participants", []] } }, "$capacity"],
      };
    if (p.policy) filter.participationPolicy = p.policy;
    // Offset cursor stays bounded; stable tie breakers retain deterministic pagination.
    const offset = p.cursor
      ? z.coerce.number().int().min(0).max(10000).parse(p.cursor)
      : 0;
    let sort: Record<string, 1 | -1> = { startsAt: 1, _id: 1 };
    if (p.section === "popular")
      sort = { participantCount: -1, startsAt: 1, _id: 1 };
    const profile =
      p.section === "for-you"
        ? await Profile.findOne({ user: req.userId })
            .select("interests onboarding.vibes")
            .lean()
        : null;
    const categories = profile
      ? [
          ...(profile.interests ?? []),
          ...(profile.onboarding?.vibes ?? []).flatMap(
            (v) => vibeCategories[v] ?? [],
          ),
        ]
      : [];
    if (p.section === "for-you")
      sort = { interestScore: -1, startsAt: 1, _id: 1 };
    const rows = await Activity.aggregate([
      { $match: { $and: [scope, filter] } },
      {
        $lookup: {
          from: "users",
          localField: "creator",
          foreignField: "_id",
          as: "organiser",
        },
      },
      { $match: { "organiser.status": "active", "organiser.adminRole": null } },
      {
        $addFields: {
          participantCount: { $size: { $ifNull: ["$participants", []] } },
          interestScore: { $cond: [{ $in: ["$category", categories] }, 1, 0] },
        },
      },
      { $sort: sort },
      { $skip: offset },
      { $limit: p.limit + 1 },
    ]);
    const more = rows.length > p.limit;
    if (more) rows.pop();
    res.json({
      data: {
        items: await serializePlans(rows, req.userId!),
        next: more ? String(offset + p.limit) : null,
      },
    });
  });
  return router;
}
