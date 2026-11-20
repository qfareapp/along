import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { z } from "zod";
import { config } from "./config.js";
import { Airport } from "./airport-models.js";

const row = z.object({
  id: z.string().regex(/^\d+$/),
  name: z.string().min(1),
  iso_country: z.literal("IN"),
  latitude_deg: z.coerce.number().min(-90).max(90),
  longitude_deg: z.coerce.number().min(-180).max(180),
  municipality: z.string().optional(),
  iata_code: z.string().optional(),
  icao_code: z.string().optional(),
  type: z.string(),
  scheduled_service: z.enum(["yes", "no"]),
});
export function parseAirportData(input: unknown[]) {
  const seen = new Set<string>(),
    valid = [];
  let skipped = 0;
  for (const raw of input) {
    const parsed = row.safeParse(raw);
    if (!parsed.success || seen.has(parsed.data.id)) {
      skipped++;
      continue;
    }
    const r = parsed.data;
    seen.add(r.id);
    valid.push({
      sourceId: `ourairports:${r.id}`,
      name: r.name.trim(),
      city: r.municipality?.trim() ?? "",
      countryCode: "IN",
      iataCode: r.iata_code?.toUpperCase() ?? "",
      icaoCode: r.icao_code?.toUpperCase() ?? "",
      type: r.type,
      scheduledService: r.scheduled_service === "yes",
      location: {
        type: "Point",
        coordinates: [r.longitude_deg, r.latitude_deg],
      },
    });
  }
  return { valid, skipped };
}
export async function importAirports(input: unknown[]) {
  const { valid, skipped } = parseAirportData(input);
  let inserted = 0,
    updated = 0;
  for (const airport of valid) {
    const result = await Airport.updateOne(
      { sourceId: airport.sourceId },
      {
        $set: airport,
        $setOnInsert: {
          enabled: false,
          radiusM: 1000,
          timezone: "Asia/Kolkata",
          zones: [],
        },
      },
      { upsert: true },
    );
    inserted += result.upsertedCount;
    updated += result.matchedCount;
  }
  return { inserted, updated, skipped };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const input = JSON.parse(
    await fs.readFile(
      new URL("../data/india-airports.json", import.meta.url),
      "utf8",
    ),
  );
  if (!process.argv.includes("--apply"))
    console.log({
      ...parseAirportData(input),
      valid: parseAirportData(input).valid.length,
      dryRun: true,
    });
  else {
    if (!config.MONGODB_URI)
      throw new Error("MONGODB_URI is required for --apply.");
    try {
      await mongoose.connect(config.MONGODB_URI);
      await Airport.init();
      console.log(await importAirports(input));
    } finally {
      await mongoose.disconnect();
    }
  }
}
