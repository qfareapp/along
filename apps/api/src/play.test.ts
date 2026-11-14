import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "node:http";
import mongoose from "mongoose";
import request from "supertest";
import { io as connectSocket, type Socket } from "socket.io-client";
import { MongoMemoryReplSet } from "mongodb-memory-server";

process.env.NODE_ENV = "test";
process.env.ADMIN_AUTH_MODE = "env";
process.env.ADMIN_EMAIL = "play-admin@example.test";
process.env.ADMIN_PASSWORD = "Play-admin-only123!";
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
process.env.ADMIN_ORIGIN = "http://localhost:3000";
process.env.EMAIL_VERIFICATION_REQUIRED = "false";
process.env.TRUST_PROXY_HOPS = "1";
const { createApp } = await import("./app.js");
const {
  User,
  Profile,
  ProfileSwipe,
  Match,
  Conversation,
  Block,
  Activity,
  Message,
} = await import("./models.js");
const {
  GameDefinition,
  GameQuestion,
  GameInvitation,
  GamePlayRequest,
  GameSession,
} = await import("./play-models.js");
const { PlanInvitation, SocialNotification, SocialSettings } =
  await import("./social-models.js");
const { AuditLog } = await import("./admin/models.js");
const { initializePlay } = await import("./play-bank.js");
const { seedCategories } = await import("./categories.js");
const { eligibleProfile } = await import("./test-fixtures.js");
const { tokens } = await import("./auth.js");
const { attachPlaySockets } = await import("./play-sockets.js");
let app = createApp();
const admin = request.agent(app);
let db: MongoMemoryReplSet,
  adminCsrf = "",
  adminId = "",
  sequence = 0;
const ids: string[] = [],
  access: string[] = [],
  photos: string[][] = [];
const ip = () => `198.51.100.${sequence}`;
const get = (path: string, who = 0) =>
  request(app)
    .get(`/api/v1/games${path}`)
    .set("X-Forwarded-For", ip())
    .auth(access[who], { type: "bearer" });
const post = (path: string, body: unknown = {}, who = 0) =>
  request(app)
    .post(`/api/v1/games${path}`)
    .set("X-Forwarded-For", ip())
    .auth(access[who], { type: "bearer" })
    .send(body);
const adminWrite = (
  path: string,
  body: unknown,
  method: "post" | "patch" = "post",
) =>
  admin[method](`/api/v1/admin/games${path}`)
    .set({
      Origin: "http://localhost:3000",
      "X-CSRF-Token": adminCsrf,
      "X-Forwarded-For": ip(),
    })
    .send(body);
