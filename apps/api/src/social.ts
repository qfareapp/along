import { Router } from "express";
import mongoose from "mongoose";
import multer from "multer";
import { compressPhoto } from "./compress-photo.js";
import { rateLimit } from "express-rate-limit";
import { memberRateKey, rateLimitMessage } from "./rate-limits.js";
import { z } from "zod";
import { authenticate, type AuthedRequest } from "./auth.js";
import {
  completion,
  discoveryUserIds,
  fail,
  requireReady,
} from "./onboarding.js";
import {
  Activity,
  Block,
  Category,
  Conversation,
  Match,
  Message,
  Profile,
  ProfilePhoto,
  Report,
  User,
} from "./models.js";
import { pairKey } from "./chat.js";
import { compatibleProfiles } from "./discovery.js";
import {
  SocialMoment,
  SocialSettings,
  MomentReaction,
  MomentView,
  SocialNotification,
  PlanInvitation,
} from "./social-models.js";
import {
  storeMomentPhoto,
  readMomentPhoto,
  removeMomentPhoto,
} from "./social-storage.js";

const id = (v: unknown) => {
  if (typeof v !== "string" || !mongoose.isObjectIdOrHexString(v))
    throw fail(404, "Social content unavailable.");
  return new mongoose.Types.ObjectId(v);
};
const ids = z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(200);
const audience = z.enum(["matches", "discover", "close_circle", "only_me"]);
const feedMode = z.enum(["matches", "discover"]).default("matches");
export const socialDefaults = {
  enabled: true,
  audience: "matches" as const,
  closeCircle: [] as string[],
  hidden: [] as string[],
  muted: [] as string[],
  allowReshare: false,
  viewReceipts: true,
  archive: true,
  notifications: true,
};
export async function socialScope(userId: string) {
  const [ready, matches, blocks, stored] = await Promise.all([
    discoveryUserIds(),
    Match.find({ users: userId, active: true }).lean(),
    Block.find({ $or: [{ user: userId }, { target: userId }] }).lean(),
    SocialSettings.findOne({ user: userId }).lean(),
  ]);
  const settings = stored ?? socialDefaults;
  const blocked = new Set(
    blocks.map((b) => String(String(b.user) === userId ? b.target : b.user)),
  );
  const readyIds = new Set(ready.map(String));
  const potential = matches
    .flatMap((m) => m.users.filter((u) => String(u) !== userId).map(String))
    .filter((u) => readyIds.has(u) && !blocked.has(u));
  let discoverCandidates: string[] = [];
  if (readyIds.has(userId) && settings.enabled) {
    const { viewer, mutualFilter } = await compatibleProfiles(userId);
    const radius = viewer.preferences?.maxDistanceKm;
    const coordinates = viewer.approximateLocation?.coordinates;
    if (radius == null || coordinates?.length === 2) {
      const location =
        radius != null && coordinates
          ? {
              approximateLocation: {
                $geoWithin: { $centerSphere: [coordinates, radius / 6378.1] },
              },
            }
          : { city: viewer.city };
      discoverCandidates = (
        await Profile.find({ ...mutualFilter, ...location }).distinct("user")
      ).map(String);
    }
  }
  const theirSettings = await SocialSettings.find({
    user: { $in: [...new Set([...potential, ...discoverCandidates])] },
  }).lean();
  const byUser = new Map(theirSettings.map((s) => [String(s.user), s]));
  const eligibleConnections = readyIds.has(userId)
    ? potential.filter((u) => byUser.get(u)?.enabled !== false)
    : [];
  const connections = settings.enabled ? eligibleConnections : [];
  return {
    userId,
    settings,
    connections,
    eligibleConnections,
    discoverAuthors: discoverCandidates.filter(
      (u) => byUser.get(u)?.enabled !== false,
    ),
    byUser,
    matches,
  };
}
type Scope = Awaited<ReturnType<typeof socialScope>>;
type Moment = mongoose.InferSchemaType<typeof SocialMoment.schema> & {
  _id: mongoose.Types.ObjectId;
};
const includes = (values: readonly unknown[], user: string) =>
  values.some((v) => String(v) === user);
const audienceMembers = (scope: Scope, moment: Moment) =>
  moment.audience === "discover"
    ? [...new Set([...scope.connections, ...scope.discoverAuthors])]
    : scope.connections;
