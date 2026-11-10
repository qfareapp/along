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
      code === 0 ? resolve() : reject(new Error(`QA command exited ${code}`)),
    );
  });
}
const root = process.cwd();
await run(
  [
    "node_modules/expo/bin/cli",
    "export",
    "--platform",
    "web",
    "--output-dir",
    "dist-onboarding-qa",
  ],
  path.join(root, "apps/mobile"),
  {
    ...process.env,
    EXPO_PUBLIC_DEMO_MODE: "false",
    EXPO_PUBLIC_API_URL: "http://127.0.0.1:4101/api/v1",
  },
);
await run(
  [
    "node_modules/tsx/dist/cli.mjs",
    "src/onboarding-browser-qa.ts",
    ...process.argv.slice(2),
  ],
  path.join(root, "apps/api"),
);
