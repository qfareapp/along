import mongoose, { Schema } from "mongoose";

type AirportRecord = {
  sourceId: string;
  name: string;
  city?: string;
  iataCode?: string;
  icaoCode?: string;
  type?: string;
  countryCode: string;
  scheduledService?: boolean;
  location: { type: "Point"; coordinates: number[] };
  enabled: boolean;
  timezone: string;
  radiusM: number;
  boundary?: number[][];
  zones: { id: string; name: string; compatibleWith: string[] }[];
  configurationSource?: string;
  createdAt: Date;
  updatedAt: Date;
};
const airportSchema = new Schema<AirportRecord>(
  {
    sourceId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    city: String,
    iataCode: String,
    icaoCode: String,
    type: String,
    countryCode: { type: String, default: "IN" },
    scheduledService: Boolean,
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: [Number],
    },
    enabled: { type: Boolean, default: false },
    timezone: { type: String, default: "Asia/Kolkata" },
    // Reference-point proximity is approximate; it is never proof of terminal access.
    radiusM: { type: Number, default: 500 },
    boundary: { type: [[Number]], default: undefined },
    zones: [{ _id: false, id: String, name: String, compatibleWith: [String] }],
    configurationSource: String,
  },
  { timestamps: true },
);
airportSchema.index({ location: "2dsphere" });
export const Airport = mongoose.model("Airport", airportSchema);

const sessionSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    airport: { type: Schema.Types.ObjectId, ref: "Airport", required: true },
    visitId: { type: String, required: true },
    zoneId: { type: String, required: true },
    intentions: [String],
    status: { type: String, enum: ["active", "ended"], default: "active" },
    availableUntil: { type: Date, required: true },
    presenceUntil: { type: Date, required: true },
    outsideSince: Date,
    endedAt: Date,
    // No precise user coordinates are persisted.
  },
  { timestamps: true },
);
sessionSchema.index({
  airport: 1,
  status: 1,
  presenceUntil: 1,
  availableUntil: 1,
});
sessionSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 7 * 86400 });
export const AirportSession = mongoose.model("AirportSession", sessionSchema);

const connectionSchema = new Schema(
  {
    pairKey: { type: String, required: true },
    visitKey: { type: String, required: true, unique: true },
    users: [{ type: Schema.Types.ObjectId, ref: "User" }],
    visits: [String],
    airport: { type: Schema.Types.ObjectId, ref: "Airport", required: true },
    actor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    intent: { type: String, required: true },
    state: {
      type: String,
      enum: ["pending", "connected", "ended", "persistent"],
      default: "pending",
    },
    validUntil: { type: Date, required: true },
    decisionUntil: { type: Date, required: true },
    // One vote per participant, updated atomically in a transaction.
    keep: [{ type: Schema.Types.ObjectId, ref: "User" }],
    conversation: { type: Schema.Types.ObjectId, ref: "Conversation" },
  },
  { timestamps: true },
);
connectionSchema.index({ users: 1, state: 1, decisionUntil: 1 });
connectionSchema.index({ state: 1, updatedAt: 1 });
export const AirportConnection = mongoose.model(
  "AirportConnection",
  connectionSchema,
);

const noticeSchema = new Schema(
  {
    eventKey: { type: String, required: true, unique: true },
    recipient: { type: Schema.Types.ObjectId, ref: "User", required: true },
    actor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    connection: {
      type: Schema.Types.ObjectId,
      ref: "AirportConnection",
      required: true,
    },
    kind: {
      type: String,
      enum: ["keep", "connected", "ended"],
      required: true,
    },
    presentedAt: Date,
    readAt: Date,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
noticeSchema.index({ recipient: 1, createdAt: -1 });
noticeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AirportNotice = mongoose.model("AirportNotice", noticeSchema);
