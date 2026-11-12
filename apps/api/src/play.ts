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
  Message,
  Profile,
  User,
} from "./models.js";
import {
  completion,
  discoveryUserIds,
  fail,
  requireReady,
} from "./onboarding.js";
import { pairKey, openConversation, assertCanSend } from "./chat.js";
import { PlanInvitation, SocialNotification } from "./social-models.js";
import { chatEvents } from "./chat-events.js";
import {
  GameDefinition,
  GameInvitation,
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
// Game notices are real messages in the existing matched conversation. They
// participate in chat previews, unread counts and read receipts, never Social.
async function gameMessage(
  actor: string,
  conversation: unknown,
  event: string,
  key: string,
  text: string,
  invitation?: unknown,
  gameSession?: unknown,
  transaction?: mongoose.ClientSession,
) {
  await Message.updateOne(
    { gameEventKey: key },
    {
      $setOnInsert: {
        conversation,
        sender: actor,
        text,
        gameEvent: event,
        gameEventKey: key,
        gameInvitation: invitation,
        gameSession,
      },
    },
    { upsert: true, session: transaction },
  );
  await Conversation.updateOne(
    { _id: conversation },
    { $set: { updatedAt: new Date() } },
    { session: transaction },
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
  // Existing accepted games also resume without a ready check or countdown.
  if (session.status === "waiting") {
    await GameSession.updateOne(
      { _id: session._id, status: "waiting" },
      { $set: { status: "playing", startsAt: new Date() }, $inc: { __v: 1 } },
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
    expiresAt: null,
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
    rounds: session.questions.flatMap((q, i) => {
      const own = session.answers.find(
        (a) => a.questionIndex === i && String(a.player) === userId,
      );
      const other = session.answers.find(
        (a) => a.questionIndex === i && String(a.player) !== userId,
      );
      return own && other
        ? [
            {
              ...q.toObject(),
              questionId: String(q.questionId),
              questionIndex: i,
              ownChoice: own.choice,
              otherChoice: other.choice,
              matched: own.choice === other.choice,
            },
          ]
        : [];
    }),
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
    const conversation = await authorizePlayPair(
      userId,
      String(session.players.find((p) => String(p) !== userId)),
    );
    await assertCanSend(userId, conversation);
    if (action === "ready") return sessionDto(session, userId); // older clients need no ready handshake
    if (action === "leave") {
      if (!["waiting", "playing"].includes(session.status))
        return sessionDto(session, userId);
      session.status = "abandoned";
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
      if (session.status !== "playing") throw fail(409, "This game has ended.");
      if (input.questionIndex !== session.currentQuestionIndex)
        throw fail(409, "This question has changed. Refresh the chat.");
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
    }
    session.lastActionAt = new Date();
    try {
      await mongoose.connection.transaction(async (transaction) => {
        await session.save({ session: transaction });
        if (input) {
          const answers = session.answers.filter(
            (a) => a.questionIndex === input.questionIndex,
          );
          const q = session.questions[input.questionIndex]!;
          if (answers.length === 2) {
            const label = (choice: string) =>
              choice === "A" ? q.optionA : q.optionB;
            const text =
              answers[0]!.choice === answers[1]!.choice
                ? `Question ${input.questionIndex + 1}: It's a match! You both chose ${label(answers[0]!.choice)}.`
                : `Question ${input.questionIndex + 1}: Different choices! ${label(answers[0]!.choice)} / ${label(answers[1]!.choice)}.`;
            await gameMessage(
              userId,
              session.conversation,
              "round",
              `play-round:${session._id}:${input.questionIndex}`,
              text,
              session.invitation,
              session._id,
              transaction,
            );
            if (session.status === "completed")
              await gameMessage(
                userId,
                session.conversation,
                "completed",
                `play-completed:${session._id}`,
                `This or That complete! Your matching score is ${session.result?.score}%.`,
                session.invitation,
                session._id,
                transaction,
              );
          } else {
            await gameMessage(
              userId,
              session.conversation,
              "turn",
              `play-turn:${session._id}:${input.questionIndex}`,
              `I've answered question ${input.questionIndex + 1} in This or That. Your turn whenever you're ready!`,
              session.invitation,
              session._id,
              transaction,
            );
          }
        } else {
          await gameMessage(
            userId,
            session.conversation,
            "ended",
            `play-ended:${session._id}`,
            "This or That was ended. You can send a new invitation anytime.",
            session.invitation,
            session._id,
            transaction,
          );
        }
      });
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
    expiresAt: null,
    recipientId: invite.recipient ? String(invite.recipient) : null,
    status:
      invite.status === "open" &&
      !!invite.expiresAt &&
      invite.expiresAt <= new Date()
        ? "expired"
        : invite.status,
    sessionId:
      linked && includes(linked.players, userId) ? String(linked._id) : null,
    sessionStatus:
      linked && includes(linked.players, userId) ? linked.status : null,
    requests: [],
  };
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
  if (!input.recipientId)
    throw fail(400, "Send a play invitation to a match from your chat.");
  const conversation = await authorizePlayPair(userId, input.recipientId);
  await assertCanSend(userId, conversation);
  if (
    await GameSession.exists({
      conversation: conversation._id,
      status: { $in: ["waiting", "playing"] },
    })
  )
    throw fail(409, "Finish your current game in this chat first.");
  let invite: InstanceType<typeof GameInvitation>;
  try {
    await mongoose.connection.transaction(async (transaction) => {
      const [created] = await GameInvitation.create(
        [
          {
            host: userId,
            recipient: input.recipientId,
            conversation: conversation._id,
            caption: input.caption,
            expiresAt: null,
            ...(rematchOf ? { rematchOf } : {}),
          },
        ],
        { session: transaction },
      );
      invite = created!;
      await gameMessage(
        userId,
        conversation._id,
        "invitation",
        `play-invite:${invite._id}`,
        "Want to play This or That? Accept or reject this invitation below.",
        invite._id,
        undefined,
        transaction,
      );
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000)
      throw fail(409, "A play invitation is already waiting in this chat.");
    throw error;
  }
  chatEvents.emit("changed", String(conversation._id));
  return invitationDto(invite!, userId);
}
export function playRouter() {
  const router = Router();
  router.use(authenticate, requireReady);
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  const write = rateLimit({
    windowMs: 60000,
    limit: 45,
    message: {
      error: {
        code: "RATE_LIMITED",
        message: "Please wait a moment before your next game action.",
      },
    },
  });
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
    const invites = await GameInvitation.find({
      $or: [
        { host: req.userId, recipient: { $in: peers } },
        { recipient: req.userId, host: { $in: peers } },
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
      const invite = await GameInvitation.findOne({
        _id: playId(req.params.id),
        host: req.userId,
        status: "open",
      });
      if (!invite || !invite.recipient)
        throw fail(409, "This invitation has already closed.");
      const conversation = await authorizePlayPair(
        req.userId!,
        String(invite.recipient),
      );
      await assertCanSend(req.userId!, conversation);
      await mongoose.connection.transaction(async (transaction) => {
        const changed = await GameInvitation.findOneAndUpdate(
          { _id: invite._id, status: "open" },
          { status: "cancelled" },
          { session: transaction },
        );
        if (!changed) throw fail(409, "This invitation has already closed.");
        await gameMessage(
          req.userId!,
          conversation._id,
          "cancelled",
          `play-response:${invite._id}`,
          "I cancelled this game invitation. We can play another time.",
          invite._id,
          undefined,
          transaction,
        );
      });
      chatEvents.emit("changed", String(conversation._id));
      res.status(204).end();
    },
  );
  router.post(
    "/invitations/:id/:action",
    write,
    async (req: AuthedRequest, res) => {
      const action = z.enum(["accept", "decline"]).parse(req.params.action);
      const invite = await GameInvitation.findOne({
        _id: playId(req.params.id),
        recipient: req.userId,
      });
      if (!invite) throw fail(404, "Invitation unavailable.");
      const conversation = await authorizePlayPair(
        req.userId!,
        String(invite.host),
      );
      await assertCanSend(req.userId!, conversation);
      if (invite.status === "accepted" && action === "accept" && invite.session)
        return void res.json({ data: { sessionId: String(invite.session) } });
      if (invite.status !== "open")
        throw fail(409, "This invitation has already closed.");
      const definition = await playDefinition();
      if (action === "accept" && !definition.active)
        throw fail(409, "This game is currently paused.");
      const questions =
        action === "accept"
          ? await selectQuestions(
              [String(invite.host), req.userId!],
              definition.questionsPerCategory,
            )
          : [];
      let sessionId: string | null = null;
      await mongoose.connection.transaction(async (transaction) => {
        const claimed = await GameInvitation.findOneAndUpdate(
          { _id: invite._id, status: "open" },
          { status: action === "accept" ? "accepted" : "declined" },
          { session: transaction },
        );
        if (!claimed) throw fail(409, "This invitation has already changed.");
        if (action === "accept") {
          if (
            await GameSession.exists({
              conversation: conversation._id,
              status: { $in: ["waiting", "playing"] },
            }).session(transaction)
          )
            throw fail(409, "This chat already has an unfinished game.");
          const [game] = await GameSession.create(
            [
              {
                invitation: invite._id,
                players: [invite.host, req.userId],
                conversation: conversation._id,
                questions,
                status: "playing",
                startsAt: new Date(),
              },
            ],
            { session: transaction },
          );
          sessionId = String(game!._id);
          await GameInvitation.updateOne(
            { _id: invite._id },
            { session: game!._id },
            { session: transaction },
          );
        }
        await gameMessage(
          req.userId!,
          conversation._id,
          action === "accept" ? "accepted" : "declined",
          `play-response:${invite._id}`,
          action === "accept"
            ? "I accepted your This or That invitation. Answer the first question anytime!"
            : "I declined this game invitation. We can keep chatting!",
          invite._id,
          sessionId,
          transaction,
        );
      });
      chatEvents.emit("changed", String(conversation._id));
      res.json({
        data: {
          status: action === "accept" ? "accepted" : "declined",
          sessionId,
        },
      });
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
      });
      if (existing) {
        res.json({ data: await invitationDto(existing, req.userId!) });
        return;
      }
      await GameInvitation.updateMany(
        {
          rematchOf: session._id,
          status: "open",
          expiresAt: { $ne: null, $lte: new Date() },
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
