import crypto from "node:crypto";
import mongoose from "mongoose";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { authenticate, type AuthedRequest } from "./auth.js";
import {
  Airport,
  AirportConnection,
  AirportSession,
  AirportNotice,
} from "./airport-models.js";
import { Block, Conversation, Match, Profile, User } from "./models.js";
import { discoveryUserIds, fail, requireReady } from "./onboarding.js";
import { memberRateKey, rateLimitMessage } from "./rate-limits.js";
import { enqueuePush } from "./push.js";
import { chatEvents } from "./chat-events.js";

const id = z.string().regex(/^[a-f\d]{24}$/i);
const intentions = z.enum(["coffee", "conversation", "dating", "games"]);
const location = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(150),
    timestamp: z.number(),
  })
  .strict();
const DAY = 86400000,
  FRESH = 5 * 60000;
export function distanceM(a: number[], b: number[]) {
  const rad = (v: number) => (v * Math.PI) / 180;
  const dlat = rad(b[1] - a[1]),
    dlon = rad(b[0] - a[0]);
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function withinAirport(
  point: number[],
  airport: {
    location?: { coordinates: number[] } | null;
    boundary?: number[][] | null;
    radiusM: number;
  },
) {
  const polygon = airport.boundary;
  if (!polygon || polygon.length < 4)
    return (
      !!airport.location &&
      distanceM(point, airport.location.coordinates) <= airport.radiusM
    );
  // Inside polygon or within the explicitly defined 500m perimeter allowance.
  let inside = false,
    nearest = Infinity;
  const scaleX = 111320 * Math.cos((point[1] * Math.PI) / 180),
    scaleY = 111320;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
    const ax = (a[0] - point[0]) * scaleX,
      ay = (a[1] - point[1]) * scaleY;
    const bx = (b[0] - point[0]) * scaleX,
      by = (b[1] - point[1]) * scaleY;
    const dx = bx - ax,
      dy = by - ay;
    const t = Math.max(
      0,
      Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)),
    );
    nearest = Math.min(nearest, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return inside || nearest <= 500;
}
function checkedLocation(input: unknown) {
  const parsed = location.parse(input),
    age = Date.now() - parsed.timestamp;
  if (age > 120000 || age < -30000)
    throw fail(400, "Get a fresh location and try again.");
  return [parsed.longitude, parsed.latitude];
}
async function assertIntention(
  a: string,
  b: string,
  intent: string,
  mine: NonNullable<Awaited<ReturnType<typeof liveAirportSession>>>,
  other: NonNullable<Awaited<ReturnType<typeof liveAirportSession>>>,
) {
  if (
    String(mine.airport) !== String(other.airport) ||
    !mine.intentions.includes(intent) ||
    !other.intentions.includes(intent)
  )
    throw fail(403, "Choose a shared intention during both airport visits.");
  if (intent === "coffee") {
    const airport = await Airport.findOne({
      _id: mine.airport,
      enabled: true,
    }).lean();
    const zone = airport?.zones.find((v) => v.id === mine.zoneId),
      otherZone = airport?.zones.find((v) => v.id === other.zoneId);
    if (
      !zone?.compatibleWith.includes(other.zoneId) ||
      !otherZone?.compatibleWith.includes(mine.zoneId)
    )
      throw fail(403, "Meeting access between these zones is not configured.");
    if (
      Math.min(+mine.availableUntil, +other.availableUntil) - Date.now() <
      30 * 60000
    )
      throw fail(
        400,
        "Coffee needs at least 30 minutes of shared availability.",
      );
  }
  if (intent === "dating") {
    const { compatibleProfiles } = await import("./discovery.js");
    const { mutualFilter } = await compatibleProfiles(a);
    if (
      !mutualFilter.user.$in.some((value) => String(value) === b) ||
      !(await Profile.exists({ ...mutualFilter, user: b }))
    )
      throw fail(403, "Dating preferences do not match.");
  }
}
export async function liveAirportSession(user: string) {
  const now = new Date();
  const session = await AirportSession.findOne({
    user,
    status: "active",
    availableUntil: { $gt: now },
    presenceUntil: { $gt: now },
  }).lean();
  return session &&
    (await Airport.exists({ _id: session.airport, enabled: true }))
    ? session
    : null;
}
export async function airportPairAllowed(a: string, b: string) {
  if (a === b) return false;
  return (await airportAudience(a)).has(b);
}
async function airportAudience(user: string) {
  const [ready, blocks, unmatched] = await Promise.all([
    discoveryUserIds(),
    Block.find({ $or: [{ user }, { target: user }] })
      .select("user target")
      .lean(),
    Match.find({ users: user, active: false }).select("users").lean(),
  ]);
  const eligible = new Set(ready.map(String));
  if (!eligible.has(user)) return new Set<string>();
  eligible.delete(user);
  for (const block of blocks)
    eligible.delete(
      String(String(block.user) === user ? block.target : block.user),
    );
  for (const match of unmatched)
    for (const member of match.users) eligible.delete(String(member));
  return eligible;
}
export async function airportConnectionAccess(
  user: string,
  connectionId: unknown,
  writing = false,
) {
  const grant = await AirportConnection.findOne({
    _id: connectionId,
    users: user,
    state: { $in: ["connected", "persistent"] },
  }).lean();
  if (!grant) throw fail(404, "Airport connection unavailable.");
  const otherId = String(grant.users.find((v) => String(v) !== user));
  if (!(await airportPairAllowed(user, otherId)))
    throw fail(404, "Airport connection unavailable.");
  const sessions = await Promise.all(
    grant.users.map((v) => liveAirportSession(String(v))),
  );
  const live =
    grant.state === "persistent" ||
    (grant.validUntil > new Date() &&
      sessions.every((s, i) => !!s && s.visitId === grant.visits[i]));
  if (!live && grant.decisionUntil <= new Date())
    throw fail(404, "Airport connection ended.");
  if (writing && !live)
    throw fail(
      403,
      "Your airport visit ended. Both choose Stay connected to keep chatting.",
    );
  return { grant, otherId, canSend: live };
}
export async function endAirportSession(
  user: string,
  expected?: { visitId?: string; staleOnly?: boolean },
) {
  const ended = await AirportSession.findOneAndUpdate(
    {
      user,
      status: "active",
      ...(expected?.visitId ? { visitId: expected.visitId } : {}),
      ...(expected?.staleOnly
        ? {
            $or: [
              { availableUntil: { $lte: new Date() } },
              { presenceUntil: { $lte: new Date() } },
            ],
          }
        : {}),
    },
    { $set: { status: "ended", endedAt: new Date() } },
  );
  if (ended) {
    await AirportConnection.updateMany(
      { visits: ended.visitId, state: "pending" },
      { $set: { state: "ended" } },
    );
    await AirportConnection.updateMany(
      {
        visits: ended.visitId,
        state: "connected",
        validUntil: { $gt: new Date() },
      },
      {
        $set: {
          validUntil: new Date(),
          decisionUntil: new Date(Date.now() + DAY),
        },
      },
    );
    const conversations = await AirportConnection.find({
      visits: ended.visitId,
      conversation: { $exists: true },
    }).select("conversation");
    conversations.forEach((v) =>
      chatEvents.emit("changed", String(v.conversation)),
    );
  }
}
export async function cleanupAirportVisits() {
  const stale = await AirportSession.find({
    status: "active",
    $or: [
      { availableUntil: { $lte: new Date() } },
      { presenceUntil: { $lte: new Date() } },
    ],
  })
    .select("user visitId")
    .limit(200)
    .lean();
  for (const visit of stale)
    await endAirportSession(String(visit.user), {
      visitId: visit.visitId,
      staleOnly: true,
    });
  // Travel metadata expires separately from chat moderation/retention policy.
  // Promoted chats no longer reference the temporary connection.
  const cutoff = new Date(Date.now() - 30 * DAY);
  await AirportConnection.deleteMany({
    updatedAt: { $lt: cutoff },
    state: { $in: ["ended", "persistent", "pending"] },
  });
  await AirportConnection.updateMany(
    { state: "connected", decisionUntil: { $lte: new Date() } },
    { $set: { state: "ended" } },
  );
}
export function airportRouter() {
  const router = Router();
  router.use(authenticate, requireReady);
  router.use(
    rateLimit({
      windowMs: 60000,
      limit: 100,
      keyGenerator: memberRateKey,
      message: rateLimitMessage,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  router.get("/airports", async (req, res) => {
    const q = z.string().trim().max(80).default("").parse(req.query.q);
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rows = await Airport.find(
      q
        ? {
            $or: ["name", "city", "iataCode", "icaoCode"].map((k) => ({
              [k]: { $regex: escaped, $options: "i" },
            })),
          }
        : {},
    )
      .select("name city iataCode enabled zones timezone")
      .sort({ enabled: -1, name: 1 })
      .limit(40)
      .lean();
    res.json({ data: rows });
  });
  router.post("/nearby", async (req, res) => {
    const point = checkedLocation(req.body);
    const airports = await Airport.find({
      enabled: true,
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: point },
          $maxDistance: 30000,
        },
      },
    })
      .limit(20)
      .lean();
    res.json({
      data: airports
        .filter((a) => withinAirport(point, a))
        .map((a) => ({
          id: String(a._id),
          name: a.name,
          city: a.city,
          iataCode: a.iataCode,
          zones: a.zones,
          approximate: !a.boundary?.length,
        })),
    });
  });
  router.get("/me", async (req: AuthedRequest, res) => {
    const live = await liveAirportSession(req.userId!);
    if (!live) await endAirportSession(req.userId!, { staleOnly: true });
    const session = await AirportSession.findOne({ user: req.userId }).lean();
    const airport = session
      ? await Airport.findById(session.airport)
          .select("name city iataCode zones")
          .lean()
      : null;
    res.json({ data: { active: !!live, session, airport } });
  });
  router.post("/check-in", async (req: AuthedRequest, res) => {
    const body = z
      .object({
        airportId: id,
        zoneId: z.string().max(80),
        minutes: z.number().int().min(15).max(120),
        intentions: z.array(intentions).min(1).max(4),
        consent: z.literal(true),
        location,
      })
      .strict()
      .parse(req.body);
    const point = checkedLocation(body.location);
    const airport = await Airport.findOne({
      _id: body.airportId,
      enabled: true,
    }).lean();
    if (!airport || !withinAirport(point, airport))
      throw fail(
        403,
        "Airport Mode is available only near a supported airport.",
      );
    if (!airport.zones.some((v) => v.id === body.zoneId))
      throw fail(400, "Choose a configured airport zone.");
    await endAirportSession(req.userId!);
    const data = await AirportSession.findOneAndUpdate(
      { user: req.userId },
      {
        $set: {
          airport: airport._id,
          visitId: crypto.randomUUID(),
          zoneId: body.zoneId,
          intentions: [...new Set(body.intentions)],
          status: "active",
          availableUntil: new Date(Date.now() + body.minutes * 60000),
          presenceUntil: new Date(Date.now() + FRESH),
        },
        $unset: { endedAt: 1, outsideSince: 1 },
      },
      { upsert: true, new: true },
    );
    res.status(201).json({ data });
  });
  router.post("/presence", async (req: AuthedRequest, res) => {
    const point = checkedLocation(req.body);
    const session = await AirportSession.findOne({
      user: req.userId,
      status: "active",
    });
    const airport = session
      ? await Airport.findOne({ _id: session.airport, enabled: true }).lean()
      : null;
    if (!session || !airport || session.availableUntil <= new Date()) {
      await endAirportSession(req.userId!);
      res.json({ data: { active: false } });
      return;
    }
    if (!withinAirport(point, airport)) {
      if (session.outsideSince && Date.now() - +session.outsideSince >= 60000) {
        await endAirportSession(req.userId!);
        res.json({ data: { active: false } });
        return;
      }
      await AirportSession.updateOne(
        { _id: session._id, visitId: session.visitId, status: "active" },
        { $set: { outsideSince: session.outsideSince ?? new Date() } },
      );
      res.json({ data: { active: true, checkingDeparture: true } });
      return;
    }
    // A stale presence lease cannot be silently revived into a new visit.
    if (session.presenceUntil <= new Date()) {
      await endAirportSession(req.userId!);
      res.json({ data: { active: false } });
      return;
    }
    await AirportSession.updateOne(
      { _id: session._id, visitId: session.visitId, status: "active" },
      {
        $set: { presenceUntil: new Date(Date.now() + FRESH) },
        $unset: { outsideSince: 1 },
      },
    );
    res.json({ data: { active: true } });
  });
  router.post("/check-out", async (req: AuthedRequest, res) => {
    await endAirportSession(req.userId!);
    res.status(204).end();
  });
  router.get("/discover", async (req: AuthedRequest, res) => {
    const mine = await liveAirportSession(req.userId!);
    if (!mine) throw fail(403, "Turn on Airport Mode to see travellers.");
    const after = z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .optional()
      .parse(req.query.after);
    const sessions = await AirportSession.find({
      airport: mine.airport,
      user: { $ne: req.userId },
      status: "active",
      availableUntil: { $gt: new Date() },
      presenceUntil: { $gt: new Date() },
      ...(after ? { _id: { $gt: after } } : {}),
    })
      .sort({ _id: 1 })
      .limit(30)
      .lean();
    const { publicCards, compatibleProfiles } = await import("./discovery.js");
    const { mutualFilter } = await compatibleProfiles(req.userId!);
    const dating = new Set(
      (await Profile.find(mutualFilter).distinct("user")).map(String),
    );
    const audience = await airportAudience(req.userId!);
    const allowed = sessions.filter((s) => audience.has(String(s.user)));
    const profiles = await Profile.find({
      user: { $in: allowed.map((v) => v.user) },
    });
    const cards = await publicCards(profiles);
    const airport = await Airport.findById(mine.airport).lean();
    res.json({
      data: {
        items: cards.map((card) => {
          const visit = allowed.find((s) => String(s.user) === card.id)!;
          const zone = airport?.zones.find((v) => v.id === mine.zoneId);
          const otherZone = airport?.zones.find((v) => v.id === visit.zoneId);
          const canMeet =
            !!zone?.compatibleWith.includes(visit.zoneId) &&
            !!otherZone?.compatibleWith.includes(mine.zoneId);
          return {
            ...card,
            zone: otherZone?.name ?? "Zone unspecified",
            intentions: visit.intentions,
            availableUntil: visit.availableUntil,
            availableMinutes: Math.max(
              0,
              Math.ceil((+visit.availableUntil - Date.now()) / 60000),
            ),
            canMeet,
            canDate:
              dating.has(card.id) &&
              mine.intentions.includes("dating") &&
              visit.intentions.includes("dating"),
          };
        }),
        nextCursor:
          sessions.length === 30 ? String(sessions.at(-1)!._id) : null,
      },
    });
  });
  router.get("/profiles/:id", async (req: AuthedRequest, res) => {
    const target = id.parse(req.params.id),
      user = req.userId!;
    if (!(await airportPairAllowed(user, target)))
      throw fail(404, "Traveller unavailable.");
    const [mine, other] = await Promise.all([
      liveAirportSession(user),
      liveAirportSession(target),
    ]);
    const pairKey = [user, target].sort().join(":");
    const grant = await AirportConnection.findOne({
      pairKey,
      state: { $in: ["connected", "persistent"] },
    })
      .sort({ _id: -1 })
      .lean();
    let conversationId: string | null = null;
    if (grant) {
      try {
        await airportConnectionAccess(user, grant._id);
        conversationId = grant.conversation ? String(grant.conversation) : null;
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
      }
    }
    if (
      !conversationId &&
      (!mine || !other || String(mine.airport) !== String(other.airport))
    )
      throw fail(404, "Traveller unavailable.");
    const { publicCards } = await import("./discovery.js");
    const [card] = await publicCards(await Profile.find({ user: target }));
    if (!card) throw fail(404, "Traveller unavailable.");
    res.json({
      data: {
        ...card,
        vibeCheck: null,
        conversationId,
        sharedIntentions:
          mine && other
            ? mine.intentions.filter((v) => other.intentions.includes(v))
            : [],
      },
    });
  });
  router.post("/connections", async (req: AuthedRequest, res) => {
    const body = z
      .object({ userId: id, intent: intentions })
      .strict()
      .parse(req.body);
    const a = req.userId!,
      b = body.userId;
    if (!(await airportPairAllowed(a, b)))
      throw fail(404, "Traveller unavailable.");
    const [mine, other] = await Promise.all([
      liveAirportSession(a),
      liveAirportSession(b),
    ]);
    if (
      !mine ||
      !other ||
      String(mine.airport) !== String(other.airport) ||
      !mine.intentions.includes(body.intent) ||
      !other.intentions.includes(body.intent)
    )
      throw fail(403, "Choose a shared intention during both airport visits.");
    const pairKey = [a, b].sort().join(":");
    const regular = await Match.findOne({ pairKey, active: true });
    if (regular) {
      const conversation = await Conversation.findOne({ match: regular._id });
      res.json({
        data: {
          conversationId: conversation ? String(conversation._id) : null,
          existing: true,
        },
      });
      return;
    }
    await assertIntention(a, b, body.intent, mine, other);
    const ordered = [mine, other].sort((x, y) =>
      String(x.user).localeCompare(String(y.user)),
    );
    const validUntil = new Date(
      Math.min(+mine.availableUntil, +other.availableUntil),
    );
    const visitKey = ordered.map((s) => s.visitId).join(":");
    await AirportConnection.updateOne(
      { visitKey },
      {
        $setOnInsert: {
          pairKey,
          visitKey,
          users: ordered.map((s) => s.user),
          visits: ordered.map((s) => s.visitId),
          airport: mine.airport,
          actor: a,
          intent: body.intent,
          validUntil,
          decisionUntil: new Date(+validUntil + DAY),
          state: "pending",
        },
      },
      { upsert: true },
    );
    const grant = await AirportConnection.findOne({ visitKey }).lean();
    if (grant?.state === "pending")
      await enqueuePush({
        key: `airport-request:${grant._id}`,
        user: String(
          grant.users.find((v) => String(v) !== String(grant.actor)),
        ),
        actor: String(grant.actor),
        kind: "notice",
        target: String(grant._id),
      });
    res.status(201).json({ data: grant });
  });
  router.get("/connections", async (req: AuthedRequest, res) => {
    const rows = await AirportConnection.find({
      users: req.userId,
      state: { $in: ["pending", "connected"] },
      decisionUntil: { $gt: new Date() },
    })
      .sort({ _id: -1 })
      .limit(100)
      .lean();
    const result = [];
    const audience = await airportAudience(req.userId!);
    for (const row of rows) {
      const other = String(row.users.find((v) => String(v) !== req.userId));
      if (!audience.has(other)) continue;
      const sessions = await Promise.all(
        row.users.map((v) => liveAirportSession(String(v))),
      );
      const live =
        row.validUntil > new Date() &&
        sessions.every((s, i) => !!s && s.visitId === row.visits[i]);
      if (row.state === "pending" && !live) continue;
      const member = await User.findById(other).select("name").lean();
      result.push({
        id: String(row._id),
        name: member?.name ?? "Traveller",
        intent: row.intent,
        state: row.state,
        incoming: String(row.actor) !== req.userId,
        needsDecision: row.state === "connected" && !live,
        kept: row.keep.some((v) => String(v) === req.userId),
        otherKept: row.keep.some((v) => String(v) !== req.userId),
        conversationId: row.conversation ? String(row.conversation) : null,
      });
    }
    res.json({ data: result });
  });
  router.get("/notices", async (req: AuthedRequest, res) => {
    const notices = await AirportNotice.find({
      recipient: req.userId,
      expiresAt: { $gt: new Date() },
    })
      .sort({ _id: -1 })
      .limit(100)
      .lean();
    const audience = await airportAudience(req.userId!);
    const data = [];
    for (const notice of notices) {
      const connection = await AirportConnection.findOne({
        _id: notice.connection,
        users: req.userId,
      }).lean();
      if (!connection) continue;
      const other = String(
        connection.users.find((value) => String(value) !== req.userId),
      );
      if (!audience.has(other)) continue;
      const member = await User.findById(other).select("name").lean();
      const name = member?.name ?? "Your airport connection";
      const own = String(notice.actor) === req.userId;
      const title =
        notice.kind === "keep"
          ? `${name} wants to stay connected`
          : notice.kind === "connected"
            ? "Both chose to stay connected!"
            : "Your airport connection has ended";
      const body =
        notice.kind === "keep"
          ? `${name} chose Stay connected. Would you like to keep talking?`
          : notice.kind === "connected"
            ? `You and ${name} both chose to stay connected. Your conversation can continue in Along.`
            : own
              ? "You chose to leave this connection at the airport. Wishing you a good journey ahead."
              : `${name} chose not to continue this connection. A moment shared, a new journey ahead.`;
      data.push({
        id: String(notice._id),
        connectionId: String(connection._id),
        kind: notice.kind,
        name,
        own,
        title,
        body,
        conversationId:
          notice.kind === "connected" &&
          connection.state === "persistent" &&
          connection.conversation
            ? String(connection.conversation)
            : null,
        presentedAt: notice.presentedAt ?? null,
        readAt: notice.readAt ?? null,
        createdAt: notice.createdAt,
      });
    }
    res.json({ data });
  });
  router.post("/notices/:id/presented", async (req: AuthedRequest, res) => {
    const notice = await AirportNotice.findOneAndUpdate(
      { _id: id.parse(req.params.id), recipient: req.userId },
      { $set: { presentedAt: new Date(), readAt: new Date() } },
    );
    if (!notice) throw fail(404, "Airport update unavailable.");
    res.status(204).end();
  });
  router.post("/connections/:id/decision", async (req: AuthedRequest, res) => {
    const connectionId = id.parse(req.params.id);
    const { action } = z
      .object({ action: z.enum(["accept", "end", "keep"]) })
      .strict()
      .parse(req.body);
    let conversationId: string | null = null;
    await mongoose.connection.transaction(async (transaction) => {
      const row = await AirportConnection.findOne({
        _id: connectionId,
        users: req.userId,
      }).session(transaction);
      if (!row || row.state === "ended" || row.decisionUntil <= new Date())
        throw fail(404, "Airport connection ended.");
      const other = String(row.users.find((v) => String(v) !== req.userId));
      if (!(await airportPairAllowed(req.userId!, other)))
        throw fail(404, "Traveller unavailable.");
      if (row.state === "persistent") {
        conversationId = row.conversation ? String(row.conversation) : null;
        return;
      }
      const alreadyKept = row.keep.some(
        (value) => String(value) === req.userId,
      );
      if (action === "end") row.state = "ended";
      else if (action === "accept") {
        if (row.state !== "pending" || String(row.actor) === req.userId)
          throw fail(403, "Only the recipient can accept this request.");
        const sessions = await Promise.all(
          row.users.map((v) => liveAirportSession(String(v))),
        );
        if (
          row.validUntil <= new Date() ||
          !sessions.every((s, i) => s && s.visitId === row.visits[i])
        )
          throw fail(409, "An airport visit has ended.");
        await assertIntention(
          String(row.users[0]),
          String(row.users[1]),
          row.intent,
          sessions[0]!,
          sessions[1]!,
        );
        // A unique placeholder match ID reserves the existing Conversation index;
        // no Match exists until both participants choose to stay connected.
        const [conversation] = await Conversation.create(
          [
            {
              match: new mongoose.Types.ObjectId(),
              airportConnection: row._id,
            },
          ],
          { session: transaction },
        );
        row.conversation = conversation._id;
        row.state = "connected";
      } else {
        if (row.state !== "connected")
          throw fail(409, "Accept the connection first.");
        if (!row.keep.some((v) => String(v) === req.userId))
          row.keep.push(new mongoose.Types.ObjectId(req.userId));
        if (row.keep.length === 2) {
          const match = await Match.findOneAndUpdate(
            { pairKey: row.pairKey },
            {
              $setOnInsert: {
                pairKey: row.pairKey,
                users: row.users,
                active: true,
              },
            },
            { upsert: true, new: true, session: transaction },
          );
          if (!match.active)
            throw fail(409, "This connection cannot be restored.");
          const existing = await Conversation.findOne({
            match: match._id,
          }).session(transaction);
          if (existing) row.conversation = existing._id;
          else
            await Conversation.updateOne(
              { _id: row.conversation },
              { $set: { match: match._id }, $unset: { airportConnection: 1 } },
              { session: transaction },
            );
          row.state = "persistent";
        }
      }
      await row.save({ session: transaction });
      conversationId = row.conversation ? String(row.conversation) : null;
      if ((action === "keep" && !alreadyKept) || action === "end") {
        const kind =
          row.state === "persistent"
            ? "connected"
            : action === "end"
              ? "ended"
              : "keep";
        const recipients = kind === "keep" ? [other] : row.users.map(String);
        if (kind !== "keep")
          await AirportNotice.updateMany(
            { connection: row._id, kind: "keep", presentedAt: null },
            { $set: { presentedAt: new Date(), readAt: new Date() } },
            { session: transaction },
          );
        for (const recipient of recipients) {
          const eventKey = `airport-decision:${row._id}:${kind}:${kind === "keep" ? req.userId : "final"}:${recipient}`;
          const notice = await AirportNotice.findOneAndUpdate(
            { eventKey },
            {
              $setOnInsert: {
                eventKey,
                recipient,
                actor: req.userId,
                connection: row._id,
                kind,
                expiresAt: new Date(Date.now() + 30 * DAY),
              },
            },
            { upsert: true, new: true, session: transaction },
          );
          await enqueuePush(
            {
              key: eventKey,
              user: recipient,
              actor: req.userId!,
              kind: "notice",
              target: String(notice!._id),
            },
            transaction,
          );
        }
      }
      if (action === "accept")
        await enqueuePush(
          {
            key: `airport:${row._id}:${action}:${req.userId}`,
            user: other,
            actor: req.userId!,
            kind: "notice",
            target: String(row._id),
          },
          transaction,
        );
    });
    if (conversationId) chatEvents.emit("changed", conversationId);
    res.json({ data: { conversationId } });
  });
  return router;
}