async function invitation(recipient = 1) {
  const response = await post("/invitations", { recipientId: ids[recipient] });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id as string;
}
async function game() {
  const invite = await invitation();
  const accepted = await post(`/invitations/${invite}/accept`, {}, 1);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  return accepted.body.data.sessionId as string;
}
async function start(_id: string) {
  /* Acceptance starts the game immediately. */
}
async function finish(id: string, same = 15) {
  await start(id);
  for (let i = 0; i < 15; i++) {
    const replies = await Promise.all([
      post(`/sessions/${id}/answers`, { questionIndex: i, choice: "A" }),
      post(
        `/sessions/${id}/answers`,
        { questionIndex: i, choice: i < same ? "A" : "B" },
        1,
      ),
    ]);
    for (const reply of replies)
      assert.equal(reply.status, 200, JSON.stringify(reply.body));
  }
}
before(
  async () => {
    db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(db.getUri());
    await Promise.all([
      GameDefinition.init(),
      GameQuestion.init(),
      GameInvitation.init(),
      GamePlayRequest.init(),
      GameSession.init(),
      Match.init(),
      Conversation.init(),
      Message.init(),
      SocialNotification.init(),
      ProfileSwipe.init(),
    ]);
    await initializePlay();
    await seedCategories();
    for (let i = 0; i < 5; i++) {
      const user = await User.create({
        name: `Player ${i}`,
        email: `player-${i}@example.test`,
        passwordHash: "fixture",
        birthDate: "1998-01-01",
      });
      ids.push(String(user._id));
      access.push((await tokens(ids[i])).accessToken);
      const profile = await eligibleProfile(user._id);
      photos.push([...profile!.photos]);
    }
    for (const peer of [1, 2]) {
      const match = await Match.create({
        users: [ids[0], ids[peer]],
        pairKey: [ids[0], ids[peer]].sort().join(":"),
      });
      await Conversation.create({ match: match._id });
    }
    await ProfileSwipe.create({ user: ids[3], target: ids[0], action: "like" });
    const login = await admin
      .post("/api/v1/admin/auth/login")
      .set("Origin", "http://localhost:3000")
      .send({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
      });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    adminCsrf = login.body.data.csrf;
    adminId = String(
      (await User.findOne({ email: process.env.ADMIN_EMAIL }))!._id,
    );
  },
  { timeout: 180000 },
);
beforeEach(async () => {
  // Each scenario gets its own request quotas as well as fresh game state.
  // Changing a forwarded IP must not reset an authenticated member's quota.
  app = createApp();
  sequence++;
  await Promise.all([
    Message.deleteMany({}),
    GameSession.deleteMany({}),
    GameInvitation.deleteMany({}),
    GamePlayRequest.deleteMany({}),
    SocialNotification.deleteMany({}),
    SocialSettings.deleteMany({}),
    Block.deleteMany({}),
    PlanInvitation.deleteMany({}),
    Activity.deleteMany({}),
  ]);
  await User.updateMany(
    { _id: { $in: ids } },
    { status: "active", restrictions: {}, sessionVersion: 0 },
  );
  await Match.updateMany({}, { active: true });
  await GameQuestion.updateMany({}, { active: true });
  await GameDefinition.updateOne(
    { key: "this_or_that" },
    {
      active: true,
      questionsPerCategory: 3,
      invitationMinutes: 30,
      inactivityMinutes: 30,
    },
  );
  for (let i = 0; i < ids.length; i++)
    await Profile.updateOne({ user: ids[i] }, { photos: photos[i] });
});
after(async () => {
  await mongoose.disconnect();
  if (db) await db.stop();
});

