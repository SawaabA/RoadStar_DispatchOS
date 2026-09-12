import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const root = normalize(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist"));
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";
const targets = {
  traffic: process.env.INTEGRATION_URL || "http://127.0.0.1:7072",
  telemetry: process.env.SIMULATOR_URL || "http://127.0.0.1:7071",
  solver: process.env.SOLVER_URL || "http://127.0.0.1:7070",
};
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const securityHeaders = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "Permissions-Policy": "camera=(), microphone=(), geolocation=()", "Cross-Origin-Opener-Policy": "same-origin" };

async function proxy(request, response) {
  const target = request.url.startsWith("/api/traffic") ? targets.traffic : request.url.startsWith("/api/telemetry") ? targets.telemetry : targets.solver;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    const upstream = await fetch(`${target}${request.url}`, { method: request.method, headers: { "content-type": request.headers["content-type"] || "application/json" }, body: chunks.length ? Buffer.concat(chunks) : undefined, signal: request.url === "/api/telemetry/events" ? undefined : AbortSignal.timeout(10_000) });
    const headers = { ...securityHeaders };
    for (const [key, value] of upstream.headers) if (!["connection", "transfer-encoding", "content-length", "access-control-allow-origin"].includes(key)) headers[key] = value;
    response.writeHead(upstream.status, headers);
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(response); else response.end();
  } catch (error) {
    response.writeHead(502, { ...securityHeaders, "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "RoadStar service unavailable", detail: error instanceof Error ? error.message : "Unknown upstream failure" }));
  }
}

const server = createServer(async (request, response) => {
  if (request.url === "/healthz") { response.writeHead(200, { ...securityHeaders, "Content-Type": "application/json" }); response.end('{"status":"ok"}'); return; }
  if (request.url?.startsWith("/api/")) { await proxy(request, response); return; }
  const pathname = decodeURIComponent(new URL(request.url || "/", "http://roadstar.local").pathname);
  const candidate = normalize(join(root, pathname === "/" ? "index.html" : pathname));
  const safeFile = candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(root, "index.html");
  response.writeHead(200, { ...securityHeaders, "Content-Type": mime[extname(safeFile)] || "application/octet-stream", "Cache-Control": safeFile.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable" });
  createReadStream(safeFile).pipe(response);
});

server.listen(port, host, () => console.log(`[WEB] RoadStar production gateway ready on http://${host}:${port}`));
