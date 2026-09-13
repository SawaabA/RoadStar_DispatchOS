import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { normalizeTmsLoad } from "./tms-contract.mjs";
import { getTrafficContext } from "./traffic-context.mjs";
import { aiMetrics, aiReadiness, AiError, authenticate, checkRateLimit, readJson, requireRole } from "./ai.mjs";
import { handleCopilot } from "./copilot.mjs";
import { handleExtract } from "./extract.mjs";

const port = Number(process.env.INTEGRATION_PORT || 7072);
const host = process.env.INTEGRATION_HOST || "127.0.0.1";
const allowedOrigin = process.env.APP_ORIGIN || "http://localhost:5173";
const production = process.env.NODE_ENV === "production";
const trafficEndpoint = process.env.TRAFFIC_URL || "https://511on.ca/api/v2/get/event?format=json&lang=en";
const routingBaseUrl = process.env.ROUTING_BASE_URL?.replace(/\/$/, "") || "";
const routingToken = process.env.ROUTING_API_TOKEN || "";
const providerChecks = [
  { id: "tms", label: process.env.TMS_PROVIDER || "RoadStar neutral demo adapter", url: process.env.TMS_HEALTH_URL, token: process.env.TMS_API_TOKEN, demo: process.env.TMS_DEMO_MODE !== "false" && !process.env.TMS_HEALTH_URL },
  { id: "eld", label: process.env.ELD_PROVIDER || "RoadStar telemetry simulator", url: process.env.ELD_HEALTH_URL, token: process.env.ELD_API_TOKEN, demo: process.env.ELD_DEMO_MODE !== "false" && !process.env.ELD_HEALTH_URL },
];
const demoTmsLoads = [
  { externalId: "TMS-DEMO-1001", customer: "Maple Auto Parts", origin: "Windsor, ON", destination: "Brampton, ON", pickupAt: "2026-09-14T12:00:00Z", deliveryAt: "2026-09-14T18:30:00Z", equipment: "dry-van", pieces: 12, weightLbs: 22600, rateCad: 2450, status: "tendered" },
  { externalId: "TMS-DEMO-1002", customer: "Northline Foods", origin: "London, ON", destination: "Ottawa, ON", pickupAt: "2026-09-14T14:00:00Z", deliveryAt: "2026-09-15T01:00:00Z", equipment: "reefer", pieces: 18, weightLbs: 31800, rateCad: 3180, status: "planned" },
  { externalId: "TMS-DEMO-1003", customer: "Golden Horseshoe Machinery", origin: "Hamilton, ON", destination: "Kingston, ON", pickupAt: "2026-09-15T13:00:00Z", deliveryAt: "2026-09-15T20:00:00Z", equipment: "flatbed", pieces: 2, weightLbs: 17400, rateCad: 2875, status: "tendered" },
].map(normalizeTmsLoad);
const cacheMs = 60_000;
let cache;
let routingHealthCache;
const metrics = { requests: 0, errors: 0, trafficFetches: 0, routingRequests: 0, aiRejected: 0 };

const baseHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Request-ID",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function writeJson(response, status, payload, requestId, extra = {}) {
  response.writeHead(status, { ...baseHeaders, "X-Request-ID": requestId, ...extra });
  response.end(JSON.stringify(payload));
}

function log(level, event, context = {}) {
  console[level](JSON.stringify({ timestamp: new Date().toISOString(), service: "integration-gateway", event, ...context }));
}

const severityOf = (event) => {
  if (event.IsFullClosure) return "critical";
  const text = `${event.Severity || ""} ${event.Impact || ""} ${event.Description || ""}`.toLowerCase();
  if (/major|critical|all lanes closed|collision/.test(text)) return "high";
  if (/medium|moderate|lane blocked|construction|roadwork/.test(text)) return "medium";
  return "low";
};

const isoFromSeconds = (value) => {
  const milliseconds = Number(value) * 1000;
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : new Date().toISOString();
};