test("identical unique questions, hidden answers and no early results", async () => {
  const id = await game();
  await start(id);
  const stored = await GameSession.findById(id);
  assert.equal(
    new Set(stored!.questions.map((q) => String(q.questionId))).size,
    15,
  );
  for (const category of [
    "lifestyle",
    "food",
    "travel",
    "entertainment",
    "connection",
  ])
    assert.equal(
      stored!.questions.filter((q) => q.category === category).length,
      3,
    );
  const a = (await get(`/sessions/${id}`)).body.data,
    b = (await get(`/sessions/${id}`, 1)).body.data;
  assert.deepEqual(a.question, b.question);
  await post(`/sessions/${id}/answers`, { questionIndex: 0, choice: "B" });
  const hidden = (await get(`/sessions/${id}`, 1)).body.data;
  assert.equal(hidden.ownAnswer, null);
  assert.equal(hidden.opponentAnswered, true);
  assert.equal(hidden.answers, undefined);
  assert.equal(hidden.result, null);
  assert.deepEqual(hidden.comparison, []);
  assert.equal((await get(`/sessions/${id}/results`)).status, 409);
});
test("answers lock, retries deduplicate, and simultaneous submits advance once", async () => {
  const id = await game();
  await start(id);
  const replies = await Promise.all([
    post(`/sessions/${id}/answers`, { questionIndex: 0, choice: "A" }),
    post(`/sessions/${id}/answers`, { questionIndex: 0, choice: "A" }),
    post(`/sessions/${id}/answers`, { questionIndex: 0, choice: "B" }, 1),
  ]);
  for (const r of replies) assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(
    (await post(`/sessions/${id}/answers`, { questionIndex: 0, choice: "B" }))
      .status,
    409,
  );
  assert.equal(
    (await post(`/sessions/${id}/answers`, { questionIndex: 3, choice: "A" }))
      .status,
    409,
  );
  const stored = await GameSession.findById(id).select("+answers");
  assert.equal(stored!.answers.length, 2);
  assert.equal(stored!.currentQuestionIndex, 1);
  assert.equal(
    (
      await post(`/sessions/${id}/answers`, {
        questionIndex: 1,
        choice: "A",
        score: 100,
      })
    ).status,
    400,
  );
});
test("completed scores and category breakdowns agree, questions retain their historical snapshots", async () => {
  const id = await game();
  const before = await GameSession.findById(id);
  await GameQuestion.updateOne(
    { _id: before!.questions[0]!.questionId },
    { text: "Changed question bank text?" },
  );
  await finish(id, 12);
  const a = (await get(`/sessions/${id}/results`)).body.data,
    b = (await get(`/sessions/${id}/results`, 1)).body.data;
  assert.equal(a.result.score, 80);
  assert.equal(a.result.matchedAnswers, 12);
  assert.equal(a.result.label, "In Sync");
  assert.deepEqual(a.result, b.result);
  assert.equal(a.comparison.length, 15);
  assert.equal(a.comparison[0].text, before!.questions[0]!.text);
  for (const [category, value] of Object.entries(a.result.categoryScores)) {
    const group = a.comparison.filter(
      (q: { category: string }) => q.category === category,
    );
    assert.equal(
      value,
      Math.round(
        (group.filter(
          (q: { ownChoice: string; otherChoice: string }) =>
            q.ownChoice === q.otherChoice,
        ).length /
          3) *
          100,
      ),
    );
  }
  assert.match(a.disclaimer, /not a prediction/);
});
test("zero agreement remains a playful score and does not change the match", async () => {
  const id = await game();
  await finish(id, 0);
  const result = (await get(`/sessions/${id}`)).body.data.result;
  assert.equal(result.score, 0);
  assert.equal(result.label, "Opposites in Play");
  assert(
    await Match.exists({
      pairKey: [ids[0], ids[1]].sort().join(":"),
      active: true,
    }),
  );
});
test("reopening restores progress and own submitted choice without revealing the opponent", async () => {
  const id = await game();
  await start(id);
  await post(`/sessions/${id}/answers`, { questionIndex: 0, choice: "B" });
  const reload = await request(createApp())
    .get(`/api/v1/games/sessions/${id}`)
    .auth(access[0], { type: "bearer" });
  assert.equal(reload.body.data.ownAnswer, "B");
  assert.equal(reload.body.data.currentQuestionIndex, 0);
  assert.equal((await get(`/sessions/${id}`, 1)).body.data.ownAnswer, null);
});
test("blocks, unmatches, eligibility loss and suspension revoke gameplay and history", async () => {
  const id = await game();
  await Block.create({ user: ids[1], target: ids[0] });
  assert.equal((await get(`/sessions/${id}`)).status, 404);
  assert.equal((await post(`/sessions/${id}/ready`, {}, 1)).status, 404);
  assert.deepEqual((await get("/sessions")).body.data, []);
  await Block.deleteMany({});
  await Match.updateMany({}, { active: false });
  assert.equal((await get(`/sessions/${id}`)).status, 404);
  await Match.updateMany({}, { active: true });
  await Profile.updateOne({ user: ids[1] }, { photos: [] });
  assert.equal((await get(`/sessions/${id}`)).status, 404);
  await Profile.updateOne({ user: ids[1] }, { photos: photos[1] });
  await User.updateOne({ _id: ids[1] }, { status: "suspended" });
  assert.equal((await get(`/sessions/${id}`)).status, 404);
});
test("admin question management requires permissions and logs edits without changing session snapshots", async () => {
  const bank = await admin.get("/api/v1/admin/games/questions");
  assert.equal(bank.status, 200);
  await request(app)
    .get("/api/v1/admin/games/questions")
    .auth(access[0], { type: "bearer" })
    .expect(401);
  await User.updateOne({ _id: adminId }, { adminRole: "analyst" });
  assert.equal((await admin.get("/api/v1/admin/games/questions")).status, 403);
  await User.updateOne({ _id: adminId }, { adminRole: "super-admin" });
  const body = {
    category: "food",
    text: "Your ideal cafe visit?",
    optionA: "Coffee",
    optionB: "Chai",
    active: true,
    tone: "playful",
    reason: "Add another friendly food question",
  };
  const created = await adminWrite("/questions", body);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(
    (
      await adminWrite(
        `/questions/${created.body.data.id}`,
        { ...body, active: false },
        "patch",
      )
    ).status,
    200,
  );
  assert.equal(
    (await GameQuestion.findById(created.body.data.id))!.active,
    false,
  );
  assert.equal(
    await AuditLog.countDocuments({ targetId: created.body.data.id }),
    2,
  );
  const changed = await adminWrite(
    "/settings",
    {
      active: true,
      questionsPerCategory: 3,
      invitationMinutes: 20,
      inactivityMinutes: 30,
      reason: "Adjust play invitation expiry window",
    },
    "patch",
  );
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  const filtered = await admin.get(
    "/api/v1/admin/games/questions?category=food",
  );
  assert(
    filtered.body.data.questions.every(
      (q: { category: string }) => q.category === "food",
    ),
  );
});
test(
  "two authenticated sockets synchronize safely and revoke access after a block",
  { timeout: 60000 },
  async () => {
    const id = await game();
    const server = createServer(app),
      sockets = attachPlaySockets(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert(address && typeof address !== "string");
    const clients: Socket[] = [];
    try {
      for (const who of [0, 1, 2]) {
        const socket = connectSocket(`http://127.0.0.1:${address.port}/play`, {
          auth: { token: access[who] },
          transports: ["websocket"],
          forceNew: true,
          extraHeaders: { Origin: `http://127.0.0.1:${address.port}` },
        });
        clients.push(socket);
        await new Promise<void>((resolve, reject) => {
          socket.once("connect", resolve);
          socket.once("connect_error", reject);
        });
      }
      const emit = (who: number, event: string, data: unknown) =>
        new Promise<{
          data?: {
            currentQuestionIndex: number;
            ownAnswer: string | null;
            comparison: unknown[];
          };
          error?: { message: string };
        }>((resolve, reject) =>
          clients[who]
            .timeout(5000)
            .emit(
              event,
              data,
              (error: Error | null, reply: Parameters<typeof resolve>[0]) =>
                error
                  ? reject(new Error(`${event}: ${error.message}`))
                  : resolve(reply),
            ),
        );
      assert((await emit(2, "game:join", { sessionId: id })).error);
      assert((await emit(0, "game:join", { sessionId: id })).data);
      assert((await emit(1, "game:join", { sessionId: id })).data);
      await GameSession.updateOne(
        { _id: id },
        { startsAt: new Date(Date.now() - 1) },
      );
      const updated = new Promise<{
        ownAnswer: string | null;
        comparison: unknown[];
      }>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Opponent did not receive game:state")),
          5000,
        );
        clients[1].once("game:state", (value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
      await emit(0, "game:answer", {
        sessionId: id,
        questionIndex: 0,
        choice: "B",
      });
      const state = await updated;
      assert.equal(state.ownAnswer, null);
      assert.deepEqual(state.comparison, []);
      const joined = await emit(1, "game:join", { sessionId: id });
      assert.equal(joined.data!.currentQuestionIndex, 0);
      await Block.create({ user: ids[0], target: ids[1] });
      try {
        const blocked = await emit(1, "game:answer", {
          sessionId: id,
          questionIndex: 0,
          choice: "A",
        });
        assert(blocked.error);
      } catch (error) {
        assert.match((error as Error).message, /disconnected/);
        assert(clients[1].disconnected);
      }
      assert.equal(
        (await GameSession.findById(id).select("+answers"))!.answers.length,
        1,
      );
    } finally {
      for (const socket of clients) socket.disconnect();
      await sockets.close();
    }
  },
);

test("direct invitation appears only in its chat, recipient accepts without host approval", async () => {
  const invite = await invitation();
  const stored = await GameInvitation.findById(invite);
  const conversation = String(stored!.conversation);
  assert.equal(stored!.expiresAt, null);
  assert.equal((await post(`/invitations/${invite}/accept`)).status, 404);
  assert.equal(
    (await post(`/invitations/${invite}/accept`, {}, 2)).status,
    404,
  );
  const thread = await request(app)
    .get(`/api/v1/conversations/${conversation}`)
    .auth(access[1], { type: "bearer" });
  assert.equal(thread.body.data.messages[0].gameInvitationId, invite);
  assert.equal(await SocialNotification.countDocuments(), 0);
  const accepted = await post(`/invitations/${invite}/accept`, {}, 1);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const state = (await get(`/sessions/${accepted.body.data.sessionId}`)).body
    .data;
  assert.equal(state.status, "playing");
  assert(state.question);
  assert.equal(state.expiresAt, null);
  assert.equal(
    (
      await post(`/sessions/${state.id}/answers`, {
        questionIndex: 0,
        choice: "A",
      })
    ).status,
    200,
  );
  assert.equal(
    (await post(`/invitations/${invite}/accept`, {}, 1)).body.data.sessionId,
    state.id,
  );
});
test("no broadcast or one-sided likes can send a game request", async () => {
  assert.equal((await post("/invitations", {})).status, 400);
  assert.equal(
    (await post("/invitations", { recipientId: ids[3] })).status,
    404,
  );
  const out = await request(app)
    .post("/api/v1/games/invitations")
    .set("X-Forwarded-For", ip())
    .auth(access[3], { type: "bearer" })
    .send({ recipientId: ids[0] });
  assert.equal(out.status, 404);
  assert((await GameQuestion.countDocuments()) >= 100);
});
test("recipient rejection ends the invitation and notifies the sender only in chat", async () => {
  const invite = await invitation();
  const declined = await post(`/invitations/${invite}/decline`, {}, 1);
  assert.equal(declined.status, 200);
  assert.equal((await GameInvitation.findById(invite))!.status, "declined");
  assert.equal(await GameSession.countDocuments(), 0);
  assert.equal(
    await Message.countDocuments({
      gameEvent: "declined",
      sender: ids[1],
      readAt: null,
    }),
    1,
  );
  assert.equal(await SocialNotification.countDocuments(), 0);
  assert.equal(
    (await post(`/invitations/${invite}/accept`, {}, 1)).status,
    409,
  );
});
test("offline invitations and saved turns survive days away; every round reveals only after both answer", async () => {
  const invite = await invitation();
  await GameInvitation.updateOne(
    { _id: invite },
    { createdAt: new Date(Date.now() - 7 * 86400000) },
  );
  const accepted = await post(`/invitations/${invite}/accept`, {}, 1);
  assert.equal(accepted.status, 200);
  const id = accepted.body.data.sessionId;
  await post(`/sessions/${id}/answers`, { questionIndex: 0, choice: "B" });
  await GameSession.updateOne(
    { _id: id },
    { lastActionAt: new Date(Date.now() - 7 * 86400000) },
  );
  const away = (await get(`/sessions/${id}`, 1)).body.data;
  assert.equal(away.status, "playing");
  assert.equal(away.opponentAnswered, true);
  assert.deepEqual(away.rounds, []);
  assert.equal(away.ownAnswer, null);
  const first = await Message.findOne({ gameEvent: "turn" });
  assert(first);
  assert(!first.text.includes("optionB"));
  const reply = await post(
    `/sessions/${id}/answers`,
    { questionIndex: 0, choice: "A" },
    1,
  );
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.equal(reply.body.data.currentQuestionIndex, 1);
  assert.equal(reply.body.data.rounds[0].matched, false);
  assert.equal(reply.body.data.rounds[0].ownChoice, "A");
  const returned = (await get(`/sessions/${id}`)).body.data;
  assert.equal(returned.rounds[0].ownChoice, "B");
  assert.equal(returned.rounds[0].otherChoice, "A");
  await post(`/sessions/${id}/answers`, { questionIndex: 1, choice: "A" });
  await post(`/sessions/${id}/answers`, { questionIndex: 1, choice: "A" }, 1);
  assert.equal(
    (await get(`/sessions/${id}`)).body.data.rounds[1].matched,
    true,
  );
  assert.equal(await Message.countDocuments({ gameEvent: "turn" }), 2);
  assert.equal(await Message.countDocuments({ gameEvent: "round" }), 2);
  assert.equal(await SocialNotification.countDocuments(), 0);
});
test("parallel invitations and accepts cannot create duplicate chat games", async () => {
  const sends = await Promise.all([
    post("/invitations", { recipientId: ids[1] }),
    post("/invitations", { recipientId: ids[1] }),
  ]);
  assert.deepEqual(sends.map((r) => r.status).sort(), [201, 409]);
  const invite = sends.find((r) => r.status === 201)!.body.data.id;
  const accepts = await Promise.all([
    post(`/invitations/${invite}/accept`, {}, 1),
    post(`/invitations/${invite}/accept`, {}, 1),
  ]);
  assert(accepts.every((r) => [200, 409].includes(r.status)));
  assert.equal(await GameSession.countDocuments(), 1);
  assert.equal(await Message.countDocuments({ gameEvent: "accepted" }), 1);
  assert.equal(
    (await post("/invitations", { recipientId: ids[1] })).status,
    409,
  );
});
test("chat unread badge records offline game turns and clears when the chat is opened", async () => {
  const id = await game();
  const conversation = String((await GameSession.findById(id))!.conversation);
  await Message.updateMany({}, { readAt: new Date() });
  await post(`/sessions/${id}/answers`, { questionIndex: 0, choice: "B" });
  await post(`/sessions/${id}/answers`, { questionIndex: 0, choice: "B" });
  const list = await request(app)
    .get("/api/v1/conversations")
    .auth(access[1], { type: "bearer" });
  const row = list.body.data.find((r: { id: string }) => r.id === conversation);
  assert.equal(row.unread, 1);
  assert.equal(row.lastMessage.gameEvent, "turn");
  await request(app)
    .get(`/api/v1/conversations/${conversation}`)
    .auth(access[1], { type: "bearer" })
    .expect(200);
  assert.equal(
    await Message.countDocuments({
      conversation,
      sender: ids[0],
      readAt: null,
    }),
    0,
  );
});
test("explicit ending creates no score and permits a new direct invitation", async () => {
  const id = await game();
  await post(`/sessions/${id}/leave`);
  assert.equal((await get(`/sessions/${id}`)).body.data.status, "abandoned");
  assert.equal((await get(`/sessions/${id}`)).body.data.result, null);
  await invitation();
});
test("messaging restrictions cannot be bypassed using game requests or answers", async () => {
  await User.updateOne({ _id: ids[0] }, { "restrictions.messaging": true });
  assert.equal(
    (await post("/invitations", { recipientId: ids[1] })).status,
    403,
  );
  await User.updateOne({ _id: ids[0] }, { restrictions: {} });
  const id = await game();
  await User.updateOne({ _id: ids[1] }, { "restrictions.messaging": true });
  assert.equal(
    (
      await post(
        `/sessions/${id}/answers`,
        { questionIndex: 0, choice: "A" },
        1,
      )
    ).status,
    403,
  );
});

test("host cancellation closes the request atomically and sends a chat notice", async () => {
  const invite = await invitation();
  assert.equal(
    (await post(`/invitations/${invite}/cancel`, {}, 1)).status,
    409,
  );
  assert.equal((await post(`/invitations/${invite}/cancel`)).status, 204);
  assert.equal(
    (await post(`/invitations/${invite}/accept`, {}, 1)).status,
    409,
  );
  assert.equal((await GameInvitation.findById(invite))!.status, "cancelled");
  assert.equal(await Message.countDocuments({ gameEvent: "cancelled" }), 1);
  assert.equal(await GameSession.countDocuments(), 0);
});
test("Social settings do not gate a private matched chat game and old Social game notices stay hidden", async () => {
  await SocialSettings.create({
    user: ids[1],
    enabled: false,
    notifications: false,
    hidden: [ids[0]],
  });
  const id = await game();
  assert.equal(
    (await post(`/sessions/${id}/answers`, { questionIndex: 0, choice: "A" }))
      .status,
    200,
  );
  await SocialNotification.create({
    recipient: ids[0],
    actor: ids[1],
    kind: "game_waiting",
    key: "legacy-game-notice",
    gameSession: id,
  });
  const notifications = await request(app)
    .get("/api/v1/social/notifications")
    .auth(access[0], { type: "bearer" });
  assert(
    !notifications.body.data.some((n: { kind: string }) =>
      n.kind.startsWith("game_"),
    ),
  );
});
