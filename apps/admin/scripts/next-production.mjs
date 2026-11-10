import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const [command, ...args] = process.argv.slice(2);
if (command !== "build" && command !== "start") {
  throw new Error("Use next-production.mjs with build or start.");
}

// An inherited development NODE_ENV mixes React's renderers during prerendering.
// Set it before Next (and its build workers) load any modules or environment files.
const child = spawn(
  process.execPath,
  [require.resolve("next/dist/bin/next"), command, ...args],
  {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, NODE_ENV: "production" },
    stdio: "inherit",
    windowsHide: true,
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error("Unable to run the admin production command:", error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 143);
});
