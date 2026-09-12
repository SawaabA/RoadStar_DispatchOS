const baseUrl = (process.env.ROADSTAR_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const supabaseUrl = process.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const expectedSchema = process.env.EXPECTED_SCHEMA_VERSION || "20260912231741";
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
  for (const table of ["dispatch_snapshots", "decision_records", "driver_user_links"]) {
    await check(`anonymous access denied: ${table}`, async () => {
      const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=*&limit=0`, { headers, signal: AbortSignal.timeout(10_000) });
      if (response.status !== 401 && response.status !== 403) throw new Error(`expected 401/403, received ${response.status}`);
    });
  }
}

if (failed) process.exitCode = 1;
else console.log("RoadStar deployment verification passed.");
