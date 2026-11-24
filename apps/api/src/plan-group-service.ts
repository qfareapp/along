import mongoose from "mongoose";
import { Activity, ActivityInterest, Block, User } from "./models.js";
import {
  PlanGroup,
  PlanGroupMember,
  PlanGroupMessage,
  PlanGroupReaction,
} from "./plan-group-models.js";
import { fail } from "./onboarding.js";
import { enqueuePush } from "./push.js";
import { Community, CommunityMembership } from "./community-models.js";

export const groupId = (value: unknown) => {
  if (typeof value !== "string" || !mongoose.isObjectIdOrHexString(value))
    throw fail(404, "Group chat unavailable.");
  return new mongoose.Types.ObjectId(value);
};
export async function selectedGroupUsers(
  activity: InstanceType<typeof Activity>,
  session?: mongoose.ClientSession,
) {
  const selected = await ActivityInterest.find({
    activity: activity._id,
    status: "accepted",
    user: { $in: activity.participants },
  })
    .session(session ?? null)
    .distinct("user");
  return User.find({
    _id: { $in: [activity.creator, ...selected] },
    status: "active",
    adminRole: null,
  })
    .session(session ?? null)
    .select("name restrictions")
    .lean();
}
export async function authorisePlanGroup(
  userId: string,
  id: unknown,
  session?: mongoose.ClientSession,
) {
  const group = await PlanGroup.findById(groupId(id)).session(session ?? null);
  const activity = group
    ? await Activity.findOne({
        _id: group.activity,
        activityType: "group",
        status: "active",
      }).session(session ?? null)
    : null;
  const member = group
    ? await PlanGroupMember.findOne({
        group: group._id,
        user: userId,
        removedAt: null,
      }).session(session ?? null)
    : null;
  if (!group || !activity || !member)
    throw fail(404, "Group chat unavailable.");
  if (activity.community) {
    if (session)
      await Community.updateOne(
        { _id: activity.community },
        { $inc: { revision: 1 } },
        { session },
      );
    if (
      !(await Community.exists({
        _id: activity.community,
        status: "active",
        visibility: "public",
      }).session(session ?? null)) ||
      ["closed", "expired"].includes(activity.ownerState) ||
      (await CommunityMembership.exists({
        community: activity.community,
        user: { $in: [userId, activity.creator] },
        status: { $in: ["banned", "suspended"] },
      }).session(session ?? null))
    )
      throw fail(404, "Group chat unavailable.");
  }
  const members = await selectedGroupUsers(activity, session);
  if (
    !members.some((u) => String(u._id) === userId) ||
    !members.some((u) => String(u._id) === String(activity.creator))
  )
    throw fail(404, "Group chat unavailable.");
  const organiserId = String(activity.creator);
  const viewerBlocks = await Block.find({
    $or: [{ user: userId }, { target: userId }],
  })
    .session(session ?? null)
    .lean();
  const hiddenSenders = viewerBlocks.map((b) =>
    String(String(b.user) === userId ? b.target : b.user),
  );
  const blocked = await Block.exists({
    $or: [
      { user: userId, target: organiserId },
      { user: organiserId, target: userId },
    ],
  }).session(session ?? null);
  if (blocked) throw fail(404, "Group chat unavailable.");
  const organiserBlocks = await Block.find({
    $or: [{ user: organiserId }, { target: organiserId }],
  })
    .session(session ?? null)
    .lean();
  const excluded = new Set(
    organiserBlocks.map((b) =>
      String(String(b.user) === organiserId ? b.target : b.user),
    ),
  );
  const memberships = await PlanGroupMember.find({
    group: group._id,
    removedAt: null,
  })
    .session(session ?? null)
    .distinct("user");
  const currentMembers = new Set(memberships.map(String));
  const roster = members.filter(
    (u) => currentMembers.has(String(u._id)) && !excluded.has(String(u._id)),
  );
  const isOrganiser = organiserId === userId;
  const me = roster.find((u) => String(u._id) === userId)!;
  return {
    group,
    activity,
    member,
    members: roster.filter((u) => !hiddenSenders.includes(String(u._id))),
    hiddenSenders,
    organiserId,
    isOrganiser,
    canSend:
      (!activity.community ||
        (activity.ownerState === "live" &&
          new Date(activity.endsAt ?? activity.startsAt) > new Date())) &&
      !me.restrictions?.messaging &&
      (isOrganiser || group.messagingMode === "everyone"),
  };
}
export type GroupAccess = Awaited<ReturnType<typeof authorisePlanGroup>>;
export function groupMessageDto(
  message: InstanceType<typeof PlanGroupMessage>,
  userId: string,
  access: GroupAccess,
) {
  const senderId = String(message.sender);
  return {
    id: String(message._id),
    sequence: message.sequence,
    text: message.text,
    deleted: !!message.deletedAt,
    pinned: !!message.pinnedAt,
    kind: message.kind,
    own: senderId === userId,
    createdAt: message.createdAt,
    sender: {
      id: senderId,
      name:
        access.members.find((u) => String(u._id) === senderId)?.name ??
        "Former member",
      isOrganiser: senderId === access.organiserId,
    },
  };
}
export async function appendGroupMessage(
  group: InstanceType<typeof PlanGroup>,
  sender: string,
  text: string,
  kind: "message" | "created" | "joined" | "permissions" | "removed",
  session: mongoose.ClientSession,
  clientId?: string,
  replyTo?: string,
) {
  const updated = await PlanGroup.findOneAndUpdate(
    { _id: group._id },
    { $inc: { lastSequence: 1 } },
    { new: true, session },
  );
  if (!updated) throw fail(404, "Group chat unavailable.");
  const [message] = await PlanGroupMessage.create(
    [
      {
        group: group._id,
        sender,
        text,
        kind,
        sequence: updated.lastSequence,
        ...(clientId ? { clientId } : {}),
        ...(replyTo ? { replyTo } : {}),
      },
    ],
    { session },
  );
  const recipients = await PlanGroupMember.find({
    group: group._id,
    removedAt: null,
    user: { $ne: sender },
  }).session(session);
  for (const member of recipients)
    if (!member.muted)
      await enqueuePush(
        {
          key: `group:${message!._id}`,
          user: String(member.user),
          actor: sender,
          kind: kind === "message" ? "group" : "notice",
          target: String(group._id),
          message: String(message!._id),
        },
        session,
      );
  return message!;
}
export async function decorateGroupMessages(
  messages: InstanceType<typeof PlanGroupMessage>[],
  userId: string,
  access: GroupAccess,
) {
  const reactions = await PlanGroupReaction.find({
    message: { $in: messages.map((m) => m._id) },
    user: { $nin: access.hiddenSenders },
  }).lean();
  const replies = await PlanGroupMessage.find({
    _id: { $in: messages.flatMap((m) => (m.replyTo ? [m.replyTo] : [])) },
    group: access.group._id,
    sender: { $nin: access.hiddenSenders },
    sequence: { $gt: access.member.joinedAfter },
    deletedAt: null,
  }).lean();
  return messages.map((m) => ({
    ...groupMessageDto(m, userId, access),
    reply: (() => {
      const r = replies.find((r) => String(r._id) === String(m.replyTo));
      return r
        ? {
            name:
              access.members.find((u) => String(u._id) === String(r.sender))
                ?.name ?? "Former member",
            text: r.text.slice(0, 150),
          }
        : null;
    })(),
    reactions: m.deletedAt
      ? []
      : ["❤️", "👍", "😂", "🎉", "🔥"]
          .map((emoji) => ({
            emoji,
            count: reactions.filter(
              (r) => String(r.message) === String(m._id) && r.emoji === emoji,
            ).length,
            own: reactions.some(
              (r) =>
                String(r.message) === String(m._id) &&
                String(r.user) === userId &&
                r.emoji === emoji,
            ),
          }))
          .filter((r) => r.count),
  }));
}
/** Called in the existing acceptance transaction. A new attendee sees join/future messages, not earlier history. */
export async function addAcceptedGroupMember(
  activityId: unknown,
  userId: string,
  ownerId: string,
  session: mongoose.ClientSession,
) {
  const group = await PlanGroup.findOne({ activity: activityId }).session(
    session,
  );
  if (!group) return;
  const oldMember = await PlanGroupMember.findOne({
    group: group._id,
    user: userId,
  }).session(session);
  if (oldMember && !oldMember.removedAt) return;
  if (oldMember) {
    const communityPlan = await Activity.exists({
      _id: activityId,
      community: { $ne: null },
      participants: userId,
    }).session(session);
    if (!communityPlan) return;
    oldMember.removedAt = null;
    oldMember.joinedAfter = group.lastSequence;
    oldMember.lastReadSequence = group.lastSequence;
    await oldMember.save({ session });
    return;
  }
  const user = await User.findById(userId)
    .select("name")
    .session(session)
    .lean();
  await PlanGroupMember.create(
    [
      {
        group: group._id,
        user: userId,
        joinedAfter: group.lastSequence,
        lastReadSequence: group.lastSequence,
      },
    ],
    { session },
  );
  await appendGroupMessage(
    group,
    ownerId,
    `${user?.name ?? "A selected attendee"} joined the plan group.`,
    "joined",
    session,
  );
}
