import mongoose from "mongoose";
import { Profile, User } from "./models.js";
import type { z } from "zod";
import type { activityInput } from "./validation.js";

type AudienceInput = NonNullable<z.infer<typeof activityInput>["audience"]>;
export async function preparePlanAudience(
  value: AudienceInput | undefined,
  userId: string,
) {
  if (!value) return {};
  const { location, ...audience } = value;
  if (audience.maxDistanceKm == null)
    return { audience, approximateLocation: null };
  const profile = location
    ? null
    : await Profile.findOne({ user: userId })
        .select("approximateLocation")
        .lean();
  const point = location
    ? [location.longitude, location.latitude]
    : profile?.approximateLocation?.coordinates;
  if (point?.length !== 2)
    throw Object.assign(
      new Error(
        "Set an approximate location to use a distance range for this plan.",
      ),
      { status: 400 },
    );
  return {
    audience,
    approximateLocation: {
      type: "Point" as const,
      coordinates: point.map((v) => Math.round(v * 1000) / 1000),
    },
  };
}

/** Additional hard constraints for public plans; missing legacy preferences remain open. */
export async function planAudienceVisibility(userId: string) {
  const [user, profile] = await Promise.all([
    User.findById(userId).select("+birthDate").lean(),
    Profile.findOne({ user: userId })
      .select("gender approximateLocation")
      .lean(),
  ]);
  const today = new Date(),
    birth = user?.birthDate;
  const age = birth
    ? today.getUTCFullYear() -
      birth.getUTCFullYear() -
      Number(
        today.getUTCMonth() < birth.getUTCMonth() ||
          (today.getUTCMonth() === birth.getUTCMonth() &&
            today.getUTCDate() < birth.getUTCDate()),
      )
    : 0;
  const coordinates = profile?.approximateLocation?.coordinates;
  let withinRadius: Record<string, unknown> | boolean = false;
  if (coordinates?.length === 2) {
    const radians = Math.PI / 180;
    const originLat = {
      $multiply: [
        { $arrayElemAt: ["$approximateLocation.coordinates", 1] },
        radians,
      ],
    };
    const originLng = {
      $multiply: [
        { $arrayElemAt: ["$approximateLocation.coordinates", 0] },
        radians,
      ],
    };
    const lat = coordinates[1] * radians,
      lng = coordinates[0] * radians;
    const cosine = {
      $add: [
        { $multiply: [{ $sin: originLat }, Math.sin(lat)] },
        {
          $multiply: [
            { $cos: originLat },
            Math.cos(lat),
            { $cos: { $subtract: [originLng, lng] } },
          ],
        },
      ],
    };
    // Clamp rounding error to acos's domain. Missing locations fail closed.
    withinRadius = {
      $expr: {
        $cond: [
          {
            $eq: [
              { $size: { $ifNull: ["$approximateLocation.coordinates", []] } },
              2,
            ],
          },
          {
            $lte: [
              {
                $multiply: [
                  6371,
                  { $acos: { $min: [1, { $max: [-1, cosine] }] } },
                ],
              },
              "$audience.maxDistanceKm",
            ],
          },
          false,
        ],
      },
    };
  }
  const selectedGender =
    profile?.gender === "man"
      ? "male"
      : profile?.gender === "woman"
        ? "female"
        : "both";
  return {
    $or: [
      { creator: new mongoose.Types.ObjectId(userId) },
      {
        $and: [
          {
            $or: [
              { "audience.minAge": { $exists: false } },
              { "audience.minAge": { $lte: age } },
            ],
          },
          {
            $or: [
              { "audience.maxAge": { $exists: false } },
              { "audience.maxAge": { $gte: age } },
            ],
          },
          {
            $or: [
              { "audience.gender": { $exists: false } },
              { "audience.gender": { $in: ["both", selectedGender] } },
            ],
          },
          {
            $or: [
              { "audience.maxDistanceKm": null },
              ...(withinRadius === false ? [] : [withinRadius]),
            ],
          },
        ],
      },
    ],
  };
}
