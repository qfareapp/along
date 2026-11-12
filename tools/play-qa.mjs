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
      code === 0
        ? resolve()
        : reject(new Error(`Along Play QA exited ${code}`)),
    );
  });
}
if (!process.argv.includes("--skip-export"))
  await run(
    [
      "node_modules/expo/bin/cli",
      "export",
      "--platform",
      "web",
      "--output-dir",
      "dist-play-qa",
    ],
    path.resolve("apps/mobile"),
    {
      ...process.env,
      EXPO_PUBLIC_DEMO_MODE: "false",
      EXPO_PUBLIC_API_URL: "http://127.0.0.1:4118/api/v1",
    },
  );
await run(
  ["node_modules/tsx/dist/cli.mjs", "src/play-browser-qa.ts"],
  path.resolve("apps/api"),
);
