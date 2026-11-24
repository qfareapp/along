import mongoose from "mongoose";
import { Activity, ActivityInterest } from "./models.js";
import { CommunityMembership, CommunityNotice } from "./community-models.js";
import { enqueuePush } from "./push.js";
import { communityEvents } from "./community-service.js";
export async function communityNotice(
  community: unknown,
  recipient: string,
  actor: string,
  text: string,
  key: string,
  session?: mongoose.ClientSession,
) {
  await CommunityNotice.updateOne(
    { key },
    { $setOnInsert: { community, recipient, actor, text: text.slice(0, 300) } },
    { upsert: true, session },
  );
  const member = await CommunityMembership.findOne({
    community,
    user: recipient,
    status: "active",
    muted: false,
  }).session(session ?? null);
  if (member)
    await enqueuePush(
      {
        key,
        user: recipient,
        actor,
        kind: "community_notice",
        target: String(community),
      },
      session,
    );
}
export async function announceCommunityPlan(
  activityId: unknown,
  actor: string,
  text: string,
  key: string,
) {
  await mongoose.connection.transaction(async (session) => {
    const activity = await Activity.findById(activityId).session(session);
    if (!activity?.community) return;
    const requests = await ActivityInterest.find({
      activity: activity._id,
      status: { $in: ["pending", "accepted", "waitlisted"] },
    }).session(session);
    for (const request of requests)
      await communityNotice(
        activity.community,
        String(request.user),
        actor,
        text,
        `${key}:${request.user}`,
        session,
      );
  });
  communityEvents.emit("privacy-changed");
}
export async function cleanupCommunities(now = new Date()) {
  // Published plans use Along's existing lifecycle; completed records remain available in My events.
  await Activity.updateMany(
    {
      community: { $ne: null },
      ownerState: "live",
      status: "active",
      $or: [
        { endsAt: { $lte: now } },
        { endsAt: null, startsAt: { $lte: now } },
      ],
    },
    { ownerState: "successful" },
  );
  await Activity.updateMany(
    {
      community: { $ne: null },
      ownerState: "successful",
      startsAt: { $lt: new Date(+now - 30 * 86400000) },
    },
    { ownerState: "expired" },
  );
  const plans = await Activity.find({
    community: { $ne: null },
    ownerState: "live",
    status: "active",
    startsAt: { $gt: now, $lte: new Date(+now + 3600000) },
    communityReminderAt: null,
  })
    .limit(20)
    .select("_id");
  for (const plan of plans)
    await mongoose.connection.transaction(async (session) => {
      const activity = await Activity.findOneAndUpdate(
        {
          _id: plan._id,
          communityReminderAt: null,
          ownerState: "live",
          status: "active",
        },
        { communityReminderAt: now },
        { new: true, session },
      );
      if (!activity) return;
      const attendees = await ActivityInterest.find({
        activity: activity._id,
        status: "accepted",
      }).session(session);
      for (const attendee of attendees)
        await communityNotice(
          activity.community,
          String(attendee.user),
          String(activity.creator),
          `Your plan ${activity.title} starts within an hour. Check the details before heading out.`,
          `reminder:${activity._id}:${attendee.user}`,
          session,
        );
    });
}
