import "dotenv/config";
import mongoose from "mongoose";
import readline from "node:readline/promises";
import { config } from "../config.js";
import { provisionFirstAdmin } from "./provision.js";
import { totpFor } from "./security.js";

if (!config.MONGODB_URI || !config.ADMIN_ENCRYPTION_KEY)
  throw new Error(
    "Set MONGODB_URI and ADMIN_ENCRYPTION_KEY in apps/api/.env first.",
  );
if (!process.stdin.isTTY)
  throw new Error(
    "Run this command in an interactive terminal; never pass a password as a command argument.",
  );
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const email = await rl.question("Initial Super Admin email: ");
const name = await rl.question("Admin name: ");
rl.close();
process.stdout.write(
  "Password (6+ chars, upper/lowercase, number and symbol; hidden): ",
);
const password = await new Promise<string>((resolve) => {
  let value = "";
  process.stdin.setRawMode(true);
  process.stdin.resume();
  const onData = (data: Buffer) => {
    for (const ch of data.toString()) {
      if (ch === "\u0003") process.exit(130);
      if (ch === "\r" || ch === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.off("data", onData);
        process.stdin.pause();
        process.stdout.write("\n");
        resolve(value);
        return;
      }
      if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
      else value += ch;
    }
  };
  process.stdin.on("data", onData);
});
await mongoose.connect(config.MONGODB_URI);
try {
  const result = await provisionFirstAdmin(email.trim(), password, name.trim());
  console.log(
    "\nAdd this account to your authenticator using this setup URI. Keep it private:",
  );
  console.log(totpFor(result.secret, email).toString());
  console.log(
    "\nStore these one-time recovery codes securely (shown only now):",
  );
  console.log(result.recoveryCodes.join("\n"));
  console.log(
    "\nBootstrap complete. Sign in to the admin panel with password and an authenticator code.",
  );
} finally {
  await mongoose.disconnect();
}
