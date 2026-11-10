/** Explicit, temporary development database. Never imported by the production entry point. */
import crypto from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

if (process.env.NODE_ENV === "production")
  throw new Error("Temporary databases are prohibited in production.");
const database = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
process.env.MONGODB_URI = database.getUri();
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.ADMIN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
const { createApp } = await import("./app.js");
const { seedCategories } = await import("./categories.js");
const { User, Profile, Activity } = await import("./models.js");
await mongoose.connect(database.getUri());
await seedCategories();
const user = await User.create({
  email: "preview@example.test",
  name: "Preview Member",
  birthDate: "1998-01-01",
  passwordHash: await bcrypt.hash("Along-local-only-2026", 12),
  emailVerified: true,
});
await Profile.create({
  user: user._id,
  city: "Kolkata",
  area: "Park Street",
  bio: "An entirely fictional adult for local development.",
  interests: ["Coffee", "Travel"],
});
await Activity.create({
  creator: user._id,
  type: "together",
  category: "food",
  title: "Coffee After Work",
  description:
    "A fictional local development plan. Find a public cafe and agree on costs together.",
  zone: "Park Street",
  startsAt: new Date(Date.now() + 86400000),
});
if (process.argv.includes("--admin")) {
  // The normal one-time bootstrap prompts for operator-owned credentials; no default admin exists.
  await import("./admin/bootstrap.js");
  await mongoose.connect(database.getUri());
}
const port = Number(process.env.PORT ?? 4000);
const server = createApp().listen(port, "127.0.0.1", () => {
  console.log(`Along local API: http://localhost:${port}`);
  console.log(
    "TEMPORARY DATABASE: all data is removed when this process stops.",
  );
  console.log(
    "Fictional local login: preview@example.test / Along-local-only-2026",
  );
  console.log(
    "Bound to loopback. Use a configured MongoDB and npm run dev for physical-phone LAN access.",
  );
});
async function shutdown() {
  server.close(async () => {
    await mongoose.disconnect();
    await database.stop();
    process.exit(0);
  });
}
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
