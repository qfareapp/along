import mongoose from "mongoose";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { initializeCategories } from "./categories.js";
import { cleanupSocial } from "./social.js";
import { initializePlay } from "./play-bank.js";
import { attachPlaySockets } from "./play-sockets.js";
import { setTimeout as delay } from "node:timers/promises";
import { PushDevice, PushJob, startPushWorker } from "./push.js";
import {
  Airport,
  AirportSession,
  AirportConnection,
  AirportNotice,
} from "./airport-models.js";
import { cleanupAirportVisits } from "./airports.js";
import {
  cleanupDeletedAccounts,
  MediaDeletion,
  AccountDeletion,
} from "./account-deletion.js";
import { seedCommunities } from "./community-seed.js";
import { cleanupCommunities } from "./community-notifications.js";
import {
  Community,
  CommunityMembership,
  CommunityMessage,
  CommunityReaction,
  CommunityNotice,
} from "./community-models.js";

mongoose.set("bufferCommands", false);
const shutdownController = new AbortController();
async function connectDatabase() {
  if (!config.MONGODB_URI) {
    console.log(
      "MONGODB_URI not set. Health is available; database routes return 503.",
    );
    return;
  }
  let attempts = 0;
  while (!shutdownController.signal.aborted) {
    try {
      await mongoose.connect(config.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
      });
      if (shutdownController.signal.aborted) {
        await mongoose.disconnect();
        return;
      }
      console.log("MongoDB connected");
      await Promise.all([
        PushDevice.init(),
        PushJob.init(),
        Airport.init(),
        AirportSession.init(),
        AirportConnection.init(),
        AirportNotice.init(),
        MediaDeletion.init(),
        AccountDeletion.init(),
      ]);
      await initializeCategories();
      await initializePlay();
      await Promise.all([
        Community.init(),
        CommunityMembership.init(),
        CommunityMessage.init(),
        CommunityReaction.init(),
        CommunityNotice.init(),
      ]);
      await seedCommunities();
      return;
    } catch {
      if (shutdownController.signal.aborted) return;
      const retryMs = Math.min(1000 * 2 ** Math.min(attempts++, 5), 30000);
      console.error(
        `MongoDB unavailable. Retrying in ${retryMs / 1000}s; database routes return 503 until connected.`,
      );
      try {
        await delay(retryMs, undefined, { signal: shutdownController.signal });
      } catch {
        return;
      }
    }
  }
}
const server = createApp().listen(config.PORT, "0.0.0.0", () =>
  console.log(`Along API listening on port ${config.PORT}`),
);
const playSockets = attachPlaySockets(server);
const stopPushWorker = startPushWorker();
void connectDatabase();
let cleaningSocial = false;
const socialCleanup = setInterval(() => {
  if (mongoose.connection.readyState === 1 && !cleaningSocial) {
    cleaningSocial = true;
    void Promise.all([
      cleanupSocial(),
      cleanupAirportVisits(),
      cleanupDeletedAccounts(),
      cleanupCommunities(),
    ])
      .catch(() =>
        console.error("Social cleanup failed; retrying next minute."),
      )
      .finally(() => {
        cleaningSocial = false;
      });
  }
}, 60000);
socialCleanup.unref();
async function shutdown() {
  stopPushWorker();
  clearInterval(socialCleanup);
  shutdownController.abort();
  await playSockets.close();
  await mongoose.disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
