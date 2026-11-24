import crypto from "node:crypto";
import { EmailLoginChallenge } from "./email-login-models.js";
import mongoose, { Schema } from "mongoose";
import {
  User,
  Profile,
  ProfilePhoto,
  ProfileSwipe,
  OnboardingEvent,
  Activity,
  ActivityInterest,
  ActivitySave,
  Match,
  Message,
  Block,
  RefreshSession,
  Report,
} from "./models.js";
import { VibeCheck, VibeAttempt } from "./vibe-check-models.js";
import {
  SocialMoment,
  MomentReaction,
  MomentView,
  SocialSettings,
  SocialNotification,
  PlanInvitation,
} from "./social-models.js";
import { GameInvitation, GamePlayRequest, GameSession } from "./play-models.js";
import {
  PlanGroup,
  PlanGroupMember,
  PlanGroupMessage,
  PlanGroupReaction,
} from "./plan-group-models.js";
import {
  AirportSession,
  AirportConnection,
  AirportNotice,
} from "./airport-models.js";
import { PushDevice, PushJob } from "./push.js";
import { Verification, SupportTicket } from "./admin/models.js";
import { removeChatAttachment } from "./chat-storage.js";
import {
  Community,
  CommunityMembership,
  CommunityMessage,
  CommunityReaction,
  CommunityNotice,
} from "./community-models.js";
import { communityEvents } from "./community-service.js";

const day = 86400000;
const mediaSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    asset: { type: String, required: true, select: false },
    attempts: { type: Number, default: 0 },
    availableAt: { type: Date, default: Date.now },
    leaseUntil: { type: Date, default: () => new Date(0) },
  },
  { timestamps: true },
);
mediaSchema.index({ availableAt: 1, leaseUntil: 1 });
export const MediaDeletion = mongoose.model("MediaDeletion", mediaSchema);
// Sweep again for a day to remove writes already in flight when sessions were revoked.
const deletionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, required: true, unique: true },
    requestedAt: { type: Date, required: true },
    nextSweepAt: { type: Date, required: true },
    sweepUntil: { type: Date, required: true },
  },
  { timestamps: true },
);
export const AccountDeletion = mongoose.model(
  "AccountDeletion",
  deletionSchema,
);

export async function queueAsset(
  asset: string,
  session: mongoose.ClientSession,
) {
  if (!asset) return;
  await MediaDeletion.updateOne(
    { key: crypto.createHash("sha256").update(asset).digest("hex") },
    { $setOnInsert: { asset } },
    { upsert: true, session },
  );
}