function permits(scope: Scope, moment: Moment) {
  const author = String(moment.author);
  if (author === scope.userId) return true;
  if (moment.audience === "only_me") return false;
  if (
    includes(moment.excluded, scope.userId) ||
    includes(scope.byUser.get(author)?.hidden ?? [], scope.userId)
  )
    return false;
  return moment.audience === "discover"
    ? scope.discoverAuthors.includes(author)
    : scope.connections.includes(author) &&
        (moment.audience === "matches" ||
          includes(moment.allowed, scope.userId));
}
export async function authorizedMoment(
  userId: string,
  momentId: unknown,
  archive = false,
) {
  const [scope, moment] = await Promise.all([
    socialScope(userId),
    SocialMoment.findById(id(momentId)).select("+media").lean(),
  ]);
  const ownArchive =
    archive && String(moment?.author) === userId && scope.settings.archive;
  if (
    !moment ||
    moment.status === "removed" ||
    !permits(scope, moment) ||
    (!ownArchive &&
      (moment.status !== "active" || moment.expiresAt <= new Date()))
  )
    throw fail(404, "This Moment is no longer available.");
  return { scope, moment };
}
async function visibleFilter(
  scope: Scope,
  mode: "matches" | "discover" = "matches",
) {
  const authors = scope.connections.filter(
    (u) =>
      (mode === "matches" || scope.discoverAuthors.includes(u)) &&
      !includes(scope.settings.muted, u) &&
      !includes(scope.byUser.get(u)?.hidden ?? [], scope.userId),
  );
  return {
    status: "active",
    expiresAt: { $gt: new Date() },
    $or: [
      { author: id(scope.userId) },
      {
        author: { $in: authors.map((value) => id(value)) },
        excluded: { $ne: id(scope.userId) },
        $or: [
          { audience: "matches" },
          { audience: "close_circle", allowed: id(scope.userId) },
        ],
      },
      {
        author: {
          $in: scope.discoverAuthors
            .filter(
              (u) =>
                (mode === "discover" || scope.connections.includes(u)) &&
                !includes(scope.settings.muted, u) &&
                !includes(scope.byUser.get(u)?.hidden ?? [], scope.userId),
            )
            .map((u) => id(u)),
        },
        audience: "discover",
        excluded: { $ne: id(scope.userId) },
      },
    ],
  };
}
async function cards(userId: string, moments: Moment[]) {
  const authorIds = [...new Set(moments.map((m) => String(m.author)))];
  const momentIds = moments.map((m) => m._id);
  const [users, profiles, photos, reactions, views, matches] =
    await Promise.all([
      User.find({ _id: { $in: authorIds } })
        .select("name")
        .lean(),
      Profile.find({ user: { $in: authorIds } })
        .select("user photos")
        .lean(),
      ProfilePhoto.find({ owner: { $in: authorIds } })
        .select("owner")
        .lean(),
      MomentReaction.find({ moment: { $in: momentIds }, user: userId }).lean(),
      MomentView.find({ moment: { $in: momentIds }, user: userId }).lean(),
      Match.find({ users: userId, active: true }).select("users").lean(),
    ]);
  return moments.map((m) => ({
    id: String(m._id),
    own: String(m.author) === userId,
    canReply: matches.some((match) => includes(match.users, String(m.author))),
    author: {
      id: String(m.author),
      name:
        users.find((u) => String(u._id) === String(m.author))?.name ??
        "Along member",
      photoId:
        profiles
          .find((p) => String(p.user) === String(m.author))
          ?.photos.find((p) =>
            photos.some(
              (photo) =>
                String(photo._id) === p &&
                String(photo.owner) === String(m.author),
            ),
          ) ?? null,
    },
    type: m.type,
    text: m.text,
    caption: m.caption,
    theme: m.theme,
    category: m.category,
    audience: String(m.author) === userId ? m.audience : undefined,
    allowReshare: m.allowReshare,
    publishedAt: m.publishedAt,
    expiresAt: m.expiresAt,
    status: m.status,
    viewed: views.some((v) => String(v.moment) === String(m._id)),
    reaction:
      reactions.find((r) => String(r.moment) === String(m._id))?.emoji ?? null,
    mediaPath: m.type === "photo" ? `/social/moments/${m._id}/media` : null,
  }));
}
async function notify(
  actor: string,
  recipient: string,
  kind: string,
  key: string,
  moment?: string,
  invitation?: string,
) {
  if (actor === recipient) return;
  const scope = await socialScope(recipient);
  if (
    !scope.settings.notifications ||
    (!scope.connections.includes(actor) &&
      !scope.discoverAuthors.includes(actor)) ||
    includes(scope.settings.muted, actor)
  )
    return;
  if (moment) {
    try {
      await authorizedMoment(recipient, moment);
    } catch {
      return;
    }
  }
  await SocialNotification.updateOne(
    { key },
    { $setOnInsert: { actor, recipient, kind, moment, invitation } },
    { upsert: true },
  );
}
async function socialConversation(from: string, to: string) {
  const scope = await socialScope(from);
  if (!scope.connections.includes(to))
    throw fail(404, "Connection unavailable.");
  const match = await Match.findOne({
    pairKey: pairKey(from, to),
    active: true,
  });
  const conversation = match
    ? await Conversation.findOne({ match: match._id })
    : null;
  if (!conversation) throw fail(404, "Conversation unavailable.");
  const user = await User.findById(from).select("restrictions");
  if (user?.restrictions?.messaging)
    throw fail(403, "Messaging is restricted. Contact support to appeal.");
  if (
    conversation.firstSender &&
    String(conversation.firstSender) !== from &&
    !(await Message.exists({ conversation: conversation._id }))
  )
    throw fail(403, "The activity owner must send the first message.");
  return conversation;
}
async function privateMessage(
  from: string,
  to: string,
  text: string,
  moment?: string,
  kind: "reply" | "share" = "reply",
) {
  const conversation = await socialConversation(from, to);
  const message = await Message.create({
    conversation: conversation._id,
    sender: from,
    text,
    socialMoment: moment,
    socialKind: kind,
  });
  await Conversation.updateOne(
    { _id: conversation._id },
    { $set: { updatedAt: new Date() } },
  );
  return {
    conversationId: String(conversation._id),
    messageId: String(message._id),
  };
}
const proposal = z
  .object({
    title: z.string().trim().min(3).max(100),
    category: z.string().min(1).max(50),
    zone: z.string().trim().min(2).max(100),
    startsAt: z.iso
      .datetime({ offset: true })
      .refine((v) => new Date(v) > new Date(), "Choose a future time."),
  })
  .strict();
