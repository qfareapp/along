import mongoose from "mongoose";
import { Activity, ActivityInterest } from "./models.js";
import { Community, CommunityMembership } from "./community-models.js";
import {
  communityAccess,
  communityId,
  communityEvents,
} from "./community-service.js";
import { PlanGroup, PlanGroupMember } from "./plan-group-models.js";
import { addAcceptedGroupMember } from "./plan-group-service.js";
import { fail } from "./onboarding.js";
import { communityNotice } from "./community-notifications.js";

export async function ensureCommunityEventGroup(
  activityId: unknown,
  owner: string,
  session: mongoose.ClientSession,
) {
  const activity = await Activity.findById(activityId).session(session);
  if (!activity?.community) return;
  let group = await PlanGroup.findOne({ activity: activity._id }).session(
    session,
  );
  if (!group) {
    [group] = await PlanGroup.create(
      [{ activity: activity._id, messagingMode: "everyone" }],
      { session },
    );
    await PlanGroupMember.create(
      [{ group: group._id, user: owner, joinedAfter: 0, lastReadSequence: 0 }],
      { session },
    );
  }
  for (const user of activity.participants)
    await addAcceptedGroupMember(activity._id, String(user), owner, session);
}
export async function requestCommunityPlan(
  userId: string,
  activityId: unknown,
) {
  let result: unknown;
  await mongoose.connection.transaction(async (session) => {
    const activity = await Activity.findOneAndUpdate(
      {
        _id: communityId(activityId),
        community: { $ne: null },
        status: "active",
        ownerState: "live",
        startsAt: { $gt: new Date() },
      },
      { $inc: { groupChatRevision: 1 } },
      { new: true, session },
    );
    if (!activity) throw fail(404, "Plan unavailable.");
    if (String(activity.creator) === userId)
      throw fail(400, "You already organise this plan.");
    await communityAccess(userId, String(activity.community), true, session);
    await Community.updateOne(
      { _id: activity.community },
      { $inc: { revision: 1 } },
      { session },
    );
    const old = await ActivityInterest.findOne({
      activity: activity._id,
      user: userId,
    }).session(session);
    const full = activity.participants.length >= (activity.capacity ?? 100);
    if (
      old &&
      old.status !== "cancelled" &&
      !(
        old.status === "pending" &&
        activity.participationPolicy === "open" &&
        !full
      )
    ) {
      result = old;
      return;
    }
    const status = full
      ? "waitlisted"
      : activity.participationPolicy === "open"
        ? "accepted"
        : "pending";
    const interest = await ActivityInterest.findOneAndUpdate(
      { activity: activity._id, user: userId },
      { $set: { status } },
      { upsert: true, new: true, session },
    );
    if (status === "accepted") {
      if (!activity.participants.some((p) => String(p) === userId))
        activity.participants.push(new mongoose.Types.ObjectId(userId));
      await activity.save({ session });
      await ensureCommunityEventGroup(
        activity._id,
        String(activity.creator),
        session,
      );
    }
    await communityNotice(
      activity.community,
      String(activity.creator),
      userId,
      `New ${status === "waitlisted" ? "waiting-list entry" : "participation request"} for ${activity.title}.`,
      `plan-request:${interest!._id}:${status}`,
      session,
    );
    if (status === "accepted")
      await communityNotice(
        activity.community,
        userId,
        String(activity.creator),
        `You're joining ${activity.title}. Your event chat is ready.`,
        `plan-approved:${interest!._id}`,
        session,
      );
    result = interest;
  });
  return result;
}
export async function removeCommunityParticipant(
  actor: string,
  activityId: unknown,
  target: string,
) {
  await mongoose.connection.transaction(async (session) => {
    const activity = await Activity.findOneAndUpdate(
      {
        _id: communityId(activityId),
        community: { $ne: null },
        status: { $ne: "deleted" },
      },
      { $inc: { groupChatRevision: 1 } },
      { new: true, session },
    );
    if (
      !activity ||
      (actor !== target && String(activity.creator) !== actor) ||
      String(activity.creator) === target
    )
      throw fail(403, "You cannot change this participation.");
    const interest = await ActivityInterest.findOneAndUpdate(
      { activity: activity._id, user: communityId(target) },
      { status: actor === target ? "cancelled" : "declined" },
      { new: true, session },
    );
    if (!interest) throw fail(404, "Participation unavailable.");
    await Activity.updateOne(
      { _id: activity._id },
      { $pull: { participants: target } },
      { session },
    );
    const group = await PlanGroup.findOne({ activity: activity._id }).session(
      session,
    );
    if (group) {
      await PlanGroupMember.updateOne(
        { group: group._id, user: target },
        { removedAt: new Date() },
        { session },
      );
      await PlanGroup.updateOne(
        { _id: group._id },
        { $inc: { contentRevision: 1 } },
        { session },
      );
    }
    if (actor !== target) {
      await communityNotice(
        activity.community,
        target,
        actor,
        `Your participation in ${activity.title} has ended.`,
        `removed:${interest._id}`,
        session,
      );
    }
    // Open plans promote the oldest eligible waiting member atomically when a seat opens.
    if (
      activity.participationPolicy === "open" &&
      activity.startsAt > new Date() &&
      activity.ownerState === "live"
    ) {
      const active = await CommunityMembership.find({
        community: activity.community,
        status: "active",
      })
        .session(session)
        .distinct("user");
      const waiting = await ActivityInterest.findOne({
        activity: activity._id,
        status: "waitlisted",
        user: { $in: active },
      })
        .sort({ createdAt: 1, _id: 1 })
        .session(session);
      if (waiting) {
        waiting.status = "pending";
        await waiting.save({ session });
        // Offer the free seat; the user explicitly confirms instead of being silently joined.
        await communityNotice(
          activity.community,
          String(waiting.user),
          String(activity.creator),
          `A place opened in ${activity.title}. Open the plan to confirm your place.`,
          `seat:${waiting._id}`,
          session,
        );
      }
    }
  });
  communityEvents.emit("privacy-changed");
}
