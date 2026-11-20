import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { Airport } from "./airport-models.js";
import { config } from "./config.js";

// Explicitly synthetic location supplied by the owner for testing Airport Mode.
// This is never included in the real airport dataset or application startup.
export const belghariaDemoAirport = {
  sourceId: "demo:belgharia",
  name: "Belgharia (Demo Airport)",
  city: "Belgharia",
  countryCode: "IN",
  type: "test_location",
  scheduledService: false,
  iataCode: "",
  icaoCode: "",
  location: {
    type: "Point" as const,
    coordinates: [88.3886244482948, 22.670388020903303],
  },
};

export async function seedBelghariaDemoAirport() {
  return Airport.findOneAndUpdate(
    { sourceId: belghariaDemoAirport.sourceId },
    {
      $set: belghariaDemoAirport,
      $setOnInsert: {
        enabled: true,
        radiusM: 1000,
        timezone: "Asia/Kolkata",
        configurationSource:
          "Owner-provided Belgharia coordinates; synthetic test area, not a real airport or terminal.",
        zones: [
          {
            id: "demo-area",
            name: "Demo test area (not an airport terminal)",
            compatibleWith: ["demo-area"],
          },
        ],
      },
    },
    { upsert: true, new: true, runValidators: true },
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.argv.includes("--apply")) {
    console.log({ ...belghariaDemoAirport, radiusM: 1000, dryRun: true });
  } else {
    if (!config.MONGODB_URI)
      throw new Error("MONGODB_URI is required for --apply.");
    try {
      await mongoose.connect(config.MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
      });
      await Airport.init();
      const airport = await seedBelghariaDemoAirport();
      console.log({
        name: airport!.name,
        enabled: airport!.enabled,
        radiusM: airport!.radiusM,
      });
    } finally {
      await mongoose.disconnect();
    }
  }
}
