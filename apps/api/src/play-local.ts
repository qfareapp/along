/** Isolated local test accounts. Never imported by the production entry point. */
import crypto from "node:crypto";
import path from "node:path";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import sharp from "sharp";
import { MongoMemoryReplSet } from "mongodb-memory-server";

if (process.env.NODE_ENV === "production")
  throw new Error("Local test accounts are prohibited in production.");
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.ADMIN_AUTH_MODE = "env";
process.env.ADMIN_EMAIL = "local-play-admin@example.test";
process.env.ADMIN_PASSWORD = crypto.randomBytes(32).toString("hex");
process.env.ADMIN_ORIGIN = "http://localhost:3000";
process.env.EMAIL_VERIFICATION_REQUIRED = "false";
process.env.PHOTO_STORAGE = "mongodb";
process.env.CORS_ORIGINS = "http://localhost:18098,http://127.0.0.1:18098";
process.env.TRUST_PROXY_HOPS = "1";
const database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
process.env.MONGODB_URI = database.getUri();
const { createApp } = await import("./app.js");
const { User, ProfilePhoto, Message, Conversation, Match } =
  await import("./models.js");
const { GameInvitation } = await import("./play-models.js");
const { initializePlay } = await import("./play-bank.js");
const { seedCategories } = await import("./categories.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const { ensureMatch } = await import("./chat.js");
const { attachPlaySockets } = await import("./play-sockets.js");
await mongoose.connect(database.getUri());
await Promise.all([
  Message.init(),
  Conversation.init(),
  Match.init(),
  GameInvitation.init(),
]);
await initializePlay();
await seedCategories();
const members: string[] = [];
for (const [i, name] of ["QA Alice", "QA Bob"].entries()) {
  const user = await User.create({
    name,
    email: `play-${i ? "bob" : "alice"}@example.test`,
    birthDate: "1997-01-01",
    passwordHash: await bcrypt.hash("Along-play-local-2026", 10),
    emailVerified: true,
  });
  members.push(String(user._id));
  await eligibleProfile(user._id);
  const bytes = await sharp(
    path.resolve(`../mobile/assets/brand/${i ? "rohan" : "ananya-photo"}.png`),
  )
    .resize(300, 400)
    .jpeg()
    .toBuffer();
  await ProfilePhoto.updateMany({ owner: user._id }, { bytes });
}
await ensureMatch(members[0], members[1]);
if (process.argv.includes("--groups")) {
  const { Activity, ActivityInterest, Profile } = await import("./models.js");
  const { PlanGroup, PlanGroupMember, PlanGroupMessage } =
    await import("./plan-group-models.js");
  const { acceptActivityInterest } = await import("./activities.js");
  await Promise.all([
    PlanGroup.init(),
    PlanGroupMember.init(),
    PlanGroupMessage.init(),
  ]);
  const travellers = [members[1]];
  const passwordHash = await bcrypt.hash("Along-play-local-2026", 10);
  const bytes = await sharp(path.resolve("../mobile/assets/brand/rohan.png"))
    .resize(300, 400)
    .jpeg()
    .toBuffer();
  for (let i = 2; i <= 20; i++) {
    const user = await User.create({
      name: `QA Traveller ${i}`,
      email: `group-traveller-${i}@example.test`,
      birthDate: "1997-01-01",
      passwordHash,
      emailVerified: true,
    });
    travellers.push(String(user._id));
    await eligibleProfile(user._id);
    await ProfilePhoto.updateMany({ owner: user._id }, { bytes });
  }
  await Profile.updateMany(
    {},
    { approximateLocation: { type: "Point", coordinates: [88.36, 22.57] } },
  );
  const trip = await Activity.create({
    creator: members[0],
    activityType: "group",
    capacity: 10,
    category: "travel",
    type: "together",
    title: "Weekend mountain trip",
    description:
      "A fictional group trip for local testing with 10 selected attendees from 20 join requests.",
    zone: "Park Street",
    startsAt: new Date(Date.now() + 7 * 86400000),
  });
  for (const [index, user] of travellers.entries()) {
    const interest = await ActivityInterest.create({
      activity: trip._id,
      user,
    });
    if (index < 10)
      await acceptActivityInterest(members[0], String(interest._id));
  }
  console.log(
    "Group fixture: Weekend mountain trip, 10 accepted / 20 requests. Alice organises, Bob is selected; group-traveller-20@example.test is pending.",
  );
}
const server = createApp().listen(4118, "127.0.0.1", () => {
  console.log("Local Play API ready: http://127.0.0.1:4118");
  console.log(
    "Temporary local database only. Stopping this process removes its test data.",
  );
  console.log("Alice: play-alice@example.test | Bob: play-bob@example.test");
  console.log("Both passwords: Along-play-local-2026");
});
const sockets = attachPlaySockets(server);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await sockets.close();
  await mongoose.disconnect();
  await database.stop();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
