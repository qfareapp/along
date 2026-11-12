import mongoose, { Schema } from "mongoose";

const ref = (model: string) => ({
  type: Schema.Types.ObjectId,
  ref: model,
  required: true,
});
const point = new Schema(
  {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], required: true },
  },
  { _id: false },
);
export const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
    },
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, required: true, maxlength: 60 },
    birthDate: {
      type: Date,
      required: function (this: { adminRole?: string }) {
        return !this.adminRole;
      },
      select: false,
    },
    status: {
      type: String,
      enum: ["active", "suspended", "banned", "deleted"],
      default: "active",
    },
    emailVerified: { type: Boolean, default: false },
    contactCodeHash: { type: String, select: false },
    contactCodeExpiresAt: { type: Date, select: false },
    contactCodeAttempts: { type: Number, default: 0, select: false },
    identityVerified: { type: Boolean, default: false },
    adminRole: { type: String, default: null },
    restrictions: {
      posting: { type: Boolean, default: false },
      messaging: { type: Boolean, default: false },
    },
    sessionVersion: { type: Number, default: 0 },
    lastActiveAt: Date,
    mfaSecretEncrypted: { type: String, select: false },
    mfaLastStep: { type: Number, default: -1, select: false },
    recoveryHashes: { type: [String], select: false },
    failedAdminLogins: { type: Number, default: 0, select: false },
    adminLockedUntil: { type: Date, select: false },
  },
  { timestamps: true },
);
userSchema.index({ adminRole: 1, status: 1, createdAt: -1 });
userSchema.index({ lastActiveAt: -1 });
export const User = mongoose.model("User", userSchema);
export const profileSchema = new Schema(
  {
    user: { ...ref("User"), unique: true },
    bio: { type: String, maxlength: 600 },
    occupation: String,
    city: String,
    area: String,
    country: { type: String, default: "India", maxlength: 80 },
    gender: String,
    interests: [String],
    photos: [String],
    preferences: {
      genders: [String],
      minAge: Number,
      maxAge: Number,
      maxDistanceKm: Number,
      distanceUnit: { type: String, enum: ["km", "mi"], default: "km" },
      intention: String,
    },
    approximateLocation: { type: point, required: false },
    onboardingComplete: { type: Boolean, default: false },
    consents: { termsAt: Date, guidelinesAt: Date, version: String },
    optionalDetails: { type: Map, of: String },
    onboarding: {
      quickStartCompleted: { type: Boolean, default: false },
      currentStep: { type: Number, min: 1, max: 6, default: 1 },
      currentStage: {
        type: String,
        enum: [
          "quick_start",
          "eligibility_pending",
          "profile_incomplete",
          "ready_for_discovery",
        ],
        default: "quick_start",
      },
      vibes: {
        type: [String],
        enum: [
          "coffee_dates",
          "weekend_exploring",
          "fitness_buddies",
          "movies_shows",
          "commute_together",
          "live_events",
          "food_adventures",
          "learn_something",
        ],
      },
      firstPlanIntent: {
        type: String,
        enum: ["do_something", "everyday_person", "just_exploring", null],
        default: null,
      },
      relationshipIntent: {
        type: String,
        enum: ["serious", "meaningful", "casual", "exploring", null],
        default: null,
      },
      personalityPrompt: {
        type: {
          type: String,
          enum: ["perfect_sunday", "get_along", "want_to_try"],
        },
        answer: { type: String, maxlength: 160 },
      },
      startedAt: Date,
      quickStartCompletedAt: Date,
      fullyCompletedAt: Date,
      personalityCompleted: { type: Boolean, default: false },
    },
  },
  { timestamps: true },
);
profileSchema.index({ approximateLocation: "2dsphere" }, { sparse: true });
profileSchema.index({ city: 1, user: 1 });
profileSchema.index({ "onboarding.currentStage": 1 });
export const Profile = mongoose.model("Profile", profileSchema);
const swipeSchema = new Schema(
  {
    user: ref("User"),
    target: ref("User"),
    action: { type: String, enum: ["like", "pass", "save"], required: true },
    notificationReadAt: { type: Date, default: null },
  },
  { timestamps: true },
);
swipeSchema.index({ user: 1, target: 1 }, { unique: true });
swipeSchema.index({ target: 1, action: 1, updatedAt: -1 });
export const ProfileSwipe = mongoose.model("ProfileSwipe", swipeSchema);
export const ProfilePhoto = mongoose.model(
  "ProfilePhoto",
  new Schema(
    {
      owner: { ...ref("User"), index: true },
      bytes: {
        type: Buffer,
        select: false,
        required: function (this: { cloudinaryPublicId?: string }) {
          return !this.cloudinaryPublicId;
        },
      },
      cloudinaryPublicId: { type: String, select: false },
      contentType: { type: String, required: true, enum: ["image/jpeg"] },
    },
    { timestamps: true },
  ),
);
const eventSchema = new Schema(
  {
    user: ref("User"),
    name: { type: String, required: true },
    step: { type: Number, min: 1, max: 6 },
    durationMs: { type: Number, min: 0, max: 86400000 },
    skipped: Boolean,
  },
  { timestamps: true },
);
eventSchema.index({ user: 1, name: 1, step: 1 }, { unique: true });
eventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });
export const OnboardingEvent = mongoose.model("OnboardingEvent", eventSchema);
export const Category = mongoose.model(
  "Category",
  new Schema(
    {
      slug: { type: String, unique: true, required: true },
      name: { type: String, required: true },
      icon: String,
      active: { type: Boolean, default: true },
      description: { type: String, maxlength: 500 },
      coverAssetKey: { type: String, maxlength: 50 },
      coverImageUrl: { type: String, maxlength: 2000 },
      displayOrder: { type: Number, default: 0 },
      cities: [String],
      riskLevel: {
        type: String,
        enum: ["low", "medium", "high"],
        default: "low",
      },
      allowedTypes: { type: [String], default: ["need", "offer", "together"] },
      moderationRequired: { type: Boolean, default: false },
    },
    { timestamps: true },
  ),
);
export const activitySchema = new Schema(
  {
    creator: ref("User"),
    visibility: {
      type: String,
      enum: ["public", "private"],
      default: "public",
    },
    type: { type: String, enum: ["need", "offer", "together"], required: true },
    category: { type: String, required: true },
    title: { type: String, required: true, maxlength: 100 },
    description: { type: String, required: true, maxlength: 1500 },
    highlight: { type: String, maxlength: 120 },
    categoryDetails: { type: Schema.Types.Mixed, default: undefined },
    audience: {
      type: new Schema(
        {
          minAge: { type: Number, min: 18, max: 120, required: true },
          maxAge: { type: Number, min: 18, max: 120, required: true },
          gender: {
            type: String,
            enum: ["male", "female", "both"],
            required: true,
          },
          maxDistanceKm: { type: Number, min: 1, max: 500, default: null },
          distanceUnit: { type: String, enum: ["km", "mi"], default: "km" },
        },
        { _id: false },
      ),
      default: undefined,
    },
    ownerState: {
      type: String,
      enum: ["live", "paused", "successful", "closed", "expired"],
      default: "live",
    },
    endsAt: Date,
    schedule: {
      type: new Schema(
        {
          dateMode: { type: String, enum: ["exact", "range"] },
          timeMode: { type: String, enum: ["exact", "range"] },
        },
        { _id: false },
      ),
      default: undefined,
    },
    activityType: {
      type: String,
      enum: ["one_on_one", "group"],
      default: "one_on_one",
    },
    capacity: { type: Number, min: 1, max: 100 },
    participants: [{ type: Schema.Types.ObjectId, ref: "User" }],
    zone: { type: String, required: true },
    startsAt: { type: Date, required: true },
    recurring: { type: Boolean, default: false },
    budget: { type: String, maxlength: 200 },
    approximateLocation: { type: point, required: false },
    status: {
      type: String,
      enum: ["active", "paused", "deleted"],
      default: "active",
    },
  },
  { timestamps: true },
);
activitySchema.index({ approximateLocation: "2dsphere" }, { sparse: true });
activitySchema.index({ status: 1, category: 1, _id: -1 });
activitySchema.index({ status: 1, category: 1, startsAt: 1, _id: 1 });
activitySchema.index({ creator: 1, status: 1 });
export const Activity = mongoose.model("ActivityPost", activitySchema);
const interestSchema = new Schema(
  {
    activity: ref("ActivityPost"),
    user: ref("User"),
    readAt: Date,
    status: {
      type: String,
      enum: ["pending", "accepted", "declined"],
      default: "pending",
    },
    responseReadAt: Date,
    conversation: { type: Schema.Types.ObjectId, ref: "Conversation" },
  },
  { timestamps: true },
);
interestSchema.index({ activity: 1, user: 1 }, { unique: true });
interestSchema.index({ user: 1, status: 1, _id: -1 });
export const ActivityInterest = mongoose.model(
  "ActivityInterest",
  interestSchema,
);
const activitySaveSchema = new Schema(
  { activity: ref("ActivityPost"), user: ref("User") },
  { timestamps: true },
);
activitySaveSchema.index({ user: 1, activity: 1 }, { unique: true });
export const ActivitySave = mongoose.model("ActivitySave", activitySaveSchema);
const matchSchema = new Schema(
  {
    users: [{ type: Schema.Types.ObjectId, ref: "User" }],
    pairKey: { type: String, unique: true, required: true },
    activity: { ...ref("ActivityPost"), required: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export const Match = mongoose.model("Match", matchSchema);
export const Conversation = mongoose.model(
  "Conversation",
  new Schema(
    {
      match: { ...ref("Match"), unique: true },
      firstSender: { type: Schema.Types.ObjectId, ref: "User" },
    },
    { timestamps: true },
  ),
);
const messageSchema = new Schema(
  {
    conversation: ref("Conversation"),
    sender: ref("User"),
    text: { type: String, default: "", maxlength: 2000 },
    attachment: {
      kind: { type: String, enum: ["image", "file"] },
      asset: { type: String, select: false },
      name: { type: String, maxlength: 160 },
      mimeType: { type: String, maxlength: 120 },
      size: Number,
    },
    socialMoment: { type: Schema.Types.ObjectId, ref: "SocialMoment" },
    socialKind: { type: String, enum: ["reply", "share"] },
    gameInvitation: { type: Schema.Types.ObjectId, ref: "GameInvitation" },
    gameSession: { type: Schema.Types.ObjectId, ref: "GameSession" },
    gameEvent: String,
    gameEventKey: String,
    readAt: Date,
  },
  { timestamps: true },
);
messageSchema.index({ conversation: 1, _id: -1 });
messageSchema.index({ gameEventKey: 1 }, { unique: true, sparse: true });
messageSchema.index({ socialMoment: 1, createdAt: -1 }, { sparse: true });
export const Message = mongoose.model("Message", messageSchema);
const blockSchema = new Schema(
  { user: ref("User"), target: ref("User") },
  { timestamps: true },
);
blockSchema.index({ user: 1, target: 1 }, { unique: true });
export const Block = mongoose.model("Block", blockSchema);
export const Report = mongoose.model(
  "Report",
  new Schema(
    {
      reporter: ref("User"),
      activity: { ...ref("ActivityPost"), required: false },
      moment: {
        type: Schema.Types.ObjectId,
        ref: "SocialMoment",
        index: true,
        sparse: true,
      },
      target: ref("User"),
      reason: { type: String, required: true, maxlength: 1500 },
      status: { type: String, default: "pending" },
      severity: {
        type: String,
        enum: ["low", "medium", "high", "critical"],
        default: "medium",
      },
      assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
      notes: [
        {
          text: String,
          by: { type: Schema.Types.ObjectId, ref: "User" },
          at: Date,
        },
      ],
    },
    { timestamps: true },
  ),
);
const sessionSchema = new Schema(
  {
    user: ref("User"),
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const RefreshSession = mongoose.model("RefreshSession", sessionSchema);
