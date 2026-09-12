import { createServer } from "node:http";

const port = Number(process.env.INTEGRATION_PORT || 7072);
const host = process.env.INTEGRATION_HOST || "127.0.0.1";
const allowedOrigin = process.env.APP_ORIGIN || "http://localhost:5173";
const endpoint = "https://511on.ca/api/v2/get/event?format=json&lang=en";
const cacheMs = 60_000;
let cache;

const headers = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=30",
  "Content-Type": "application/json; charset=utf-8",
};

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
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Ontario 511 returned ${response.status}`);
  const events = await response.json();
  const incidents = events
    .filter((event) =>
      Number.isFinite(Number(event.Latitude)) &&
      Number.isFinite(Number(event.Longitude)) &&
      Number(event.Latitude) >= 41.5 &&
      Number(event.Latitude) <= 46.5 &&
      Number(event.Longitude) >= -84.9 &&
      Number(event.Longitude) <= -74,
    )
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
    .sort((a, b) =>
      a.severity === b.severity
        ? b.updatedAt.localeCompare(a.updatedAt)
        : ["critical", "high", "medium", "low"].indexOf(a.severity) -
          ["critical", "high", "medium", "low"].indexOf(b.severity),
    )
    .slice(0, 80);
  const value = { incidents, source: "ontario-511", fetchedAt: new Date().toISOString() };
  cache = { cachedAt: Date.now(), value };
  return value;
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, headers);
    response.end();
    return;
  }
  if (request.url === "/api/traffic/health") {
    response.writeHead(200, headers);
    response.end(JSON.stringify({ status: "ok", provider: "ontario-511", cached: Boolean(cache) }));
    return;
  }
  if (request.url === "/api/traffic/incidents") {
    try {
      const result = await getIncidents();
      response.writeHead(200, headers);
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(503, headers);
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Traffic provider unavailable" }));
    }
    return;
  }
  response.writeHead(404, headers);
  response.end(JSON.stringify({ error: "Not found" }));
});

server.listen(port, host, () =>
  console.log(`[INTEGRATIONS] Ontario 511 gateway ready on http://${host}:${port}`),
);
