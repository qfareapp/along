import { spawnSync } from "node:child_process";
import path from "node:path";
// Use the running Metro development preview. No export, APK, or production build.
const result = spawnSync(
  process.execPath,
  [
    "node_modules/tsx/dist/cli.mjs",
    process.argv.includes("--groups")
      ? "src/plan-group-browser-qa.ts"
      : "src/play-browser-qa.ts",
  ],
  {
    cwd: path.resolve("apps/api"),
    stdio: "inherit",
    windowsHide: true,
  },
);
process.exitCode = result.status ?? 1;
