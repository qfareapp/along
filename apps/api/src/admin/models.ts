import mongoose, { Schema } from "mongoose";
const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
});
export const AdminRole = mongoose.model(
  "AdminRole",
  new Schema(
    {
      slug: { type: String, required: true, unique: true },
      name: { type: String, required: true },
      permissions: [String],
    },
    { timestamps: true },
  ),
);
const session = new Schema(
  {
    user: ref("User"),
    authMode: { type: String, enum: ["mfa", "env"], default: "mfa" },
    credentialVersion: String,
    tokenHash: { type: String, required: true, unique: true },
    csrf: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    revokedAt: Date,
  },
  { timestamps: true },
);
session.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
session.index({ user: 1, revokedAt: 1 });
export const AdminSession = mongoose.model("AdminSession", session);
const audit = new Schema(
  {
    admin: { type: Schema.Types.ObjectId, ref: "User" },
    action: { type: String, required: true, immutable: true },
    targetType: String,
    targetId: String,
    reason: { type: String, maxlength: 1500 },
    outcome: { type: String, default: "success" },
    metadata: Schema.Types.Mixed,
    requestId: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
audit.index({ createdAt: -1, _id: -1 });
audit.index({ targetId: 1, createdAt: -1 });
export const AuditLog = mongoose.model("AuditLog", audit);
export const Verification = mongoose.model(
  "Verification",
  new Schema(
    {
      user: ref("User"),
      type: { type: String, enum: ["identity", "age"], required: true },
      providerReference: { type: String, maxlength: 200 },
      status: {
        type: String,
        enum: ["pending", "approved", "rejected", "more_info", "appealed"],
        default: "pending",
      },
      reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
      reason: String,
      expiresAt: Date,
    },
    { timestamps: true },
  ),
);
const setting = new Schema(
  {
    key: { type: String, unique: true, required: true },
    value: { type: Schema.Types.Mixed, required: true },
    version: { type: Number, default: 1 },
    history: [
      {
        version: Number,
        value: Schema.Types.Mixed,
        reason: String,
        admin: { type: Schema.Types.ObjectId, ref: "User" },
        at: Date,
      },
    ],
  },
  { timestamps: true },
);
export const PlatformSetting = mongoose.model("PlatformSetting", setting);
export const SupportTicket = mongoose.model(
  "SupportTicket",
  new Schema(
    {
      user: ref("User"),
      subject: { type: String, required: true, maxlength: 150 },
      text: { type: String, required: true, maxlength: 3000 },
      status: {
        type: String,
        enum: ["open", "in_progress", "resolved"],
        default: "open",
      },
      priority: {
        type: String,
        enum: ["normal", "high", "urgent"],
        default: "normal",
      },
      assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
      replies: [
        {
          text: String,
          internal: { type: Boolean, default: false },
          by: { type: Schema.Types.ObjectId, ref: "User" },
          at: Date,
        },
      ],
    },
    { timestamps: true },
  ),
);
export const CMSContent = mongoose.model(
  "CMSContent",
  new Schema(
    {
      slug: { type: String, unique: true, required: true },
      title: { type: String, required: true },
      body: { type: String, required: true, maxlength: 30000 },
      status: {
        type: String,
        enum: ["draft", "published", "archived"],
        default: "draft",
      },
      version: { type: Number, default: 1 },
      history: [{ title: String, body: String, version: Number, at: Date }],
    },
    { timestamps: true },
  ),
);
