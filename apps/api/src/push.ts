import mongoose, { Schema } from "mongoose";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { authenticate, requestMember, type AuthedRequest } from "./auth.js";
import { Block, Message, User } from "./models.js";
import { config } from "./config.js";
import { memberRateKey, rateLimitMessage } from "./rate-limits.js";

const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
});
export const PushDevice = mongoose.model(
  "PushDevice",
  new Schema(
    {
      installationId: { type: String, unique: true, required: true },
      token: { type: String, unique: true, required: true },
      user: { ...ref("User"), index: true },
      sessionVersion: { type: Number, required: true },
      expiresAt: {
        type: Date,
        required: true,
        index: { expireAfterSeconds: 0 },
      },
    },
    { timestamps: true },
  ),
);
const jobSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    user: ref("User"),
    actor: ref("User"),
    device: ref("PushDevice"),
    kind: {
      type: String,
      enum: ["message", "group", "notice", "community", "community_notice"],
      required: true,
    },
    target: Schema.Types.ObjectId,
    message: Schema.Types.ObjectId,
    state: {
      type: String,
      enum: ["pending", "receipt", "delivered", "skipped", "failed"],
      default: "pending",
    },
    attempts: { type: Number, default: 0 },
    availableAt: { type: Date, default: Date.now },
    leaseUntil: { type: Date, default: () => new Date(0) },
    ticketId: String,
    sentToken: String,
    lastError: String,
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true },
);
jobSchema.index({ state: 1, availableAt: 1, leaseUntil: 1 });
export const PushJob = mongoose.model("PushJob", jobSchema);

export async function enqueuePush(
  input: {
    key: string;
    user: string;
    actor: string;
    kind?: "message" | "group" | "notice" | "community" | "community_notice";
    target?: string;
    message?: string;
  },
  session?: mongoose.ClientSession,
) {
  if (!config.PUSH_NOTIFICATIONS_ENABLED || input.user === input.actor) return;
  const devices = await PushDevice.find({
    user: input.user,
    expiresAt: { $gt: new Date() },
  }).session(session ?? null);
  for (const device of devices)
    await PushJob.updateOne(
      { key: `${input.key}:${device._id}` },
      {
        $setOnInsert: {
          user: input.user,
          actor: input.actor,
          device: device._id,
          kind: input.kind ?? "notice",
          target: input.target,
          message: input.message,
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      },
      { upsert: true, session },
    );
}

export function pushDevicesRouter() {
  const router = Router();
  router.use(authenticate);
  router.use(
    rateLimit({
      windowMs: 60000,
      limit: 30,
      keyGenerator: memberRateKey,
      message: rateLimitMessage,
    }),
  );
  const installationId = z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/);
  router.put("/", async (req: AuthedRequest, res) => {
    const input = z
      .object({
        installationId,
        token: z
          .string()
          .max(200)
          .regex(/^(Expo|Exponent)PushToken\[[a-zA-Z0-9_-]+\]$/),
        platform: z.literal("android"),
      })
      .strict()
      .parse(req.body);
    const user = await requestMember(req);
    await mongoose.connection.transaction(async (session) => {
      await PushDevice.deleteMany(
        { token: input.token, installationId: { $ne: input.installationId } },
        { session },
      );
      await PushDevice.updateOne(
        { installationId: input.installationId },
        {
          $set: {
            token: input.token,
            user: req.userId,
            sessionVersion: user!.sessionVersion ?? 0,
            expiresAt: new Date(Date.now() + 30 * 86400000),
          },
        },
        { upsert: true, session },
      );
    });
    res.status(204).end();
  });
  router.delete("/:installationId", async (req: AuthedRequest, res) => {
    await PushDevice.deleteOne({
      user: req.userId,
      installationId: installationId.parse(req.params.installationId),
    });
    res.status(204).end();
  });
  return router;
}

