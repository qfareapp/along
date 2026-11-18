import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { authenticate, type AuthedRequest } from "./auth.js";
import { compatibleProfiles } from "./discovery.js";
import { ensureMatch, pairKey } from "./chat.js";
import { chatEvents } from "./chat-events.js";
import { fail, requireReady, discoveryUserIds } from "./onboarding.js";
import { Block, Conversation, Match, Message, Profile, User } from "./models.js";
import { memberRateKey, rateLimitMessage } from "./rate-limits.js";
import { VibeCheck, VibeAttempt } from "./vibe-check-models.js";
import { vibePresets } from "./vibe-check-bank.js";

const resourceId = (value: unknown) => {
  if (typeof value !== "string" || !mongoose.isObjectIdOrHexString(value))
    throw fail(404, "Vibe Check unavailable.");
  return value;
};
const questionInput = z.object({
  id: z.string().max(80),
  prompt: z.string().trim().min(5).max(180).optional(),
  options: z.array(z.string().trim().min(1).max(80)).min(2).max(4).optional(),
  answer: z.number().int().min(0).max(3),
}).strict();
const settingsInput = z.object({
  revision: z.number().int().min(0),
  enabled: z.boolean(),
  autoMatch: z.boolean(),
  threshold: z.number().int().min(0).max(100),
  questions: z.array(questionInput).max(20),
}).strict();
const answersInput = z.object({
  revision: z.number().int().min(1),
  answers: z.array(z.object({
    id: z.string().max(80), choice: z.number().int().min(0).max(3),
  }).strict()).min(1).max(20),
}).strict();
const isDuplicate = (e: unknown) => (e as { code?: number })?.code === 11000;

/** Same visibility as a Discover profile; a quiz cannot bypass blocks or unmatching. */
async function pairAccess(visitor: string, owner: string, writing = false) {
  if (visitor === owner) throw fail(400, "Choose another member's Vibe Check.");
  const { filter } = await compatibleProfiles(visitor);
  const [visible, pair, users] = await Promise.all([
    Profile.exists({ ...filter, user: { ...filter.user, $eq: owner } }),
    Match.findOne({ pairKey: pairKey(visitor, owner) }).lean(),
    User.find({ _id: { $in: [visitor, owner] }, status: "active", adminRole: null })
      .select("restrictions").lean(),
  ]);
  if (!visible || users.length !== 2 || pair?.active === false)
    throw fail(404, "Vibe Check unavailable.");
  if (writing && users.some(u => u.restrictions?.messaging))
    throw fail(403, "Messaging is restricted for this connection.");
  return pair?.active ? Conversation.findOne({ match: pair._id }).lean() : null;
}

type Attempt = Pick<mongoose.InferSchemaType<typeof VibeAttempt.schema>,
  "revision" | "matches" | "total" | "threshold" | "passed" | "status" | "conversation"
> & { _id: unknown };
function result(a: Attempt, current = true) {
  return {
    id: String(a._id), revision: a.revision,
    score: Number((a.matches / a.total * 100).toFixed(1)), matches: a.matches,
    total: a.total, threshold: a.threshold, passed: a.passed,
    status: a.status === "pending" && !current ? "superseded" : a.status,
    conversationId: a.conversation ? String(a.conversation) : null,
  };
}
async function matchAttempt(a: InstanceType<typeof VibeAttempt>, session: mongoose.ClientSession) {
  const conversationId = await ensureMatch(String(a.visitor), String(a.owner), undefined, session);
  if (!conversationId) throw fail(409, "This connection is no longer available.");
  a.status = "matched";
  a.conversation = new mongoose.Types.ObjectId(conversationId);
  a.visitorReadAt = undefined;
  await a.save({ session });
  // One shared chat notice; the private result inbox notifies both members.
  await Message.create([{
    conversation: conversationId, sender: a.owner,
    text: `Vibe Check: ${a.matches}/${a.total} shared choices (${Number((a.matches / a.total * 100).toFixed(1))}%). You matched! Say hello.`,
    gameEventKey: `vibe-check:${a._id}`,
  }], { session, ordered: true });
  await Conversation.updateOne({ _id: conversationId }, { $set: { updatedAt: new Date() } }, { session });
}

