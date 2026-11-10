import { z } from "zod";
import {
  validatePlanDetails,
  type PlanDetails,
} from "../../../packages/plan-details/index.js";

export function checkPlanDetails(category: string, details?: PlanDetails) {
  if (details === undefined) return;
  const errors = validatePlanDetails(category, details);
  if (Object.keys(errors).length) {
    throw new z.ZodError(
      Object.entries(errors).map(([key, message]) => ({
        code: "custom",
        path: ["categoryDetails", key],
        message,
      })),
    );
  }
}

export function isAdult(value: string, today = new Date()): boolean {
  const birth = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(birth.getTime()) ||
    birth.toISOString().slice(0, 10) !== value
  )
    return false;
  const cutoff = new Date(
    Date.UTC(
      today.getUTCFullYear() - 18,
      today.getUTCMonth(),
      today.getUTCDate(),
    ),
  );
  return (
    birth <= cutoff && birth.getUTCFullYear() >= today.getUTCFullYear() - 120
  );
}
export const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(10).max(72),
});
export const registration = credentials.extend({
  name: z.string().trim().min(2).max(60),
  birthDate: z.iso
    .date()
    .refine((v) => isAdult(v), "Along is for adults aged 18 and over."),
});
export const activityInput = z.object({
  type: z.enum(["need", "offer", "together"]),
  category: z.string().min(2).max(50),
  audience: z
    .object({
      minAge: z.number().int().min(18).max(120),
      maxAge: z.number().int().min(18).max(120),
      gender: z.enum(["male", "female", "both"]),
      maxDistanceKm: z.number().min(1).max(500).nullable(),
      distanceUnit: z.enum(["km", "mi"]),
      location: z
        .object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
        })
        .strict()
        .optional(),
    })
    .strict()
    .refine(
      (value) => value.minAge <= value.maxAge,
      "Minimum age must not exceed maximum age.",
    )
    .optional(),
  title: z.string().trim().min(5).max(100),
  description: z.string().trim().min(15).max(1500),
  highlight: z.string().trim().max(120).optional(),
  endsAt: z.iso.datetime().nullable().optional(),
  schedule: z
    .object({
      dateMode: z.enum(["exact", "range"]),
      timeMode: z.enum(["exact", "range"]),
    })
    .nullable()
    .optional(),
  activityType: z.enum(["one_on_one", "group"]).optional(),
  capacity: z.number().int().min(1).max(100).optional(),
  zone: z.string().trim().min(2).max(100),
  startsAt: z.iso
    .datetime()
    .refine((v) => new Date(v) > new Date(), "Choose a future date."),
  recurring: z.boolean().default(false),
  budget: z.string().max(200).default("Decide together"),
  categoryDetails: z
    .record(
      z.string().max(40),
      z.union([z.string().trim().max(300), z.array(z.string().max(20)).max(7)]),
    )
    .refine(
      (value) => Object.keys(value).length <= 12,
      "Too many category details.",
    )
    .optional(),
});
export const profileInput = z.object({
  bio: z.string().max(600).optional(),
  occupation: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  area: z.string().max(100).optional(),
  interests: z.array(z.string().max(40)).max(20).optional(),
});
