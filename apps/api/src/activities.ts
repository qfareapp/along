import { Router } from "express";
import mongoose, { type PipelineStage } from "mongoose";
import { z } from "zod";
import { authenticate, type AuthedRequest } from "./auth.js";
import {
  Activity,
  ActivityInterest,
  ActivitySave,
  Category,
  Profile,
  ProfilePhoto,
  User,
} from "./models.js";
import { compatibleProfiles } from "./discovery.js";
import { fail, requireReady, vibeCategories } from "./onboarding.js";
import { ensureMatch } from "./chat.js";
import { config } from "./config.js";
import { socialScope } from "./social.js";
import { planAudienceVisibility } from "./plan-audience.js";

async function privatePlansFor(userId: string) {
  const scope = await socialScope(userId);
  return {
    visibility: "private",
    participants: {
      $all: [new mongoose.Types.ObjectId(userId)],
      $elemMatch: {
        $in: scope.connections.map(
          (value) => new mongoose.Types.ObjectId(value),
        ),
      },
    },
    status: { $ne: "deleted" },
  };
}

export const liveActivityFilter = (now = new Date()) => ({
  visibility: { $ne: "private" },
  status: "active",
  ownerState: { $nin: ["paused", "successful", "closed", "expired"] },
  $or: [
    { startsAt: { $gte: now } },
    { endsAt: { $gt: now } },
    { recurring: true, endsAt: null },
  ],
});
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const objectId = (id: unknown) => {
  if (typeof id !== "string" || !mongoose.isObjectIdOrHexString(id))
    throw fail(404, "Plan unavailable.");
  return new mongoose.Types.ObjectId(id);
};

// Match discovery's visibility: members open to the viewer; mutual preferences rank first.
export async function activityScope(userId: string) {
  const { viewer, filter, mutualFilter } = await compatibleProfiles(userId);
  const coordinates = viewer.approximateLocation?.coordinates;
  const radius = viewer.preferences?.maxDistanceKm;
  if (radius != null && coordinates?.length !== 2)
    throw fail(
      400,
      "Update your location in Dating Preferences to find nearby plans.",
    );
  const location =
    radius != null && coordinates
      ? {
          approximateLocation: {
            $geoWithin: { $centerSphere: [coordinates, radius / 6378.1] },
          },
        }
      : { city: viewer.city };
  const profiles = await Profile.find({ ...filter, ...location })
    .select("user onboarding.vibes approximateLocation")
    .lean();
  const mutualCreators = await Profile.find({
    ...mutualFilter,
    ...location,
  }).distinct("user");
  const categories = await Category.find({
    active: true,
    $or: [{ cities: { $size: 0 } }, { cities: viewer.city }],
  })
    .sort({ displayOrder: 1, name: 1 })
    .lean();
  const creators = [
    new mongoose.Types.ObjectId(userId),
    ...profiles.map((p) => p.user),
  ];
  return {
    viewer,
    profiles,
    mutualCreators,
    categories,
    filter: {
      ...liveActivityFilter(),
      creator: { $in: creators },
      category: { $in: categories.map((c) => c.slug) },
      $and: [await planAudienceVisibility(userId)],
    },
  };
}

export async function visibleActivity(
  userId: string,
  id: unknown,
  includeOwnPast = false,
) {
  const scope = await activityScope(userId);
  const privateFilter = await privatePlansFor(userId);
  const activity = await Activity.findOne({
    ...(includeOwnPast
      ? {
          $or: [
            scope.filter,
            privateFilter,
            {
              creator: new mongoose.Types.ObjectId(userId),
              status: { $ne: "deleted" },
            },
          ],
        }
      : {
          $or: [scope.filter, { ...privateFilter, status: "active" }],
        }),
    _id: objectId(id),
  }).lean();
  if (!activity) throw fail(404, "Plan unavailable.");
  return activity;
}