async function getIncidents() {
  if (cache && Date.now() - cache.cachedAt < cacheMs) return cache.value;
  metrics.trafficFetches += 1;
  const response = await fetch(trafficEndpoint, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Ontario 511 returned ${response.status}`);
  const events = await response.json();
  if (!Array.isArray(events)) throw new Error("Ontario 511 returned an invalid payload");
  const incidents = events
    .filter((event) => Number.isFinite(Number(event.Latitude)) && Number.isFinite(Number(event.Longitude)) && Number(event.Latitude) >= 41.5 && Number(event.Latitude) <= 46.5 && Number(event.Longitude) >= -84.9 && Number(event.Longitude) <= -74)
    .map((event) => ({
      id: `ON511-${event.ID}`,
      source: "ontario-511",
      roadway: event.RoadwayName || "Ontario roadway",
      direction: event.DirectionOfTravel || "All directions",
      description: event.Description || "Traffic event",
      eventType: event.EventType || "event",
      severity: severityOf(event),
      point: { lat: Number(event.Latitude), lng: Number(event.Longitude) },
      reportedAt: isoFromSeconds(event.Reported),
      updatedAt: isoFromSeconds(event.LastUpdated),
      fullClosure: Boolean(event.IsFullClosure),
    }))
    .sort((a, b) => a.severity === b.severity ? b.updatedAt.localeCompare(a.updatedAt) : ["critical", "high", "medium", "low"].indexOf(a.severity) - ["critical", "high", "medium", "low"].indexOf(b.severity))
    .slice(0, 80);
  const value = { incidents, source: "ontario-511", fetchedAt: new Date().toISOString() };
  cache = { cachedAt: Date.now(), value };
  return value;
}

function parsePoint(raw) {
  const parts = raw?.split(",").map(Number);
  if (!parts || parts.length !== 2 || !parts.every(Number.isFinite)) return null;
  const [lng, lat] = parts;
  return lng < -180 || lng > 180 || lat < -90 || lat > 90 ? null : { lng, lat };
}

async function getRoute(origin, destination) {
  if (!routingBaseUrl) throw new Error("Routing provider is not configured");
  metrics.routingRequests += 1;
  const url = new URL(`${routingBaseUrl}/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}`);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "false");
  const headers = routingToken ? { Authorization: `Bearer ${routingToken}` } : undefined;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Routing provider returned ${response.status}`);
  const payload = await response.json();
  const route = payload?.routes?.[0];
  const distanceKm = Number(route?.distance) / 1000;
  const durationMinutes = Number(route?.duration) / 60;
  const coordinates = route?.geometry?.coordinates;
  const validCoordinates = Array.isArray(coordinates) && coordinates.length >= 2 && coordinates.every((point) =>
    Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])) &&
    Number(point[0]) >= -180 && Number(point[0]) <= 180 && Number(point[1]) >= -90 && Number(point[1]) <= 90);
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || !Number.isFinite(durationMinutes) || durationMinutes <= 0 || !validCoordinates) {
    throw new Error("Routing provider returned an invalid route");
  }
  return { source: process.env.ROUTING_PROVIDER || "OSRM-compatible", distanceKm, durationMinutes, coordinates };
}

async function checkExternalProvider(provider) {
  if (provider.demo) return { id: provider.id, provider: provider.label, status: "demo" };
  if (!provider.url) return { id: provider.id, provider: provider.label, status: "not_configured" };
  try {
    const headers = provider.token ? { Authorization: `Bearer ${provider.token}` } : undefined;
    const response = await fetch(provider.url, { headers, signal: AbortSignal.timeout(5_000) });
    return { id: provider.id, provider: provider.label, status: response.ok ? "connected" : "degraded", httpStatus: response.status };
  } catch {
    return { id: provider.id, provider: provider.label, status: "degraded" };
  }
}

async function checkRoutingProvider() {
  if (!routingBaseUrl) return { id: "routing", provider: process.env.ROUTING_PROVIDER || "OSRM-compatible routing", status: "not_configured" };
  if (routingHealthCache && Date.now() - routingHealthCache.checkedAt < 10_000) return routingHealthCache.value;
  const value = { id: "routing", provider: process.env.ROUTING_PROVIDER || "OSRM-compatible routing", status: "degraded" };
  try {
    const url = new URL(`${routingBaseUrl}/nearest/v1/driving/-79.3832,43.6532`);
    url.searchParams.set("number", "1");
    const headers = routingToken ? { Authorization: `Bearer ${routingToken}` } : undefined;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
    const payload = response.ok ? await response.json() : undefined;
    value.status = response.ok && payload?.code === "Ok" && payload?.waypoints?.length ? "connected" : "degraded";
    value.httpStatus = response.status;
  } catch {
    value.status = "degraded";
  }
  routingHealthCache = { checkedAt: Date.now(), value };
  return value;
}

// Authenticated AI features, keyed by path. Each entry names the roles allowed
// to call it and receives the verified caller and the parsed JSON body.
const aiRoutes = new Map([
  // Viewers may ask: the copilot only narrates data they can already read.
  ["/api/ai/copilot", { roles: ["admin", "dispatcher", "viewer"], handle: handleCopilot }],
  // Drivers may extract only proof of delivery; the handler enforces that per schema.
  ["/api/ai/extract", { roles: ["admin", "dispatcher", "driver"], handle: handleExtract }],
]);

async function handleAiPost(request, response, url, requestId) {
  const route = aiRoutes.get(url.pathname);
  if (!route) { writeJson(response, 404, { error: "Not found" }, requestId); return; }
  try {
    const identity = await authenticate(request);
    requireRole(identity, route.roles);
    checkRateLimit(identity.userId);
    const body = await readJson(request);
    writeJson(response, 200, await route.handle({ identity, body, requestId }), requestId, { "Cache-Control": "no-store" });
  } catch (error) {
    if (error instanceof AiError) {
      metrics.aiRejected += 1;
      const extra = error.status === 429 ? { "Retry-After": String(error.details.retryAfterSeconds ?? 60) } : {};
      writeJson(response, error.status, { error: error.message, code: error.code, ...error.details }, requestId, extra);
      return;
    }
    metrics.errors += 1;
    log("error", "ai_failure", { requestId, path: url.pathname, message: error instanceof Error ? error.message : "Unknown failure" });
    writeJson(response, 500, { error: "RoadStar AI failed", code: "internal" }, requestId);
  }
}

