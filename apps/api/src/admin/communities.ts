import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import {
  Community,
  CommunityMembership,
  CommunityMessage,
  CommunityModerationAction,
} from "../community-models.js";
import { Activity, Report, User } from "../models.js";
import {
  communityEvents,
  communityId,
  escapeSearch,
} from "../community-service.js";
import { moderateCommunityMember } from "../communities.js";
import { seedCommunities } from "../community-seed.js";
import { AuditLog } from "./models.js";
import { permit, type AdminRequest } from "./security.js";
import { fail } from "../onboarding.js";
const reason = z.string().trim().min(10).max(1500);
const fields = z.object({
  name: z.string().trim().min(3).max(60),
  slug: z.string().regex(/^[a-z0-9-]{3,60}$/),
  description: z.string().trim().min(10).max(1000),
  category: z.string().trim().min(2).max(50),
  icon: z.enum([
    "people-outline",
    "airplane-outline",
    "cafe-outline",
    "musical-notes-outline",
    "restaurant-outline",
    "game-controller-outline",
    "fitness-outline",
    "book-outline",
  ]),
  coverImage: z
    .union([
      z.literal(""),
      z
        .url()
        .refine((v) => v.startsWith("https://"), "Use an HTTPS image URL."),
    ])
    .optional(),
  rules: z.string().trim().min(10).max(4000),
  status: z.enum(["active", "archived"]),
  visibility: z.enum(["public", "hidden"]),
  maxActivePlans: z.number().int().min(1).max(50),
  messageRateLimit: z.number().int().min(1).max(60),
});
export function communityAdminRouter() {
  const router = Router();
  router.get("/", permit("settings.manage"), async (_req, res) =>
    res.json({
      data: await Community.find().sort({ _id: 1 }).limit(100).lean(),
    }),
  );
  router.post(
    "/seed",
    permit("settings.manage"),
    async (req: AdminRequest, res) => {
      await seedCommunities();
      await AuditLog.create({
        admin: req.admin!.id,
        action: "communities.seed",
        targetType: "community",
        reason: "Configure the six initial interest communities.",
      });
      res.json({ data: { ok: true } });
    },
  );
  router.post(
    "/",
    permit("settings.manage"),
    async (req: AdminRequest, res) => {
      const input = fields.extend({ reason }).strict().parse(req.body);
      let data;
      await mongoose.connection.transaction(async (session) => {
        const { reason: explanation, ...values } = input;
        [data] = await Community.create([values], { session });
        await AuditLog.create(
          [
            {
              admin: req.admin!.id,
              action: "community.create",
              targetType: "community",
              targetId: String(data._id),
              reason: explanation,
            },
          ],
          { session },
        );
      });
      res.status(201).json({ data });
    },
  );
  router.patch(
    "/:id",
    permit("settings.manage"),
    async (req: AdminRequest, res) => {
      const input = fields
        .partial()
        .extend({ reason })
        .strict()
        .parse(req.body);
      let data;
      await mongoose.connection.transaction(async (session) => {
        const { reason: explanation, ...values } = input;
        data = await Community.findOneAndUpdate(
          { _id: communityId(req.params.id) },
          { $set: values, $inc: { revision: 1 } },
          { new: true, runValidators: true, session },
        );
        if (!data) throw fail(404, "Community unavailable.");
        await AuditLog.create(
          [
            {
              admin: req.admin!.id,
              action: "community.update",
              targetType: "community",
              targetId: String(req.params.id),
              reason: explanation,
              metadata: values,
            },
          ],
          { session },
        );
      });
      communityEvents.emit("changed", String(req.params.id));
      communityEvents.emit("privacy-changed");
      res.json({ data });
    },
  );
  router.get("/:id/members", permit("settings.manage"), async (req, res) => {
    const input = z
      .object({
        cursor: z.string().optional(),
        q: z.string().max(100).default(""),
      })
      .parse(req.query);
    const users = input.q
      ? await User.find({
          name: new RegExp(escapeSearch(input.q), "i"),
        }).distinct("_id")
      : null;
    const items = await CommunityMembership.find({
      community: communityId(req.params.id),
      ...(users ? { user: { $in: users } } : {}),
      ...(input.cursor ? { _id: { $gt: communityId(input.cursor) } } : {}),
    })
      .sort({ _id: 1 })
      .limit(31)
      .populate("user", "name")
      .lean();
    const more = items.length > 30;
    if (more) items.pop();
    res.json({
      data: { items, next: more ? String(items.at(-1)!._id) : null },
    });
  });
  router.post(
    "/:id/members/:userId",
    permit("settings.manage"),
    async (req: AdminRequest, res) => {
      const input = z
        .object({
          action: z.enum([
            "mute",
            "unmute",
            "suspend",
            "ban",
            "restore",
            "moderator",
            "member",
          ]),
          reason,
        })
        .strict()
        .parse(req.body);
      await moderateCommunityMember(
        String(req.params.id),
        String(req.params.userId),
        req.admin!.id,
        input.action,
        input.reason,
        true,
      );
      res.json({ data: { ok: true } });
    },
  );
  router.get("/:id/reports", permit("reports.review"), async (req, res) => {
    const items = await Report.find({ community: communityId(req.params.id) })
      .select("+evidenceText")
      .sort({ priority: -1, _id: -1 })
      .limit(50)
      .lean();
    res.json({ data: items });
  });
  router.post(
    "/:id/messages/:messageId/remove",
    permit("reports.review"),
    async (req: AdminRequest, res) => {
      const input = z.object({ reason }).parse(req.body);
      await mongoose.connection.transaction(async (session) => {
        const message = await CommunityMessage.findOneAndUpdate(
          {
            _id: communityId(req.params.messageId),
            community: communityId(req.params.id),
          },
          { text: "Message removed", deletedAt: new Date(), pinnedAt: null },
          { new: true, session },
        );
        if (!message) throw fail(404, "Message unavailable.");
        await Community.updateOne(
          { _id: message.community },
          { $inc: { revision: 1, contentRevision: 1 } },
          { session },
        );
        await CommunityModerationAction.create(
          [
            {
              community: message.community,
              moderator: req.admin!.id,
              message: message._id,
              action: "delete_message",
              reason: input.reason,
            },
          ],
          { session },
        );
      });
      communityEvents.emit("changed", String(req.params.id));
      res.json({ data: { ok: true } });
    },
  );
  router.get("/:id/plans", permit("activities.moderate"), async (req, res) =>
    res.json({
      data: await Activity.find({ community: communityId(req.params.id) })
        .select("title startsAt ownerState status creator")
        .sort({ _id: -1 })
        .limit(50)
        .lean(),
    }),
  );
  router.post(
    "/:id/plans/:planId/remove",
    permit("activities.moderate"),
    async (req: AdminRequest, res) => {
      const input = z.object({ reason }).parse(req.body);
      await mongoose.connection.transaction(async (session) => {
        const activity = await Activity.findOneAndUpdate(
          {
            _id: communityId(req.params.planId),
            community: communityId(req.params.id),
          },
          { status: "deleted", ownerState: "closed" },
          { new: true, session },
        );
        if (!activity) throw fail(404, "Plan unavailable.");
        await AuditLog.create(
          [
            {
              admin: req.admin!.id,
              action: "community.plan.remove",
              targetType: "activity",
              targetId: String(activity._id),
              reason: input.reason,
            },
          ],
          { session },
        );
      });
      res.json({ data: { ok: true } });
    },
  );
  return router;
}