async function serializePlans(
  rows: Record<string, any>[],
  userId: string,
  detail = false,
) {
  const creators = rows.map((a) => a.creator),
    ids = rows.map((a) => a._id);
  const [users, profiles, saves, interests] = await Promise.all([
    User.find({ _id: { $in: creators }, status: "active", adminRole: null })
      .select("name identityVerified +birthDate")
      .lean(),
    Profile.find({ user: { $in: creators } })
      .select("user photos occupation")
      .lean(),
    ActivitySave.find({ user: userId, activity: { $in: ids } }).lean(),
    ActivityInterest.find({ user: userId, activity: { $in: ids } }).lean(),
  ]);
  const photoIds = profiles
    .flatMap((p) => p.photos)
    .filter((id) => mongoose.isObjectIdOrHexString(id));
  const photos = await ProfilePhoto.find({
    _id: { $in: photoIds },
    owner: { $in: creators },
  })
    .select("owner")
    .lean();
  const photoOwners = new Map(
    photos.map((p) => [String(p._id), String(p.owner)]),
  );
  const byUser = new Map(users.map((u) => [String(u._id), u]));
  const byProfile = new Map(profiles.map((p) => [String(p.user), p]));
  const saved = new Set(saves.map((s) => String(s.activity)));
  const requested = new Map(interests.map((i) => [String(i.activity), i]));
  const today = new Date();
  return rows.flatMap((a) => {
    const u = byUser.get(String(a.creator)),
      p = byProfile.get(String(a.creator));
    if (!u) return [];
    const interest = requested.get(String(a._id));
    const age = u.birthDate
      ? today.getUTCFullYear() -
        u.birthDate.getUTCFullYear() -
        (today.getUTCMonth() < u.birthDate.getUTCMonth() ||
        (today.getUTCMonth() === u.birthDate.getUTCMonth() &&
          today.getUTCDate() < u.birthDate.getUTCDate())
          ? 1
          : 0)
      : null;
    const capacity = a.activityType === "group" ? (a.capacity ?? null) : 1;
    const placesLeft =
      capacity == null
        ? null
        : Math.max(0, capacity - (a.participants?.length ?? 0));
    return [
      {
        _id: String(a._id),
        title: a.title,
        category: a.category,
        audience: a.audience ?? null,
        privatePlan: a.visibility === "private",
        ownerState: a.ownerState ?? "live",
        publicationStatus: a.status ?? "active",
        zone: a.zone,
        highlight: a.highlight || (a.description ?? "").slice(0, 120),
        ...(detail
          ? {
              description: a.description,
              budget: a.budget,
              recurring: a.recurring,
              categoryDetails: a.categoryDetails,
            }
          : {}),
        startsAt: a.startsAt,
        endsAt: a.endsAt ?? null,
        schedule: a.schedule ?? null,
        type: a.type,
        activityType: a.activityType ?? "one_on_one",
        capacity,
        placesLeft,
        availability: placesLeft === 0 ? "full" : "open",
        expired:
          a.ownerState === "expired" ||
          !(
            (a.startsAt && new Date(a.startsAt) >= today) ||
            (a.endsAt && new Date(a.endsAt) > today) ||
            (a.recurring && !a.endsAt)
          ),
        saved: saved.has(String(a._id)),
        interested: !!interest,
        interestStatus: interest?.status ?? (interest ? "pending" : null),
        conversationId: interest?.conversation
          ? String(interest.conversation)
          : null,
        isOwner: String(a.creator) === userId,
        creator: {
          _id: String(u._id),
          name: u.name,
          age,
          identityVerified: u.identityVerified,
          occupation: p?.occupation ?? "",
          photoId:
            p?.photos.find((id) => photoOwners.get(id) === String(u._id)) ??
            null,
        },
      },
    ];
  });
}

/** Reuse plan visibility and serialization for the mixed Social feed. */
export async function socialPlanCards(
  userId: string,
  authors: string[],
  before: string | undefined,
  limit: number,
) {
  const viewer = await Profile.findOne({ user: userId })
    .select("preferences.maxDistanceKm approximateLocation")
    .lean();
  if (
    viewer?.preferences?.maxDistanceKm != null &&
    viewer.approximateLocation?.coordinates?.length !== 2
  )
    return [];
  const scope = await activityScope(userId);
  const rows = await Activity.find({
    $and: [
      scope.filter,
      {
        creator: {
          $in: authors.map((author) => new mongoose.Types.ObjectId(author)),
        },
      },
      ...(before
        ? [{ _id: { $lt: new mongoose.Types.ObjectId(before) } }]
        : []),
    ],
  })
    .sort({ _id: -1 })
    .limit(limit)
    .lean();
  return serializePlans(rows, userId, true);
}

