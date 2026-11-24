import { Router, type NextFunction, type Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import multer, { MulterError } from "multer";
import { compressPhoto } from "./compress-photo.js";
import { validateDocument } from "./document-validation.js";
import { rateLimit } from "express-rate-limit";
import { memberRateKey, rateLimitMessage } from "./rate-limits.js";
import { chatEvents } from "./chat-events.js";
import { enqueuePush } from "./push.js";
import { authenticate, type AuthedRequest } from "./auth.js";
import { config } from "./config.js";
import {
  readChatAttachment,
  removeChatAttachment,
  storeChatAttachment,
} from "./chat-storage.js";
import {
  Block,
  Conversation,
  Match,
  Message,
  Profile,
  ProfilePhoto,
  ProfileSwipe,
  User,
} from "./models.js";
import { fail, requireReady } from "./onboarding.js";

export const pairKey = (a: string, b: string) => [a, b].sort().join(":");

/** Creates the match and its conversation for a mutual like. Never revives an unmatched pair. */
export async function ensureMatch(
  a: string,
  b: string,
  activity?: string,
  session?: mongoose.ClientSession,
) {
  const key = pairKey(a, b);
  await Match.updateOne(
    { pairKey: key },
    {
      $setOnInsert: {
        pairKey: key,
        users: [a, b].sort(),
        active: true,
        ...(activity ? { activity } : {}),
      },
    },
    { upsert: true, session },
  );
  const match = await Match.findOne({ pairKey: key })
    .session(session ?? null)
    .lean();
  if (!match?.active) return null;
  await Conversation.updateOne(
    { match: match._id },
    {
      $setOnInsert: {
        match: match._id,
        ...(activity ? { firstSender: a } : {}),
      },
    },
    { upsert: true, session },
  );
  const conversation = await Conversation.findOne({ match: match._id })
    .session(session ?? null)
    .lean();
  return conversation ? String(conversation._id) : null;
}

async function blockedWith(userId: string) {
  const blocks = await Block.find({
    $or: [{ user: userId }, { target: userId }],
  }).lean();
  return new Set(
    blocks.map((b) => String(String(b.user) === userId ? b.target : b.user)),
  );
}

/** Backfills matches for mutual likes made before conversations existed. */
const backfillChecks = new Map<string, number>();
async function backfillMatches(userId: string) {
  if (Date.now() - (backfillChecks.get(userId) ?? 0) < 3600000) return;
  const liked = await ProfileSwipe.find({
    user: userId,
    action: "like",
  }).distinct("target");
  if (!liked.length) return;
  const mutual = await ProfileSwipe.find({
    user: { $in: liked },
    target: userId,
    action: "like",
  }).distinct("user");
  if (!mutual.length) return;
  const existing = new Set(
    await Match.find({
      pairKey: { $in: mutual.map((id) => pairKey(userId, String(id))) },
    }).distinct("pairKey"),
  );
  for (const id of mutual)
    if (!existing.has(pairKey(userId, String(id))))
      await ensureMatch(userId, String(id));
  if (backfillChecks.size >= 1000)
    backfillChecks.delete(backfillChecks.keys().next().value!);
  backfillChecks.set(userId, Date.now());
}

async function mainPhotos(userIds: string[]) {
  const profiles = await Profile.find({ user: { $in: userIds } })
    .select("user photos")
    .lean();
  const candidates = profiles.flatMap((p) => p.photos?.slice(0, 6) ?? []);
  const owned = await ProfilePhoto.find({
    _id: {
      $in: candidates.filter((id) => mongoose.isObjectIdOrHexString(id)),
    },
  })
    .select("owner")
    .lean();
  const ownedBy = new Map(owned.map((p) => [String(p._id), String(p.owner)]));
  return new Map(
    profiles.map((p) => [
      String(p.user),
      p.photos?.find((id) => ownedBy.get(id) === String(p.user)) ?? null,
    ]),
  );
}

/** Loads a conversation the caller may use, or throws 404. */
export async function openConversation(userId: string, id: string) {
  if (!mongoose.isObjectIdOrHexString(id))
    throw fail(404, "Conversation unavailable.");
  const conversation = await Conversation.findById(id).lean();
  if (conversation?.airportConnection) {
    const { airportConnectionAccess } = await import("./airports.js");
    const { grant, otherId, canSend } = await airportConnectionAccess(
      userId,
      conversation.airportConnection,
    );
    const other = await User.findOne({
      _id: otherId,
      status: "active",
      adminRole: null,
    })
      .select("name identityVerified")
      .lean();
    if (!other) throw fail(404, "Conversation unavailable.");
    return {
      conversation,
      match: {
        _id: grant._id,
        users: grant.users,
        active: true,
        activity: undefined,
        createdAt: grant.createdAt,
        updatedAt: grant.updatedAt,
      },
      other,
      otherId,
      airportCanSend: canSend,
    };
  }
  const match = conversation
    ? await Match.findById(conversation.match).lean()
    : null;
  if (
    !conversation ||
    !match?.active ||
    !match.users.some((u) => String(u) === userId)
  )
    throw fail(404, "Conversation unavailable.");
  const otherId = String(match.users.find((u) => String(u) !== userId));
  const [other, blocked] = await Promise.all([
    User.findOne({ _id: otherId, status: "active", adminRole: null })
      .select("name identityVerified")
      .lean(),
    blockedWith(userId),
  ]);
  if (!other || blocked.has(otherId))
    throw fail(404, "Conversation unavailable.");
  return { conversation, match, other, otherId, airportCanSend: true };
}

const serialize = (
  m: {
    _id: unknown;
    conversation?: unknown;
    sender: unknown;
    text?: string | null;
    createdAt?: Date;
    readAt?: Date | null;
    gameInvitation?: unknown;
    gameSession?: unknown;
    gameEvent?: string | null;
    attachment?: {
      kind?: string | null;
      name?: string | null;
      mimeType?: string | null;
      size?: number | null;
    } | null;
  },
  userId: string,
) => ({
  id: String(m._id),
  text: m.text ?? "",
  own: String(m.sender) === userId,
  createdAt: m.createdAt,
  readAt: m.readAt ?? null,
  gameInvitationId: m.gameInvitation ? String(m.gameInvitation) : null,
  gameSessionId: m.gameSession ? String(m.gameSession) : null,
  gameEvent: m.gameEvent ?? null,
  socialMomentId:
    "socialMoment" in m && m.socialMoment ? String(m.socialMoment) : null,
  attachment: m.attachment?.kind
    ? {
        kind: m.attachment.kind,
        name: m.attachment.name ?? "Attachment",
        mimeType: m.attachment.mimeType ?? "application/octet-stream",
        size: m.attachment.size ?? 0,
        path: `/conversations/${String(m.conversation)}/messages/${String(m._id)}/attachment`,
      }
    : null,
});

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
// Documents only: executables, scripts and archives are never accepted.
const FILE_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "text/plain": [".txt"],
  "text/csv": [".csv"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [
    ".pptx",
  ],
};
const MAX_UPLOAD = 20 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD, files: 1, fields: 2, fieldSize: 8000 },
}).single("file");
function receiveAttachment(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  upload(req, res, (error: unknown) => {
    if (error instanceof MulterError)
      return next(
        fail(
          error.code === "LIMIT_FILE_SIZE" ? 413 : 400,
          error.code === "LIMIT_FILE_SIZE"
            ? "Choose a file up to 20 MB."
            : "Send one photo or file at a time.",
        ),
      );
    next(error);
  });
}
const cleanName = (name: string) =>
  name
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .trim()
    .slice(-120) || "attachment";

