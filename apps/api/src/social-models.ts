import mongoose, { Schema } from "mongoose";
const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
});
const options = { timestamps: true } as const;
const moment = new Schema(
  {
    author: ref("User"),
    type: {
      type: String,
      enum: ["text", "photo", "question", "along_now"],
      required: true,
    },
    text: { type: String, maxlength: 600, default: "" },
    caption: { type: String, maxlength: 500, default: "" },
    theme: {
      type: String,
      enum: ["teal", "coral", "peach", "night"],
      default: "teal",
    },
    media: { type: String, select: false },
    audience: {
      type: String,
      enum: ["matches", "discover", "close_circle", "only_me"],
      default: "matches",
    },
    allowed: [{ type: Schema.Types.ObjectId, ref: "User" }],
    excluded: [{ type: Schema.Types.ObjectId, ref: "User" }],
    allowReshare: { type: Boolean, default: false },
    category: String,
    publishedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["active", "expired", "removed"],
      default: "active",
    },
  },
  options,
);
moment.index({ author: 1, status: 1, expiresAt: 1, _id: -1 });
moment.index({ status: 1, expiresAt: 1 });
export const SocialMoment = mongoose.model("SocialMoment", moment);
const reaction = new Schema(
  {
    moment: ref("SocialMoment"),
    user: ref("User"),
    emoji: { type: String, required: true },
  },
  options,
);
reaction.index({ moment: 1, user: 1 }, { unique: true });
export const MomentReaction = mongoose.model("MomentReaction", reaction);
const view = new Schema(
  {
    moment: ref("SocialMoment"),
    user: ref("User"),
    visible: { type: Boolean, default: true },
  },
  options,
);
view.index({ moment: 1, user: 1 }, { unique: true });
export const MomentView = mongoose.model("MomentView", view);
const settings = new Schema(
  {
    user: { ...ref("User"), unique: true },
    enabled: { type: Boolean, default: true },
    audience: {
      type: String,
      enum: ["matches", "discover", "close_circle", "only_me"],
      default: "matches",
    },
    closeCircle: [{ type: Schema.Types.ObjectId, ref: "User" }],
    hidden: [{ type: Schema.Types.ObjectId, ref: "User" }],
    muted: [{ type: Schema.Types.ObjectId, ref: "User" }],
    allowReshare: { type: Boolean, default: false },
    viewReceipts: { type: Boolean, default: true },
    archive: { type: Boolean, default: true },
    notifications: { type: Boolean, default: true },
  },
  options,
);
export const SocialSettings = mongoose.model("SocialSettings", settings);
const notification = new Schema(
  {
    recipient: ref("User"),
    actor: ref("User"),
    moment: { ...ref("SocialMoment"), required: false },
    invitation: { type: Schema.Types.ObjectId, ref: "PlanInvitation" },
    kind: {
      type: String,
      enum: [
        "moment",
        "reaction",
        "reply",
        "shared",
        "invitation",
        "accepted",
        "changes",
      ],
      required: true,
    },
    key: { type: String, required: true, unique: true },
    readAt: Date,
  },
  options,
);
notification.index({ recipient: 1, _id: -1 });
notification.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });
export const SocialNotification = mongoose.model(
  "SocialNotification",
  notification,
);
const invitation = new Schema(
  {
    moment: ref("SocialMoment"),
    proposer: ref("User"),
    recipient: ref("User"),
    title: { type: String, required: true, maxlength: 100 },
    category: { type: String, required: true },
    zone: { type: String, required: true, maxlength: 100 },
    startsAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined"],
      default: "pending",
    },
    version: { type: Number, default: 0 },
    activity: { type: Schema.Types.ObjectId, ref: "ActivityPost" },
  },
  options,
);
invitation.index({ recipient: 1, _id: -1 });
invitation.index({ proposer: 1, _id: -1 });
export const PlanInvitation = mongoose.model("PlanInvitation", invitation);
