import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(process.env.ALONG_PREVIEW_DIR ?? "apps/mobile/dist");
const port = Number(process.env.PORT ?? 8081);
const types = {
  ".js": "application/javascript",
  ".html": "text/html",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
  ".json": "application/json",
};
http
  .createServer((req, res) => {
    let file = path.resolve(
      root,
      "." + decodeURIComponent((req.url || "/").split("?")[0]),
    );
    if (!file.startsWith(root + path.sep) && file !== root) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory())
      file = path.join(root, "index.html");
    res.setHeader(
      "Content-Type",
      types[path.extname(file)] || "application/octet-stream",
    );
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`Along preview: http://localhost:${port}`),
  );
