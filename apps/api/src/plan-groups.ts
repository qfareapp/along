import { Router } from "express";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { authenticate, type AuthedRequest } from "./auth.js";
import { fail, requireReady } from "./onboarding.js";
import { Activity, ActivityInterest, Block } from "./models.js";
import {
  PlanGroup,
  PlanGroupMember,
  PlanGroupMessage,
  PlanGroupReaction,
} from "./plan-group-models.js";
import {
  appendGroupMessage,
  authorisePlanGroup,
  groupId,
  groupMessageDto,
  selectedGroupUsers,
  type GroupAccess,
  decorateGroupMessages,
} from "./plan-group-service.js";
import { communityEvents } from "./community-service.js";

async function summary(access: GroupAccess, userId: string) {
  const { group, activity, member } = access;
  const [lastMessage, unread] = await Promise.all([
    PlanGroupMessage.findOne({
      group: group._id,
      sender: { $nin: access.hiddenSenders },
      sequence: { $gt: member.joinedAfter },
    }).sort({ sequence: -1 }),
    PlanGroupMessage.countDocuments({
      group: group._id,
      sequence: { $gt: Math.max(member.joinedAfter, member.lastReadSequence) },
      sender: { $nin: [userId, ...access.hiddenSenders] },
    }),
  ]);
  return {
    id: String(group._id),
    visibilityKey: crypto
      .createHash("sha256")
      .update(
        JSON.stringify([
          access.hiddenSenders.slice().sort(),
          access.members.map((u) => String(u._id)).sort(),
          member.joinedAfter,
          group.contentRevision ?? 0,
        ]),
      )
      .digest("hex"),
    activityId: String(activity._id),
    title: activity.title,
    messagingMode: group.messagingMode,
    isOrganiser: access.isOrganiser,
    canSend: access.canSend,
    muted: member.muted,
    memberCount: access.members.length,
    lastSequence: group.lastSequence,
    lastReadSequence: member.lastReadSequence,
    updatedAt: group.updatedAt,
    unread,
    lastMessage: lastMessage
      ? groupMessageDto(lastMessage, userId, access)
      : null,
  };
}

