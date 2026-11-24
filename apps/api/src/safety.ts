import mongoose from "mongoose";
import { Router } from "express";
import { communityEvents } from "./community-service.js";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { authenticate, type AuthedRequest } from "./auth.js";
import { Activity, Block, Match, Message, Report, User } from "./models.js";
import { openConversation, pairKey } from "./chat.js";
import { authorisePlanGroup } from "./plan-group-service.js";
import { PlanGroupMessage } from "./plan-group-models.js";
import { fail } from "./onboarding.js";
import { memberRateKey, rateLimitMessage } from "./rate-limits.js";
import { AirportConnection } from "./airport-models.js";

export const safetyCategories = [
  "other",
  "harassment",
  "scam",
  "explicit_content",
  "child_safety",
  "privacy",
  "account",
  "support",
] as const;
const objectId = z
  .string()
  .refine((v) => mongoose.isObjectIdOrHexString(v), "Invalid resource ID.");
export function safetyRouter() {
  const router = Router();
  router.use(["/blocks", "/reports"], authenticate);
  router.use(["/blocks", "/reports"], (_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  router.get("/blocks", async (req: AuthedRequest, res) => {
    const ids = await Block.find({ user: req.userId }).distinct("target");
    const users = await User.find({
      _id: { $in: ids },
      status: "active",
      adminRole: null,
    })
      .select("name")
      .lean();
    res.json({ data: users.map((u) => ({ id: String(u._id), name: u.name })) });
  });
  router.delete("/blocks/:id", async (req: AuthedRequest, res) => {
    await Block.deleteOne({
      user: req.userId,
      target: objectId.parse(req.params.id),
    });
    // Unblocking never restores an ended match or conversation.
    communityEvents.emit("privacy-changed");
    res.status(204).end();
  });
  const write = rateLimit({
    windowMs: 60000,
    limit: 12,
    keyGenerator: memberRateKey,
    message: rateLimitMessage,
  });
  router.post("/blocks", write, async (req: AuthedRequest, res) => {
    const { userId } = z.object({ userId: objectId }).strict().parse(req.body);
    if (userId === req.userId)
      throw fail(400, "Cannot block your own account.");
    if (
      !(await User.exists({ _id: userId, status: "active", adminRole: null }))
    )
      throw fail(404, "Member unavailable.");
    await mongoose.connection.transaction(async (session) => {
      await Block.updateOne(
        { user: req.userId, target: userId },
        { $setOnInsert: { user: req.userId, target: userId } },
        { upsert: true, session },
      );
      await Match.updateOne(
        { pairKey: pairKey(req.userId!, userId) },
        { $set: { active: false } },
        { session },
      );
      await AirportConnection.updateMany(
        { pairKey: pairKey(req.userId!, userId) },
        { $set: { state: "ended", keep: [] } },
        { session },
      );
    });
    communityEvents.emit("privacy-changed");
    res.status(204).end();
  });
  router.post("/reports", write, async (req: AuthedRequest, res) => {
    const input = z
      .object({
        userId: objectId.optional(),
        reason: z.string().trim().min(10).max(1500),
        category: z.enum(safetyCategories).default("other"),
        activityId: objectId.optional(),
        conversationId: objectId.optional(),
        messageId: objectId.optional(),
        groupId: objectId.optional(),
        groupMessageId: objectId.optional(),
      })
      .strict()
      .parse(req.body);
    if (input.userId === req.userId)
      throw fail(400, "You cannot report your own account.");
    let target = input.userId,
      evidenceText: string | undefined;
    if (input.messageId && !input.conversationId)
      throw fail(400, "Choose a conversation for this message.");
    if (input.groupMessageId && !input.groupId)
      throw fail(400, "Choose a group for this message.");
    if (input.conversationId && input.groupId)
      throw fail(400, "Choose one report context.");
    if (input.conversationId) {
      const access = await openConversation(req.userId!, input.conversationId);
      if (target && target !== access.otherId)
        throw fail(404, "Member unavailable in this conversation.");
      target = access.otherId;
      if (input.messageId) {
        const message = await Message.findOne({
          _id: input.messageId,
          conversation: access.conversation._id,
          sender: target,
        });
        if (!message) throw fail(404, "Message unavailable.");
        evidenceText = message.text;
      }
    }
    if (input.groupId) {
      const access = await authorisePlanGroup(req.userId!, input.groupId);
      if (input.groupMessageId) {
        const message = await PlanGroupMessage.findOne({
          _id: input.groupMessageId,
          group: access.group._id,
          sequence: { $gt: access.member.joinedAfter },
          kind: "message",
          sender: { $ne: req.userId },
        });
        if (!message) throw fail(404, "Message unavailable.");
        if (target && target !== String(message.sender))
          throw fail(404, "Member unavailable in this message.");
        target = String(message.sender);
        evidenceText = message.text;
      } else if (
        target &&
        !access.members.some((u) => String(u._id) === target)
      )
        throw fail(404, "Group member unavailable.");
    }
    const targetUser = target
      ? await User.findOne({ _id: target, adminRole: null })
          .select("status")
          .lean()
      : null;
    if (target && !targetUser) throw fail(404, "Member unavailable.");
    if (
      input.activityId &&
      !(await Activity.exists({ _id: input.activityId, status: "active" }))
    )
      throw fail(404, "Plan unavailable.");
    const report = await Report.create({
      reporter: req.userId,
      target,
      reason: input.reason,
      category: input.category,
      activity: input.activityId,
      conversation: input.conversationId,
      message: input.messageId,
      group: input.groupId,
      groupMessage: input.groupMessageId,
      evidenceText,
      severity: input.category === "child_safety" ? "critical" : "medium",
      priority: input.category === "child_safety" ? 100 : 0,
      ...(!target || targetUser?.status === "deleted"
        ? { expiresAt: new Date(Date.now() + 180 * 86400000) }
        : {}),
    });
    res
      .status(201)
      .json({ data: { received: true, reference: String(report._id) } });
  });
  return router;
}