/** Throws unless the caller may send in this conversation right now. */
export async function assertCanSend(
  userId: string,
  conversation: { _id: unknown; firstSender?: unknown },
) {
  const me = await User.findById(userId).select("restrictions").lean();
  const record = await Conversation.findById(conversation._id)
    .select("airportConnection")
    .lean();
  if (record?.airportConnection) {
    const { airportConnectionAccess } = await import("./airports.js");
    await airportConnectionAccess(userId, record.airportConnection, true);
  }
  if (me?.restrictions?.messaging)
    throw fail(403, "Messaging is restricted. Contact support to appeal.");
  if (
    conversation.firstSender &&
    String(conversation.firstSender) !== userId &&
    !(await Message.exists({ conversation: conversation._id }))
  )
    throw fail(403, "The activity owner must send the first message.");
}
async function attachmentMessage(
  userId: string,
  conversationId: string,
  messageId: string,
) {
  const { conversation } = await openConversation(userId, conversationId);
  if (!mongoose.isObjectIdOrHexString(messageId))
    throw fail(404, "Attachment unavailable.");
  const message = await Message.findOne({
    _id: messageId,
    conversation: conversation._id,
  })
    .select("+attachment.asset")
    .lean();
  if (!message?.attachment?.asset) throw fail(404, "Attachment unavailable.");
  return message.attachment as {
    asset: string;
    kind: "image" | "file";
    name: string;
    mimeType: string;
  };
}
const linkAudience = "along-chat-attachment";
const submissionId = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{8,100}$/)
  .optional();
