import crypto from "node:crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import mongoose from "mongoose";
import { z } from "zod";
import { authenticate, type AuthedRequest } from "./auth.js";
import {
  Block,
  Category,
  Conversation,
  Match,
  Profile,
  User,
} from "./models.js";
import {
  completion,
  discoveryUserIds,
  fail,
  requireReady,
} from "./onboarding.js";
import { pairKey, openConversation } from "./chat.js";
import {
  PlanInvitation,
  SocialNotification,
  SocialSettings,
} from "./social-models.js";
import {
  GameDefinition,
  GameInvitation,
  GamePlayRequest,
  GameQuestion,
  GameSession,
  playCategories,
} from "./play-models.js";
import { initializePlay } from "./play-bank.js";

export const playId = (value: unknown) => {
  if (typeof value !== "string" || !mongoose.isObjectIdOrHexString(value))
    throw fail(404, "Play unavailable.");
  return new mongoose.Types.ObjectId(value);
};
const includes = (values: readonly unknown[], id: string) =>
  values.some((v) => String(v) === id);
export const playDisclaimer =
  "Just a fun snapshot of your preferences, not a prediction of your relationship.";
export async function playDefinition() {
  if (!(await GameDefinition.exists({ key: "this_or_that" })))
    await initializePlay();
  return (await GameDefinition.findOne({ key: "this_or_that" }))!;
}
export async function playConnections(userId: string) {
  const [ready, matches, blocks] = await Promise.all([
    discoveryUserIds(),
    Match.find({ users: userId, active: true }).lean(),
    Block.find({ $or: [{ user: userId }, { target: userId }] }).lean(),
  ]);
  const blocked = new Set(
    blocks.map((b) => String(String(b.user) === userId ? b.target : b.user)),
  );
  const eligible = new Set(ready.map(String));
  if (!eligible.has(userId)) return [];
  return [
    ...new Set(
      matches
        .flatMap((m) => m.users.map(String))
        .filter((id) => id !== userId && eligible.has(id) && !blocked.has(id)),
    ),
  ];
}
export async function authorizePlayPair(a: string, b: string) {
  if (a === b || !(await playConnections(a)).includes(b))
    throw fail(404, "This match is unavailable for play.");
  const match = await Match.findOne({ pairKey: pairKey(a, b), active: true });
  const conversation = match
    ? await Conversation.findOne({ match: match._id })
    : null;
  if (!conversation)
    throw fail(404, "Open your matched conversation before playing.");
  return conversation;
}
async function socialPlayConnections(userId: string) {
  const peers = await playConnections(userId);
  const settings = await SocialSettings.find({
    user: { $in: [userId, ...peers] },
  }).lean();
  const mine = settings.find((s) => String(s.user) === userId);
  if (mine?.enabled === false) return [];
  return peers.filter((id) => {
    const theirs = settings.find((s) => String(s.user) === id);
    return (
      theirs?.enabled !== false &&
      !includes(mine?.hidden ?? [], id) &&
      !includes(theirs?.hidden ?? [], userId)
    );
  });
}
async function notifyPlay(
  actor: string,
  recipient: string,
  kind: string,
  key: string,
  invitation?: unknown,
  session?: unknown,
) {
  const settings = await SocialSettings.findOne({ user: recipient }).lean();
  if (
    settings?.notifications === false ||
    includes(settings?.muted ?? [], actor)
  )
    return;
  await SocialNotification.updateOne(
    { key },
    {
      $setOnInsert: {
        actor,
        recipient,
        kind,
        gameInvitation: invitation,
        gameSession: session,
      },
    },
    { upsert: true },
  );
}
function shuffle<T>(values: T[]) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
async function selectQuestions(players: string[], perCategory: number) {
  const history = await GameSession.find({ players: { $all: players } })
    .sort({ createdAt: -1 })
    .limit(5)
    .select("questions.questionId")
    .lean();
  const used = new Set(
    history.flatMap((s) => s.questions.map((q) => String(q.questionId))),
  );
  const pool = await GameQuestion.find({ active: true }).lean();
  const selected = playCategories.flatMap((category) => {
    const available = pool.filter((q) => q.category === category);
    if (available.length < perCategory)
      throw fail(
        503,
        "This game needs more active questions. Try again later.",
      );
    return [
      ...shuffle(available.filter((q) => !used.has(String(q._id)))),
      ...shuffle(available.filter((q) => used.has(String(q._id)))),
    ].slice(0, perCategory);
  });
  return shuffle(selected).map((q) => ({
    questionId: q._id,
    category: q.category,
    text: q.text,
    optionA: q.optionA,
    optionB: q.optionB,
  }));
}
type PlaySession = InstanceType<typeof GameSession>;
export function scorePlay(
  session: Pick<PlaySession, "questions" | "answers" | "players">,
) {
  let matchedAnswers = 0;
  const categoryTotals: Record<string, number> = {},
    categoryMatches: Record<string, number> = {};
  for (let i = 0; i < session.questions.length; i++) {
    const answers = session.answers.filter((a) => a.questionIndex === i);
    if (
      answers.length !== 2 ||
      new Set(answers.map((a) => String(a.player))).size !== 2
    )
      throw fail(409, "Both players must complete the game first.");
    const category = session.questions[i]!.category;
    categoryTotals[category] = (categoryTotals[category] ?? 0) + 1;
    if (answers[0]!.choice === answers[1]!.choice) {
      matchedAnswers++;
      categoryMatches[category] = (categoryMatches[category] ?? 0) + 1;
    }
  }
  const score = Math.round((matchedAnswers / session.questions.length) * 100);
  return {
    score,
    matchedAnswers,
    totalQuestions: session.questions.length,
    categoryScores: Object.fromEntries(
      Object.entries(categoryTotals).map(([key, total]) => [
        key,
        Math.round(((categoryMatches[key] ?? 0) / total) * 100),
      ]),
    ),
    label:
      score >= 80
        ? "In Sync"
        : score >= 60
          ? "Great Vibes"
          : score >= 40
            ? "Interesting Mix"
            : score >= 20
              ? "Different Flavours"
              : "Opposites in Play",
  };
}
export async function authorizedSession(userId: string, sessionId: unknown) {
  const session = await GameSession.findOne({
    _id: playId(sessionId),
    players: userId,
  }).select("+answers");
  if (!session || session.players.length !== 2)
    throw fail(404, "Game unavailable.");
  const other = String(session.players.find((p) => String(p) !== userId));
  await authorizePlayPair(userId, other);
  if (
    ["waiting", "playing"].includes(session.status) &&
    Date.now() - session.lastActionAt.getTime() >
      session.inactivityMinutes * 60000
  ) {
    await GameSession.updateOne(
      {
        _id: session._id,
        status: session.status,
        lastActionAt: session.lastActionAt,
      },
      { $set: { status: "abandoned" }, $inc: { __v: 1 } },
    );
    return (await GameSession.findById(session._id).select("+answers"))!;
  }
  return session;
}
async function sessionDto(session: PlaySession, userId: string) {
  const members = await User.find({ _id: { $in: session.players } })
    .select("name")
    .lean();
  const profiles = await Profile.find({ user: { $in: session.players } })
    .select("user photos")
    .lean();
  const finished = session.status === "completed";
  return {
    id: String(session._id),
    game: "this_or_that",
    invitationId: String(session.invitation),
    conversationId: String(session.conversation),
    status: session.status,
    currentQuestionIndex: session.currentQuestionIndex,
    totalQuestions: session.questions.length,
    startsAt: session.startsAt ?? null,
    completedAt: session.completedAt ?? null,
    expiresAt: new Date(
      session.lastActionAt.getTime() + session.inactivityMinutes * 60000,
    ),
    players: session.players.map((p) => ({
      id: String(p),
      own: String(p) === userId,
      name:
        members.find((u) => String(u._id) === String(p))?.name ?? "Your match",
      photoId:
        profiles.find((profile) => String(profile.user) === String(p))
          ?.photos[0] ?? null,
      ready: includes(session.ready, String(p)),
    })),
    question:
      session.status === "playing"
        ? {
            ...session.questions[session.currentQuestionIndex]!.toObject(),
            questionId: String(
              session.questions[session.currentQuestionIndex]!.questionId,
            ),
          }
        : null,
    ownAnswer:
      session.answers.find(
        (a) =>
          String(a.player) === userId &&
          a.questionIndex === session.currentQuestionIndex,
      )?.choice ?? null,
    opponentAnswered: session.answers.some(
      (a) =>
        String(a.player) !== userId &&
        a.questionIndex === session.currentQuestionIndex,
    ),
    result: finished ? session.result : null,
    disclaimer: playDisclaimer,
    comparison: finished
      ? session.questions.map((q, i) => ({
          ...q.toObject(),
          questionId: String(q.questionId),
          ownChoice: session.answers.find(
            (a) => a.questionIndex === i && String(a.player) === userId,
          )!.choice,
          otherChoice: session.answers.find(
            (a) => a.questionIndex === i && String(a.player) !== userId,
          )!.choice,
        }))
      : [],
  };
}
export async function getPlayState(userId: string, sessionId: unknown) {
  return sessionDto(await authorizedSession(userId, sessionId), userId);
}
export type PlayState = Awaited<ReturnType<typeof getPlayState>>;
let publish: (sessionId: string) => Promise<void> = async () => {};
export function setPlayPublisher(handler: typeof publish) {
  publish = handler;
}
async function publishPlay(sessionId: string) {
  await publish(sessionId).catch(() => {});
}
export async function mutatePlay(
  userId: string,
  sessionId: unknown,
  action: "ready" | "answer" | "leave",
  body: unknown = {},
) {
  const input =
    action === "answer"
      ? z
          .object({
            questionIndex: z.number().int().min(0).max(24),
            choice: z.enum(["A", "B"]),
          })
          .strict()
          .parse(body)
      : null;
  for (let retry = 0; retry < 6; retry++) {
    const session = await authorizedSession(userId, sessionId);
    if (action === "leave" && ["waiting", "playing"].includes(session.status))
      session.status = "abandoned";
    else if (action === "ready") {
      if (session.status !== "waiting") return sessionDto(session, userId);
      if (!includes(session.ready, userId))
        session.ready.push(new mongoose.Types.ObjectId(userId));
      if (session.ready.length === 2) {
        session.status = "playing";
        session.startsAt = new Date(Date.now() + 3000);
      }
    } else if (input) {
      const existing = session.answers.find(
        (a) =>
          String(a.player) === userId &&
          a.questionIndex === input.questionIndex,
      );
      if (existing) {
        if (existing.choice !== input.choice)
          throw fail(409, "Your answer is already locked in.");
        return sessionDto(session, userId);
      }
      if (
        session.status !== "playing" ||
        !session.startsAt ||
        session.startsAt.getTime() > Date.now()
      )
        throw fail(409, "Wait for both players and the countdown.");
      if (input.questionIndex !== session.currentQuestionIndex)
        throw fail(409, "This question has changed. Refresh the game.");
      session.answers.push({
        player: new mongoose.Types.ObjectId(userId),
        questionIndex: input.questionIndex,
        choice: input.choice,
        submittedAt: new Date(),
      });
      if (
        session.answers.filter((a) => a.questionIndex === input.questionIndex)
          .length === 2
      ) {
        session.currentQuestionIndex++;
        if (session.currentQuestionIndex === session.questions.length) {
          session.status = "completed";
          session.completedAt = new Date();
          session.set("result", scorePlay(session));
        }
      }
    } else if (action !== "leave") throw fail(409, "Game unavailable.");
    session.lastActionAt = new Date();
    try {
      await session.save();
      const other = String(session.players.find((p) => String(p) !== userId));
      if (session.status === "completed")
        for (const player of session.players.map(String))
          await notifyPlay(
            String(session.players.find((p) => String(p) !== player)),
            player,
            "game_completed",
            `game-completed:${session._id}:${player}`,
            session.invitation,
            session._id,
          );
      else if (
        action === "ready" ||
        (action === "answer" && session.currentQuestionIndex === 0)
      )
        await notifyPlay(
          userId,
          other,
          action === "ready" ? "game_ready" : "game_waiting",
          `game-${action}:${session._id}:${userId}`,
          session.invitation,
          session._id,
        );
      await publishPlay(String(session._id));
      return sessionDto(session, userId);
    } catch (error) {
      if (!(error instanceof mongoose.Error.VersionError) || retry === 5)
        throw error;
    }
  }
  throw fail(409, "The game changed. Please try again.");
}
async function invitationDto(
  invite: InstanceType<typeof GameInvitation>,
  userId: string,
) {
  const host = await User.findById(invite.host).select("name").lean();
  const profile = await Profile.findOne({ user: invite.host })
    .select("photos")
    .lean();
  const own = String(invite.host) === userId;
  const requesters = await GamePlayRequest.find({
    invitation: invite._id,
    ...(own ? {} : { user: userId }),
  }).lean();
  const allowed = own ? await playConnections(userId) : [];
  const users = await User.find({
    _id: {
      $in: requesters
        .filter((r) => (own ? allowed.includes(String(r.user)) : true))
        .map((r) => r.user),
    },
  })
    .select("name")
    .lean();
  const linked = invite.session
    ? await GameSession.findById(invite.session).select("status players").lean()
    : null;
  return {
    id: String(invite._id),
    host: {
      id: String(invite.host),
      name: host?.name ?? "Your match",
      photoId: profile?.photos[0] ?? null,
    },
    own,
    caption: invite.caption,
    expiresAt: invite.expiresAt,
    status:
      invite.status === "open" && invite.expiresAt <= new Date()
        ? "expired"
        : invite.status,
    sessionId:
      linked && includes(linked.players, userId) ? String(linked._id) : null,
    sessionStatus:
      linked && includes(linked.players, userId) ? linked.status : null,
    requests: requesters
      .filter((r) => users.some((u) => String(u._id) === String(r.user)))
      .map((r) => ({
        id: String(r._id),
        userId: String(r.user),
        name: users.find((u) => String(u._id) === String(r.user))!.name,
        status: r.status,
      })),
  };
}
async function visibleInvitation(userId: string, value: unknown) {
  const invite = await GameInvitation.findById(playId(value));
  if (!invite) throw fail(404, "Play invitation unavailable.");
  if (String(invite.host) !== userId) {
    await authorizePlayPair(userId, String(invite.host));
    if (invite.recipient && String(invite.recipient) !== userId)
      throw fail(404, "Play invitation unavailable.");
    if (
      !invite.recipient &&
      !(await socialPlayConnections(userId)).includes(String(invite.host))
    )
      throw fail(404, "Play invitation unavailable.");
  }
  return invite;
}
async function createInvitation(
  userId: string,
  raw: unknown,
  rematchOf?: string,
) {
  const input = z
    .object({
      recipientId: z.string().optional(),
      caption: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .default("Want to discover your vibe together?"),
    })
    .strict()
    .parse(raw);
  const definition = await playDefinition();
  if (!definition.active) throw fail(409, "This or That is taking a break.");
  if (
    (await User.findById(userId).select("restrictions"))?.restrictions?.posting
  )
    throw fail(403, "Posting is restricted.");
  const connections = input.recipientId
    ? await playConnections(userId)
    : await socialPlayConnections(userId);
  if (!connections.length)
    throw fail(
      409,
      "Make a mutual connection before inviting someone to play.",
    );
  if (input.recipientId) {
    playId(input.recipientId);
    await authorizePlayPair(userId, input.recipientId);
  }
  if (
    (await GameInvitation.countDocuments({
      host: userId,
      status: "open",
      expiresAt: { $gt: new Date() },
    })) >= 3
  )
    throw fail(409, "You already have three open invitations.");
  const invite = await GameInvitation.create({
    host: userId,
    recipient: input.recipientId,
    caption: input.caption,
    expiresAt: new Date(Date.now() + definition.invitationMinutes * 60000),
    ...(rematchOf ? { rematchOf } : {}),
  });
  for (const recipient of input.recipientId ? [input.recipientId] : connections)
    await notifyPlay(
      userId,
      recipient,
      rematchOf ? "game_rematch" : "game_invitation",
      `play-invite:${invite._id}:${recipient}`,
      invite._id,
    );
  return invitationDto(invite, userId);
}
export function playRouter() {
  const router = Router();
  router.use(authenticate, requireReady);
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  const write = rateLimit({ windowMs: 60000, limit: 45 });
  router.get("/", async (_req, res) => {
    const d = await playDefinition();
    res.json({
      data: [
        {
          key: d.key,
          name: "This or That",
          tagline: "Two choices. Two people. One vibe.",
          totalQuestions: d.questionsPerCategory * 5,
          active: d.active,
          categories: playCategories,
          disclaimer: playDisclaimer,
        },
      ],
    });
  });
  router.get("/connections", async (req: AuthedRequest, res) => {
    const ids = await playConnections(req.userId!);
    const users = await User.find({ _id: { $in: ids } })
      .select("name")
      .lean();
    const profiles = await Profile.find({ user: { $in: ids } })
      .select("user photos")
      .lean();
    res.json({
      data: users.map((u) => ({
        id: String(u._id),
        name: u.name,
        photoId:
          profiles.find((p) => String(p.user) === String(u._id))?.photos[0] ??
          null,
      })),
    });
  });
  router.get("/conversation/:id", async (req: AuthedRequest, res) => {
    const { otherId } = await openConversation(
      req.userId!,
      String(req.params.id),
    );
    await authorizePlayPair(req.userId!, otherId);
    const invites = await GameInvitation.find({
      recipient: { $in: [req.userId, otherId] },
      host: { $in: [req.userId, otherId] },
      status: "open",
      expiresAt: { $gt: new Date() },
    })
      .sort({ _id: -1 })
      .limit(10);
    const sessions = await GameSession.find({
      players: { $all: [req.userId, otherId] },
    })
      .sort({ updatedAt: -1 })
      .limit(10)
      .select("+answers");
    res.json({
      data: {
        recipientId: otherId,
        invitations: await Promise.all(
          invites.map((i) => invitationDto(i, req.userId!)),
        ),
        sessions: await Promise.all(
          sessions.map((s) => getPlayState(req.userId!, String(s._id))),
        ),
      },
    });
  });
  router.get("/invitations", async (req: AuthedRequest, res) => {
    const peers = await playConnections(req.userId!);
    const socialPeers = await socialPlayConnections(req.userId!);
    const invites = await GameInvitation.find({
      $or: [
        { host: req.userId },
        { host: { $in: socialPeers }, recipient: null },
        {
          host: { $in: peers },
          recipient: req.userId,
        },
      ],
    })
      .sort({ _id: -1 })
      .limit(40);
    res.json({
      data: await Promise.all(
        invites.map((i) => invitationDto(i, req.userId!)),
      ),
    });
  });
  router.post("/invitations", write, async (req: AuthedRequest, res) => {
    res
      .status(201)
      .json({ data: await createInvitation(req.userId!, req.body) });
  });
  router.post(
    "/invitations/:id/cancel",
    write,
    async (req: AuthedRequest, res) => {
      const changed = await GameInvitation.findOneAndUpdate(
        { _id: playId(req.params.id), host: req.userId, status: "open" },
        { status: "cancelled" },
      );
      if (!changed) throw fail(409, "This invitation has already closed.");
      await GamePlayRequest.updateMany(
        { invitation: changed._id, status: "pending" },
        { status: "unavailable" },
      );
      res.status(204).end();
    },
  );
  router.post(
    "/invitations/:id/requests",
    write,
    async (req: AuthedRequest, res) => {
      const invite = await visibleInvitation(req.userId!, req.params.id);
      if (String(invite.host) === req.userId)
        throw fail(400, "Choose a match's invitation.");
      if (invite.status !== "open" || invite.expiresAt <= new Date())
        throw fail(409, "This invitation is no longer available.");
      const connection = await authorizePlayPair(
        req.userId!,
        String(invite.host),
      );
      void connection;
      let request;
      try {
        request = await GamePlayRequest.create({
          invitation: invite._id,
          user: req.userId,
        });
      } catch (e) {
        if ((e as { code?: number }).code === 11000)
          throw fail(409, "You already requested this game.");
        throw e;
      }
      // A concurrent accept/cancel cannot leave a usable late request behind.
      if (
        !(await GameInvitation.exists({
          _id: invite._id,
          status: "open",
          expiresAt: { $gt: new Date() },
        }))
      ) {
        await GamePlayRequest.updateOne(
          { _id: request._id },
          { status: "unavailable" },
        );
        throw fail(409, "This invitation just closed.");
      }
      await notifyPlay(
        req.userId!,
        String(invite.host),
        "game_request",
        `game-request:${request._id}`,
        invite._id,
      );
      res.status(201).json({ data: { id: String(request._id) } });
    },
  );
  router.post(
    "/requests/:id/:action",
    write,
    async (req: AuthedRequest, res) => {
      const action = z.enum(["accept", "decline"]).parse(req.params.action);
      const request = await GamePlayRequest.findOne({
        _id: playId(req.params.id),
        status: "pending",
      });
      const invite = request
        ? await GameInvitation.findOne({
            _id: request.invitation,
            host: req.userId,
            status: "open",
            expiresAt: { $gt: new Date() },
          })
        : null;
      if (!request || !invite)
        throw fail(409, "This play request is no longer available.");
      const conversation = await authorizePlayPair(
        req.userId!,
        String(request.user),
      );
      if (invite.recipient && String(invite.recipient) !== String(request.user))
        throw fail(404, "Request unavailable.");
      if (action === "decline") {
        const declined = await GamePlayRequest.findOneAndUpdate(
          { _id: request._id, status: "pending" },
          { status: "declined" },
        );
        if (!declined) throw fail(409, "This request has already changed.");
        await notifyPlay(
          req.userId!,
          String(request.user),
          "game_declined",
          `game-declined:${request._id}`,
          invite._id,
        );
        res.json({ data: { status: "declined" } });
        return;
      }
      const definition = await playDefinition();
      if (!definition.active) throw fail(409, "This game is currently paused.");
      const questions = await selectQuestions(
        [req.userId!, String(request.user)],
        definition.questionsPerCategory,
      );
      let sessionId = "";
      await mongoose.connection.transaction(async (session) => {
        const claimed = await GameInvitation.findOneAndUpdate(
          { _id: invite._id, status: "open", expiresAt: { $gt: new Date() } },
          { status: "accepted", acceptedRequest: request._id },
          { session },
        );
        const claimedRequest = claimed
          ? await GamePlayRequest.findOneAndUpdate(
              { _id: request._id, status: "pending" },
              { status: "accepted" },
              { session },
            )
          : null;
        if (!claimed || !claimedRequest)
          throw fail(
            409,
            "Another request was accepted or the invitation closed.",
          );
        const [game] = await GameSession.create(
          [
            {
              invitation: invite._id,
              players: [invite.host, request.user],
              conversation: conversation._id,
              questions,
              inactivityMinutes: definition.inactivityMinutes,
            },
          ],
          { session },
        );
        sessionId = String(game!._id);
        await GameInvitation.updateOne(
          { _id: invite._id },
          { session: game!._id },
          { session },
        );
        await GamePlayRequest.updateMany(
          { invitation: invite._id, status: "pending" },
          { status: "unavailable" },
          { session },
        );
      });
      await notifyPlay(
        req.userId!,
        String(request.user),
        "game_accepted",
        `game-accepted:${invite._id}`,
        invite._id,
        sessionId,
      );
      res.json({ data: { sessionId } });
    },
  );
  router.get("/sessions", async (req: AuthedRequest, res) => {
    const peers = await playConnections(req.userId!);
    const sessions = await GameSession.find({ players: req.userId })
      .sort({ updatedAt: -1 })
      .limit(30)
      .select("+answers");
    const visible = sessions.filter((s) =>
      s.players.some(
        (p) => String(p) !== req.userId && peers.includes(String(p)),
      ),
    );
    res.json({
      data: await Promise.all(
        visible.map((s) => getPlayState(req.userId!, String(s._id))),
      ),
    });
  });
  router.get("/sessions/:id", async (req: AuthedRequest, res) => {
    res.json({ data: await getPlayState(req.userId!, req.params.id) });
  });
  router.get("/sessions/:id/results", async (req: AuthedRequest, res) => {
    const state = await getPlayState(req.userId!, req.params.id);
    if (state.status !== "completed")
      throw fail(409, "Finish the game together to reveal your results.");
    res.json({ data: state });
  });
  for (const action of ["ready", "answer", "leave"] as const)
    router.post(
      `/sessions/:id/${action === "answer" ? "answers" : action}`,
      write,
      async (req: AuthedRequest, res) => {
        res.json({
          data: await mutatePlay(req.userId!, req.params.id, action, req.body),
        });
      },
    );
  router.post(
    "/sessions/:id/rematch",
    write,
    async (req: AuthedRequest, res) => {
      const session = await authorizedSession(req.userId!, req.params.id);
      if (!["completed", "abandoned"].includes(session.status))
        throw fail(409, "Finish or leave this game before a rematch.");
      const other = String(
        session.players.find((p) => String(p) !== req.userId),
      );
      const existing = await GameInvitation.findOne({
        rematchOf: session._id,
        status: "open",
        expiresAt: { $gt: new Date() },
      });
      if (existing) {
        res.json({ data: await invitationDto(existing, req.userId!) });
        return;
      }
      await GameInvitation.updateMany(
        {
          rematchOf: session._id,
          status: "open",
          expiresAt: { $lte: new Date() },
        },
        { status: "expired" },
      );
      try {
        res.status(201).json({
          data: await createInvitation(
            req.userId!,
            { recipientId: other, caption: "Another round of This or That?" },
            String(session._id),
          ),
        });
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
        const retry = await GameInvitation.findOne({
          rematchOf: session._id,
          status: "open",
        });
        if (!retry) throw e;
        res.json({ data: await invitationDto(retry, req.userId!) });
      }
    },
  );
  router.get(
    "/sessions/:id/plan-suggestions",
    async (req: AuthedRequest, res) => {
      const session = await authorizedSession(req.userId!, req.params.id);
      if (session.status !== "completed")
        throw fail(409, "Finish the game to make a plan from your results.");
      const shared = session.questions
        .flatMap((q, i) => {
          const a = session.answers.filter((a) => a.questionIndex === i);
          return a[0]?.choice === a[1]?.choice
            ? [a[0]!.choice === "A" ? q.optionA : q.optionB]
            : [];
        })
        .join(" ")
        .toLowerCase();
      const keys = [
        ...new Set([
          ...(/coffee|chai|food|cook|meal|cafe|dinner|breakfast|snack|dessert|picnic/.test(
            shared,
          )
            ? ["food"]
            : []),
          ...(/movie|film|music|show|theatre/.test(shared) ? ["movies"] : []),
          ...(/walk|mountain|beach|adventure|trip|travel/.test(shared)
            ? ["travel"]
            : []),
          ...(/paint|pottery|craft|creative|garden/.test(shared)
            ? ["hobbies"]
            : []),
          "food",
          "hobbies",
        ]),
      ];
      const profile = await Profile.findOne({ user: req.userId });
      const categories = await Category.find({
        slug: { $in: keys },
        active: true,
        $or: [{ cities: { $size: 0 } }, { cities: profile?.city }],
      })
        .select("slug name")
        .lean();
      res.json({
        data: categories.map((c) => ({
          category: c.slug,
          name: c.name,
          title:
            c.slug === "food" && /coffee|cafe/.test(shared)
              ? "Coffee Together?"
              : `${c.name} Together?`,
        })),
      });
    },
  );
  router.post(
    "/sessions/:id/make-plan",
    write,
    async (req: AuthedRequest, res) => {
      const session = await authorizedSession(req.userId!, req.params.id);
      if (session.status !== "completed")
        throw fail(409, "Complete the game together first.");
      const input = z
        .object({
          title: z.string().trim().min(3).max(100),
          category: z.string().min(1).max(50),
          zone: z.string().trim().min(2).max(100),
          startsAt: z.iso
            .datetime({ offset: true })
            .refine((v) => new Date(v) > new Date(), "Choose a future time."),
        })
        .strict()
        .parse(req.body);
      const profile = await Profile.findOne({ user: req.userId });
      if (
        !(await Category.exists({
          slug: input.category,
          active: true,
          $or: [{ cities: { $size: 0 } }, { cities: profile?.city }],
        }))
      )
        throw fail(400, "Choose an available plan category.");
      if (
        (await User.findById(req.userId).select("restrictions"))?.restrictions
          ?.posting
      )
        throw fail(403, "Posting is restricted.");
      const recipient = String(
        session.players.find((p) => String(p) !== req.userId),
      );
      const requestKey = crypto
        .createHash("sha256")
        .update(
          JSON.stringify([
            String(session._id),
            req.userId,
            input.title,
            input.category,
            input.zone,
            input.startsAt,
          ]),
        )
        .digest("hex");
      const invite = await PlanInvitation.findOneAndUpdate(
        { requestKey },
        {
          $setOnInsert: {
            ...input,
            requestKey,
            gameSession: session._id,
            proposer: req.userId,
            recipient,
          },
        },
        { upsert: true, new: true, runValidators: true },
      );
      await SocialNotification.updateOne(
        { key: `invitation:${invite._id}:0` },
        {
          $setOnInsert: {
            recipient,
            actor: req.userId,
            kind: "invitation",
            invitation: invite._id,
          },
        },
        { upsert: true },
      );
      res.status(201).json({ data: { id: String(invite._id) } });
    },
  );
  return router;
}
