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
const { User, Profile, ProfileSwipe, Match, Conversation, Block, Activity } =
  await import("./models.js");
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
const app = createApp(),
  admin = request.agent(app);
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
async function invitation(recipient?: number) {
  const response = await post("/invitations", {
    caption: "A friendly game together?",
    ...(recipient != null ? { recipientId: ids[recipient] } : {}),
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.id as string;
}
async function game() {
  const invite = await invitation(1);
  const requested = await post(`/invitations/${invite}/requests`, {}, 1);
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  const accepted = await post(`/requests/${requested.body.data.id}/accept`);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  return accepted.body.data.sessionId as string;
}
async function start(id: string) {
  assert.equal((await post(`/sessions/${id}/ready`)).status, 200);
  assert.equal((await post(`/sessions/${id}/ready`, {}, 1)).status, 200);
  await GameSession.updateOne(
    { _id: id },
    { startsAt: new Date(Date.now() - 1) },
  );
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
  sequence++;
  await Promise.all([
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

test("bank has 100 questions in five categories and only mutual connections can play", async () => {
  assert.equal(await GameQuestion.countDocuments(), 100);
  const definition = await get("");
  assert.equal(definition.status, 200);
  assert.equal(definition.body.data[0].totalQuestions, 15);
  const connections = (await get("/connections")).body.data.map(
    (p: { id: string }) => p.id,
  );
  assert.deepEqual(connections.sort(), [ids[1], ids[2]].sort());
  assert.equal(
    (await post("/invitations", { recipientId: ids[3] })).status,
    404,
  );
  assert.equal(
    (await post("/invitations", { recipientId: ids[0] })).status,
    404,
  );
  await request(app).get("/api/v1/games").expect(401);
});
test("targeted invitations are private; one-sided likes and outsiders cannot request", async () => {
  const id = await invitation(1);
  assert.equal((await get("/invitations", 1)).body.data.length, 1);
  assert.equal((await get("/invitations", 2)).body.data.length, 0);
  for (const who of [2, 3, 4])
    assert.equal(
      (await post(`/invitations/${id}/requests`, {}, who)).status,
      404,
    );
  assert.equal((await post(`/invitations/${id}/requests`)).status, 400);
});
test("Social invitations reach eligible matches only and prevent duplicate requests", async () => {
  const id = await invitation();
  assert.equal((await get("/invitations", 2)).body.data.length, 1);
  assert.equal((await get("/invitations", 3)).body.data.length, 0);
  assert.equal((await post(`/invitations/${id}/requests`, {}, 1)).status, 201);
  assert.equal((await post(`/invitations/${id}/requests`, {}, 1)).status, 409);
  assert.equal(await GamePlayRequest.countDocuments({ invitation: id }), 1);
});
test("expired and cancelled invitations cannot start sessions", async () => {
  const id = await invitation();
  await GameInvitation.updateOne(
    { _id: id },
    { expiresAt: new Date(Date.now() - 1) },
  );
  assert.equal((await post(`/invitations/${id}/requests`, {}, 1)).status, 409);
  const next = await invitation();
  await post(`/invitations/${next}/cancel`);
  assert.equal(
    (await post(`/invitations/${next}/requests`, {}, 1)).status,
    409,
  );
  assert.equal((await post(`/invitations/${next}/cancel`, {}, 1)).status, 409);
});
test("Social audience privacy is respected while a direct chat invitation remains explicit", async () => {
  await SocialSettings.create({ user: ids[0], hidden: [ids[1]] });
  const broadcast = await invitation();
  assert.equal((await get("/invitations", 1)).body.data.length, 0);
  assert.equal(
    (await post(`/invitations/${broadcast}/requests`, {}, 1)).status,
    404,
  );
  const direct = await invitation(1);
  assert.equal((await get("/invitations", 1)).body.data[0].id, direct);
  assert.equal(
    (await post(`/invitations/${direct}/requests`, {}, 1)).status,
    201,
  );
});
test("simultaneous accepts claim exactly one request and one session", async () => {
  const id = await invitation();
  const a = await post(`/invitations/${id}/requests`, {}, 1),
    b = await post(`/invitations/${id}/requests`, {}, 2);
  const responses = await Promise.all([
    post(`/requests/${a.body.data.id}/accept`),
    post(`/requests/${b.body.data.id}/accept`),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await GameSession.countDocuments(), 1);
  assert.equal(await GamePlayRequest.countDocuments({ status: "accepted" }), 1);
  assert.equal(
    await GamePlayRequest.countDocuments({ status: "unavailable" }),
    1,
  );
  assert.equal((await post(`/invitations/${id}/requests`, {}, 1)).status, 409);
});
test("only the host accepts; nonparticipants cannot view or join the session", async () => {
  const id = await invitation();
  const requested = await post(`/invitations/${id}/requests`, {}, 1);
  assert.equal(
    (await post(`/requests/${requested.body.data.id}/accept`, {}, 2)).status,
    409,
  );
  const accepted = await post(`/requests/${requested.body.data.id}/accept`);
  const session = accepted.body.data.sessionId;
  assert.equal((await get(`/sessions/${session}`, 2)).status, 404);
  assert.equal((await post(`/sessions/${session}/ready`, {}, 2)).status, 404);
  assert.equal((await get("/invitations", 2)).body.data[0].sessionId, null);
});
test("both players must be ready and the server enforces the countdown", async () => {
  const id = await game();
  assert.equal((await get(`/sessions/${id}`)).body.data.question, null);
  await post(`/sessions/${id}/ready`);
  assert.equal((await get(`/sessions/${id}`)).body.data.status, "waiting");
  assert.equal(
    (await post(`/sessions/${id}/answers`, { questionIndex: 0, choice: "A" }))
      .status,
    409,
  );
  await post(`/sessions/${id}/ready`, {}, 1);
  assert.equal((await get(`/sessions/${id}`)).body.data.status, "playing");
  assert.equal(
    (await post(`/sessions/${id}/answers`, { questionIndex: 0, choice: "A" }))
      .status,
    409,
  );
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
test("timeouts and leaving abandon the game without a misleading score", async () => {
  const id = await game();
  await start(id);
  await post(`/sessions/${id}/answers`, { questionIndex: 0, choice: "A" });
  await GameSession.updateOne(
    { _id: id },
    { lastActionAt: new Date(Date.now() - 31 * 60000) },
  );
  const response = await get(`/sessions/${id}`);
  assert.equal(response.body.data.status, "abandoned");
  assert.equal(response.body.data.result, null);
  assert.deepEqual(response.body.data.comparison, []);
  assert.equal(
    (
      await post(
        `/sessions/${id}/answers`,
        { questionIndex: 0, choice: "A" },
        1,
      )
    ).status,
    409,
  );
  const next = await game();
  await post(`/sessions/${next}/leave`);
  assert.equal(
    (await get(`/sessions/${next}`, 1)).body.data.status,
    "abandoned",
  );
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
test("play notifications respect preferences, deduplicate and route to the private game", async () => {
  await SocialSettings.create({ user: ids[2], notifications: false });
  const invite = await invitation();
  assert.equal(
    await SocialNotification.countDocuments({ recipient: ids[2] }),
    0,
  );
  assert.equal(
    await SocialNotification.countDocuments({
      recipient: ids[1],
      kind: "game_invitation",
    }),
    1,
  );
  const requested = await post(`/invitations/${invite}/requests`, {}, 1);
  await post(`/invitations/${invite}/requests`, {}, 1);
  assert.equal(
    await SocialNotification.countDocuments({
      recipient: ids[0],
      kind: "game_request",
    }),
    1,
  );
  const accepted = await post(`/requests/${requested.body.data.id}/accept`);
  const rows = await request(app)
    .get("/api/v1/social/notifications")
    .auth(access[1], { type: "bearer" });
  assert(
    rows.body.data.some(
      (n: { gameSessionId: string }) =>
        n.gameSessionId === accepted.body.data.sessionId,
    ),
  );
});
test("rematches create fresh sessions, avoid repeated questions and preserve history", async () => {
  const id = await game();
  await finish(id);
  const old = await GameSession.findById(id).select("+answers");
  const rematch = await post(`/sessions/${id}/rematch`, {}, 1);
  assert.equal(rematch.status, 201);
  const requested = await post(`/invitations/${rematch.body.data.id}/requests`);
  const accepted = await post(
    `/requests/${requested.body.data.id}/accept`,
    {},
    1,
  );
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const next = await GameSession.findById(accepted.body.data.sessionId);
  const oldIds = new Set(old!.questions.map((q) => String(q.questionId)));
  assert(next!.questions.every((q) => !oldIds.has(String(q.questionId))));
  assert.equal((await GameSession.findById(id))!.status, "completed");
  assert.equal(old!.answers.length, 30);
});
test("plan proposals stay private and unconfirmed until the other player accepts", async () => {
  const id = await game();
  const proposal = {
    title: "Coffee Together?",
    category: "food",
    zone: "A public cafe",
    startsAt: new Date(Date.now() + 86400000).toISOString(),
  };
  assert.equal((await post(`/sessions/${id}/make-plan`, proposal)).status, 409);
  await finish(id);
  const suggestions = await get(`/sessions/${id}/plan-suggestions`);
  assert.equal(suggestions.status, 200);
  const proposed = await post(`/sessions/${id}/make-plan`, proposal);
  assert.equal(proposed.status, 201, JSON.stringify(proposed.body));
  const retried = await post(`/sessions/${id}/make-plan`, proposal);
  assert.equal(retried.body.data.id, proposed.body.data.id);
  assert.equal(await PlanInvitation.countDocuments(), 1);
  assert.equal(await Activity.countDocuments(), 0);
  assert.equal(
    (await PlanInvitation.findById(proposed.body.data.id))!.status,
    "pending",
  );
  const response = await request(app)
    .post(`/api/v1/social/invitations/${proposed.body.data.id}/respond`)
    .set("X-Forwarded-For", ip())
    .auth(access[1], { type: "bearer" })
    .send({ action: "accept", version: 0 });
  assert.equal(response.status, 204, JSON.stringify(response.body));
  const activity = await Activity.findOne({});
  assert.equal(activity!.visibility, "private");
  assert.deepEqual(
    activity!.participants.map(String).sort(),
    ids.slice(0, 2).sort(),
  );
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
      await emit(0, "game:ready", { sessionId: id });
      await emit(1, "game:ready", { sessionId: id });
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
