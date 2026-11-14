import mongoose from "mongoose";
import { Activity, ActivityInterest, Block, User } from "./models.js";
import {
  PlanGroup,
  PlanGroupMember,
  PlanGroupMessage,
} from "./plan-group-models.js";
import { fail } from "./onboarding.js";

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
    ? await PlanGroupMember.findOne({ group: group._id, user: userId }).session(
        session ?? null,
      )
    : null;
  if (!group || !activity || !member)
    throw fail(404, "Group chat unavailable.");
  const members = await selectedGroupUsers(activity, session);
  if (
    !members.some((u) => String(u._id) === userId) ||
    !members.some((u) => String(u._id) === String(activity.creator))
  )
    throw fail(404, "Group chat unavailable.");
  const organiserId = String(activity.creator);
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
  const roster = members.filter((u) => !excluded.has(String(u._id)));
  const isOrganiser = organiserId === userId;
  const me = roster.find((u) => String(u._id) === userId)!;
  return {
    group,
    activity,
    member,
    members: roster,
    organiserId,
    isOrganiser,
    canSend:
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
  kind: "message" | "created" | "joined" | "permissions",
  session: mongoose.ClientSession,
  clientId?: string,
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
      },
    ],
    { session },
  );
  return message!;
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
  if (
    !group ||
    (await PlanGroupMember.exists({ group: group._id, user: userId }).session(
      session,
    ))
  )
    return;
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
