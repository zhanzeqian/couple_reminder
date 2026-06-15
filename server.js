import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { handleApiRequest } from "./lib/http.js";
import { runReminderScan } from "./lib/app.js";

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const root = join(process.cwd(), "public");

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

setInterval(() => {
  runReminderScan().catch((error) => console.error("Reminder scan failed", error));
}, 30000);

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname === "/healthz") return sendJson(res, 200, { ok: true });
    if (url.pathname.startsWith("/api/")) return await handleApiRequest(req, res, url);

    const safePath = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(root, safePath === "/" ? "index.html" : safePath);
    const resolvedPath = existsSync(filePath) ? filePath : join(root, "index.html");
    const file = await readFile(resolvedPath);

    res.writeHead(200, {
      "Content-Type": types[extname(resolvedPath)] || "text/html; charset=utf-8",
      "Cache-Control": safePath.includes("service-worker.js") ? "no-store" : "no-cache"
    });
    res.end(file);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
}).listen(port, host, () => {
  console.log(`Couple Reminder PWA running at http://${host}:${port}`);
});

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