const contentHash = (text: string, bytes?: Buffer) =>
  crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        text,
        file: bytes
          ? crypto.createHash("sha256").update(bytes).digest("hex")
          : null,
      }),
    )
    .digest("hex");
async function discardAttachment(asset: string) {
  try {
    await removeChatAttachment(asset);
  } catch {
    try {
      const { queueAsset } = await import("./account-deletion.js");
      await mongoose.connection.transaction((session) =>
        queueAsset(asset, session),
      );
    } catch {
      console.error(
        JSON.stringify({
          event: "orphan_media_cleanup_failed",
          severity: "error",
        }),
      );
    }
  }
}
async function replayMessage(
  conversation: unknown,
  sender: string,
  clientId: string | undefined,
  hash: string,
  session?: mongoose.ClientSession,
) {
  if (!clientId) return null; // Compatibility with older installed clients.
  const previous = await Message.findOne({ conversation, sender, clientId })
    .select("+requestHash")
    .session(session ?? null);
  if (previous && previous.requestHash !== hash)
    throw fail(
      409,
      "This message submission was already used for different content.",
    );
  return previous;
}
async function persistDirectMessage(input: {
  conversation: mongoose.Types.ObjectId;
  sender: string;
  recipient: string;
  text: string;
  clientId?: string;
  requestHash: string;
  attachment?: {
    kind: "image" | "file";
    asset: string;
    name: string;
    mimeType: string;
    size: number;
  };
}) {
  await Message.init();
  try {
    return await mongoose.connection.transaction(async (session) => {
      const old = await replayMessage(
        input.conversation,
        input.sender,
        input.clientId,
        input.requestHash,
        session,
      );
      if (old) return old;
      const [message] = await Message.create([input], { session });
      await Conversation.updateOne(
        { _id: input.conversation },
        { $set: { updatedAt: new Date() } },
        { session },
      );
      await enqueuePush(
        {
          key: `message:${message!._id}`,
          user: input.recipient,
          actor: input.sender,
          kind: "message",
          target: String(input.conversation),
          message: String(message!._id),
        },
        session,
      );
      return message!;
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const previous = await replayMessage(
        input.conversation,
        input.sender,
        input.clientId,
        input.requestHash,
      );
      if (previous) return previous;
    }
    throw error;
  }
}

export function chatRouter() {
  const router = Router();
  // Short-lived signed links let the app open files without sharing bearer tokens.
  router.get("/attachments/:token", async (req, res) => {
    let payload: jwt.JwtPayload | string;
    try {
      payload = jwt.verify(String(req.params.token), config.JWT_SECRET ?? "", {
        algorithms: ["HS256"],
        issuer: "along",
        audience: linkAudience,
      });
    } catch {
      throw fail(
        404,
        "This download link has expired. Open it again from the chat.",
      );
    }
    if (typeof payload === "string" || !payload.sub)
      throw fail(404, "Attachment unavailable.");
    const attachment = await attachmentMessage(
      payload.sub,
      String(payload.conversation),
      String(payload.message),
    );
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.attachment(attachment.name);
    res.type(attachment.mimeType);
    res.send(await readChatAttachment(attachment.asset));
  });
  router.use(authenticate, requireReady);
  const sendLimit = rateLimit({
    windowMs: 60000,
    limit: 40,
    keyGenerator: memberRateKey,
    message: rateLimitMessage,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });

  const inbox = async (req: AuthedRequest, res: Response) => {
    const userId = req.userId!;
    const input = z
      .object({
        cursor: z.string().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(30),
      })
      .parse(req.query);
    let cursor: { updatedAt: Date; id: mongoose.Types.ObjectId } | null = null;
    if (input.cursor) {
      try {
        const value = z
          .object({
            date: z.iso.datetime(),
            id: z.string().regex(/^[a-f0-9]{24}$/i),
          })
          .parse(
            JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")),
          );
        cursor = {
          updatedAt: new Date(value.date),
          id: new mongoose.Types.ObjectId(value.id),
        };
      } catch {
        throw fail(400, "Invalid conversation cursor.");
      }
    }
    await backfillMatches(userId);
    const { AirportConnection } = await import("./airport-models.js");
    const blocked = await blockedWith(userId);
    const oid = new mongoose.Types.ObjectId(userId);
    const hasAirport = await AirportConnection.exists({
      users: oid,
      state: "connected",
      decisionUntil: { $gt: new Date() },
    });
    const ready = hasAirport
      ? await import("./onboarding.js").then((m) => m.discoveryUserIds())
      : [];
    const pipeline: mongoose.PipelineStage[] = [
      { $match: { users: oid, active: true } },
      {
        $lookup: {
          from: Conversation.collection.name,
          localField: "_id",
          foreignField: "match",
          as: "chat",
        },
      },
      { $unwind: "$chat" },
      {
        $project: {
          _id: "$chat._id",
          users: 1,
          matchedAt: "$createdAt",
          activityConnection: { $ne: [{ $ifNull: ["$activity", null] }, null] },
          airportConnection: { $literal: false },
          firstSender: "$chat.firstSender",
          updatedAt: "$chat.updatedAt",
        },
      },
      {
        $unionWith: {
          coll: AirportConnection.collection.name,
          pipeline: [
            {
              $match: {
                users: oid,
                state: "connected",
                decisionUntil: { $gt: new Date() },
                $expr: { $setIsSubset: ["$users", ready] },
              },
            },
            {
              $lookup: {
                from: Match.collection.name,
                localField: "pairKey",
                foreignField: "pairKey",
                as: "regular",
              },
            },
            { $match: { "regular.active": { $ne: false } } },
            {
              $lookup: {
                from: Conversation.collection.name,
                localField: "conversation",
                foreignField: "_id",
                as: "chat",
              },
            },
            { $unwind: "$chat" },
            {
              $project: {
                _id: "$chat._id",
                users: 1,
                matchedAt: "$createdAt",
                activityConnection: { $literal: true },
                airportConnection: { $literal: true },
                firstSender: "$chat.firstSender",
                updatedAt: "$chat.updatedAt",
              },
            },
          ],
        },
      },
      {
        $match: {
          users: {
            $nin: [...blocked].map((id) => new mongoose.Types.ObjectId(id)),
          },
        },
      },
      {
        $lookup: {
          from: User.collection.name,
          localField: "users",
          foreignField: "_id",
          as: "members",
          pipeline: [
            { $match: { status: "active", adminRole: null } },
            { $project: { name: 1, identityVerified: 1 } },
          ],
        },
      },
      { $match: { $expr: { $eq: [{ $size: "$members" }, 2] } } },
      {
        $facet: {
          items: [
            ...(cursor
              ? [
                  {
                    $match: {
                      $or: [
                        { updatedAt: { $lt: cursor.updatedAt } },
                        {
                          updatedAt: cursor.updatedAt,
                          _id: { $lt: cursor.id },
                        },
                      ],
                    },
                  },
                ]
              : []),
            { $sort: { updatedAt: -1, _id: -1 } },
            { $limit: input.limit + 1 },
          ],
          totals: [
            {
              $lookup: {
                from: Message.collection.name,
                localField: "_id",
                foreignField: "conversation",
                as: "unread",
                pipeline: [
                  { $match: { sender: { $ne: oid }, readAt: null } },
                  { $count: "count" },
                ],
              },
            },
            {
              $group: {
                _id: null,
                unread: {
                  $sum: {
                    $ifNull: [{ $arrayElemAt: ["$unread.count", 0] }, 0],
                  },
                },
              },
            },
          ],
        },
      },
    ];
    const [page] = await Match.aggregate(pipeline);
    const items = (page?.items ?? []) as {
      _id: mongoose.Types.ObjectId;
      users: mongoose.Types.ObjectId[];
      matchedAt: Date;
      updatedAt: Date;
      activityConnection: boolean;
      airportConnection: boolean;
      firstSender?: mongoose.Types.ObjectId;
      members: {
        _id: mongoose.Types.ObjectId;
        name: string;
        identityVerified: boolean;
      }[];
    }[];
    const more = items.length > input.limit;
    if (more) items.pop();
    const ids = items.map((row) => row._id);
    const [summaries, photos] = await Promise.all([
      Message.aggregate([
        { $match: { conversation: { $in: ids } } },
        { $sort: { conversation: 1, _id: -1 } },
        { $project: { "attachment.asset": 0 } },
        {
          $group: {
            _id: "$conversation",
            last: { $first: "$$ROOT" },
            unread: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ["$sender", oid] },
                      { $eq: [{ $ifNull: ["$readAt", null] }, null] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
      mainPhotos(
        items.flatMap((row) =>
          row.users.filter((id) => String(id) !== userId).map(String),
        ),
      ),
    ]);
    const byConversation = new Map(
      summaries.map((row) => [String(row._id), row]),
    );
    const rows = items.flatMap((row) => {
      const summary = byConversation.get(String(row._id));
      if (
        !summary?.last &&
        row.firstSender &&
        String(row.firstSender) !== userId
      )
        return [];
      const other = row.members.find(
        (member) => String(member._id) !== userId,
      )!;
      return [
        {
          id: String(row._id),
          matchedAt: row.matchedAt,
          activityConnection: row.activityConnection,
          airportConnection: row.airportConnection,
          member: {
            id: String(other._id),
            name: other.name,
            identityVerified: other.identityVerified,
            photoId: photos.get(String(other._id)) ?? null,
          },
          lastMessage: summary?.last ? serialize(summary.last, userId) : null,
          unread: summary?.unread ?? 0,
        },
      ];
    });
    const last = items.at(-1);
    const nextCursor =
      more && last
        ? Buffer.from(
            JSON.stringify({
              date: last.updatedAt.toISOString(),
              id: String(last._id),
            }),
          ).toString("base64url")
        : null;
    if (req.path === "/inbox")
      res.json({
        data: {
          items: rows,
          nextCursor,
          totalUnread: page?.totals?.[0]?.unread ?? 0,
        },
      });
    else
      res.json({
        data: rows,
        nextCursor,
        totalUnread: page?.totals?.[0]?.unread ?? 0,
      });
  };
  router.get("/", inbox); // Legacy envelope; bounded first page.
  router.get("/inbox", inbox);

  router.get("/:id", async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const { conversation, match, other, otherId, airportCanSend } =
      await openConversation(userId, String(req.params.id));
    const q = z
      .object({
        after: z
          .string()
          .regex(/^[a-f\d]{24}$/i)
          .optional(),
        before: z
          .string()
          .regex(/^[a-f\d]{24}$/i)
          .optional(),
      })
      .refine((q) => !(q.before && q.after), "Choose one cursor.")
      .parse(req.query);
    const after =
      q.after && mongoose.isObjectIdOrHexString(q.after) ? q.after : undefined;
    const messages = await Message.find({
      conversation: conversation._id,
      ...(after ? { _id: { $gt: after } } : {}),
      ...(q.before ? { _id: { $lt: q.before } } : {}),
    })
      .sort({ _id: after ? 1 : -1 })
      .limit(101)
      .lean();
    const more = messages.length > 100;
    if (more) messages.pop();
    if (!after) messages.reverse();
    await Message.updateMany(
      {
        _id: { $in: messages.map((m) => m._id) },
        conversation: conversation._id,
        sender: { $ne: userId },
        readAt: null,
      },
      { $set: { readAt: new Date() } },
    );
    const me = await User.findById(userId).select("restrictions").lean();
    res.json({
      data: {
        id: String(conversation._id),
        matchedAt: match.createdAt,
        activityConnection: !!match.activity,
        airportConnection: !!conversation.airportConnection,
        airportPaused: !!conversation.airportConnection && !airportCanSend,
        waitingForOwner:
          !!conversation.firstSender &&
          String(conversation.firstSender) !== userId &&
          !(await Message.exists({ conversation: conversation._id })),
        canSend:
          airportCanSend &&
          !me?.restrictions?.messaging &&
          (!conversation.firstSender ||
            String(conversation.firstSender) === userId ||
            !!(await Message.exists({ conversation: conversation._id }))),
        member: {
          id: otherId,
          name: other.name,
          identityVerified: other.identityVerified,
          photoId: (await mainPhotos([otherId])).get(otherId) ?? null,
        },
        messages: messages.map((m) => serialize(m, userId)),
        nextBefore: !after && more ? String(messages[0]!._id) : null,
        nextAfter: after && more ? String(messages.at(-1)!._id) : null,
      },
    });
  });

  router.post("/:id/messages", sendLimit, async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const { text, clientId } = z
      .object({
        text: z.string().trim().min(1).max(2000),
        clientId: submissionId,
      })
      .strict()
      .parse(req.body);
    const { conversation, otherId } = await openConversation(
      userId,
      String(req.params.id),
    );
    await assertCanSend(userId, conversation);
    const message = await persistDirectMessage({
      conversation: conversation._id,
      sender: userId,
      recipient: otherId,
      text,
      clientId,
      requestHash: contentHash(text),
    });
    res.status(201).json({ data: serialize(message.toObject(), userId) });
    chatEvents.emit("changed", String(conversation._id));
  });

  router.post(
    "/:id/attachments",
    sendLimit,
    receiveAttachment,
    async (req: AuthedRequest, res) => {
      const userId = req.userId!;
      const { conversation, otherId } = await openConversation(
        userId,
        String(req.params.id),
      );
      await assertCanSend(userId, conversation);
      const { text, clientId } = z
        .object({
          text: z.string().trim().max(2000).default(""),
          clientId: submissionId,
        })
        .parse(req.body ?? {});
      const upload = req.file;
      if (!upload) throw fail(400, "Choose a photo or file to send.");
      const requestHash = contentHash(text, upload.buffer);
      const previous = await replayMessage(
        conversation._id,
        userId,
        clientId,
        requestHash,
      );
      if (previous)
        return void res
          .status(201)
          .json({ data: serialize(previous.toObject(), userId) });
      const image = IMAGE_TYPES.includes(upload.mimetype);
      const extension = upload.originalname
        .toLowerCase()
        .match(/\.[a-z0-9]+$/)?.[0];
      if (
        !image &&
        !(extension && FILE_TYPES[upload.mimetype]?.includes(extension))
      )
        throw fail(
          400,
          "You can send photos, PDFs, and Word, Excel, PowerPoint, text or CSV files.",
        );
      let bytes = upload.buffer;
      let name = cleanName(upload.originalname);
      let mimeType = upload.mimetype;
      if (!image) validateDocument(bytes, mimeType);
      if (image) {
        if (bytes.length > 10 * 1024 * 1024)
          throw fail(413, "Choose a photo up to 10 MB.");
        try {
          // Re-encoding strips metadata such as location before anyone sees the photo.
          bytes = await compressPhoto(bytes);
        } catch {
          throw fail(
            400,
            "This photo could not be processed. Choose another image.",
          );
        }
        name = name.replace(/\.[^.]+$/, "") + ".jpg";
        mimeType = "image/jpeg";
      }
      const asset = await storeChatAttachment(
        bytes,
        userId,
        image ? "image" : "file",
      );
      let message;
      try {
        message = await persistDirectMessage({
          conversation: conversation._id,
          sender: userId,
          recipient: otherId,
          text,
          clientId,
          requestHash,
          attachment: {
            kind: image ? "image" : "file",
            asset,
            name,
            mimeType,
            size: bytes.length,
          },
        });
      } catch (error) {
        await discardAttachment(asset);
        throw error;
      }
      // A concurrent identical request may have persisted another uploaded copy.
      const stored = await Message.findById(message._id).select(
        "+attachment.asset",
      );
      if (stored?.attachment?.asset !== asset) await discardAttachment(asset);
      res.status(201).json({ data: serialize(message.toObject(), userId) });
      chatEvents.emit("changed", String(conversation._id));
    },
  );

  router.get(
    "/:id/messages/:messageId/attachment",
    async (req: AuthedRequest, res) => {
      const attachment = await attachmentMessage(
        req.userId!,
        String(req.params.id),
        String(req.params.messageId),
      );
      res.set("Cache-Control", "private, no-store");
      res.set("X-Content-Type-Options", "nosniff");
      if (attachment.kind !== "image") res.attachment(attachment.name);
      res.type(attachment.mimeType);
      res.send(await readChatAttachment(attachment.asset));
    },
  );

  router.post(
    "/:id/messages/:messageId/attachment-link",
    async (req: AuthedRequest, res) => {
      await attachmentMessage(
        req.userId!,
        String(req.params.id),
        String(req.params.messageId),
      );
      const token = jwt.sign(
        {
          sub: req.userId,
          conversation: String(req.params.id),
          message: String(req.params.messageId),
        },
        config.JWT_SECRET!,
        {
          algorithm: "HS256",
          expiresIn: "5m",
          issuer: "along",
          audience: linkAudience,
        },
      );
      res.json({ data: { path: `/conversations/attachments/${token}` } });
    },
  );

  router.post("/:id/unmatch", async (req: AuthedRequest, res) => {
    const { match, conversation } = await openConversation(
      req.userId!,
      String(req.params.id),
    );
    if (conversation.airportConnection) {
      const { AirportConnection } = await import("./airport-models.js");
      await AirportConnection.updateOne(
        { _id: conversation.airportConnection },
        { $set: { state: "ended" } },
      );
    } else
      await Match.updateOne({ _id: match._id }, { $set: { active: false } });
    res.status(204).end();
  });

  return router;
}