/** Re-entrant and atomic: storage keys are durably queued before records disappear. */
export async function eraseAccount(userId: string, now = new Date()) {
  await mongoose.connection.transaction(async (session) => {
    const user = await User.findOne({ _id: userId, adminRole: null }).session(
      session,
    );
    if (!user) return;
    const first = user.status !== "deleted";
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          status: "deleted",
          name: "Deleted member",
          email: `${user._id}@deleted.invalid`,
          passwordHash: "deleted",
          emailVerified: false,
          identityVerified: false,
        },
        ...(first ? { $inc: { sessionVersion: 1 } } : {}),
        $unset: {
          birthDate: 1,
          lastActiveAt: 1,
          contactCodeHash: 1,
          contactCodeExpiresAt: 1,
          contactCodeAttempts: 1,
          passwordResetHash: 1,
          passwordResetExpiresAt: 1,
          passwordResetRequestedAt: 1,
          passwordResetAttempts: 1,
          mfaSecretEncrypted: 1,
          recoveryHashes: 1,
        },
      },
      { session },
    );
    await AccountDeletion.updateOne(
      { user: user._id },
      {
        $setOnInsert: {
          requestedAt: now,
          nextSweepAt: new Date(+now + 60000),
          sweepUntil: new Date(+now + day),
        },
      },
      { upsert: true, session },
    );

    const photos = await ProfilePhoto.find({ owner: user._id })
      .select("+cloudinaryPublicId")
      .session(session);
    const moments = await SocialMoment.find({ author: user._id })
      .select("+media")
      .session(session);
    const messages = await Message.find({ sender: user._id })
      .select("+attachment.asset")
      .session(session);
    for (const photo of photos)
      if (photo.cloudinaryPublicId)
        await queueAsset(`cloudinary:${photo.cloudinaryPublicId}`, session);
    for (const moment of moments)
      if (moment.media) await queueAsset(moment.media, session);
    for (const message of messages)
      if (message.attachment?.asset)
        await queueAsset(message.attachment.asset, session);
    const momentIds = moments.map((m) => m._id);
    const planIds = await Activity.find({ creator: user._id })
      .session(session)
      .distinct("_id");
    const groupIds = await PlanGroup.find({ activity: { $in: planIds } })
      .session(session)
      .distinct("_id");
    const gameSessionIds = await GameSession.find({ players: user._id })
      .session(session)
      .distinct("_id");
    const gameIds = await GameInvitation.find({
      $or: [
        { host: user._id },
        { recipient: user._id },
        { session: { $in: gameSessionIds } },
      ],
    })
      .session(session)
      .distinct("_id");

    // Keep shared referential tombstones without personal text, location or credentials.
    await Activity.updateMany(
      { creator: user._id },
      {
        $set: {
          status: "deleted",
          ownerState: "closed",
          title: "Deleted plan",
          description: "",
          zone: "",
          budget: "",
          participants: [],
        },
        $unset: {
          approximateLocation: 1,
          categoryDetails: 1,
          audience: 1,
          highlight: 1,
        },
      },
      { session },
    );
    await Activity.updateMany(
      { participants: user._id },
      { $pull: { participants: user._id } },
      { session },
    );
    await Match.updateMany(
      { users: user._id },
      { $set: { active: false } },
      { session },
    );
    await AirportConnection.updateMany(
      { users: user._id },
      { $set: { state: "ended", keep: [] } },
      { session },
    );
    await SocialSettings.updateMany(
      {},
      { $pull: { closeCircle: user._id, hidden: user._id, muted: user._id } },
      { session },
    );
    await SocialMoment.updateMany(
      {},
      { $pull: { allowed: user._id, excluded: user._id } },
      { session },
    );
    await Message.updateMany(
      { socialMoment: { $in: momentIds } },
      { $unset: { socialMoment: 1, socialKind: 1 } },
      { session },
    );
    // No full account, password, birth date or media is retained as "safety evidence".
    await Report.updateMany(
      { $or: [{ reporter: user._id }, { target: user._id }] },
      {
        $set: { expiresAt: new Date(+now + 180 * day) },
      },
      { session },
    );

    // Sequential operations are required inside a MongoDB transaction.
    const communityMemberships = await CommunityMembership.find({
      user: user._id,
      status: "active",
    }).session(session);
    for (const member of communityMemberships)
      await Community.updateOne(
        { _id: member.community },
        { $inc: { memberCount: -1, revision: 1 } },
        { session },
      );
    const communityMessages = await CommunityMessage.find({ sender: user._id })
      .session(session)
      .distinct("_id");
    await CommunityReaction.deleteMany(
      { $or: [{ user: user._id }, { message: { $in: communityMessages } }] },
      { session },
    );
    await CommunityMessage.deleteMany({ sender: user._id }, { session });
    await CommunityMembership.deleteMany({ user: user._id }, { session });
    await CommunityNotice.deleteMany(
      { $or: [{ recipient: user._id }, { actor: user._id }] },
      { session },
    );
    await EmailLoginChallenge.deleteMany({ user: user._id }, { session });
    await RefreshSession.deleteMany({ user: user._id }, { session });
    await PushDevice.deleteMany({ user: user._id }, { session });
    await PushJob.deleteMany(
      { $or: [{ user: user._id }, { actor: user._id }] },
      { session },
    );
    await ProfilePhoto.deleteMany({ owner: user._id }, { session });
    await Profile.deleteMany({ user: user._id }, { session });
    await ProfileSwipe.deleteMany(
      { $or: [{ user: user._id }, { target: user._id }] },
      { session },
    );
    await OnboardingEvent.deleteMany({ user: user._id }, { session });
    await VibeCheck.deleteMany({ owner: user._id }, { session });
    await VibeAttempt.deleteMany(
      { $or: [{ owner: user._id }, { visitor: user._id }] },
      { session },
    );
    await Message.deleteMany({ sender: user._id }, { session });
    await ActivityInterest.deleteMany(
      { $or: [{ user: user._id }, { activity: { $in: planIds } }] },
      { session },
    );
    await ActivitySave.deleteMany(
      { $or: [{ user: user._id }, { activity: { $in: planIds } }] },
      { session },
    );
    await SocialMoment.deleteMany({ author: user._id }, { session });
    await MomentReaction.deleteMany(
      { $or: [{ user: user._id }, { moment: { $in: momentIds } }] },
      { session },
    );
    await MomentView.deleteMany(
      { $or: [{ user: user._id }, { moment: { $in: momentIds } }] },
      { session },
    );
    await SocialSettings.deleteMany({ user: user._id }, { session });
    await SocialNotification.deleteMany(
      { $or: [{ recipient: user._id }, { actor: user._id }] },
      { session },
    );
    await PlanInvitation.deleteMany(
      { $or: [{ proposer: user._id }, { recipient: user._id }] },
      { session },
    );
    await GameSession.deleteMany({ players: user._id }, { session });
    await GameInvitation.deleteMany(
      {
        $or: [{ _id: { $in: gameIds } }, { session: { $in: gameSessionIds } }],
      },
      { session },
    );
    await GamePlayRequest.deleteMany(
      { $or: [{ user: user._id }, { invitation: { $in: gameIds } }] },
      { session },
    );
    const removedGroupMessages = await PlanGroupMessage.find({
      $or: [{ sender: user._id }, { group: { $in: groupIds } }],
    })
      .session(session)
      .distinct("_id");
    await PlanGroupReaction.deleteMany(
      { $or: [{ user: user._id }, { message: { $in: removedGroupMessages } }] },
      { session },
    );
    await PlanGroupMessage.deleteMany(
      { $or: [{ sender: user._id }, { group: { $in: groupIds } }] },
      { session },
    );
    // System announcements may include the deleted member's name; remove those too.
    await PlanGroupMessage.deleteMany(
      {
        kind: { $ne: "message" },
        group: {
          $in: await PlanGroupMember.find({ user: user._id })
            .session(session)
            .distinct("group"),
        },
      },
      { session },
    );
    await PlanGroupMember.deleteMany(
      { $or: [{ user: user._id }, { group: { $in: groupIds } }] },
      { session },
    );
    await PlanGroup.deleteMany({ _id: { $in: groupIds } }, { session });
    await AirportSession.deleteMany({ user: user._id }, { session });
    await AirportNotice.deleteMany(
      { $or: [{ recipient: user._id }, { actor: user._id }] },
      { session },
    );
    await Verification.deleteMany({ user: user._id }, { session });
    await SupportTicket.deleteMany({ user: user._id }, { session });
    await Block.deleteMany(
      { $or: [{ user: user._id }, { target: user._id }] },
      { session },
    );
  });
  communityEvents.emit("privacy-changed");
}

