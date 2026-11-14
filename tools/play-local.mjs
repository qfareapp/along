import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
const children = [];
let closing = false;
function stop() {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (process.platform === "win32" && child.pid)
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    else child.kill("SIGTERM");
  }
}
function run(args, cwd, env = process.env) {
  const child = spawn(process.execPath, args, {
    cwd: path.resolve(cwd),
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop();
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    if (!closing) {
      stop();
      process.exitCode = code ?? 1;
    }
  });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
run(
  [
    "node_modules/tsx/dist/cli.mjs",
    "src/play-local.ts",
    ...(process.argv.includes("--groups") ? ["--groups"] : []),
  ],
  "apps/api",
);
run(
  [
    "node_modules/expo/bin/cli",
    "start",
    "--web",
    "--localhost",
    "--port",
    "18098",
  ],
  "apps/mobile",
  {
    ...process.env,
    NODE_ENV: "development",
    CI: "false",
    BROWSER: "none",
    EXPO_PUBLIC_DEMO_MODE: "false",
    EXPO_PUBLIC_API_URL: "http://127.0.0.1:4118/api/v1",
  },
);
console.log(
  "Local preview: http://localhost:18098 - use separate browser profiles for Alice and Bob.",
);