type Job = InstanceType<typeof PushJob>;
async function payloadFor(job: Job) {
  const device = await PushDevice.findOne({
    _id: job.device,
    user: job.user,
    expiresAt: { $gt: new Date() },
  });
  if (!device) return null;
  const [user, actor, block] = await Promise.all([
    User.findOne({ _id: job.user, status: "active", adminRole: null }).lean(),
    User.findOne({ _id: job.actor, status: "active", adminRole: null })
      .select("name restrictions")
      .lean(),
    Block.exists({
      $or: [
        { user: job.user, target: job.actor },
        { user: job.actor, target: job.user },
      ],
    }),
  ]);
  if (
    !user ||
    (user.sessionVersion ?? 0) !== device.sessionVersion ||
    !actor ||
    block
  )
    return null;
  const recipientId = String(job.user);
  const base = { to: device.token, sound: "default", ttl: 86400 };
  if (job.kind === "community_notice") {
    const { communityAccess } = await import("./community-service.js");
    let access;
    try {
      access = await communityAccess(recipientId, String(job.target));
    } catch (error) {
      if ([403, 404].includes((error as { status?: number }).status ?? 0))
        return null;
      throw error;
    }
    if (access.member?.muted) return null;
    return {
      ...base,
      title: "Along",
      body: "1 new notification from Along",
      channelId: "updates",
      priority: "default",
      data: { kind: "notice", recipientId, communityId: String(job.target) },
    };
  }
  if (job.kind === "notice")
    return {
      ...base,
      title: "Along",
      body: "1 new notification from Along",
      channelId: "updates",
      priority: "default",
      data: { kind: "notice", recipientId },
    };
  if (actor.restrictions?.messaging) return null;
  if (job.kind === "message") {
    const { openConversation } = await import("./chat.js");
    try {
      await openConversation(recipientId, String(job.target));
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null;
      throw error;
    }
    if (
      !(await Message.exists({
        _id: job.message,
        conversation: job.target,
        sender: job.actor,
        readAt: null,
      }))
    )
      return null;
    return {
      ...base,
      title: `New message from ${actor.name}`.slice(0, 100),
      body: "Open Along to read it.",
      channelId: "messages",
      priority: "high",
      data: {
        kind: "message",
        recipientId,
        conversationId: String(job.target),
      },
    };
  }
  if (job.kind === "community") {
    const { communityAccess } = await import("./community-service.js");
    const { CommunityMessage } = await import("./community-models.js");
    let access;
    try {
      access = await communityAccess(recipientId, String(job.target));
    } catch (error) {
      if ([403, 404].includes((error as { status?: number }).status ?? 0))
        return null;
      throw error;
    }
    if (access.member?.muted) return null;
    const message = await CommunityMessage.findOne({
      _id: job.message,
      community: job.target,
      sender: job.actor,
      deletedAt: null,
    });
    if (
      !message ||
      message.sequence <=
        Math.max(access.member!.joinedAfter, access.member!.lastReadSequence)
    )
      return null;
    return {
      ...base,
      title: `New message from ${actor.name}`.slice(0, 100),
      body: "Open Along to read it.",
      channelId: "messages",
      priority: "high",
      data: { kind: "community", recipientId, communityId: String(job.target) },
    };
  }
  const { authorisePlanGroup } = await import("./plan-group-service.js");
  const { PlanGroupMessage } = await import("./plan-group-models.js");
  let access;
  try {
    access = await authorisePlanGroup(recipientId, String(job.target));
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
  const message = await PlanGroupMessage.findOne({
    _id: job.message,
    group: job.target,
    sender: job.actor,
    kind: "message",
  });
  if (
    !message ||
    access.member.muted ||
    message.deletedAt ||
    message.sequence <=
      Math.max(access.member.joinedAfter, access.member.lastReadSequence)
  )
    return null;
  return {
    ...base,
    title: `New message from ${actor.name}`.slice(0, 100),
    body: "Open Along to read it.",
    channelId: "messages",
    priority: "high",
    data: { kind: "group", recipientId, groupId: String(job.target) },
  };
}

const providerError = (value: unknown) =>
  String(value ?? "ProviderError")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .slice(0, 80);
async function expoRequest(path: string, body: unknown, fetcher: typeof fetch) {
  const response = await fetcher(`https://exp.host/--/api/v2/push/${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(12000),
    headers: {
      "Content-Type": "application/json",
      ...(config.EXPO_ACCESS_TOKEN
        ? { Authorization: `Bearer ${config.EXPO_ACCESS_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return (await response.json()) as { data?: unknown; errors?: unknown[] };
}

/** Persisted jobs survive restarts. Delivery never runs inside a chat/request transaction. */
export async function processPushJobs(
  fetcher: typeof fetch = fetch,
  limit = 20,
) {
  if (
    !config.PUSH_NOTIFICATIONS_ENABLED ||
    mongoose.connection.readyState !== 1
  )
    return;
  for (let index = 0; index < limit; index++) {
    const now = new Date();
    const job = await PushJob.findOneAndUpdate(
      {
        state: { $in: ["pending", "receipt"] },
        availableAt: { $lte: now },
        leaseUntil: { $lte: now },
        expiresAt: { $gt: now },
      },
      { $set: { leaseUntil: new Date(Date.now() + 60000) } },
      { new: true, sort: { availableAt: 1 } },
    );
    if (!job) break;
    try {
      if (job.state === "pending") {
        const payload = await payloadFor(job);
        if (!payload) {
          job.state = "skipped";
          await job.save();
          continue;
        }
        job.sentToken = payload.to;
        const result = await expoRequest("send", [payload], fetcher);
        const ticket = (
          result.data as
            | { status?: string; id?: string; details?: { error?: string } }[]
            | undefined
        )?.[0];
        if (ticket?.status !== "ok" || !ticket.id) {
          const code = providerError(ticket?.details?.error);
          if (code === "DeviceNotRegistered")
            await PushDevice.deleteOne({
              _id: job.device,
              token: job.sentToken,
            });
          if (
            [
              "DeviceNotRegistered",
              "MessageTooBig",
              "InvalidCredentials",
            ].includes(code)
          ) {
            job.state = "failed";
            job.lastError = code;
            await job.save();
            continue;
          }
          throw new Error(code);
        }
        job.ticketId = ticket.id;
        job.state = "receipt";
        job.attempts = 0;
        job.availableAt = new Date(Date.now() + 15 * 60000);
      } else {
        const result = await expoRequest(
          "getReceipts",
          { ids: [job.ticketId] },
          fetcher,
        );
        const receipt = (
          result.data as
            | Record<string, { status?: string; details?: { error?: string } }>
            | undefined
        )?.[job.ticketId!];
        if (!receipt) throw new Error("ReceiptPending");
        if (receipt.status === "ok") job.state = "delivered";
        else {
          job.lastError = providerError(receipt.details?.error);
          if (job.lastError === "DeviceNotRegistered")
            await PushDevice.deleteOne({
              _id: job.device,
              token: job.sentToken,
            });
          job.state = "failed";
        }
      }
      job.leaseUntil = new Date(0);
      await job.save();
    } catch (error) {
      job.attempts += 1;
      job.lastError = providerError(
        error instanceof Error ? error.message : "DeliveryError",
      );
      job.leaseUntil = new Date(0);
      job.availableAt = new Date(
        Date.now() + Math.min(30 * 2 ** job.attempts, 3600) * 1000,
      );
      if (job.attempts >= 8) job.state = "failed";
      await job.save();
    }
  }
}

export function startPushWorker() {
  let running = false;
  const timer = setInterval(() => {
    if (
      running ||
      !config.PUSH_NOTIFICATIONS_ENABLED ||
      mongoose.connection.readyState !== 1
    )
      return;
    running = true;
    void processPushJobs()
      .catch(() =>
        console.error("Push queue processing failed; retrying shortly."),
      )
      .finally(() => {
        running = false;
      });
  }, 3000);
  timer.unref();
  return () => clearInterval(timer);
}
