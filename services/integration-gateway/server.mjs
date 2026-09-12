import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.INTEGRATION_PORT || 7072);
const host = process.env.INTEGRATION_HOST || "127.0.0.1";
const allowedOrigin = process.env.APP_ORIGIN || "http://localhost:5173";
const production = process.env.NODE_ENV === "production";
const trafficEndpoint = process.env.TRAFFIC_URL || "https://511on.ca/api/v2/get/event?format=json&lang=en";
const routingBaseUrl = process.env.ROUTING_BASE_URL?.replace(/\/$/, "") || "";
const routingToken = process.env.ROUTING_API_TOKEN || "";
const providerChecks = [
  { id: "tms", label: process.env.TMS_PROVIDER || "TMS", url: process.env.TMS_HEALTH_URL, token: process.env.TMS_API_TOKEN },
  { id: "eld", label: process.env.ELD_PROVIDER || "ELD / telematics", url: process.env.ELD_HEALTH_URL, token: process.env.ELD_API_TOKEN },
];
const cacheMs = 60_000;
let cache;
const metrics = { requests: 0, errors: 0, trafficFetches: 0, routingRequests: 0 };

const baseHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "Content-Type, X-Request-ID",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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
  if (!route || !Array.isArray(route.geometry?.coordinates)) throw new Error("Routing provider returned an invalid route");
  return { source: process.env.ROUTING_PROVIDER || "OSRM-compatible", distanceKm: Number(route.distance) / 1000, durationMinutes: Number(route.duration) / 60, coordinates: route.geometry.coordinates };
}

async function checkExternalProvider(provider) {
  if (!provider.url) return { id: provider.id, provider: provider.label, status: "not_configured" };
  try {
    const headers = provider.token ? { Authorization: `Bearer ${provider.token}` } : undefined;
    const response = await fetch(provider.url, { headers, signal: AbortSignal.timeout(5_000) });
    return { id: provider.id, provider: provider.label, status: response.ok ? "connected" : "degraded", httpStatus: response.status };
  } catch {
    return { id: provider.id, provider: provider.label, status: "degraded" };
  }
}

const server = createServer(async (request, response) => {
  const requestId = String(request.headers["x-request-id"] || randomUUID());
  const startedAt = Date.now();
  metrics.requests += 1;
  response.on("finish", () => log("info", "request", { requestId, method: request.method, path: request.url, status: response.statusCode, durationMs: Date.now() - startedAt }));
  if (request.method === "OPTIONS") { response.writeHead(204, { ...baseHeaders, "X-Request-ID": requestId }); response.end(); return; }
  if (request.method !== "GET") { writeJson(response, 405, { error: "Method not allowed" }, requestId, { Allow: "GET, OPTIONS" }); return; }
  const url = new URL(request.url || "/", "http://roadstar.local");

  if (url.pathname === "/healthz" || url.pathname === "/api/traffic/health") {
    writeJson(response, 200, { status: "ok", provider: "ontario-511", cached: Boolean(cache) }, requestId);
    return;
  }
  if (url.pathname === "/readyz") {
    const routingRequired = process.env.REQUIRE_ROUTING === "true";
    const ready = !routingRequired || Boolean(routingBaseUrl);
    writeJson(response, ready ? 200 : 503, { status: ready ? "ready" : "not_ready", routingConfigured: Boolean(routingBaseUrl) }, requestId);
    return;
  }
  if (url.pathname === "/api/integrations/health") {
    const external = await Promise.all(providerChecks.map(checkExternalProvider));
    writeJson(response, 200, { status: "ok", checkedAt: new Date().toISOString(), providers: [...external, { id: "routing", provider: process.env.ROUTING_PROVIDER || "OSRM-compatible routing", status: routingBaseUrl ? "configured" : "not_configured" }, { id: "traffic", provider: "Ontario 511", status: "connected" }] }, requestId, { "Cache-Control": "no-store" });
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
    const body = Object.entries(metrics).map(([name, value]) => `roadstar_integration_${name}_total ${value}`).join("\n") + "\n";
    response.writeHead(200, { "Content-Type": "text/plain; version=0.0.4", "X-Content-Type-Options": "nosniff", "X-Request-ID": requestId });
    response.end(body);
    return;
  }
  writeJson(response, 404, { error: "Not found" }, requestId);
});

server.listen(port, host, () => log("info", "ready", { host, port, routingConfigured: Boolean(routingBaseUrl) }));

function shutdown(signal) {
  log("info", "shutdown", { signal });
  server.close((error) => process.exit(error ? 1 : 0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
