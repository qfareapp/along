import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { Airport, AirportSession, AirportConnection } from "../airport-models.js";
import { AuditLog } from "./models.js";
import { permit, type AdminRequest } from "./security.js";

const coordinate = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
export function validAirportBoundary(ring: number[][]) {
  if (
    ring.length < 4 ||
    JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))
  )
    return false;
  const vertices = ring.slice(0, -1);
  if (new Set(vertices.map((v) => v.join(","))).size !== vertices.length)
    return false;
  let area = 0;
  const orientation = (a: number[], b: number[], c: number[]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const onSegment = (a: number[], b: number[], c: number[]) =>
    Math.abs(orientation(a, b, c)) < 1e-12 &&
    c[0] >= Math.min(a[0], b[0]) &&
    c[0] <= Math.max(a[0], b[0]) &&
    c[1] >= Math.min(a[1], b[1]) &&
    c[1] <= Math.max(a[1], b[1]);
  for (let i = 0; i < vertices.length; i++) {
    const a = ring[i],
      b = ring[i + 1];
    area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 1; j < vertices.length; j++) {
      if (j === i + 1 || (i === 0 && j === vertices.length - 1)) continue;
      const c = ring[j],
        d = ring[j + 1];
      if (
        (orientation(a, b, c) * orientation(a, b, d) < 0 &&
          orientation(c, d, a) * orientation(c, d, b) < 0) ||
        onSegment(a, b, c) ||
        onSegment(a, b, d) ||
        onSegment(c, d, a) ||
        onSegment(c, d, b)
      )
        return false;
    }
  }
  return Math.abs(area) > 1e-10;
}
const configuration = z
  .object({
    enabled: z.boolean(),
    radiusM: z.number().int().min(100).max(15000),
    configurationSource: z.string().trim().min(10).max(1000),
    boundary: z.array(coordinate).min(4).max(500).nullable().optional(),
    zones: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9_-]{1,60}$/),
            name: z.string().trim().min(2).max(100),
            compatibleWith: z.array(z.string()).max(30),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    reason: z.string().trim().min(10).max(1000),
  })
  .strict()
  .superRefine((v, ctx) => {
    const ids = new Set(v.zones.map((z) => z.id));
    if (
      ids.size !== v.zones.length ||
      v.zones.some((z) => z.compatibleWith.some((id) => !ids.has(id)))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Zone IDs must be unique and compatibility must reference configured zones.",
      });
    if (v.boundary && !validAirportBoundary(v.boundary))
      ctx.addIssue({
        code: "custom",
        message:
          "Boundary must be a closed, non-intersecting GeoJSON ring with non-zero area in longitude/latitude order.",
      });
  });
export function airportAdminRouter() {
  const router = Router();
  router.use(permit("settings.manage"));
  router.get("/", async (_req, res) => {
    res.json({
      data: await Airport.find().sort({ name: 1 }).limit(500).lean(),
    });
  });
  router.patch("/:id", async (req: AdminRequest, res) => {
    const airportId = z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .parse(req.params.id);
    const { reason, boundary, ...settings } = configuration.parse(req.body);
    const result = await mongoose.connection.transaction(async (session) => {
      const airport = await Airport.findByIdAndUpdate(
        airportId,
        {
          $set: { ...settings, ...(boundary ? { boundary } : {}) },
          ...(boundary === null ? { $unset: { boundary: 1 } } : {}),
        },
        { new: true, runValidators: true, session },
      );
      if (!airport)
        throw Object.assign(new Error("Airport not found."), { status: 404 });
      if (!settings.enabled) {
        await AirportSession.updateMany({ airport: airport._id, status: "active" }, { $set: { status: "ended", endedAt: new Date() } }, { session });
        await AirportConnection.updateMany({ airport: airport._id, state: "pending" }, { $set: { state: "ended" } }, { session });
        await AirportConnection.updateMany({ airport: airport._id, state: "connected", validUntil: { $gt: new Date() } }, { $set: { validUntil: new Date(), decisionUntil: new Date(Date.now() + 86400000) } }, { session });
      }
      await AuditLog.create(
        [
          {
            admin: req.admin!.id,
            action: "airport.configure",
            targetType: "airport",
            targetId: airportId,
            reason,
            requestId: req.requestId,
            outcome: "success",
          },
        ],
        { session },
      );
      return airport;
    });
    res.json({ data: result });
  });
  return router;
}
