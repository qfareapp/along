import mongoose, { Schema } from "mongoose";
const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
});
const options = { timestamps: true } as const;
const community = new Schema(
  {
    name: { type: String, required: true, maxlength: 60 },
    slug: { type: String, required: true, unique: true },
    description: { type: String, required: true, maxlength: 1000 },
    category: { type: String, required: true },
    icon: { type: String, default: "people-outline" },
    coverImage: { type: String, maxlength: 1000 },
    rules: {
      type: String,
      default:
        "Be respectful. No harassment, spam or sharing private information. Meet in public and report unsafe behaviour.",
      maxlength: 4000,
    },
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
      index: true,
    },
    visibility: { type: String, enum: ["public", "hidden"], default: "public" },
    maxActivePlans: { type: Number, default: 3, min: 1, max: 50 },
    messageRateLimit: { type: Number, default: 20, min: 1, max: 60 },
    memberCount: { type: Number, default: 0, min: 0 },
    lastSequence: { type: Number, default: 0 },
    revision: { type: Number, default: 0 },
    contentRevision: { type: Number, default: 0 },
  },
  options,
);
export const Community = mongoose.model("Community", community);
const membership = new Schema(
  {
    community: ref("Community"),
    user: ref("User"),
    status: {
      type: String,
      enum: ["active", "left", "suspended", "banned"],
      default: "active",
    },
    role: {
      type: String,
      enum: ["member", "moderator", "admin"],
      default: "member",
    },
    joinedAt: { type: Date, default: Date.now },
    joinedAfter: { type: Number, default: 0 },
    lastReadSequence: { type: Number, default: 0 },
    muted: { type: Boolean, default: false },
    mutedUntil: Date,
  },
  options,
);
membership.index({ community: 1, user: 1 }, { unique: true });
membership.index({ user: 1, status: 1, community: 1 });
membership.index({ community: 1, status: 1, _id: 1 });
export const CommunityMembership = mongoose.model(
  "CommunityMembership",
  membership,
);
const message = new Schema(
  {
    community: ref("Community"),
    sender: ref("User"),
    text: { type: String, required: true, maxlength: 2000 },
    clientId: { type: String, required: true, maxlength: 100 },
    sequence: { type: Number, required: true },
    replyTo: { type: Schema.Types.ObjectId, ref: "CommunityMessage" },
    deletedAt: Date,
    pinnedAt: Date,
  },
  options,
);
message.index({ community: 1, sequence: -1 }, { unique: true });
message.index({ community: 1, sender: 1, clientId: 1 }, { unique: true });
export const CommunityMessage = mongoose.model("CommunityMessage", message);
const reaction = new Schema(
  {
    message: ref("CommunityMessage"),
    user: ref("User"),
    emoji: { type: String, required: true, maxlength: 16 },
  },
  options,
);
reaction.index({ message: 1, user: 1 }, { unique: true });
export const CommunityReaction = mongoose.model("CommunityReaction", reaction);
export const CommunityModerationAction = mongoose.model(
  "CommunityModerationAction",
  new Schema(
    {
      community: ref("Community"),
      moderator: ref("User"),
      targetUser: { type: Schema.Types.ObjectId, ref: "User" },
      message: { type: Schema.Types.ObjectId, ref: "CommunityMessage" },
      action: { type: String, required: true },
      reason: { type: String, required: true, maxlength: 1500 },
    },
    options,
  ),
);
const notice = new Schema(
  {
    community: ref("Community"),
    recipient: ref("User"),
    actor: ref("User"),
    key: { type: String, unique: true, required: true },
    text: { type: String, required: true, maxlength: 300 },
    readAt: Date,
  },
  options,
);
notice.index({ recipient: 1, _id: -1 });
notice.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });
export const CommunityNotice = mongoose.model("CommunityNotice", notice);
