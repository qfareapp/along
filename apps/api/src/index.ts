import mongoose from "mongoose";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { initializeCategories } from "./categories.js";
import { cleanupSocial } from "./social.js";
import { setTimeout as delay } from "node:timers/promises";

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
      await initializeCategories();
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
void connectDatabase();
let cleaningSocial = false;
const socialCleanup = setInterval(() => {
  if (mongoose.connection.readyState === 1 && !cleaningSocial) {
    cleaningSocial = true;
    void cleanupSocial()
      .catch(() =>
        console.error("Social cleanup failed; retrying next minute."),
      )
      .finally(() => {
        cleaningSocial = false;
      });
  }
}, 60000);
socialCleanup.unref();
function shutdown() {
  clearInterval(socialCleanup);
  shutdownController.abort();
  server.close(() => {
    void mongoose.disconnect().then(() => process.exit(0));
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
