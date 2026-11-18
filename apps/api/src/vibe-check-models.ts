import mongoose, { Schema } from "mongoose";

const question = new Schema({
  id: { type: String, required: true },
  prompt: { type: String, required: true, maxlength: 180 },
  options: [{ type: String, maxlength: 80 }],
  answer: { type: Number, required: true, select: false },
}, { _id: false });
const check = new Schema({
  owner: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  enabled: { type: Boolean, default: false },
  autoMatch: { type: Boolean, default: false },
  threshold: { type: Number, min: 0, max: 100, default: 60 },
  revision: { type: Number, required: true, default: 1 },
  serial: { type: Number, default: 0 },
  questions: [question],
}, { timestamps: true });
export const VibeCheck = mongoose.model("VibeCheck", check);

const attempt = new Schema({
  owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
  visitor: { type: Schema.Types.ObjectId, ref: "User", required: true },
  revision: { type: Number, required: true },
  // Saved privately for audit/retries. Public DTOs never serialize these fields.
  answers: [{ id: String, choice: Number, _id: false }],
  matches: { type: Number, required: true },
  total: { type: Number, required: true },
  threshold: { type: Number, required: true },
  passed: { type: Boolean, required: true },
  status: { type: String, enum: ["failed", "pending", "matched", "declined"], required: true },
  conversation: { type: Schema.Types.ObjectId, ref: "Conversation" },
  ownerReadAt: Date,
  visitorReadAt: Date,
}, { timestamps: true });
attempt.index({ owner: 1, visitor: 1, revision: 1 }, { unique: true });
attempt.index({ owner: 1, createdAt: -1 });
attempt.index({ visitor: 1, updatedAt: -1 });
export const VibeAttempt = mongoose.model("VibeAttempt", attempt);
