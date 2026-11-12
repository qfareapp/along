import { Router, type NextFunction, type Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import jwt from "jsonwebtoken";
import multer, { MulterError } from "multer";
import { compressPhoto } from "./compress-photo.js";
import { rateLimit } from "express-rate-limit";
import { chatEvents } from "./chat-events.js";
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
async function backfillMatches(userId: string) {
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
  return { conversation, match, other, otherId };
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
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],
  "application/vnd.ms-powerpoint": [".ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [
    ".pptx",
  ],
};
const MAX_UPLOAD = 20 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD, files: 1, fields: 1, fieldSize: 4000 },
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
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });

  router.get("/", async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    await backfillMatches(userId);
    const matches = await Match.find({ users: userId, active: true }).lean();
    const others = matches.map((m) =>
      String(m.users.find((u) => String(u) !== userId)),
    );
    const [users, blocked, photos, conversations] = await Promise.all([
      User.find({ _id: { $in: others }, status: "active", adminRole: null })
        .select("name identityVerified")
        .lean(),
      blockedWith(userId),
      mainPhotos(others),
      Conversation.find({ match: { $in: matches.map((m) => m._id) } }).lean(),
    ]);
    const userById = new Map(users.map((u) => [String(u._id), u]));
    const convByMatch = new Map(conversations.map((c) => [String(c.match), c]));
    const rows = await Promise.all(
      matches.map(async (m, i) => {
        const otherId = others[i];
        const other = userById.get(otherId);
        const conversation = convByMatch.get(String(m._id));
        if (!other || !conversation || blocked.has(otherId)) return null;
        const [last, unread] = await Promise.all([
          Message.findOne({ conversation: conversation._id })
            .sort({ _id: -1 })
            .lean(),
          Message.countDocuments({
            conversation: conversation._id,
            sender: { $ne: userId },
            readAt: null,
          }),
        ]);
        if (
          !last &&
          conversation.firstSender &&
          String(conversation.firstSender) !== userId
        )
          return null;
        return {
          id: String(conversation._id),
          matchedAt: m.createdAt,
          activityConnection: !!m.activity,
          member: {
            id: otherId,
            name: other.name,
            identityVerified: other.identityVerified,
            photoId: photos.get(otherId) ?? null,
          },
          lastMessage: last ? serialize(last, userId) : null,
          unread,
        };
      }),
    );
    const data = rows
      .filter((r) => !!r)
      .sort(
        (a, b) =>
          +new Date(b.lastMessage?.createdAt ?? b.matchedAt ?? 0) -
          +new Date(a.lastMessage?.createdAt ?? a.matchedAt ?? 0),
      );
    res.json({ data });
  });

  router.get("/:id", async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const { conversation, match, other, otherId } = await openConversation(
      userId,
      String(req.params.id),
    );
    const q = z.object({ after: z.string().optional() }).parse(req.query);
    const after =
      q.after && mongoose.isObjectIdOrHexString(q.after) ? q.after : undefined;
    const messages = await Message.find({
      conversation: conversation._id,
      ...(after ? { _id: { $gt: after } } : {}),
    })
      .sort({ _id: -1 })
      .limit(100)
      .lean();
    await Message.updateMany(
      { conversation: conversation._id, sender: { $ne: userId }, readAt: null },
      { $set: { readAt: new Date() } },
    );
    const me = await User.findById(userId).select("restrictions").lean();
    res.json({
      data: {
        id: String(conversation._id),
        matchedAt: match.createdAt,
        activityConnection: !!match.activity,
        waitingForOwner:
          !!conversation.firstSender &&
          String(conversation.firstSender) !== userId &&
          !(await Message.exists({ conversation: conversation._id })),
        canSend:
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
        messages: messages.reverse().map((m) => serialize(m, userId)),
      },
    });
  });

  router.post("/:id/messages", sendLimit, async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const { text } = z
      .object({ text: z.string().trim().min(1).max(2000) })
      .strict()
      .parse(req.body);
    const { conversation } = await openConversation(
      userId,
      String(req.params.id),
    );
    await assertCanSend(userId, conversation);
    const message = await Message.create({
      conversation: conversation._id,
      sender: userId,
      text,
    });
    await Conversation.updateOne(
      { _id: conversation._id },
      { $set: { updatedAt: new Date() } },
    );
    res.status(201).json({ data: serialize(message.toObject(), userId) });
    chatEvents.emit("changed", String(conversation._id));
  });

  router.post(
    "/:id/attachments",
    sendLimit,
    receiveAttachment,
    async (req: AuthedRequest, res) => {
      const userId = req.userId!;
      const { conversation } = await openConversation(
        userId,
        String(req.params.id),
      );
      await assertCanSend(userId, conversation);
      const { text } = z
        .object({ text: z.string().trim().max(2000).default("") })
        .parse(req.body ?? {});
      const upload = req.file;
      if (!upload) throw fail(400, "Choose a photo or file to send.");
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
        message = await Message.create({
          conversation: conversation._id,
          sender: userId,
          text,
          attachment: {
            kind: image ? "image" : "file",
            asset,
            name,
            mimeType,
            size: bytes.length,
          },
        });
      } catch (error) {
        await removeChatAttachment(asset);
        throw error;
      }
      await Conversation.updateOne(
        { _id: conversation._id },
        { $set: { updatedAt: new Date() } },
      );
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
    const { match } = await openConversation(
      req.userId!,
      String(req.params.id),
    );
    await Match.updateOne({ _id: match._id }, { $set: { active: false } });
    res.status(204).end();
  });

  return router;
}
