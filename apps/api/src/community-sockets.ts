import type { Server } from "socket.io";
import { z } from "zod";
import { verifyMemberToken } from "./auth.js";
import { completion } from "./onboarding.js";
import {
  communityAccess,
  communityEvents,
  sendCommunityMessage,
} from "./community-service.js";
import { communityMessageInput } from "./communities.js";
import { authorisePlanGroup } from "./plan-group-service.js";

/** Sockets carry invalidations, not message bodies: REST always reapplies blocks and history boundaries. */
export function attachCommunitySockets(io: Server) {
  const namespace = io.of("/communities");
  namespace.use(async (socket, next) => {
    try {
      const token = z
        .string()
        .min(1)
        .max(4096)
        .parse(socket.handshake.auth?.token);
      const user = await verifyMemberToken(token);
      if (!(await completion(String(user._id))).activated) throw new Error();
      socket.data.token = token;
      socket.data.userId = String(user._id);
      next();
    } catch {
      next(new Error("Please sign in to use Communities."));
    }
  });
  namespace.on("connection", (socket) => {
    let started = Date.now(),
      actions = 0;
    const run = async (
      work: () => Promise<unknown>,
      ack?: (result: unknown) => void,
    ) => {
      try {
        if (Date.now() - started >= 60000) {
          started = Date.now();
          actions = 0;
        }
        if (++actions > 60) throw new Error("Please wait before trying again.");
        await verifyMemberToken(socket.data.token);
        if (!(await completion(socket.data.userId)).activated)
          throw new Error("Complete your profile to continue.");
        const data = await work();
        if (typeof ack === "function") ack({ ok: true, data });
      } catch (error) {
        if (typeof ack === "function")
          ack({
            ok: false,
            error:
              error instanceof Error ? error.message : "Community unavailable.",
          });
      }
    };
    socket.on(
      "community:subscribe",
      (input: unknown, ack?: (r: unknown) => void) =>
        void run(async () => {
          const { communityId } = z
            .object({ communityId: z.string() })
            .parse(input);
          await communityAccess(socket.data.userId, communityId);
          for (const room of socket.rooms)
            if (room.startsWith("community:")) await socket.leave(room);
          await socket.join(`community:${communityId}`);
          return { communityId };
        }, ack),
    );
    socket.on("community:unsubscribe", () => {
      for (const room of socket.rooms)
        if (room.startsWith("community:")) void socket.leave(room);
    });
    socket.on(
      "event:subscribe",
      (input: unknown, ack?: (r: unknown) => void) =>
        void run(async () => {
          const { groupId } = z.object({ groupId: z.string() }).parse(input);
          await authorisePlanGroup(socket.data.userId, groupId);
          for (const room of socket.rooms)
            if (room.startsWith("event:")) await socket.leave(room);
          await socket.join(`event:${groupId}`);
          return { groupId };
        }, ack),
    );
    socket.on(
      "community:message:send",
      (input: unknown, ack?: (r: unknown) => void) =>
        void run(async () => {
          const { communityId, ...message } = communityMessageInput
            .extend({ communityId: z.string() })
            .parse(input);
          return sendCommunityMessage(socket.data.userId, communityId, message);
        }, ack),
    );
  });
  const publish = async (id: string) => {
    const sockets = await namespace.in(`community:${id}`).fetchSockets();
    await Promise.all(
      sockets.map(async (socket) => {
        try {
          await verifyMemberToken(socket.data.token);
          await communityAccess(socket.data.userId, id);
          socket.emit("community:changed", { communityId: id });
        } catch {
          await socket.leave(`community:${id}`);
          socket.emit("community:access-revoked", { communityId: id });
        }
      }),
    );
  };
  const changed = (id: string) => {
    void publish(id).catch(() => {});
  };
  const publishGroup = async (id: string) => {
    const sockets = await namespace.in(`event:${id}`).fetchSockets();
    await Promise.all(
      sockets.map(async (socket) => {
        try {
          await verifyMemberToken(socket.data.token);
          await authorisePlanGroup(socket.data.userId, id);
          socket.emit("event:changed", { groupId: id });
        } catch {
          await socket.leave(`event:${id}`);
          socket.emit("event:access-revoked", { groupId: id });
        }
      }),
    );
  };
  const groupChanged = (id: string) => {
    void publishGroup(id).catch(() => {});
  };
  function recheckEvents() {
    const groups = new Set(
      [...namespace.sockets.values()].flatMap((s) =>
        [...s.rooms]
          .filter((r) => r.startsWith("event:"))
          .map((r) => r.slice(6)),
      ),
    );
    for (const id of groups) groupChanged(id);
  }
  const privacyChanged = () => {
    const ids = new Set(
      [...namespace.sockets.values()].flatMap((s) =>
        [...s.rooms]
          .filter((r) => r.startsWith("community:"))
          .map((r) => r.slice(10)),
      ),
    );
    for (const id of ids) changed(id);
    recheckEvents();
  };
  communityEvents.on("changed", changed);
  communityEvents.on("group-changed", groupChanged);
  communityEvents.on("privacy-changed", privacyChanged);
  const timer = setInterval(() => {
    const ids = new Set(
      [...namespace.sockets.values()].flatMap((s) =>
        [...s.rooms]
          .filter((r) => r.startsWith("community:"))
          .map((r) => r.slice(10)),
      ),
    );
    for (const id of ids) changed(id);
    const groups = new Set(
      [...namespace.sockets.values()].flatMap((s) =>
        [...s.rooms]
          .filter((r) => r.startsWith("event:"))
          .map((r) => r.slice(6)),
      ),
    );
    for (const id of groups) groupChanged(id);
  }, 10000);
  timer.unref();
  return () => {
    clearInterval(timer);
    communityEvents.off("changed", changed);
    communityEvents.off("group-changed", groupChanged);
    communityEvents.off("privacy-changed", privacyChanged);
  };
}