export async function acceptActivityInterest(
  ownerId: string,
  interestId: unknown,
) {
  const interest = await ActivityInterest.findById(objectId(interestId));
  if (!interest) throw fail(404, "Request unavailable.");
  const activity = await visibleActivity(ownerId, String(interest.activity));
  if (String(activity.creator) !== ownerId)
    throw fail(404, "Request unavailable.");
  // Both sides must still be permitted to view and interact with each other.
  await visibleActivity(String(interest.user), String(activity._id));
  const me = await User.findById(ownerId).select("restrictions").lean();
  if (me?.restrictions?.messaging)
    throw fail(403, "Messaging is restricted. Contact support to appeal.");
  if (interest.status === "declined")
    throw fail(409, "This request was declined.");
  const capacity =
    activity.activityType === "group" ? (activity.capacity ?? 100) : 1;
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const current = await ActivityInterest.findById(interest._id).session(
        session,
      );
      if (!current || current.status === "declined")
        throw fail(409, "This request was declined.");
      const reserved = await Activity.findOneAndUpdate(
        {
          _id: activity._id,
          ...liveActivityFilter(),
          $and: [
            {
              $or: [
                { participants: interest.user },
                {
                  $expr: {
                    $lt: [
                      { $size: { $ifNull: ["$participants", []] } },
                      capacity,
                    ],
                  },
                },
              ],
            },
          ],
        },
        { $addToSet: { participants: interest.user } },
        { new: true, session },
      );
      if (!reserved) throw fail(409, "Activity Full");
      const conversation = await ensureMatch(
        ownerId,
        String(interest.user),
        String(activity._id),
        session,
      );
      if (!conversation) throw fail(404, "Conversation unavailable.");
      await ActivityInterest.updateOne(
        { _id: interest._id },
        {
          $set: {
            status: "accepted",
            conversation,
            readAt: new Date(),
          },
        },
        { session },
      );
      return conversation;
    });
  } finally {
    await session.endSession();
  }
}

