import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { z } from "zod";
import { config } from "./config.js";
import { verifyMemberToken } from "./auth.js";
import { completion } from "./onboarding.js";
import { chatEvents } from "./chat-events.js";
import { getPlayState, mutatePlay, setPlayPublisher } from "./play.js";

export function attachPlaySockets(server: HttpServer) {
  const origins = [
    ...config.CORS_ORIGINS.split(",").map((s) => s.trim()),
    new URL(config.ADMIN_ORIGIN).origin,
  ];
  const io = new Server(server, {
    cors: { origin: origins, credentials: true },
    allowRequest: (req, next) => {
      const origin = req.headers.origin;
      if (!origin || origins.includes(origin)) return next(null, true);
      // Android's native WebSocket sends the API URL as its default Origin.
      // Accept that same-host origin while retaining the browser origin allowlist.
      try {
        const parsed = new URL(origin);
        next(
          null,
          ["http:", "https:"].includes(parsed.protocol) &&
            parsed.host === req.headers.host,
        );
      } catch {
        next(null, false);
      }
    },
    maxHttpBufferSize: 8192,
  });
  const play = io.of("/play");
  play.use(async (socket, next) => {
    try {
      const token = z
        .string()
        .min(1)
        .max(4096)
        .parse(socket.handshake.auth?.token);
      const user = await verifyMemberToken(token);
      if (!(await completion(String(user._id))).activated) throw new Error();
      socket.data.userId = String(user._id);
      socket.data.token = token;
      next();
    } catch {
      next(new Error("Please sign in to play."));
    }
  });
  async function broadcast(sessionId: string, chatChanged = false) {
    const sockets = await play.in(`game:${sessionId}`).fetchSockets();
    await Promise.all(
      sockets.map(async (socket) => {
        try {
          await verifyMemberToken(socket.data.token);
          const state = await getPlayState(socket.data.userId, sessionId);
          socket.emit("game:state", state);
          if (chatChanged)
            socket.emit("game:chat_updated", {
              conversationId: state.conversationId,
            });
          if (state.status === "completed")
            socket.emit("game:completed", state);
        } catch {
          socket.emit("game:error", {
            message: "This game is no longer available.",
          });
          socket.disconnect(true);
        }
      }),
    );
  }
  setPlayPublisher(broadcast);
  play.on("connection", (socket) => {
    let windowStart = Date.now(),
      events = 0;
    const input = z
      .object({
        sessionId: z.string().regex(/^[a-f\d]{24}$/i),
        questionIndex: z.number().int().min(0).max(24).optional(),
        choice: z.enum(["A", "B"]).optional(),
      })
      .strict();
    for (const event of [
      "game:join",
      "game:ready",
      "game:answer",
      "game:leave",
    ] as const)
      socket.on(event, async (raw, acknowledge) => {
        const ack = typeof acknowledge === "function" ? acknowledge : () => {};
        try {
          if (Date.now() - windowStart > 10000) {
            windowStart = Date.now();
            events = 0;
          }
          if (++events > 30) throw new Error("Slow down and try again.");
          const user = await verifyMemberToken(socket.data.token);
          const body = input.parse(raw);
          await getPlayState(String(user._id), body.sessionId);
          if (event === "game:join") {
            for (const room of socket.rooms)
              if (room.startsWith("game:")) await socket.leave(room);
            await socket.join(`game:${body.sessionId}`);
            socket.data.sessionId = body.sessionId;
            socket.data.conversationId = (
              await getPlayState(String(user._id), body.sessionId)
            ).conversationId;
            ack({ data: await getPlayState(String(user._id), body.sessionId) });
            await broadcast(body.sessionId);
          } else {
            const action =
              event === "game:ready"
                ? "ready"
                : event === "game:answer"
                  ? "answer"
                  : "leave";
            const state = await mutatePlay(
              String(user._id),
              body.sessionId,
              action,
              action === "answer"
                ? { questionIndex: body.questionIndex, choice: body.choice }
                : {},
            );
            ack({ data: state });
          }
        } catch (error) {
          const message =
            error instanceof z.ZodError
              ? "Invalid game action."
              : error instanceof Error
                ? error.message
                : "Unable to update the game.";
          ack({ error: { message } });
          socket.emit("game:error", { message });
        }
      });
    socket.on("disconnect", () => {
      if (socket.data.sessionId)
        socket
          .to(`game:${socket.data.sessionId}`)
          .emit("game:player_disconnected");
    });
  });
  // Revalidate active subscribers even when they are idle: blocks, unmatches,
  // suspensions and token revocations must not leave an authorized socket behind.
  const recheck = setInterval(() => {
    const sessions = new Set(
      [...play.sockets.values()]
        .map((s) => s.data.sessionId)
        .filter((s): s is string => typeof s === "string"),
    );
    void Promise.all([...sessions].map((id) => broadcast(id))).catch(() => {});
  }, 10000);
  recheck.unref();
  const chatChanged = (conversationId: string) => {
    const sessions = new Set(
      [...play.sockets.values()]
        .filter((s) => s.data.conversationId === conversationId)
        .map((s) => s.data.sessionId as string),
    );
    void Promise.all([...sessions].map((id) => broadcast(id, true))).catch(
      () => {},
    );
  };
  chatEvents.on("changed", chatChanged);
  io.on("close", () => clearInterval(recheck));
  return {
    io,
    close: async () => {
      clearInterval(recheck);
      chatEvents.off("changed", chatChanged);
      setPlayPublisher(async () => {});
      await io.close();
    },
  };
}