async function checkCategory(category: string, userId: string) {
  const profile = await Profile.findOne({ user: userId });
  if (
    !(await Category.exists({
      slug: category,
      active: true,
      $or: [{ cities: { $size: 0 } }, { cities: profile?.city }],
    }))
  )
    throw fail(400, "Choose an available plan category.");
}
export async function cleanupSocial(now = new Date()) {
  await SocialMoment.updateMany(
    { status: "active", expiresAt: { $lte: now } },
    { $set: { status: "expired" } },
  );
  // Thirty-day moderation retention. Archives and reported evidence are preserved.
  const old = await SocialMoment.aggregate<Moment>([
    {
      $match: {
        status: { $in: ["expired", "removed"] },
        expiresAt: { $lt: new Date(+now - 30 * 86400000) },
      },
    },
    {
      $lookup: {
        from: SocialSettings.collection.name,
        localField: "author",
        foreignField: "user",
        as: "settings",
      },
    },
    { $match: { $or: [{ status: "removed" }, { "settings.archive": false }] } },
    {
      $lookup: {
        from: Report.collection.name,
        localField: "_id",
        foreignField: "moment",
        as: "evidence",
      },
    },
    { $match: { "evidence.0": { $exists: false } } },
    { $limit: 100 },
    { $project: { settings: 0, evidence: 0 } },
  ]);
  for (const moment of old) {
    const settings = await SocialSettings.findOne({ user: moment.author });
    if (
      (moment.status !== "removed" && settings?.archive !== false) ||
      (await Report.exists({ moment: moment._id }))
    )
      continue;
    if (moment.media) await removeMomentPhoto(moment.media);
    await Promise.all([
      MomentReaction.deleteMany({ moment: moment._id }),
      MomentView.deleteMany({ moment: moment._id }),
      SocialMoment.deleteOne({ _id: moment._id }),
    ]);
  }
}

