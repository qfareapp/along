import mongoose, { Schema } from "mongoose";
const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
});
export const playCategories = [
  "lifestyle",
  "food",
  "travel",
  "entertainment",
  "connection",
] as const;
export const GameDefinition = mongoose.model(
  "GameDefinition",
  new Schema(
    {
      key: { type: String, unique: true, required: true },
      active: { type: Boolean, default: true },
      questionsPerCategory: { type: Number, default: 3, min: 1, max: 5 },
      invitationMinutes: { type: Number, default: 30, min: 5, max: 120 },
      inactivityMinutes: { type: Number, default: 30, min: 5, max: 120 },
    },
    { timestamps: true },
  ),
);
export const GameQuestion = mongoose.model(
  "GameQuestion",
  new Schema(
    {
      key: { type: String, unique: true, required: true },
      category: { type: String, enum: playCategories, required: true },
      text: { type: String, required: true, maxlength: 200 },
      optionA: { type: String, required: true, maxlength: 80 },
      optionB: { type: String, required: true, maxlength: 80 },
      active: { type: Boolean, default: true },
      tone: { type: String, default: "playful", maxlength: 40 },
    },
    { timestamps: true },
  ),
);
const invitation = new Schema(
  {
    host: ref("User"),
    conversation: { type: Schema.Types.ObjectId, ref: "Conversation" },
    recipient: { type: Schema.Types.ObjectId, ref: "User" },
    caption: {
      type: String,
      default: "Want to discover your vibe together?",
      maxlength: 200,
    },
    status: {
      type: String,
      enum: ["open", "accepted", "declined", "cancelled", "expired"],
      default: "open",
    },
    expiresAt: { type: Date, default: null },
    session: { type: Schema.Types.ObjectId, ref: "GameSession" },
    acceptedRequest: { type: Schema.Types.ObjectId, ref: "GamePlayRequest" },
    rematchOf: { type: Schema.Types.ObjectId, ref: "GameSession" },
  },
  { timestamps: true },
);
invitation.index({ host: 1, status: 1, expiresAt: 1 });
invitation.index(
  { conversation: 1 },
  {
    unique: true,
    partialFilterExpression: {
      conversation: { $type: "objectId" },
      status: "open",
    },
  },
);
invitation.index(
  { rematchOf: 1 },
  {
    unique: true,
    partialFilterExpression: {
      rematchOf: { $type: "objectId" },
      status: "open",
    },
  },
);
export const GameInvitation = mongoose.model("GameInvitation", invitation);
const playRequest = new Schema(
  {
    invitation: ref("GameInvitation"),
    user: ref("User"),
    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "unavailable"],
      default: "pending",
    },
  },
  { timestamps: true },
);
playRequest.index({ invitation: 1, user: 1 }, { unique: true });
export const GamePlayRequest = mongoose.model("GamePlayRequest", playRequest);
const snapshot = new Schema(
  {
    questionId: ref("GameQuestion"),
    category: { type: String, required: true },
    text: { type: String, required: true },
    optionA: { type: String, required: true },
    optionB: { type: String, required: true },
  },
  { _id: false },
);
const answer = new Schema(
  {
    player: ref("User"),
    questionIndex: { type: Number, required: true },
    choice: { type: String, enum: ["A", "B"], required: true },
    submittedAt: { type: Date, required: true },
  },
  { _id: false },
);
const session = new Schema(
  {
    invitation: { ...ref("GameInvitation"), unique: true },
    players: [{ type: Schema.Types.ObjectId, ref: "User" }],
    conversation: ref("Conversation"),
    status: {
      type: String,
      enum: ["waiting", "playing", "completed", "abandoned", "cancelled"],
      default: "waiting",
    },
    ready: [{ type: Schema.Types.ObjectId, ref: "User" }],
    startsAt: Date,
    completedAt: Date,
    currentQuestionIndex: { type: Number, default: 0 },
    questions: { type: [snapshot], required: true },
    answers: { type: [answer], select: false, default: [] },
    result: {
      score: Number,
      matchedAnswers: Number,
      totalQuestions: Number,
      categoryScores: { type: Map, of: Number },
      label: String,
    },
    lastActionAt: { type: Date, default: Date.now },
    inactivityMinutes: { type: Number, default: 30 },
  },
  { timestamps: true, optimisticConcurrency: true },
);
session.index({ players: 1, updatedAt: -1 });
export const GameSession = mongoose.model("GameSession", session);
