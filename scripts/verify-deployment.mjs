const baseUrl = (process.env.ROADSTAR_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const supabaseUrl = process.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const expectedSchema = process.env.EXPECTED_SCHEMA_VERSION || "20260913131500";
const requireRealRouting = process.env.ROADSTAR_REQUIRE_REAL_ROUTING === "true";
let failed = false;

async function check(name, operation) {
  try {
    const detail = await operation();
    console.log(`[PASS] ${name}${detail ? ` - ${detail}` : ""}`);
  } catch (error) {
    failed = true;
    console.error(`[FAIL] ${name} - ${error instanceof Error ? error.message : String(error)}`);
  }
}

await check("web liveness", async () => {
  const response = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
});

await check("dependency readiness", async () => {
  const response = await fetch(`${baseUrl}/readyz`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
});

await check("direct SPA route", async () => {
  const response = await fetch(`${baseUrl}/driver`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok || !(response.headers.get("content-type") || "").includes("text/html")) throw new Error(`HTTP ${response.status}`);
  if (!response.headers.get("content-security-policy")) throw new Error("Content-Security-Policy header is missing");
});

await check("integration status", async () => {
  const response = await fetch(`${baseUrl}/api/integrations/health`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const providers = Array.isArray(payload.providers) ? payload.providers.map((item) => `${item.id}:${item.status}`).join(", ") : "none";
  return providers;
});

for (const [name, path] of [
  ["solver", "/api/health"],
  ["telemetry", "/api/telemetry/health"],
  ["Ontario 511", "/api/traffic/health"],
]) {
  await check(`${name} service`, async () => {
    const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  });
}

const routes = [
  ["Toronto-Hamilton", "-79.3832,43.6532", "-79.8711,43.2557"],
  ["London-Milton", "-81.2453,42.9849", "-79.8774,43.5183"],
  ["Vaughan-Pickering", "-79.5085,43.8563", "-79.0868,43.8384"],
  ["Toronto-Ottawa", "-79.3832,43.6532", "-75.6972,45.4215"],
];
for (const [name, origin, destination] of routes) {
  await check(`road route ${name}`, async () => {
    const response = await fetch(`${baseUrl}/api/routing/route?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (requireRealRouting && (payload.fallback || payload.source === "presentation-fallback")) throw new Error("presentation-fallback returned while real routing is required");
    if (!payload.fallback && (!(payload.distanceKm > 0) || !(payload.durationMinutes > 0) || !Array.isArray(payload.coordinates) || payload.coordinates.length < 5)) throw new Error("routing response lacks road geometry, distance, or duration");
    return `${payload.source}${payload.distanceKm ? `, ${Math.round(payload.distanceKm)} km` : ""}`;
  });
}

await check("routing rejects invalid coordinates", async () => {
  const response = await fetch(`${baseUrl}/api/routing/route?origin=invalid&destination=-79.8,43.2`, { signal: AbortSignal.timeout(10_000) });
  if (response.status !== 400) throw new Error(`expected HTTP 400, received ${response.status}`);
});

await check("routing handles a distant destination", async () => {
  const response = await fetch(`${baseUrl}/api/routing/route?origin=-79.3832,43.6532&destination=-123.1207,49.2827`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.fallback && (!(payload.distanceKm > 0) || !(payload.durationMinutes > 0) || !Array.isArray(payload.coordinates) || payload.coordinates.length < 5)) {
    throw new Error("distant routing response is neither a controlled fallback nor a valid road route");
  }
  return payload.fallback ? "controlled fallback" : `${payload.source}, ${Math.round(payload.distanceKm)} km`;
});

if (!supabaseUrl || !supabaseKey) {
  failed = true;
  console.error("[FAIL] Supabase checks - VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required");
} else {
  const headers = { apikey: supabaseKey };
  await check("Supabase schema version", async () => {
    const response = await fetch(`${supabaseUrl}/rest/v1/system_health?select=schema_version`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await response.json();
    const actual = rows?.[0]?.schema_version;
    if (actual !== expectedSchema) throw new Error(`expected ${expectedSchema}, received ${actual || "none"}`);
    return actual;
  });
  for (const table of ["dispatch_snapshots", "decision_records", "driver_user_links", "loading_plans", "load_documents"]) {
    await check(`anonymous access denied: ${table}`, async () => {
      const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=*&limit=0`, { headers, signal: AbortSignal.timeout(10_000) });
      if (response.status !== 401 && response.status !== 403) throw new Error(`expected 401/403, received ${response.status}`);
    });
  }
}

if (failed) process.exitCode = 1;
else console.log("RoadStar deployment verification passed.");