export function socialRouter() {
  const router = Router();
  router.use(authenticate, requireReady);
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });
  const mutate = rateLimit({
    windowMs: 60000,
    limit: 35,
    keyGenerator: memberRateKey,
    message: rateLimitMessage,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const publishLimit = rateLimit({
    windowMs: 3600000,
    limit: 20,
    keyGenerator: memberRateKey,
    message: rateLimitMessage,
  });
  router.get("/categories", async (req: AuthedRequest, res) => {
    const profile = await Profile.findOne({ user: req.userId });
    const categories = await Category.find({
      active: true,
      $or: [{ cities: { $size: 0 } }, { cities: profile?.city }],
    })
      .select("slug name")
      .sort({ displayOrder: 1 })
      .lean();
    res.json({ data: categories.map((c) => ({ slug: c.slug, name: c.name })) });
  });
  router.get("/settings", async (req: AuthedRequest, res) => {
    const scope = await socialScope(req.userId!);
    const s = scope.settings;
    res.json({
      data: s
        ? {
            enabled: s.enabled,
            audience: s.audience,
            closeCircle: s.closeCircle
              .map(String)
              .filter((u) => scope.eligibleConnections.includes(u)),
            hidden: s.hidden
              .map(String)
              .filter((u) => scope.eligibleConnections.includes(u)),
            muted: s.muted
              .map(String)
              .filter((u) => scope.eligibleConnections.includes(u)),
            allowReshare: s.allowReshare,
            viewReceipts: s.viewReceipts,
            archive: s.archive,
            notifications: s.notifications,
          }
        : socialDefaults,
    });
  });
  router.patch("/settings", mutate, async (req: AuthedRequest, res) => {
    const body = z
      .object({
        enabled: z.boolean(),
        audience,
        closeCircle: ids,
        hidden: ids,
        muted: ids,
        allowReshare: z.boolean(),
        viewReceipts: z.boolean(),
        archive: z.boolean(),
        notifications: z.boolean(),
      })
      .strict()
      .parse(req.body);
    // Temporarily disabled users can still manage their retained connection lists.
    const scope = await socialScope(req.userId!);
    const matched = scope.eligibleConnections;
    if (
      [...body.closeCircle, ...body.hidden, ...body.muted].some(
        (u) => !matched.includes(u),
      )
    )
      throw fail(400, "Select only your matches.");
    await SocialSettings.updateOne(
      { user: req.userId },
      { $set: body },
      { upsert: true, runValidators: true },
    );
    res.json({ data: body });
  });
  router.get("/connections", async (req: AuthedRequest, res) => {
    const scope = await socialScope(req.userId!);
    const users = await User.find({ _id: { $in: scope.eligibleConnections } })
      .select("name")
      .lean();
    res.json({ data: users.map((u) => ({ id: String(u._id), name: u.name })) });
  });
  router.get("/feed", async (req: AuthedRequest, res) => {
    const query = z
      .object({
        before: z
          .string()
          .regex(/^[a-f\d]{24}$/i)
          .optional(),
        author: z
          .string()
          .regex(/^[a-f\d]{24}$/i)
          .optional(),
        limit: z.coerce.number().int().min(1).max(30).default(15),
        scope: feedMode,
        includePlans: z.enum(["true", "false"]).default("false"),
      })
      .parse(req.query);
    const scope = await socialScope(req.userId!);
    const rows = await SocialMoment.find({
      ...(await visibleFilter(scope, query.scope)),
      ...(query.author ? { author: id(query.author) } : {}),
      ...(query.before ? { _id: { $lt: id(query.before) } } : {}),
    })
      .sort({ _id: -1 })
      .limit(query.limit + 1)
      .lean();
    if (query.includePlans === "true") {
      const authors = [
        scope.userId,
        ...(query.scope === "matches"
          ? scope.connections
          : scope.discoverAuthors
        ).filter(
          (author) =>
            !includes(scope.settings.muted, author) &&
            !includes(scope.byUser.get(author)?.hidden ?? [], scope.userId),
        ),
      ].filter((author) => !query.author || author === query.author);
      // Load at request time to avoid initializing activities/social through each other.
      const { socialPlanCards } = await import("./activities.js");
      const [moments, plans] = await Promise.all([
        cards(req.userId!, rows),
        socialPlanCards(req.userId!, authors, query.before, query.limit + 1),
      ]);
      const mixed = [
        ...moments.map((moment) => ({
          kind: "moment" as const,
          id: moment.id,
          moment,
        })),
        ...plans.map((plan) => ({ kind: "plan" as const, id: plan._id, plan })),
      ].sort((a, b) => b.id.localeCompare(a.id));
      const more = mixed.length > query.limit;
      mixed.splice(query.limit);
      return void res.json({
        data: {
          items: mixed,
          next: more ? mixed.at(-1)!.id : null,
          connectionCount: scope.connections.length,
        },
      });
    }
    const more = rows.length > query.limit;
    rows.splice(query.limit);
    res.json({
      data: {
        items: await cards(req.userId!, rows),
        next: more ? String(rows.at(-1)!._id) : null,
        connectionCount: scope.connections.length,
      },
    });
  });
  router.get("/tray", async (req: AuthedRequest, res) => {
    const mode = feedMode.parse(req.query.scope);
    const scope = await socialScope(req.userId!);
    const rows = (await SocialMoment.aggregate([
      { $match: await visibleFilter(scope, mode) },
      { $sort: { _id: -1 } },
      { $group: { _id: "$author", latest: { $first: "$$ROOT" } } },
      { $sort: { "latest._id": -1 } },
      { $limit: 100 },
      { $replaceRoot: { newRoot: "$latest" } },
    ])) as Moment[];
    const serialized = await cards(req.userId!, rows);
    // A ring stays unviewed until every current Moment from that author has been viewed.
    const unseen = await SocialMoment.aggregate([
      { $match: await visibleFilter(scope, mode) },
      {
        $lookup: {
          from: MomentView.collection.name,
          let: { moment: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$moment", "$$moment"] },
                    { $eq: ["$user", id(req.userId)] },
                  ],
                },
              },
            },
          ],
          as: "seen",
        },
      },
      { $match: { "seen.0": { $exists: false } } },
      { $group: { _id: "$author" } },
    ]);
    const unviewed = new Set(unseen.map((r) => String(r._id)));
    res.json({
      data: serialized
        .map((m) => ({ ...m, viewed: !unviewed.has(m.author.id) }))
        .sort(
          (a, b) =>
            Number(b.own) - Number(a.own) ||
            Number(a.viewed) - Number(b.viewed) ||
            +new Date(b.publishedAt) - +new Date(a.publishedAt),
        ),
    });
  });
  for (const [route, archive] of [
    ["my-moments", false],
    ["my-archive", true],
  ] as const)
    router.get(`/${route}`, async (req: AuthedRequest, res) => {
      const scope = await socialScope(req.userId!);
      if (archive && !scope.settings.archive)
        return void res.json({ data: [] });
      const moments = await SocialMoment.find({
        author: req.userId,
        status: { $ne: "removed" },
        expiresAt: archive ? { $lte: new Date() } : { $gt: new Date() },
      })
        .sort({ _id: -1 })
        .limit(50)
        .lean();
      res.json({ data: await cards(req.userId!, moments) });
    });
  router.post(
    "/moments",
    publishLimit,
    multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 8 * 1024 * 1024,
        files: 1,
        fields: 1,
        fieldSize: 12000,
      },
    }).single("photo"),
    async (req: AuthedRequest, res) => {
      let raw = req.body;
      if (req.is("multipart/form-data")) {
        try {
          raw = JSON.parse(req.body.payload);
        } catch {
          throw fail(400, "Invalid Moment details.");
        }
      }
      const scope = await socialScope(req.userId!);
      if (!scope.settings.enabled)
        throw fail(403, "Enable Social in your privacy settings first.");
      if (
        (await SocialMoment.countDocuments({
          author: req.userId,
          status: "active",
          expiresAt: { $gt: new Date() },
        })) >= 20
      )
        throw fail(
          429,
          "You can share up to 20 active Moments. Delete one or wait for it to expire.",
        );
      const me = await User.findById(req.userId).select("restrictions");
      if (me?.restrictions?.posting)
        throw fail(403, "Posting is restricted. Contact support to appeal.");
      const b = z
        .object({
          type: z.enum(["text", "photo", "question", "along_now"]),
          text: z.string().trim().max(600).default(""),
          caption: z.string().trim().max(500).default(""),
          theme: z.enum(["teal", "coral", "peach", "night"]).default("teal"),
          audience: audience.optional(),
          allowed: ids.optional(),
          excluded: ids.default([]),
          allowReshare: z.boolean().optional(),
          category: z.string().max(50).optional(),
        })
        .strict()
        .parse(raw);
      const selectedAudience = b.audience ?? scope.settings.audience;
      const allowed =
        b.allowed ??
        (selectedAudience === "close_circle"
          ? scope.settings.closeCircle
              .map(String)
              .filter((u) => scope.connections.includes(u))
          : []);
      if (
        [...allowed, ...b.excluded].some((u) => !scope.connections.includes(u))
      )
        throw fail(
          400,
          "Choose only currently eligible matches for your audience.",
        );
      if (selectedAudience === "close_circle" && !allowed.length)
        throw fail(400, "Choose at least one match for Close Circle.");
      if (b.type !== "photo" && !b.text)
        throw fail(400, "Add something to your Moment.");
      if ((b.type === "photo") !== !!req.file)
        throw fail(400, "Select a photo for a photo Moment.");
      if (b.category) await checkCategory(b.category, req.userId!);
      let media: string | undefined;
      if (req.file) {
        if (
          !["image/jpeg", "image/png", "image/webp"].includes(req.file.mimetype)
        )
          throw fail(400, "Choose a JPEG, PNG or WebP image.");
        let bytes: Buffer;
        try {
          bytes = await compressPhoto(req.file.buffer);
        } catch {
          throw fail(
            400,
            "This photo could not be processed. Choose another image.",
          );
        }
        media = await storeMomentPhoto(bytes, req.userId!);
      }
      const publishedAt = new Date();
      let moment;
      try {
        moment = await SocialMoment.create({
          ...b,
          allowed,
          audience: selectedAudience,
          allowReshare: b.allowReshare ?? scope.settings.allowReshare,
          author: req.userId,
          media,
          publishedAt,
          expiresAt: new Date(+publishedAt + 86400000),
        });
      } catch (error) {
        if (media) await removeMomentPhoto(media);
        throw error;
      }
      // Notifications contain references only; every read checks current eligibility.
      await Promise.allSettled(
        scope.connections.map((to) =>
          notify(
            req.userId!,
            to,
            "moment",
            `moment:${moment._id}:${to}`,
            String(moment._id),
          ),
        ),
      );
      res.status(201).json({ data: (await cards(req.userId!, [moment]))[0] });
    },
  );
  router.get("/moments/:id", async (req: AuthedRequest, res) => {
    const { moment } = await authorizedMoment(req.userId!, req.params.id);
    res.json({ data: (await cards(req.userId!, [moment]))[0] });
  });
  router.get("/moments/:id/media", async (req: AuthedRequest, res) => {
    const { moment } = await authorizedMoment(req.userId!, req.params.id, true);
    if (!moment.media) throw fail(404, "Photo unavailable.");
    res.type("image/jpeg").send(await readMomentPhoto(moment.media));
  });
  router.delete("/moments/:id", mutate, async (req: AuthedRequest, res) => {
    const moment = await SocialMoment.findOne({
      _id: id(req.params.id),
      author: req.userId,
    });
    if (!moment) throw fail(404, "Moment unavailable.");
    await SocialMoment.updateOne(
      { _id: moment._id },
      { $set: { status: "removed" } },
    );
    res.status(204).end();
  });
  router.patch(
    "/moments/:id/audience",
    mutate,
    async (req: AuthedRequest, res) => {
      const { moment, scope } = await authorizedMoment(
        req.userId!,
        req.params.id,
      );
      if (String(moment.author) !== req.userId)
        throw fail(404, "Moment unavailable.");
      const b = z
        .object({
          audience,
          allowed: ids,
          excluded: ids,
          allowReshare: z.boolean(),
        })
        .strict()
        .parse(req.body);
      if (
        [...b.allowed, ...b.excluded].some(
          (u) => !scope.connections.includes(u),
        ) ||
        (b.audience === "close_circle" && !b.allowed.length)
      )
        throw fail(400, "Choose eligible matches for your audience.");
      await SocialMoment.updateOne({ _id: moment._id }, { $set: b });
      res.status(204).end();
    },
  );
  router.post("/moments/:id/views", async (req: AuthedRequest, res) => {
    const { moment, scope } = await authorizedMoment(
      req.userId!,
      req.params.id,
    );
    if (String(moment.author) !== req.userId)
      await MomentView.updateOne(
        { moment: moment._id, user: req.userId },
        {
          $setOnInsert: {
            moment: moment._id,
            user: req.userId,
            visible: scope.settings.viewReceipts,
          },
        },
        { upsert: true },
      );
    res.status(204).end();
  });
  router.get("/moments/:id/views", async (req: AuthedRequest, res) => {
    const { moment, scope } = await authorizedMoment(
      req.userId!,
      req.params.id,
      true,
    );
    if (String(moment.author) !== req.userId)
      throw fail(404, "Viewer list unavailable.");
    const views = await MomentView.find({
      moment: moment._id,
      user: { $in: audienceMembers(scope, moment) },
      visible: { $ne: false },
    })
      .sort({ _id: -1 })
      .limit(200)
      .lean();
    const users = await User.find({ _id: { $in: views.map((v) => v.user) } })
      .select("name")
      .lean();
    res.json({
      data: views.map((v) => ({
        id: String(v.user),
        name: users.find((u) => String(u._id) === String(v.user))?.name,
        viewedAt: v.createdAt,
      })),
    });
  });
  router.put(
    "/moments/:id/reaction",
    mutate,
    async (req: AuthedRequest, res) => {
      const { emoji } = z
        .object({ emoji: z.enum(["❤️", "😂", "🔥", "☕", "👀", "🙌"]) })
        .strict()
        .parse(req.body);
      const { moment } = await authorizedMoment(req.userId!, req.params.id);
      if (String(moment.author) === req.userId)
        throw fail(400, "React to a match's Moment.");
      await MomentReaction.updateOne(
        { moment: moment._id, user: req.userId },
        { $set: { emoji } },
        { upsert: true },
      );
      await notify(
        req.userId!,
        String(moment.author),
        "reaction",
        `reaction:${moment._id}:${req.userId}`,
        String(moment._id),
      );
      res.json({ data: { emoji } });
    },
  );
  router.get("/moments/:id/reactions", async (req: AuthedRequest, res) => {
    const { moment, scope } = await authorizedMoment(
      req.userId!,
      req.params.id,
      true,
    );
    if (String(moment.author) !== req.userId)
      throw fail(404, "Reactions unavailable.");
    const reactions = await MomentReaction.find({
      moment: moment._id,
      user: { $in: audienceMembers(scope, moment) },
    })
      .limit(200)
      .lean();
    const users = await User.find({
      _id: { $in: reactions.map((r) => r.user) },
    })
      .select("name")
      .lean();
    res.json({
      data: reactions.map((r) => ({
        id: String(r.user),
        name: users.find((u) => String(u._id) === String(r.user))?.name,
        emoji: r.emoji,
      })),
    });
  });
  router.delete(
    "/moments/:id/reaction",
    mutate,
    async (req: AuthedRequest, res) => {
      const { moment } = await authorizedMoment(req.userId!, req.params.id);
      await MomentReaction.deleteOne({ moment: moment._id, user: req.userId });
      res.status(204).end();
    },
  );
  router.post(
    "/moments/:id/replies",
    mutate,
    async (req: AuthedRequest, res) => {
      const { text } = z
        .object({ text: z.string().trim().min(1).max(1500) })
        .strict()
        .parse(req.body);
      const { moment } = await authorizedMoment(req.userId!, req.params.id);
      const result = await privateMessage(
        req.userId!,
        String(moment.author),
        text,
        String(moment._id),
      );
      await notify(
        req.userId!,
        String(moment.author),
        "reply",
        `reply:${result.messageId}`,
        String(moment._id),
      );
      res.status(201).json({ data: result });
    },
  );
  router.get(
    "/moments/:id/share-recipients",
    async (req: AuthedRequest, res) => {
      const { moment, scope } = await authorizedMoment(
        req.userId!,
        req.params.id,
      );
      if (!moment.allowReshare) return void res.json({ data: [] });
      const eligible: string[] = [];
      for (const to of scope.connections) {
        if (to === String(moment.author)) continue;
        try {
          await authorizedMoment(to, req.params.id);
          await socialConversation(req.userId!, to);
          eligible.push(to);
        } catch {
          /* Recipient has no independent permission. */
        }
      }
      const users = await User.find({ _id: { $in: eligible } })
        .select("name")
        .lean();
      res.json({
        data: users.map((u) => ({ id: String(u._id), name: u.name })),
      });
    },
  );
  router.post("/moments/:id/share", mutate, async (req: AuthedRequest, res) => {
    const { recipient } = z
      .object({ recipient: z.string().regex(/^[a-f\d]{24}$/i) })
      .strict()
      .parse(req.body);
    const { moment } = await authorizedMoment(req.userId!, req.params.id);
    if (!moment.allowReshare)
      throw fail(403, "The creator hasn't enabled sharing for this Moment.");
    await authorizedMoment(recipient, req.params.id);
    const result = await privateMessage(
      req.userId!,
      recipient,
      "Shared a private Moment. Open it while it is still available.",
      String(moment._id),
      "share",
    );
    await notify(
      req.userId!,
      recipient,
      "shared",
      `shared:${result.messageId}`,
      String(moment._id),
    );
    res.status(201).json({ data: result });
  });
  router.post(
    "/moments/:id/report",
    mutate,
    async (req: AuthedRequest, res) => {
      const { reason } = z
        .object({ reason: z.string().trim().min(5).max(1500) })
        .strict()
        .parse(req.body);
      const { moment } = await authorizedMoment(req.userId!, req.params.id);
      if (String(moment.author) === req.userId)
        throw fail(400, "You can delete your own Moment.");
      await Report.updateOne(
        { reporter: req.userId, moment: moment._id },
        {
          $setOnInsert: {
            reporter: req.userId,
            target: moment.author,
            moment: moment._id,
            reason,
          },
        },
        { upsert: true },
      );
      res.status(204).end();
    },
  );
  router.post(
    "/moments/:id/make-plan",
    mutate,
    async (req: AuthedRequest, res) => {
      const b = proposal.parse(req.body);
      const { moment } = await authorizedMoment(req.userId!, req.params.id);
      await socialConversation(req.userId!, String(moment.author));
      await checkCategory(b.category, req.userId!);
      const invite = await PlanInvitation.create({
        ...b,
        moment: moment._id,
        proposer: req.userId,
        recipient: moment.author,
      });
      await notify(
        req.userId!,
        String(moment.author),
        "invitation",
        `invitation:${invite._id}:0`,
        undefined,
        String(invite._id),
      );
      res.status(201).json({ data: { id: String(invite._id) } });
    },
  );
  router.get("/invitations", async (req: AuthedRequest, res) => {
    const scope = await socialScope(req.userId!);
    const invitations = await PlanInvitation.find({
      $or: [
        { proposer: req.userId, recipient: { $in: scope.connections } },
        { recipient: req.userId, proposer: { $in: scope.connections } },
      ],
    })
      .sort({ _id: -1 })
      .limit(50)
      .lean();
    const users = await User.find({ _id: { $in: scope.connections } })
      .select("name")
      .lean();
    res.json({
      data: invitations.map((i) => ({
        id: String(i._id),
        title: i.title,
        category: i.category,
        zone: i.zone,
        startsAt: i.startsAt,
        status: i.status,
        version: i.version,
        incoming: String(i.recipient) === req.userId,
        member:
          users.find(
            (u) =>
              String(u._id) ===
              String(
                String(i.recipient) === req.userId ? i.proposer : i.recipient,
              ),
          )?.name ?? "Your match",
        activityId: i.activity ? String(i.activity) : null,
      })),
    });
  });
  router.post(
    "/invitations/:id/respond",
    mutate,
    async (req: AuthedRequest, res) => {
      const b = z
        .object({
          action: z.enum(["accept", "decline", "changes"]),
          version: z.number().int().min(0),
          proposal: proposal.optional(),
        })
        .strict()
        .parse(req.body);
      const invite = await PlanInvitation.findOne({
        _id: id(req.params.id),
        recipient: req.userId,
        status: "pending",
        version: b.version,
      });
      if (!invite)
        throw fail(
          409,
          "This invitation has changed. Refresh to see its latest details.",
        );
      await socialConversation(req.userId!, String(invite.proposer));
      if (b.action === "changes" && !b.proposal)
        throw fail(400, "Add your suggested plan details.");
      if (b.action !== "decline") {
        if (new Date(b.proposal?.startsAt ?? invite.startsAt) <= new Date())
          throw fail(400, "Choose a future time.");
        await checkCategory(
          b.proposal?.category ?? invite.category,
          req.userId!,
        );
      }
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const update =
            b.action === "changes"
              ? {
                  ...b.proposal!,
                  proposer: req.userId,
                  recipient: invite.proposer,
                }
              : { status: b.action === "accept" ? "accepted" : "declined" };
          const changed = await PlanInvitation.findOneAndUpdate(
            {
              _id: invite._id,
              status: "pending",
              version: b.version,
              recipient: req.userId,
            },
            { $set: update, $inc: { version: 1 } },
            { new: true, session },
          );
          if (!changed)
            throw fail(
              409,
              "This invitation has changed. Refresh and try again.",
            );
          if (b.action === "accept") {
            const owner = await User.findById(invite.proposer).session(session);
            const recipient = await User.findById(invite.recipient).session(
              session,
            );
            if (
              owner?.restrictions?.posting ||
              recipient?.restrictions?.posting
            )
              throw fail(
                403,
                "Posting is restricted. Contact support to appeal.",
              );
            const [activity] = await Activity.create(
              [
                {
                  creator: invite.proposer,
                  participants: [invite.proposer, invite.recipient],
                  visibility: "private",
                  type: "together",
                  activityType: "one_on_one",
                  title: invite.title,
                  description:
                    "A private plan agreed together through Along Social.",
                  category: invite.category,
                  zone: invite.zone,
                  startsAt: invite.startsAt,
                },
              ],
              { session },
            );
            await PlanInvitation.updateOne(
              { _id: invite._id },
              { $set: { activity: activity!._id } },
              { session },
            );
          }
        });
      } finally {
        await session.endSession();
      }
      if (b.action !== "decline")
        await notify(
          req.userId!,
          String(invite.proposer),
          b.action === "accept" ? "accepted" : "changes",
          `invitation:${invite._id}:${b.version + 1}`,
          undefined,
          String(invite._id),
        );
      res.status(204).end();
    },
  );
  router.get("/notifications", async (req: AuthedRequest, res) => {
    const scope = await socialScope(req.userId!);
    const rows = await SocialNotification.find({
      recipient: req.userId,
      kind: { $not: /^game_/ },
      actor: {
        $in: [...new Set([...scope.connections, ...scope.discoverAuthors])],
      },
    })
      .sort({ _id: -1 })
      .limit(60)
      .lean();
    const items = [];
    const actors = await User.find({ _id: { $in: rows.map((n) => n.actor) } })
      .select("name")
      .lean();
    const visibleMoments = await SocialMoment.find({
      _id: { $in: rows.flatMap((n) => (n.moment ? [n.moment] : [])) },
      status: "active",
      expiresAt: { $gt: new Date() },
    }).lean();
    const permitted = new Set(
      visibleMoments.filter((m) => permits(scope, m)).map((m) => String(m._id)),
    );
    for (const n of rows) {
      if (n.moment && !permitted.has(String(n.moment))) continue;
      if (
        !scope.connections.includes(String(n.actor)) &&
        (!n.moment ||
          visibleMoments.find((m) => String(m._id) === String(n.moment))
            ?.audience !== "discover")
      )
        continue;
      items.push({
        id: String(n._id),
        actor: {
          id: String(n.actor),
          name:
            actors.find((u) => String(u._id) === String(n.actor))?.name ??
            "Your match",
        },
        kind: n.kind,
        momentId: n.moment ? String(n.moment) : null,
        invitationId: n.invitation ? String(n.invitation) : null,
        gameInvitationId: n.gameInvitation ? String(n.gameInvitation) : null,
        gameSessionId: n.gameSession ? String(n.gameSession) : null,
        readAt: n.readAt ?? null,
        createdAt: n.createdAt,
      });
    }
    res.json({ data: items });
  });
  router.post("/notifications/:id/read", async (req: AuthedRequest, res) => {
    await SocialNotification.updateOne(
      { _id: id(req.params.id), recipient: req.userId },
      { $set: { readAt: new Date() } },
    );
    res.status(204).end();
  });
  return router;
}