export function planGroupsRouter() {
  const router = Router();
  router.use(authenticate, requireReady);
  router.use((req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
      res.on("finish", () => {
        const id = req.path.split("/")[1];
        if (res.statusCode < 400 && mongoose.isObjectIdOrHexString(id))
          communityEvents.emit("group-changed", id);
      });
    next();
  });
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  const write = rateLimit({
    windowMs: 60000,
    limit: 45,
    keyGenerator: (req) => (req as AuthedRequest).userId!,
    message: {
      error: {
        code: "RATE_LIMITED",
        message: "Please wait a moment before sending again.",
      },
    },
  });
  router.get("/", async (req: AuthedRequest, res) => {
    const memberships = await PlanGroupMember.find({
      user: req.userId,
      removedAt: null,
    })
      .select("group")
      .lean();
    const groups = await PlanGroup.find({
      _id: { $in: memberships.map((m) => m.group) },
    })
      .sort({ updatedAt: -1 })
      .limit(100);
    const data = [];
    for (const group of groups) {
      try {
        data.push(
          await summary(
            await authorisePlanGroup(req.userId!, String(group._id)),
            req.userId!,
          ),
        );
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
      }
    }
    res.json({ data });
  });
  router.get("/for-plan/:id", async (req: AuthedRequest, res) => {
    const activity = await Activity.findOne({
      _id: groupId(req.params.id),
      activityType: "group",
      status: "active",
    });
    if (!activity) throw fail(404, "Group chat unavailable.");
    const users = await selectedGroupUsers(activity);
    const ownerId = String(activity.creator);
    if (
      !users.some((u) => String(u._id) === req.userId) ||
      !users.some((u) => String(u._id) === ownerId) ||
      (await Block.exists({
        $or: [
          { user: req.userId, target: ownerId },
          { user: ownerId, target: req.userId },
        ],
      }))
    )
      throw fail(404, "Group chat unavailable.");
    const group = await PlanGroup.findOne({ activity: activity._id });
    if (group) await authorisePlanGroup(req.userId!, String(group._id));
    res.json({
      data: {
        groupId: group ? String(group._id) : null,
        acceptedCount: users.filter((u) => String(u._id) !== ownerId).length,
        isOrganiser: ownerId === req.userId,
        canCreate:
          ownerId === req.userId &&
          users.length > 1 &&
          !users.find((u) => String(u._id) === ownerId)?.restrictions
            ?.messaging,
      },
    });
  });
  router.post("/", write, async (req: AuthedRequest, res) => {
    const input = z
      .object({
        activityId: z.string(),
        messagingMode: z
          .enum(["everyone", "organiser_only"])
          .default("everyone"),
      })
      .strict()
      .parse(req.body);
    let id = "",
      created = false;
    await mongoose.connection.transaction(async (session) => {
      // Serialize creation with the existing capacity/acceptance write on this plan.
      const activity = await Activity.findOneAndUpdate(
        {
          _id: groupId(input.activityId),
          creator: req.userId,
          activityType: "group",
          status: "active",
        },
        { $inc: { groupChatRevision: 1 } },
        { new: true, session },
      );
      if (!activity)
        throw fail(
          404,
          "Only the organiser can create this plan's group chat.",
        );
      const existing = await PlanGroup.findOne({
        activity: activity._id,
      }).session(session);
      if (existing) {
        id = String(existing._id);
        return;
      }
      const users = await selectedGroupUsers(activity, session);
      if (!users.some((u) => String(u._id) === req.userId) || users.length < 2)
        throw fail(
          409,
          "Accept at least one attendee before creating the group chat.",
        );
      if (
        users.find((u) => String(u._id) === req.userId)?.restrictions?.messaging
      )
        throw fail(403, "Messaging is restricted. Contact support to appeal.");
      const [group] = await PlanGroup.create(
        [{ activity: activity._id, messagingMode: input.messagingMode }],
        { session, ordered: true },
      );
      id = String(group!._id);
      created = true;
      await PlanGroupMember.create(
        users.map((user) => ({
          group: group!._id,
          user: user._id,
          joinedAfter: 0,
          lastReadSequence: 0,
        })),
        { session, ordered: true },
      );
      await appendGroupMessage(
        group!,
        req.userId!,
        `Group created for ${activity.title}. Selected attendees are added automatically.`,
        "created",
        session,
      );
    });
    res.status(created ? 201 : 200).json({ data: { id } });
  });
  router.get("/:id", async (req: AuthedRequest, res) => {
    const input = z
      .object({
        before: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .strict()
      .parse(req.query);
    const access = await authorisePlanGroup(req.userId!, req.params.id);
    const rows = await PlanGroupMessage.find({
      group: access.group._id,
      sender: { $nin: access.hiddenSenders },
      sequence: {
        $gt: access.member.joinedAfter,
        ...(input.before ? { $lt: input.before } : {}),
      },
    })
      .sort({ sequence: -1 })
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const messages = rows.slice(0, input.limit).reverse();
    res.json({
      data: {
        ...(await summary(access, req.userId!)),
        members: access.members.map((user) => ({
          id: String(user._id),
          own: String(user._id) === req.userId,
          name: user.name,
          isOrganiser: String(user._id) === access.organiserId,
        })),
        messages: await decorateGroupMessages(messages, req.userId!, access),
        nextBefore: hasMore ? messages[0]!.sequence : null,
      },
    });
  });
  router.patch("/:id/preferences", write, async (req: AuthedRequest, res) => {
    const access = await authorisePlanGroup(req.userId!, req.params.id);
    const { muted } = z.object({ muted: z.boolean() }).strict().parse(req.body);
    await PlanGroupMember.updateOne({ _id: access.member._id }, { muted });
    res.json({ data: { muted } });
  });
  router.post(
    "/:id/messages/:messageId/action",
    write,
    async (req: AuthedRequest, res) => {
      const input = z
        .object({
          action: z.enum(["react", "pin", "delete"]),
          emoji: z.enum(["❤️", "👍", "😂", "🎉", "🔥"]).nullable().optional(),
          pinned: z.boolean().optional(),
        })
        .strict()
        .parse(req.body);
      await mongoose.connection.transaction(async (session) => {
        const access = await authorisePlanGroup(
          req.userId!,
          req.params.id,
          session,
        );
        const message = await PlanGroupMessage.findOne({
          _id: groupId(req.params.messageId),
          group: access.group._id,
          sender: { $nin: access.hiddenSenders },
          sequence: { $gt: access.member.joinedAfter },
          kind: "message",
          deletedAt: null,
        }).session(session);
        if (!message) throw fail(404, "Message unavailable.");
        if (input.action === "react") {
          if (input.emoji)
            await PlanGroupReaction.updateOne(
              { message: message._id, user: req.userId },
              { emoji: input.emoji },
              { upsert: true, session },
            );
          else
            await PlanGroupReaction.deleteOne(
              { message: message._id, user: req.userId },
              { session },
            );
        } else {
          if (
            !access.isOrganiser &&
            (input.action === "pin" || String(message.sender) !== req.userId)
          )
            throw fail(403, "You cannot change this message.");
          if (input.action === "pin")
            message.pinnedAt = input.pinned ? new Date() : undefined;
          else {
            message.text = "Message removed";
            message.deletedAt = new Date();
            message.pinnedAt = undefined;
            await PlanGroupReaction.deleteMany(
              { message: message._id },
              { session },
            );
          }
          await message.save({ session });
        }
        await PlanGroup.updateOne(
          { _id: access.group._id },
          { $inc: { contentRevision: 1 } },
          { session },
        );
      });
      res.json({ data: { ok: true } });
    },
  );
  router.patch("/:id/settings", write, async (req: AuthedRequest, res) => {
    const { messagingMode } = z
      .object({ messagingMode: z.enum(["everyone", "organiser_only"]) })
      .strict()
      .parse(req.body);
    await mongoose.connection.transaction(async (session) => {
      const access = await authorisePlanGroup(
        req.userId!,
        req.params.id,
        session,
      );
      if (!access.isOrganiser)
        throw fail(403, "Only the organiser can change group permissions.");
      if (access.group.messagingMode === messagingMode) return;
      await PlanGroup.updateOne(
        { _id: access.group._id },
        { $set: { messagingMode } },
        { session },
      );
      await appendGroupMessage(
        access.group,
        req.userId!,
        messagingMode === "everyone"
          ? "The organiser allowed everyone to send messages."
          : "The organiser switched to organiser-only announcements.",
        "permissions",
        session,
      );
    });
    res.json({
      data: await summary(
        await authorisePlanGroup(req.userId!, req.params.id),
        req.userId!,
      ),
    });
  });
  router.delete(
    "/:id/members/:userId",
    write,
    async (req: AuthedRequest, res) => {
      const targetId = groupId(req.params.userId);
      await mongoose.connection.transaction(async (session) => {
        const access = await authorisePlanGroup(
          req.userId!,
          req.params.id,
          session,
        );
        if (!access.isOrganiser)
          throw fail(403, "Only the organiser can remove group members.");
        if (String(targetId) === access.organiserId)
          throw fail(400, "The organiser cannot be removed from the group.");
        const member = await PlanGroupMember.findOne({
          group: access.group._id,
          user: targetId,
        }).session(session);
        if (!member) throw fail(404, "Group member not found.");
        if (member.removedAt) return;
        member.removedAt = new Date();
        await member.save({ session });
        if (access.activity.community) {
          await Activity.updateOne(
            { _id: access.activity._id },
            {
              $pull: { participants: targetId },
              $inc: { groupChatRevision: 1 },
            },
            { session },
          );
          await ActivityInterest.updateOne(
            { activity: access.activity._id, user: targetId },
            { status: "declined" },
            { session },
          );
        }
        const name = access.members.find(
          (user) => String(user._id) === String(targetId),
        )?.name;
        await appendGroupMessage(
          access.group,
          req.userId!,
          `${name ?? "A member"} was removed from the group by the organiser.`,
          "removed",
          session,
        );
      });
      res.status(204).end();
    },
  );
  router.post("/:id/messages", write, async (req: AuthedRequest, res) => {
    const input = z
      .object({
        text: z.string().trim().min(1).max(2000),
        clientId: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/),
        replyTo: z.string().optional(),
      })
      .strict()
      .parse(req.body);
    let messageId = "";
    await mongoose.connection.transaction(async (session) => {
      const access = await authorisePlanGroup(
        req.userId!,
        req.params.id,
        session,
      );
      const existing = await PlanGroupMessage.findOne({
        group: access.group._id,
        sender: req.userId,
        clientId: input.clientId,
      }).session(session);
      if (existing) {
        if (existing.text !== input.text)
          throw fail(409, "This message retry has different text.");
        messageId = String(existing._id);
        return;
      }
      if (!access.canSend)
        throw fail(
          403,
          access.group.messagingMode === "organiser_only" && !access.isOrganiser
            ? "Only the organiser can send messages in this group."
            : "Messaging is restricted. Contact support to appeal.",
        );
      if (
        input.replyTo &&
        !(await PlanGroupMessage.exists({
          _id: groupId(input.replyTo),
          group: access.group._id,
          sender: { $nin: access.hiddenSenders },
          sequence: { $gt: access.member.joinedAfter },
          deletedAt: null,
        }).session(session))
      )
        throw fail(404, "Original message unavailable.");
      const message = await appendGroupMessage(
        access.group,
        req.userId!,
        input.text,
        "message",
        session,
        input.clientId,
        input.replyTo,
      );
      messageId = String(message._id);
    });
    const access = await authorisePlanGroup(req.userId!, req.params.id);
    const message = await PlanGroupMessage.findById(messageId);
    res
      .status(201)
      .json({ data: groupMessageDto(message!, req.userId!, access) });
  });
  router.post("/:id/read", async (req: AuthedRequest, res) => {
    const { throughSequence } = z
      .object({ throughSequence: z.number().int().min(0) })
      .strict()
      .parse(req.body);
    const access = await authorisePlanGroup(req.userId!, req.params.id);
    await PlanGroupMember.updateOne(
      { _id: access.member._id },
      {
        $max: {
          lastReadSequence: Math.min(
            throughSequence,
            access.group.lastSequence,
          ),
        },
      },
    );
    res.status(204).end();
  });
  return router;
}
