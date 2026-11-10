import mongoose from "mongoose";
import { config } from "./config.js";
import { seedCategories } from "./categories.js";
if (!config.MONGODB_URI) throw new Error("Set MONGODB_URI first.");
await mongoose.connect(config.MONGODB_URI);
await seedCategories();
console.log(
  "Added missing activity categories. Existing category settings are preserved.",
);
await mongoose.disconnect();
