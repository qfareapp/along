import mongoose from "mongoose";
import { EventEmitter } from "node:events";
import { Activity, Block, Category, Profile, User } from "./models.js";
import {
  Community,
  CommunityMembership,
  CommunityMessage,
  CommunityReaction,
  CommunityNotice,
} from "./community-models.js";
import { fail } from "./onboarding.js";
import { enqueuePush } from "./push.js";
import { planAudienceVisibility } from "./plan-audience.js";

export const communityEvents = new EventEmitter();
export const communityId = (value: unknown) => {
  if (typeof value !== "string" || !mongoose.isObjectIdOrHexString(value))
    throw fail(404, "Community unavailable.");
  return new mongoose.Types.ObjectId(value);
};
export const escapeSearch = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export async function hiddenCommunityUsers(userId: string) {
  const blocks = await Block.find({
    $or: [{ user: userId }, { target: userId }],
  }).lean();
  return blocks.map((b) =>
    String(String(b.user) === userId ? b.target : b.user),
  );
}
export async function communityPlanFilter(userId: string, includePast = false) {
  const hidden = await hiddenCommunityUsers(userId);
  const categories = await Category.find({ active: true }).distinct("slug");
  return {
    community: { $ne: null },
    visibility: { $ne: "private" },
    status: "active",
    creator: { $nin: hidden.map((u) => new mongoose.Types.ObjectId(u)) },
    category: { $in: categories },
    ...(includePast
      ? {}
      : {
          ownerState: "live",
          $or: [
            { startsAt: { $gte: new Date() } },
            { endsAt: { $gt: new Date() } },
          ],
        }),
    $and: [await planAudienceVisibility(userId)],
  };
}
export async function communityAccess(
  userId: string,
  id: unknown,
  memberRequired = true,
  session?: mongoose.ClientSession,
) {
  const community = await Community.findOne({
    _id: communityId(id),
    status: "active",
    visibility: "public",
  }).session(session ?? null);
  if (!community) throw fail(404, "Community unavailable.");
  const member = await CommunityMembership.findOne({
    community: community._id,
    user: userId,
  }).session(session ?? null);
  if (member?.status === "suspended" || member?.status === "banned")
    throw fail(
      403,
      "Your access to this community has been restricted. Contact support to appeal.",
    );
  if (memberRequired && member?.status !== "active")
    throw fail(403, "Join this community to continue.");
  return {
    community,
    member,
    moderator:
      member?.status === "active" &&
      ["moderator", "admin"].includes(member.role),
  };
}
export async function changeCommunityMembership(
  userId: string,
  id: unknown,
  joining: boolean,
) {
  await mongoose.connection.transaction(async (session) => {
    const { community, member } = await communityAccess(
      userId,
      id,
      false,
      session,
    );
    // All membership changes serialize on the community, including retries/rejoins.
    await Community.updateOne(
      { _id: community._id },
      { $inc: { revision: 1 } },
      { session },
    );
    if (joining && member?.status !== "active") {
      await CommunityMembership.updateOne(
        { community: community._id, user: userId },
        {
          $set: {
            status: "active",
            joinedAt: new Date(),
            joinedAfter: community.lastSequence,
            lastReadSequence: community.lastSequence,
          },
        },
        { upsert: true, session },
      );
      await Community.updateOne(
        { _id: community._id },
        { $inc: { memberCount: 1 } },
        { session },
      );
      await CommunityNotice.updateOne(
        { key: `welcome:${community._id}:${userId}` },
        {
          $setOnInsert: {
            community: community._id,
            recipient: userId,
            actor: userId,
            text: `Welcome to ${community.name}. Find your people. Make plans together.`,
          },
        },
        { upsert: true, session },
      );
    } else if (!joining && member?.status === "active") {
      member.status = "left";
      await member.save({ session });
      await Community.updateOne(
        { _id: community._id },
        { $inc: { memberCount: -1 } },
        { session },
      );
    }
  });
  communityEvents.emit("changed", String(id));
}
export async function communitySummary(userId: string, id: unknown) {
  const { community, member, moderator } = await communityAccess(
    userId,
    id,
    false,
  );
  const hidden = await hiddenCommunityUsers(userId);
  const unreadRows =
    member?.status === "active"
      ? await CommunityMessage.aggregate([
          {
            $match: {
              community: community._id,
              sequence: {
                $gt: Math.max(member.joinedAfter, member.lastReadSequence),
              },
              sender: {
                $nin: [userId, ...hidden].map(
                  (u) => new mongoose.Types.ObjectId(u),
                ),
              },
              deletedAt: null,
            },
          },
          {
            $lookup: {
              from: "users",
              localField: "sender",
              foreignField: "_id",
              as: "author",
            },
          },
          { $match: { "author.status": "active", "author.adminRole": null } },
          { $count: "count" },
        ])
      : [];
  const unread = unreadRows[0]?.count ?? 0;
  const upcomingEvents = await Activity.countDocuments({
    community: community._id,
    status: "active",
    ownerState: "live",
    startsAt: { $gt: new Date() },
  });
  return {
    id: String(community._id),
    name: community.name,
    slug: community.slug,
    description: community.description,
    category: community.category,
    icon: community.icon,
    coverImage: community.coverImage,
    rules: community.rules,
    memberCount: community.memberCount,
    upcomingEvents,
    joined: member?.status === "active",
    role: member?.role ?? "member",
    moderator,
    muted: member?.muted ?? false,
    mutedUntil: member?.mutedUntil,
    unread,
    lastSequence: community.lastSequence,
    visibilityKey: JSON.stringify([
      hidden.sort(),
      community.contentRevision,
      member?.joinedAfter,
    ]),
  };
}
export async function communityMessages(
  userId: string,
  id: unknown,
  before?: number,
) {
  const { community, member } = await communityAccess(userId, id);
  const hidden = await hiddenCommunityUsers(userId);
  const rows = await CommunityMessage.find({
    community: community._id,
    sender: { $nin: hidden },
    sequence: { $gt: member!.joinedAfter, ...(before ? { $lt: before } : {}) },
  })
    .sort({ sequence: -1 })
    .limit(31)
    .lean();
  const more = rows.length > 30;
  if (more) rows.pop();
  const replyIds = rows.flatMap((r) => (r.replyTo ? [r.replyTo] : []));
  const replies = await CommunityMessage.find({
    _id: { $in: replyIds },
    community: community._id,
    sender: { $nin: hidden },
    deletedAt: null,
    sequence: { $gt: member!.joinedAfter },
  })
    .select("text sender")
    .lean();
  const users = await User.find({
    _id: {
      $in: [...rows.map((r) => r.sender), ...replies.map((r) => r.sender)],
    },
    status: "active",
    adminRole: null,
  })
    .select("name")
    .lean();
  const names = new Map(users.map((u) => [String(u._id), u.name]));
  const profiles = await Profile.find({
    user: { $in: users.map((u) => u._id) },
  })
    .select("user photos")
    .lean();
  const photos = new Map(
    profiles.map((p) => [
      String(p.user),
      p.photos?.[0] ? String(p.photos[0]) : null,
    ]),
  );
  const reactions = await CommunityReaction.find({
    message: { $in: rows.map((r) => r._id) },
    user: { $nin: hidden },
  }).lean();
  return {
    items: rows.reverse().map((row) => ({
      id: String(row._id),
      sequence: row.sequence,
      text:
        row.deletedAt || !names.has(String(row.sender))
          ? "Message removed"
          : row.text,
      deleted: !!row.deletedAt || !names.has(String(row.sender)),
      own: String(row.sender) === userId,
      sender: {
        id: String(row.sender),
        name: names.get(String(row.sender)) ?? "Former member",
        photoId: photos.get(String(row.sender)),
      },
      createdAt: row.createdAt,
      pinned: !!row.pinnedAt,
      reply: (() => {
        const r = replies.find((r) => String(r._id) === String(row.replyTo));
        return r && names.has(String(r.sender))
          ? { name: names.get(String(r.sender)), text: r.text.slice(0, 150) }
          : null;
      })(),
      reactions: row.deletedAt
        ? []
        : ["❤️", "👍", "😂", "🎉", "🔥"]
            .map((emoji) => ({
              emoji,
              count: reactions.filter(
                (r) =>
                  String(r.message) === String(row._id) && r.emoji === emoji,
              ).length,
              own: reactions.some(
                (r) =>
                  String(r.message) === String(row._id) &&
                  r.emoji === emoji &&
                  String(r.user) === userId,
              ),
            }))
            .filter((r) => r.count),
    })),
    nextBefore: more ? (rows[0]?.sequence ?? null) : null,
  };
}
export async function sendCommunityMessage(
  userId: string,
  id: unknown,
  input: { text: string; clientId: string; replyTo?: string },
) {
  const owner = await User.findById(userId).select("restrictions");
  if (owner?.restrictions?.messaging)
    throw fail(403, "Messaging is restricted. Contact support to appeal.");
  let messageId = "";
  await mongoose.connection.transaction(async (session) => {
    const { community, member } = await communityAccess(
      userId,
      id,
      true,
      session,
    );
    if (member?.mutedUntil && member.mutedUntil > new Date())
      throw fail(403, "A moderator has temporarily paused your messages.");
    const old = await CommunityMessage.findOne({
      community: community._id,
      sender: userId,
      clientId: input.clientId,
    }).session(session);
    if (old) {
      if (
        !old.deletedAt &&
        (old.text !== input.text ||
          String(old.replyTo ?? "") !== (input.replyTo ?? ""))
      )
        throw fail(409, "This message retry has different content.");
      messageId = String(old._id);
      return;
    }
    const recent = await CommunityMessage.countDocuments({
      community: community._id,
      sender: userId,
      createdAt: { $gte: new Date(Date.now() - 60000) },
    }).session(session);
    if (recent >= community.messageRateLimit)
      throw fail(429, "Please wait before sending another community message.");
    if (input.replyTo) {
      const hidden = await hiddenCommunityUsers(userId);
      if (
        !(await CommunityMessage.exists({
          _id: communityId(input.replyTo),
          community: community._id,
          deletedAt: null,
          sender: { $nin: hidden },
          sequence: { $gt: member!.joinedAfter },
        }).session(session))
      )
        throw fail(404, "Original message unavailable.");
    }
    const updated = await Community.findOneAndUpdate(
      { _id: community._id, status: "active" },
      { $inc: { lastSequence: 1 } },
      { new: true, session },
    );
    if (!updated) throw fail(404, "Community unavailable.");
    const [message] = await CommunityMessage.create(
      [
        {
          community: community._id,
          sender: userId,
          text: input.text,
          clientId: input.clientId,
          sequence: updated.lastSequence,
          ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        },
      ],
      { session },
    );
    messageId = String(message._id);
  });
  communityEvents.emit("changed", String(id));
  // Stable notice/job keys also repair a failed enqueue when a client retries.
  if (input.replyTo) {
    const original = await CommunityMessage.findById(input.replyTo);
    if (original && String(original.sender) !== userId) {
      const recipient = String(original.sender);
      const membership = await CommunityMembership.findOne({
        community: id,
        user: recipient,
        status: "active",
        muted: false,
      });
      const hidden = await hiddenCommunityUsers(userId);
      if (membership && !hidden.includes(recipient)) {
        await CommunityNotice.updateOne(
          { key: `reply:${messageId}` },
          {
            $setOnInsert: {
              community: id,
              recipient,
              actor: userId,
              text: "Someone replied to your community message.",
            },
          },
          { upsert: true },
        );
        await enqueuePush({
          key: `community:${messageId}`,
          user: recipient,
          actor: userId,
          kind: "community",
          target: String(id),
          message: messageId,
        });
      }
    }
  }
  return { id: messageId };
}
