import { spawn } from "node:child_process";
import path from "node:path";
function run(args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Social QA exited ${code}`)),
    );
  });
}
await run(
  [
    "node_modules/expo/bin/cli",
    "export",
    "--platform",
    "web",
    "--output-dir",
    "dist-social-qa",
  ],
  path.resolve("apps/mobile"),
  {
    ...process.env,
    EXPO_PUBLIC_DEMO_MODE: "false",
    EXPO_PUBLIC_API_URL: "http://127.0.0.1:4110/api/v1",
  },
);
await run(
  [
    "node_modules/tsx/dist/cli.mjs",
    "src/social-browser-qa.ts",
    ...process.argv.slice(2),
  ],
  path.resolve("apps/api"),
);