const server = createServer(async (request, response) => {
  const requestId = String(request.headers["x-request-id"] || randomUUID());
  const startedAt = Date.now();
  metrics.requests += 1;
  response.on("finish", () => log("info", "request", { requestId, method: request.method, path: request.url, status: response.statusCode, durationMs: Date.now() - startedAt }));
  if (request.method === "OPTIONS") { response.writeHead(204, { ...baseHeaders, "X-Request-ID": requestId }); response.end(); return; }
  const url = new URL(request.url || "/", "http://roadstar.local");
  if (request.method === "POST" && url.pathname.startsWith("/api/ai/")) { await handleAiPost(request, response, url, requestId); return; }
  if (request.method !== "GET") { writeJson(response, 405, { error: "Method not allowed" }, requestId, { Allow: "GET, OPTIONS" }); return; }

  if (url.pathname === "/healthz" || url.pathname === "/api/traffic/health") {
    writeJson(response, 200, { status: "ok", provider: "ontario-511", cached: Boolean(cache) }, requestId);
    return;
  }
  if (url.pathname === "/readyz") {
    const routingRequired = process.env.REQUIRE_ROUTING === "true";
    const routing = await checkRoutingProvider();
    const ready = !routingRequired || routing.status === "connected";
    writeJson(response, ready ? 200 : 503, { status: ready ? "ready" : "not_ready", routing }, requestId);
    return;
  }
  if (url.pathname === "/api/ai/health") {
    writeJson(response, 200, aiReadiness(), requestId, { "Cache-Control": "no-store" });
    return;
  }
  if (url.pathname === "/api/integrations/health") {
    const [external, routing] = await Promise.all([
      Promise.all(providerChecks.map(checkExternalProvider)),
      checkRoutingProvider(),
    ]);
    writeJson(response, 200, { status: "ok", checkedAt: new Date().toISOString(), providers: [...external, routing, { id: "traffic", provider: "Ontario 511", status: "connected" }, (({ id, provider, status }) => ({ id, provider, status }))(aiReadiness())] }, requestId, { "Cache-Control": "no-store" });
    return;
  }
  if (url.pathname === "/api/tms/health") {
    writeJson(response, 200, { status: "ok", provider: "roadstar-neutral-demo", mode: "demo", direction: "two-way-ready", authoritative: "roadstar-supabase", writable: false }, requestId, { "Cache-Control": "no-store" });
    return;
  }
  if (url.pathname === "/api/tms/loads") {
    writeJson(response, 200, { source: "roadstar-neutral-demo", mode: "demo", loads: demoTmsLoads }, requestId, { "Cache-Control": "no-store" });
    return;
  }
  if (url.pathname === "/api/traffic/incidents") {
    try {
      writeJson(response, 200, await getIncidents(), requestId, { "Cache-Control": "public, max-age=30" });
    } catch (error) {
      metrics.errors += 1;
      log("error", "traffic_failure", { requestId, message: error instanceof Error ? error.message : "Unknown failure" });
      writeJson(response, 503, { error: "Traffic provider unavailable", ...(production ? {} : { detail: error instanceof Error ? error.message : "Unknown failure" }) }, requestId);
    }
    return;
  }
  if (url.pathname === "/api/traffic/context") {
    writeJson(response, 200, await getTrafficContext(), requestId, { "Cache-Control": "public, max-age=60" });
    return;
  }
  if (url.pathname === "/api/routing/route") {
    const origin = parsePoint(url.searchParams.get("origin"));
    const destination = parsePoint(url.searchParams.get("destination"));
    if (!origin || !destination) { writeJson(response, 400, { error: "origin and destination must be lng,lat coordinates" }, requestId); return; }
    try {
      writeJson(response, 200, await getRoute(origin, destination), requestId, { "Cache-Control": "public, max-age=3600" });
    } catch (error) {
      metrics.errors += 1;
      log("error", "routing_failure", { requestId, message: error instanceof Error ? error.message : "Unknown failure" });
      writeJson(response, 200, { source: "presentation-fallback", fallback: true, error: "Road routing unavailable" }, requestId, { "Cache-Control": "no-store" });
    }
    return;
  }
  if (url.pathname === "/metrics") {
    const body = Object.entries({ ...metrics, ...aiMetrics() }).map(([name, value]) => `roadstar_integration_${name}_total ${value}`).join("\n") + "\n";
    response.writeHead(200, { "Content-Type": "text/plain; version=0.0.4", "X-Content-Type-Options": "nosniff", "X-Request-ID": requestId });
    response.end(body);
    return;
  }
  writeJson(response, 404, { error: "Not found" }, requestId);
});

server.listen(port, host, () => log("info", "ready", { host, port, routingConfigured: Boolean(routingBaseUrl), ai: aiReadiness().status }));

function shutdown(signal) {
  log("info", "shutdown", { signal });
  server.close((error) => process.exit(error ? 1 : 0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
