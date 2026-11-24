import mongoose from "mongoose";
import { config } from "./config.js";
import { seedCommunities } from "./community-seed.js";
try {
  if (!config.MONGODB_URI) throw new Error("Missing database configuration.");
  await mongoose.connect(config.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });
  await seedCommunities();
  console.log(
    "Along's six communities are configured. Existing settings were preserved.",
  );
} catch {
  console.error(
    "Could not configure communities. Check the API database configuration and connection.",
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