export function vibeChecksRouter() {
  const router = Router();
  router.use(authenticate, requireReady);
  router.use((_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
  const write = rateLimit({ windowMs: 60000, limit: 30, keyGenerator: memberRateKey, message: rateLimitMessage });
  router.get("/mine", async (req: AuthedRequest, res) => {
    const saved = await VibeCheck.findOne({ owner: req.userId }).select("+questions.answer").lean();
    res.json({ data: {
      presets: vibePresets,
      settings: saved ? {
        revision: saved.revision, enabled: saved.enabled, autoMatch: saved.autoMatch,
        threshold: saved.threshold,
        questions: saved.questions.map(q => ({ id: q.id, prompt: q.prompt, options: q.options, answer: q.answer })),
      } : { revision: 0, enabled: false, autoMatch: false, threshold: 60, questions: [] },
    } });
  });
  router.put("/mine", write, async (req: AuthedRequest, res) => {
    const body = settingsInput.parse(req.body);
    if (body.enabled && !body.questions.length) throw fail(400, "Select at least one question.");
    if (new Set(body.questions.map(q => q.id)).size !== body.questions.length)
      throw fail(400, "Select each question only once.");
    const questions = body.questions.map(q => {
      const preset = vibePresets.find(p => p.id === q.id);
      if (!preset && (!/^custom_[a-zA-Z0-9_-]+$/.test(q.id) || !q.prompt || !q.options))
        throw fail(400, "Choose a preset or complete your custom question.");
      const prompt = preset?.prompt ?? q.prompt!;
      const options = preset?.options ?? q.options!;
      if (new Set(options.map(o => o.toLocaleLowerCase())).size !== options.length || q.answer >= options.length)
        throw fail(400, "Use distinct options and choose one of them as your answer.");
      return { id: q.id, prompt, options, answer: q.answer };
    });
    try {
      const saved = await VibeCheck.findOneAndUpdate(
        { owner: req.userId, revision: body.revision },
        { $set: { enabled: body.enabled, autoMatch: body.autoMatch, threshold: body.threshold, questions }, $inc: { revision: 1, serial: 1 } },
        { new: true, upsert: body.revision === 0, runValidators: true },
      );
      if (!saved) throw fail(409, "Your Vibe Check changed. Reload before saving again.");
      res.json({ data: { revision: saved.revision } });
    } catch (e) {
      if (isDuplicate(e)) throw fail(409, "Your Vibe Check changed. Reload before saving again.");
      throw e;
    }
  });
  router.get("/inbox", async (req: AuthedRequest, res) => {
    const ready = await discoveryUserIds();
    const blocks = await Block.find({ $or: [{ user: req.userId }, { target: req.userId }] }).lean();
    const blocked = new Set(blocks.map(b => String(String(b.user) === req.userId ? b.target : b.user)));
    const rows = await VibeAttempt.find({ $or: [
      { owner: req.userId, passed: true }, { visitor: req.userId },
    ] }).sort({ updatedAt: -1 }).limit(60).lean();
    const readyIds = new Set(ready.map(String));
    const users = await User.find({ _id: { $in: rows.flatMap(a => [a.owner, a.visitor]) } }).select("name").lean();
    const names = new Map(users.map(u => [String(u._id), u.name]));
    const checks = await VibeCheck.find({ owner: { $in: rows.map(a => a.owner) } }).select("owner revision enabled").lean();
    const current = new Map(checks.map(c => [String(c.owner), c]));
    const inactive = new Set(await Match.find({ active: false, users: req.userId }).distinct("pairKey"));
    res.json({ data: rows.flatMap(a => {
      const incoming = String(a.owner) === req.userId;
      const other = String(incoming ? a.visitor : a.owner);
      if (!readyIds.has(other) || blocked.has(other) || inactive.has(pairKey(req.userId!, other))) return [];
      const check = current.get(String(a.owner));
      return [{ ...result(a, !!check?.enabled && check.revision === a.revision),
        incoming, member: { id: other, name: names.get(other) ?? "Member" },
        readAt: incoming ? a.ownerReadAt ?? null : a.visitorReadAt ?? null,
        createdAt: a.createdAt,
      }];
    }) });
  });
  router.post("/attempts/:id/read", write, async (req: AuthedRequest, res) => {
    const a = await VibeAttempt.findOne({ _id: resourceId(req.params.id), $or: [{ owner: req.userId }, { visitor: req.userId }] });
    if (!a) throw fail(404, "Vibe Check unavailable.");
    await VibeAttempt.updateOne({ _id: a._id }, { $set: String(a.owner) === req.userId ? { ownerReadAt: new Date() } : { visitorReadAt: new Date() } });
    res.status(204).end();
  });
  router.post("/attempts/:id/decision", write, async (req: AuthedRequest, res) => {
    const { accept } = z.object({ accept: z.boolean() }).strict().parse(req.body);
    const id = resourceId(req.params.id);
    const a = await VibeAttempt.findOne({ _id: id, owner: req.userId });
    if (!a) throw fail(404, "Vibe Check unavailable.");
    await pairAccess(String(a.visitor), String(a.owner), true);
    const session = await mongoose.startSession();
    try {
      const outcome = await session.withTransaction(async () => {
        const current = await VibeAttempt.findById(id).session(session);
        if (!current) throw fail(404, "Vibe Check unavailable.");
        if (current.status !== "pending") {
          if ((accept && current.status === "matched") || (!accept && current.status === "declined")) return result(current);
          throw fail(409, "This request has already been decided.");
        }
        const locked = await VibeCheck.updateOne({ owner: req.userId, revision: current.revision, enabled: true }, { $inc: { serial: 1 } }, { session });
        if (!locked.modifiedCount) throw fail(409, "This Vibe Check has changed. A new attempt is needed.");
        current.ownerReadAt = new Date();
        current.visitorReadAt = undefined;
        if (accept) await matchAttempt(current, session);
        else { current.status = "declined"; await current.save({ session }); }
        return result(current);
      });
      if (outcome?.conversationId) chatEvents.emit("changed", outcome.conversationId);
      res.json({ data: outcome });
    } finally { await session.endSession(); }
  });
  router.get("/profiles/:id", async (req: AuthedRequest, res) => {
    const owner = resourceId(req.params.id);
    const conversation = await pairAccess(req.userId!, owner);
    const check = await VibeCheck.findOne({ owner, enabled: true }).lean();
    if (!check) throw fail(404, "This member hasn't enabled a Vibe Check.");
    const attempt = await VibeAttempt.findOne({ owner, visitor: req.userId, revision: check.revision }).lean();
    const user = await User.findById(owner).select("name").lean();
    res.json({ data: { owner: { id: owner, name: user?.name ?? "Member" },
      revision: check.revision, threshold: check.threshold, autoMatch: check.autoMatch,
      questions: check.questions.map(q => ({ id: q.id, prompt: q.prompt, options: q.options })),
      attempt: attempt ? result(attempt) : null,
      conversationId: conversation ? String(conversation._id) : null,
    } });
  });
  router.post("/profiles/:id/attempt", write, async (req: AuthedRequest, res) => {
    const owner = resourceId(req.params.id), visitor = req.userId!;
    const body = answersInput.parse(req.body);
    await pairAccess(visitor, owner, true);
    const session = await mongoose.startSession();
    try {
      const outcome = await session.withTransaction(async () => {
        const check = await VibeCheck.findOneAndUpdate(
          { owner, enabled: true, revision: body.revision }, { $inc: { serial: 1 } },
          { new: true, session },
        ).select("+questions.answer");
        if (!check) throw fail(409, "This Vibe Check changed. Reload to see the current questions.");
        const existing = await VibeAttempt.findOne({ owner, visitor, revision: body.revision }).session(session);
        if (existing) {
          const same = existing.answers.length === body.answers.length && existing.answers.every(a => body.answers.some(b => b.id === a.id && b.choice === a.choice));
          if (!same) throw fail(409, "You have already submitted this Vibe Check.");
          return result(existing);
        }
        if (new Set(body.answers.map(a => a.id)).size !== body.answers.length || body.answers.length !== check.questions.length)
          throw fail(400, "Answer every question exactly once.");
        let matches = 0;
        for (const q of check.questions) {
          const selected = body.answers.find(a => a.id === q.id);
          if (!selected || selected.choice >= q.options.length) throw fail(400, "Choose one of the available answers for every question.");
          if (selected.choice === q.answer) matches++;
        }
        const total = check.questions.length;
        const passed = matches * 100 >= check.threshold * total;
        const [attempt] = await VibeAttempt.create([{
          owner, visitor, revision: check.revision, answers: body.answers,
          matches, total, threshold: check.threshold, passed,
          status: passed ? "pending" : "failed", visitorReadAt: new Date(),
        }], { session, ordered: true });
        if (passed && check.autoMatch) await matchAttempt(attempt, session);
        return result(attempt);
      });
      if (outcome?.conversationId) chatEvents.emit("changed", outcome.conversationId);
      res.json({ data: outcome });
    } finally { await session.endSession(); }
  });
  return router;
}
