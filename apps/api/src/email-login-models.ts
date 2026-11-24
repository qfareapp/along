import mongoose, { Schema } from "mongoose";

const challenge = new Schema({
  emailKey: { type: String, required: true, unique: true, select: false },
  email: { type: String, select: false },
  requestId: { type: String, required: true, unique: true },
  user: { type: Schema.Types.ObjectId, ref: "User", index: true },
  codeHash: { type: String, select: false },
  attempts: { type: Number, default: 0 },
  consumed: { type: Boolean, default: false },
  signupTokenHash: { type: String, select: false, index: true },
  signupExpiresAt: Date,
  requestedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  windowStartedAt: { type: Date, required: true },
  sendCount: { type: Number, required: true },
  cleanupAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
});
export const EmailLoginChallenge = mongoose.model(
  "EmailLoginChallenge",
  challenge,
);
