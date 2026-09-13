import { createReadStream, existsSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const root = normalize(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist"));
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";
const targets = {
  integrations: process.env.INTEGRATION_URL || "http://127.0.0.1:7072",
  telemetry: process.env.SIMULATOR_URL || "http://127.0.0.1:7071",
  solver: process.env.SOLVER_URL || "http://127.0.0.1:7070",
};
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://tiles.openfreemap.org https://server.arcgisonline.com https://fonts.googleapis.com; worker-src 'self' blob:; font-src 'self' data: https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
const metrics = { requests: 0, errors: 0, upstreamErrors: 0 };

function log(level, event, context = {}) {
  console[level](JSON.stringify({ timestamp: new Date().toISOString(), service: "web-gateway", event, ...context }));
}

async function proxy(request, response) {
  const requestId = String(request.headers["x-request-id"] || randomUUID());
  const target = request.url.startsWith("/api/traffic") || request.url.startsWith("/api/routing") || request.url.startsWith("/api/integrations") || request.url.startsWith("/api/tms")
    ? targets.integrations
    : request.url.startsWith("/api/telemetry") ? targets.telemetry : targets.solver;
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_048_576) {
      response.writeHead(413, { ...securityHeaders, "Content-Type": "application/json", "X-Request-ID": requestId });
      response.end('{"error":"Request body too large"}');
      return;
    }
    chunks.push(chunk);
  }
  try {
    const upstream = await fetch(`${target}${request.url}`, { method: request.method, headers: { "content-type": request.headers["content-type"] || "application/json", "x-request-id": requestId }, body: chunks.length ? Buffer.concat(chunks) : undefined, signal: request.url === "/api/telemetry/events" ? undefined : AbortSignal.timeout(10_000) });
    const headers = { ...securityHeaders, "X-Request-ID": requestId };
    for (const [key, value] of upstream.headers) if (!["connection", "transfer-encoding", "content-length", "access-control-allow-origin", "x-request-id"].includes(key)) headers[key] = value;
    response.writeHead(upstream.status, headers);
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(response); else response.end();
  } catch (error) {
    metrics.errors += 1;
    metrics.upstreamErrors += 1;
    log("error", "upstream_failure", { requestId, path: request.url, message: error instanceof Error ? error.message : "Unknown upstream failure" });
    response.writeHead(502, { ...securityHeaders, "Content-Type": "application/json", "X-Request-ID": requestId });
    response.end(JSON.stringify({ error: "RoadStar service unavailable", requestId }));
  }
}

async function readiness() {
  const checks = await Promise.allSettled([
    fetch(`${targets.solver}/api/health`, { signal: AbortSignal.timeout(3_000) }),
    fetch(`${targets.telemetry}/api/telemetry/health`, { signal: AbortSignal.timeout(3_000) }),
    fetch(`${targets.integrations}/readyz`, { signal: AbortSignal.timeout(3_000) }),
  ]);
  const services = ["solver", "telemetry", "integrations"].map((name, index) => ({ name, ready: checks[index].status === "fulfilled" && checks[index].value.ok }));
  return { ready: services.every((item) => item.ready), services };
}

const server = createServer(async (request, response) => {
  const requestId = String(request.headers["x-request-id"] || randomUUID());
  const startedAt = Date.now();
  metrics.requests += 1;
  response.on("finish", () => log("info", "request", { requestId, method: request.method, path: request.url, status: response.statusCode, durationMs: Date.now() - startedAt }));
  if (request.url === "/healthz") { response.writeHead(200, { ...securityHeaders, "Content-Type": "application/json", "X-Request-ID": requestId }); response.end('{"status":"ok"}'); return; }
  if (request.url === "/readyz") {
    const result = await readiness();
    response.writeHead(result.ready ? 200 : 503, { ...securityHeaders, "Content-Type": "application/json", "Cache-Control": "no-store", "X-Request-ID": requestId });
    response.end(JSON.stringify({ status: result.ready ? "ready" : "not_ready", services: result.services }));
    return;
  }
  if (request.url === "/metrics") {
    const body = Object.entries(metrics).map(([name, value]) => `roadstar_web_${name}_total ${value}`).join("\n") + "\n";
    response.writeHead(200, { ...securityHeaders, "Content-Type": "text/plain; version=0.0.4", "X-Request-ID": requestId });
    response.end(body);
    return;
  }
  if (request.url?.startsWith("/api/")) { await proxy(request, response); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url || "/", "http://roadstar.local").pathname); }
  catch { response.writeHead(400, { ...securityHeaders, "Content-Type": "application/json", "X-Request-ID": requestId }); response.end('{"error":"Invalid request path"}'); return; }
  const candidate = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  const candidateRelative = relative(root, candidate);
  const insideRoot = candidateRelative === "" || (!candidateRelative.startsWith("..") && !candidateRelative.startsWith("/"));
  const safeFile = insideRoot && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(root, "index.html");
  response.writeHead(200, { ...securityHeaders, "Content-Type": mime[extname(safeFile)] || "application/octet-stream", "Cache-Control": safeFile.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable" });
  createReadStream(safeFile).pipe(response);
});

server.listen(port, host, () => log("info", "ready", { host, port }));

function shutdown(signal) {
  log("info", "shutdown", { signal });
  server.close((error) => process.exit(error ? 1 : 0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
