import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { authenticate, type AuthedRequest } from "./auth.js";
import {
  Activity,
  Block,
  Category,
  Profile,
  ProfilePhoto,
  ProfileSwipe,
  User,
} from "./models.js";
import {
  completion,
  discoveryUserIds,
  fail,
  requireReady,
} from "./onboarding.js";
import { ensureMatch } from "./chat.js";
import { planAudienceVisibility } from "./plan-audience.js";

function ageOf(birth: Date) {
  const today = new Date();
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  if (
    today.getUTCMonth() < birth.getUTCMonth() ||
    (today.getUTCMonth() === birth.getUTCMonth() &&
      today.getUTCDate() < birth.getUTCDate())
  )
    age--;
  return age;
}
export async function compatibleProfiles(userId: string) {
  const [viewer, user, ready, blocks] = await Promise.all([
    Profile.findOne({ user: userId }).lean(),
    User.findById(userId).select("+birthDate"),
    discoveryUserIds(),
    Block.find({ $or: [{ user: userId }, { target: userId }] }).lean(),
  ]);
  if (!viewer || !user?.birthDate)
    throw fail(403, "Complete your profile first.");
  const blocked = blocks.map((b) =>
    String(b.user) === userId ? b.target : b.user,
  );
  const age = ageOf(user.birthDate),
    today = new Date();
  const min = viewer.preferences?.minAge ?? 18,
    max = viewer.preferences?.maxAge ?? 120;
  const oldest = new Date(
    Date.UTC(
      today.getUTCFullYear() - max - 1,
      today.getUTCMonth(),
      today.getUTCDate() + 1,
    ),
  );
  const youngest = new Date(
    Date.UTC(
      today.getUTCFullYear() - min,
      today.getUTCMonth(),
      today.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
  const others = {
    $in: ready,
    $nin: [new mongoose.Types.ObjectId(userId), ...blocked],
  };
  const [everyone, inAgeRange] = await Promise.all([
    User.find({ _id: others }).distinct("_id"),
    User.find({
      _id: others,
      birthDate: { $gte: oldest, $lte: youngest },
    }).distinct("_id"),
  ]);
  // Their preferences must always include the viewer: nobody is shown to people they excluded.
  const openToViewer = {
    "preferences.genders": viewer.gender,
    "preferences.minAge": { $lte: age },
    "preferences.maxAge": { $gte: age },
  };
  return {
    viewer,
    /** Members who are open to the viewer. Used for viewing, liking and lists. */
    filter: { user: { $in: everyone }, ...openToViewer },
    /** Members who also fit the viewer's own age and gender preferences. */
    mutualFilter: {
      user: { $in: inAgeRange },
      gender: { $in: viewer.preferences?.genders ?? [] },
      ...openToViewer,
    },
  };
}
async function publicCards(profiles: InstanceType<typeof Profile>[]) {
  const ids = profiles.map((p) => p.user);
  const users = await User.find({
    _id: { $in: ids },
    status: "active",
    adminRole: null,
  })
    .select("name identityVerified createdAt +birthDate")
    .lean();
  const photos = await ProfilePhoto.find({ owner: { $in: ids } })
    .select("owner")
    .lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return profiles.flatMap((p) => {
    const u = byId.get(String(p.user));
    if (!u?.birthDate) return [];
    const ownedPhotos = new Set(
      photos
        .filter((v) => String(v.owner) === String(p.user))
        .map((v) => String(v._id)),
    );
    return [
      {
        id: String(u._id),
        name: u.name,
        age: ageOf(u.birthDate),
        identityVerified: u.identityVerified,
        occupation: p.occupation ?? "",
        city: p.city ?? "",
        bio: p.bio ?? "",
        vibes: p.onboarding?.vibes ?? [],
        photoIds: p.photos.filter((id) => ownedPhotos.has(id)),
        personalityPrompt: p.onboarding?.personalityPrompt ?? null,
        relationshipIntent: p.onboarding?.relationshipIntent ?? null,
        firstPlanIntent: p.onboarding?.firstPlanIntent ?? null,
        details: Object.fromEntries(
          [...(p.optionalDetails ?? new Map<string, string>())].filter(
            ([, value]) => !!value?.trim(),
          ),
        ),
        memberSince: u.createdAt ?? null,
      },
    ];
  });
}
export function discoveryRouter() {
  const router = Router();
  router.use(authenticate, requireReady);
  router.get("/", async (req: AuthedRequest, res) => {
    const q = z
      .object({
        cityOnly: z.enum(["true", "false"]).default("true"),
        limit: z.coerce.number().int().min(1).max(30).default(20),
      })
      .parse(req.query);
    const { viewer, filter, mutualFilter } = await compatibleProfiles(
      req.userId!,
    );
    const seen = await ProfileSwipe.find({ user: req.userId }).distinct(
      "target",
    );
    const radius = viewer.preferences?.maxDistanceKm;
    const coordinates = viewer.approximateLocation?.coordinates;
    if (radius != null && coordinates?.length !== 2)
      throw fail(
        400,
        "Update your location in Dating Preferences to find nearby people.",
      );
    // The selected radius applies to both mutual matches and fallback suggestions.
    // When enabled, it replaces the city boundary so nearby members across cities appear.
    const city =
      radius != null && coordinates
        ? {
            approximateLocation: {
              $geoWithin: { $centerSphere: [coordinates, radius / 6378.1] },
            },
          }
        : q.cityOnly === "true"
          ? { city: viewer.city }
          : {};
    const vibes = new Set<string>(viewer.onboarding?.vibes ?? []);
    const byVibes = (a: { vibes: string[] }, b: { vibes: string[] }) =>
      b.vibes.filter((v) => vibes.has(v)).length -
      a.vibes.filter((v) => vibes.has(v)).length;
    // Mutual preference matches first; once they run out, fill with members open to the viewer.
    const mutual = await publicCards(
      await Profile.find({
        ...mutualFilter,
        user: { ...mutualFilter.user, $nin: seen },
        ...city,
      })
        .sort({ _id: -1 })
        .limit(q.limit),
    );
    const others =
      mutual.length < q.limit
        ? await publicCards(
            await Profile.find({
              ...filter,
              user: {
                ...filter.user,
                $nin: [...seen, ...mutual.map((c) => c.id)],
              },
              ...city,
            })
              .sort({ _id: -1 })
              .limit(q.limit - mutual.length),
          )
        : [];
    res.json({
      data: [
        ...mutual.sort(byVibes).map((c) => ({ ...c, mutualMatch: true })),
        ...others.sort(byVibes).map((c) => ({ ...c, mutualMatch: false })),
      ],
    });
  });
  router.get("/likes", async (req: AuthedRequest, res) => {
    const { filter } = await compatibleProfiles(req.userId!);
    const actions = await ProfileSwipe.find({
      user: req.userId,
      action: { $in: ["like", "save"] },
    })
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();
    const profiles = await Profile.find({
      ...filter,
      user: {
        ...filter.user,
        $in: filter.user.$in.filter((id) =>
          actions.some((a) => String(a.target) === String(id)),
        ),
      },
    });
    const cards = await publicCards(profiles);
    const reciprocal = await ProfileSwipe.find({
      user: { $in: cards.map((c) => c.id) },
      target: req.userId,
      action: "like",
    }).distinct("user");
    res.json({
      data: cards.map((card) => ({
        ...card,
        action: actions.find((v) => String(v.target) === card.id)!.action,
        likedAt:
          actions.find((v) => String(v.target) === card.id)!.updatedAt ?? null,
        mutual:
          actions.some(
            (v) => String(v.target) === card.id && v.action === "like",
          ) && reciprocal.some((id) => String(id) === card.id),
      })),
    });
  });
  router.get("/liked-me", async (req: AuthedRequest, res) => {
    const { filter } = await compatibleProfiles(req.userId!);
    const likes = await ProfileSwipe.find({
      target: req.userId,
      action: "like",
    })
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();
    const mine = await ProfileSwipe.find({
      user: req.userId,
      target: { $in: likes.map((l) => l.user) },
    }).lean();
    const myAction = new Map(mine.map((v) => [String(v.target), v.action]));
    // Liked back (now a match, so it lives in chat) or passed: no longer pending.
    const pending = likes.filter((l) => {
      const action = myAction.get(String(l.user));
      return action !== "like" && action !== "pass";
    });
    const profiles = await Profile.find({
      ...filter,
      user: {
        ...filter.user,
        $in: filter.user.$in.filter((id) =>
          pending.some((l) => String(l.user) === String(id)),
        ),
      },
    });
    const cards = await publicCards(profiles);
    const likedAt = new Map(pending.map((l) => [String(l.user), l.updatedAt]));
    res.json({
      data: cards
        .map((card) => ({
          ...card,
          likedAt: likedAt.get(card.id) ?? null,
          action: myAction.get(card.id),
        }))
        .sort((a, b) => +new Date(b.likedAt ?? 0) - +new Date(a.likedAt ?? 0)),
    });
  });
  router.get("/:id", async (req: AuthedRequest, res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id))
      throw fail(404, "Profile unavailable.");
    const { filter } = await compatibleProfiles(req.userId!);
    const profiles = await Profile.find({
      ...filter,
      user: { ...filter.user, $eq: req.params.id },
    }).limit(1);
    const [card] = await publicCards(profiles);
    if (!card) throw fail(404, "Profile unavailable.");
    const { mutualFilter } = await compatibleProfiles(req.userId!);
    const [own, reciprocal, plans, mutualMatch] = await Promise.all([
      ProfileSwipe.findOne({ user: req.userId, target: card.id }).lean(),
      ProfileSwipe.exists({
        user: card.id,
        target: req.userId,
        action: "like",
      }),
      Activity.find({
        $and: [await planAudienceVisibility(req.userId!)],
        visibility: { $ne: "private" },
        creator: card.id,
        status: "active",
        startsAt: { $gte: new Date() },
        category: {
          $in: await Category.find({ active: true }).distinct("slug"),
        },
      })
        .sort({ startsAt: 1 })
        .limit(5)
        .select("title category zone startsAt type")
        .lean(),
      Profile.exists({
        ...mutualFilter,
        user: { ...mutualFilter.user, $eq: card.id },
      }),
    ]);
    res.json({
      data: {
        ...card,
        mutualMatch: !!mutualMatch,
        action: own?.action === "pass" ? undefined : own?.action,
        mutual: own?.action === "like" && !!reciprocal,
        conversationId:
          own?.action === "like" && reciprocal
            ? await ensureMatch(req.userId!, card.id)
            : null,
        plans,
      },
    });
  });
  router.post("/:id/action", async (req: AuthedRequest, res) => {
    const body = z
      .object({ action: z.enum(["like", "pass", "save"]) })
      .strict()
      .parse(req.body);
    if (
      !mongoose.isObjectIdOrHexString(req.params.id) ||
      req.params.id === req.userId
    )
      throw fail(400, "Choose another member's profile.");
    const { filter } = await compatibleProfiles(req.userId!);
    if (
      !(await Profile.exists({
        ...filter,
        user: { ...filter.user, $eq: req.params.id },
      })) ||
      !(await completion(String(req.params.id))).activated
    )
      throw fail(404, "Profile unavailable.");
    await ProfileSwipe.findOneAndUpdate(
      { user: req.userId, target: req.params.id },
      { $set: { action: body.action } },
      { upsert: true, runValidators: true },
    );
    const mutual =
      body.action === "like" &&
      !!(await ProfileSwipe.exists({
        user: req.params.id,
        target: req.userId,
        action: "like",
      }));
    const conversationId = mutual
      ? await ensureMatch(req.userId!, String(req.params.id))
      : null;
    res.json({ data: { action: body.action, mutual, conversationId } });
  });
  return router;
}
