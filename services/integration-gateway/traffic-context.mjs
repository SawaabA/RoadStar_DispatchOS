// Ontario 511 documented resources. Cache successes and failures and coalesce
// concurrent callers to respect the provider's 10 requests/minute allowance.
const cache = new Map();
const pending = new Map();
const ttl = 5 * 60_000;
const validPoint = row => row.Latitude != null && row.Longitude != null && Number.isFinite(Number(row.Latitude)) && Number.isFinite(Number(row.Longitude)) && Number(row.Latitude) >= 41.5 && Number(row.Latitude) <= 57 && Number(row.Longitude) >= -95.3 && Number(row.Longitude) <= -74;
const stamp = value => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) < 8_640_000_000_000 ? new Date(Number(value) * 1000).toISOString() : null;
const text = value => typeof value === "string" ? value.slice(0, 4000) : "";
const safeLink = value => { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; } };

export function normalizeTrafficContext(kind, rows, now = Date.now()) {
  if (!Array.isArray(rows)) throw new Error("Traffic resource must be an array");
  if (kind === "cameras") return rows.filter(r => r && validPoint(r)).slice(0, 2500).map(r => ({
    id: `CAMERA-${r.Id}`, roadway: text(r.Roadway), location: text(r.Location), direction: text(r.Direction),
    point: { lat: Number(r.Latitude), lng: Number(r.Longitude) },
    views: (Array.isArray(r.Views) ? r.Views : []).filter(v => v && v.Status === "Enabled" && safeLink(v.Url)).map(v => ({ id: String(v.Id), url: safeLink(v.Url), description: text(v.Description) })),
  }));
  if (kind === "conditions") return rows.filter(Boolean).slice(0, 2500).map((r, i) => ({ id: `CONDITION-${i}`, roadway: text(r.RoadwayName), location: text(r.LocationDescription),
    conditions: Array.isArray(r.Condition) ? r.Condition.filter(c => typeof c === "string").slice(0, 20) : [], visibility: text(r.Visibility), region: text(r.Region), updatedAt: stamp(r.LastUpdated) }));
  return rows.filter(r => r && validPoint(r) && (!r.StartDate || Number(r.StartDate) * 1000 <= now) && (!r.PlannedEndDate || Number(r.PlannedEndDate) * 1000 >= now)).slice(0, 2500).map(r => ({
    id: `CONSTRUCTION-${r.ID}`, source: "ontario-511", roadway: text(r.RoadwayName), direction: text(r.DirectionOfTravel), description: text(r.Description), eventType: "roadwork",
    severity: r.IsFullClosure === true ? "critical" : "medium", fullClosure: r.IsFullClosure === true,
    point: { lat: Number(r.Latitude), lng: Number(r.Longitude) }, reportedAt: stamp(r.Reported) ?? new Date(now).toISOString(), updatedAt: stamp(r.LastUpdated) ?? new Date(now).toISOString(),
  }));
}

export async function getTrafficContext() {
  const endpoints = { cameras: process.env.TRAFFIC_CAMERAS_URL || "https://511on.ca/api/v2/get/cameras?format=json&lang=en",
    construction: process.env.TRAFFIC_CONSTRUCTION_URL || "https://511on.ca/api/v2/get/constructionprojects?format=json&lang=en",
    conditions: process.env.TRAFFIC_CONDITIONS_URL || "https://511on.ca/api/v3/get/roadconditions?format=json&lang=en" };
  const entries = await Promise.all(Object.entries(endpoints).map(async ([kind, url]) => {
    if (cache.has(kind) && Date.now() - cache.get(kind).checkedAt < ttl) return [kind, cache.get(kind)];
    if (!pending.has(kind)) pending.set(kind, (async () => {
      const previous = cache.get(kind);
      let value;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        value = { status: "connected", records: normalizeTrafficContext(kind, await response.json()), fetchedAt: new Date().toISOString() };
      } catch { value = { status: "degraded", records: previous?.records ?? [], fetchedAt: previous?.fetchedAt ?? null }; }
      const result = { ...value, checkedAt: Date.now() }; cache.set(kind, result); return result;
    })().finally(() => pending.delete(kind)));
    return [kind, await pending.get(kind)];
  }));
  return { source: "ontario-511", resources: Object.fromEntries(entries) };
}