export async function cleanupDeletedAccounts(
  now = new Date(),
  remove = removeChatAttachment,
) {
  const tasks = await AccountDeletion.find({
    nextSweepAt: { $lte: now },
  }).limit(10);
  for (const task of tasks) {
    // Never purge an active account, including one restored incorrectly by an operator.
    try {
      if (await User.exists({ _id: task.user, status: "deleted" }))
        await eraseAccount(String(task.user), task.requestedAt);
    } catch {
      console.error(
        "Account cleanup could not finish; it remains queued for retry.",
      );
      continue;
    }
    if (task.sweepUntil <= now)
      await AccountDeletion.deleteOne({ _id: task._id });
    else
      await AccountDeletion.updateOne(
        { _id: task._id },
        { nextSweepAt: new Date(+now + 60000) },
      );
  }
  for (let i = 0; i < 20; i++) {
    const job = await MediaDeletion.findOneAndUpdate(
      { availableAt: { $lte: now }, leaseUntil: { $lte: now } },
      { $set: { leaseUntil: new Date(+now + 120000) }, $inc: { attempts: 1 } },
      { new: true },
    ).select("+asset");
    if (!job) break;
    try {
      await remove(job.asset);
      await MediaDeletion.deleteOne({
        _id: job._id,
        leaseUntil: job.leaseUntil,
      });
    } catch {
      if (job.attempts === 1 || job.attempts % 5 === 0)
        console.error(
          "Media removal failed; the private deletion job remains queued for retry.",
        );
      await MediaDeletion.updateOne(
        { _id: job._id, leaseUntil: job.leaseUntil },
        {
          $set: {
            leaseUntil: new Date(0),
            availableAt: new Date(
              +now + Math.min(3600000, 60000 * 2 ** Math.min(job.attempts, 6)),
            ),
          },
        },
      );
    }
  }
  await Report.deleteMany({ expiresAt: { $lte: now } });
}
