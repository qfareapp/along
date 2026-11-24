import mongoose, { Schema } from "mongoose";
const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
});
export const PlanGroup = mongoose.model(
  "PlanGroup",
  new Schema(
    {
      activity: { ...ref("ActivityPost"), unique: true },
      messagingMode: {
        type: String,
        enum: ["everyone", "organiser_only"],
        default: "everyone",
      },
      lastSequence: { type: Number, default: 0 },
      contentRevision: { type: Number, default: 0 },
    },
    { timestamps: true },
  ),
);
const membership = new Schema(
  {
    group: ref("PlanGroup"),
    user: ref("User"),
    joinedAfter: { type: Number, required: true, default: 0 },
    lastReadSequence: { type: Number, required: true, default: 0 },
    removedAt: { type: Date, default: null },
    muted: { type: Boolean, default: false },
  },
  { timestamps: true },
);
membership.index({ group: 1, user: 1 }, { unique: true });
membership.index({ user: 1, group: 1 });
export const PlanGroupMember = mongoose.model("PlanGroupMember", membership);
const message = new Schema(
  {
    group: ref("PlanGroup"),
    sender: ref("User"),
    sequence: { type: Number, required: true },
    text: { type: String, required: true, maxlength: 2000 },
    kind: {
      type: String,
      enum: ["message", "created", "joined", "permissions", "removed"],
      default: "message",
    },
    clientId: { type: String, maxlength: 80 },
    replyTo: { type: Schema.Types.ObjectId, ref: "PlanGroupMessage" },
    pinnedAt: Date,
    deletedAt: Date,
  },
  { timestamps: true },
);
message.index({ group: 1, sequence: -1 }, { unique: true });
message.index(
  { group: 1, sender: 1, clientId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientId: { $type: "string" } },
  },
);
export const PlanGroupMessage = mongoose.model("PlanGroupMessage", message);
const reaction = new Schema(
  {
    message: ref("PlanGroupMessage"),
    user: ref("User"),
    emoji: { type: String, required: true, maxlength: 16 },
  },
  { timestamps: true },
);
reaction.index({ message: 1, user: 1 }, { unique: true });
export const PlanGroupReaction = mongoose.model("PlanGroupReaction", reaction);