export function activitiesRouter() {
  const router = Router();
  router.use(authenticate, requireReady);
  router.get("/categories", async (req: AuthedRequest, res) => {
    const { filter, categories } = await activityScope(req.userId!);
    const counts = await Activity.aggregate([
      { $match: filter },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]);
    const bySlug = new Map(counts.map((c) => [c._id, c.count]));
    const past = await Activity.aggregate([
      {
        $match: {
          status: "active",
          creator: new mongoose.Types.ObjectId(req.userId),
          category: filter.category,
          $nor: filter.$or,
        },
      },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]);
    const pastBySlug = new Map(past.map((c) => [c._id, c.count]));
    const managed = await Activity.aggregate([
      {
        $match: {
          creator: new mongoose.Types.ObjectId(req.userId),
          category: filter.category,
          status: { $ne: "deleted" },
          $or: [
            { status: "paused" },
            {
              ownerState: {
                $in: ["paused", "successful", "closed", "expired"],
              },
            },
            { $nor: filter.$or },
          ],
        },
      },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]);
    const managedBySlug = new Map(managed.map((c) => [c._id, c.count]));
    const q = z
      .string()
      .max(100)
      .optional()
      .parse(req.query.q)
      ?.trim()
      .toLowerCase();
    res.json({
      data: categories
        .filter(
          (c) =>
            !q ||
            `${c.name} ${c.description ?? ""} ${c.slug}`
              .toLowerCase()
              .includes(q),
        )
        .map((c) => ({
          ...c,
          liveCount: bySlug.get(c.slug) ?? 0,
          ownPastCount: pastBySlug.get(c.slug) ?? 0,
          ownManagedCount: managedBySlug.get(c.slug) ?? 0,
        })),
    });
  });
  router.get("/browse", async (req: AuthedRequest, res) => {
    const query = z
      .object({
        category: z.string().max(50).optional(),
        q: z.string().max(100).optional(),
        sort: z
          .enum(["recommended", "soon", "nearest", "newest"])
          .default("soon"),
        when: z.enum(["any", "today", "weekend"]).default("any"),
        kind: z.enum(["any", "one_on_one", "group"]).default("any"),
        nearby: z.enum(["true", "false"]).default("false"),
        saved: z.enum(["true", "false"]).default("false"),
        owner: z.enum(["true", "false"]).default("false"),
        offset: z.coerce.number().int().min(0).max(100000).default(0),
        limit: z.coerce.number().int().min(1).max(30).default(20),
        timezoneOffset: z.coerce
          .number()
          .int()
          .min(-840)
          .max(840)
          .default(-330),
      })
      .parse(req.query);
    const scope = await activityScope(req.userId!);
    const clauses: Record<string, any>[] = [
      query.owner === "true"
        ? {
            status: { $ne: "deleted" },
            $or: [
              { creator: new mongoose.Types.ObjectId(req.userId) },
              {
                ...(await privatePlansFor(req.userId!)),
              },
            ],
          }
        : scope.filter,
    ];
    if (query.category) clauses.push({ category: query.category });
    if (query.kind !== "any")
      clauses.push(
        query.kind === "group"
          ? { activityType: "group" }
          : { activityType: { $ne: "group" } },
      );
    if (query.saved === "true")
      clauses.push({
        _id: {
          $in: await ActivitySave.find({ user: req.userId }).distinct(
            "activity",
          ),
        },
      });
    if (query.q?.trim()) {
      const regex = { $regex: escaped(query.q.trim()), $options: "i" };
      const matchedCategories = scope.categories
        .filter((c) =>
          new RegExp(escaped(query.q!.trim()), "i").test(`${c.name} ${c.slug}`),
        )
        .map((c) => c.slug);
      clauses.push({
        $or: [
          { title: regex },
          { description: regex },
          { highlight: regex },
          { zone: regex },
          { category: { $in: matchedCategories } },
        ],
      });
    }
    if (query.when !== "any") {
      const shift = query.timezoneOffset * 60000,
        local = new Date(Date.now() - shift);
      const start =
        Date.UTC(
          local.getUTCFullYear(),
          local.getUTCMonth(),
          local.getUTCDate(),
        ) + shift;
      const day = local.getUTCDay();
      const from =
        query.when === "today"
          ? start
          : start + (day === 0 ? -1 : day === 6 ? 0 : 6 - day) * 86400000;
      const to = from + (query.when === "today" ? 1 : 2) * 86400000;
      clauses.push({
        $or: [
          { startsAt: { $gte: new Date(from), $lt: new Date(to) } },
          { startsAt: { $lt: new Date(to) }, endsAt: { $gt: new Date(from) } },
          {
            recurring: true,
            startsAt: { $lt: new Date(to) },
            $or: [{ endsAt: null }, { endsAt: { $gt: new Date(from) } }],
          },
        ],
      });
    }
    const pipeline: PipelineStage[] = [];
    const coords = scope.viewer.approximateLocation?.coordinates;
    if (query.sort === "nearest" || query.nearby === "true") {
      if (coords?.length !== 2)
        throw fail(
          400,
          "Save your approximate location in Dating Preferences to use Nearby.",
        );
      // Geo ranking uses organizer approximate areas already used by discovery, never public coordinates.
      const distances = await Profile.aggregate([
        {
          $geoNear: {
            near: {
              type: "Point",
              coordinates: [coords[0], coords[1]] as [number, number],
            },
            distanceField: "distance",
            spherical: true,
            maxDistance: (scope.viewer.preferences?.maxDistanceKm ?? 25) * 1000,
            query: { user: { $in: scope.filter.creator.$in } },
          },
        },
        { $project: { user: 1, distance: 1 } },
      ]);
      clauses.push({ creator: { $in: distances.map((d) => d.user) } });
      pipeline.push({
        $addFields: {
          distanceRank: {
            $indexOfArray: [distances.map((d) => d.user), "$creator"],
          },
        },
      });
    }
    pipeline.unshift({ $match: { $and: clauses } });
    // In Your plans, expired and closed plans sink below the active ones.
    if (query.owner === "true") {
      const now = new Date();
      pipeline.push({
        $addFields: {
          pastRank: {
            $cond: [
              {
                $or: [
                  { $in: ["$ownerState", ["expired", "closed"]] },
                  {
                    $not: [
                      {
                        $or: [
                          { $gte: ["$startsAt", now] },
                          { $gt: ["$endsAt", now] },
                          {
                            $and: [
                              { $eq: ["$recurring", true] },
                              { $eq: [{ $ifNull: ["$endsAt", null] }, null] },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              1,
              0,
            ],
          },
        },
      });
    }
    if (query.sort === "recommended") {
      const vibes = new Set(scope.viewer.onboarding?.vibes ?? []);
      const preferred = scope.profiles
        .filter((p) => p.onboarding?.vibes?.some((v) => vibes.has(v)))
        .map((p) => p.user);
      const preferredCategories = [...vibes].flatMap(
        (vibe) => vibeCategories[vibe] ?? [],
      );
      pipeline.push({
        $addFields: {
          relevance: {
            $add: [
              { $cond: [{ $in: ["$creator", scope.mutualCreators] }, 3, 0] },
              { $cond: [{ $in: ["$creator", preferred] }, 1, 0] },
              { $cond: [{ $in: ["$category", preferredCategories] }, 1, 0] },
            ],
          },
        },
      });
    }
    const sort: Record<string, 1 | -1> = {
      ...(query.owner === "true" ? { pastRank: 1 } : {}),
      ...(query.sort === "newest"
        ? { _id: -1 }
        : query.sort === "nearest"
          ? { distanceRank: 1, startsAt: 1, _id: 1 }
          : query.sort === "recommended"
            ? { relevance: -1, startsAt: 1, _id: 1 }
            : { startsAt: 1, _id: 1 }),
    };
    pipeline.push({
      $facet: {
        rows: [
          { $sort: sort },
          { $skip: query.offset },
          { $limit: query.limit },
          {
            $project: {
              title: 1,
              audience: 1,
              visibility: 1,
              ownerState: 1,
              status: 1,
              category: 1,
              zone: 1,
              startsAt: 1,
              endsAt: 1,
              schedule: 1,
              creator: 1,
              type: 1,
              activityType: 1,
              capacity: 1,
              participants: 1,
              recurring: 1,
              highlight: {
                $cond: [
                  { $gt: [{ $strLenCP: { $ifNull: ["$highlight", ""] } }, 0] },
                  "$highlight",
                  { $substrCP: ["$description", 0, 120] },
                ],
              },
            },
          },
        ],
        total: [{ $count: "value" }],
      },
    });
    const [result] = await Activity.aggregate(pipeline);
    const total = result.total[0]?.value ?? 0;
    res.json({
      data: {
        items: await serializePlans(result.rows, req.userId!),
        total,
        nextOffset:
          query.offset + query.limit < total
            ? query.offset + query.limit
            : null,
      },
    });
  });
  // The owner's past-date plans they have not extended, closed or let expire yet.
  router.get("/expiring", async (req: AuthedRequest, res) => {
    const data = await Activity.find({
      creator: new mongoose.Types.ObjectId(req.userId),
      visibility: { $ne: "private" },
      status: { $ne: "deleted" },
      ownerState: { $nin: ["successful", "closed", "expired"] },
      $nor: liveActivityFilter().$or,
    })
      .sort({ startsAt: 1 })
      .limit(10)
      .select("title category startsAt endsAt schedule")
      .lean();
    res.json({ data });
  });
  router.get("/:id", async (req: AuthedRequest, res) => {
    const activity = await visibleActivity(req.userId!, req.params.id, true);
    res.json({
      data: (await serializePlans([activity], req.userId!, true))[0],
    });
  });
  router.patch("/:id/state", async (req: AuthedRequest, res) => {
    const { state } = z
      .object({
        state: z.enum(["live", "paused", "successful", "closed", "expired"]),
      })
      .strict()
      .parse(req.body);
    const activity = await Activity.findOne({
      _id: objectId(req.params.id),
      creator: req.userId,
      status: { $ne: "deleted" },
    });
    if (!activity) throw fail(404, "Plan unavailable.");
    if (state === "live") {
      const owner = await User.findById(req.userId)
        .select("restrictions emailVerified")
        .lean();
      if (owner?.restrictions?.posting)
        throw fail(403, "Posting is restricted. Contact support to appeal.");
      if (config.EMAIL_VERIFICATION_REQUIRED && !owner?.emailVerified)
        throw fail(403, "Verify your email before going live.");
      if (activity.status !== "active")
        throw fail(
          409,
          "This plan is under review or paused by moderation. It cannot go live yet.",
        );
      const scope = await activityScope(req.userId!);
      const category = scope.categories.find(
        (cat) => cat.slug === activity.category,
      );
      if (!category || !category.allowedTypes.includes(activity.type))
        throw fail(
          409,
          "This category is not currently available for this plan.",
        );
      const live = liveActivityFilter();
      const data = await Activity.findOneAndUpdate(
        {
          _id: activity._id,
          creator: req.userId,
          status: "active",
          $or: live.$or,
        },
        { $set: { ownerState: state } },
        { new: true, runValidators: true },
      );
      if (!data)
        throw fail(
          409,
          "Reschedule this plan to a future date before going live.",
        );
      return res.json({ data: { ownerState: data.ownerState } });
    }
    const data = await Activity.findOneAndUpdate(
      {
        _id: activity._id,
        creator: req.userId,
        status: { $ne: "deleted" },
        // Only plans whose dates have passed can be marked expired.
        ...(state === "expired" ? { $nor: liveActivityFilter().$or } : {}),
      },
      { $set: { ownerState: state } },
      { new: true, runValidators: true },
    );
    if (!data) throw fail(404, "Plan unavailable.");
    res.json({ data: { ownerState: data.ownerState } });
  });
  router.post("/:id/interests", async (req: AuthedRequest, res) => {
    const activity = await visibleActivity(req.userId!, req.params.id);
    if (String(activity.creator) === req.userId)
      throw fail(404, "Plan not available.");
    const existing = await ActivityInterest.findOne({
      activity: activity._id,
      user: req.userId,
    });
    if (existing) {
      res.status(201).json({ data: existing });
      return;
    }
    const capacity =
      activity.activityType === "group" ? (activity.capacity ?? 100) : 1;
    if ((activity.participants?.length ?? 0) >= capacity)
      throw fail(409, "Activity Full");
    const interest = await ActivityInterest.findOneAndUpdate(
      { activity: activity._id, user: req.userId },
      {
        $setOnInsert: {
          activity: activity._id,
          user: req.userId,
          status: "pending",
        },
      },
      { upsert: true, new: true },
    );
    res.status(201).json({ data: interest });
  });
  router.post("/:id/save", async (req: AuthedRequest, res) => {
    const activity = await visibleActivity(req.userId!, req.params.id);
    await ActivitySave.updateOne(
      { user: req.userId, activity: activity._id },
      { $setOnInsert: { user: req.userId, activity: activity._id } },
      { upsert: true },
    );
    res.status(204).end();
  });
  router.delete("/:id/save", async (req: AuthedRequest, res) => {
    await ActivitySave.deleteOne({
      user: req.userId,
      activity: objectId(req.params.id),
    });
    res.status(204).end();
  });
  router.post(
    "/:id/interests/:interestId/decline",
    async (req: AuthedRequest, res) => {
      const activity = await visibleActivity(req.userId!, req.params.id);
      if (String(activity.creator) !== req.userId)
        throw fail(404, "Request unavailable.");
      const interest = await ActivityInterest.findOneAndUpdate(
        {
          _id: objectId(req.params.interestId),
          activity: activity._id,
          status: { $in: ["pending", null] },
        },
        { $set: { status: "declined", readAt: new Date() } },
      );
      if (!interest) throw fail(409, "Request already handled.");
      res.status(204).end();
    },
  );
  return router;
}
