import { spawn } from "node:child_process";
import path from "node:path";
let preview;
try {
  await new Promise((resolve, reject) => {
    const build = spawn(
      process.execPath,
      [
        "node_modules/expo/bin/cli",
        "export",
        "--platform",
        "web",
        "--output-dir",
        "dist-demo-qa",
      ],
      {
        cwd: path.resolve("apps/mobile"),
        stdio: "inherit",
        windowsHide: true,
        env: { ...process.env, EXPO_PUBLIC_DEMO_MODE: "true" },
      },
    );
    build.on("error", reject);
    build.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Demo export failed: ${code}`)),
    );
  });
  process.env.ALONG_MOBILE_QA_URL = "http://localhost:18081";
  {
    preview = spawn(process.execPath, ["tools/preview.mjs"], {
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        PORT: "18081",
        ALONG_PREVIEW_DIR: "apps/mobile/dist-demo-qa",
      },
    });
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        if ((await fetch(process.env.ALONG_MOBILE_QA_URL)).ok) break;
      } catch {
        /* Wait briefly for readiness. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await import("./qa.mjs");
} finally {
  if (preview) preview.kill();
}
