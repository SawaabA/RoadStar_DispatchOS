import { useEffect, useState } from "react";
import type { RoadIncident } from "../types";

type Resource<T> = { status: string; fetchedAt: string | null; records: T[] };
type Context = { resources: {
  cameras: Resource<{ id: string; roadway: string; location: string; views: { id: string; url: string; description: string }[] }>;
  conditions: Resource<{ id: string; roadway: string; location: string; conditions: string[]; visibility: string; updatedAt: string | null }>;
  construction: Resource<RoadIncident>;
} };
export function TrafficContextPanel({ onConstruction }: { onConstruction: (incidents: RoadIncident[]) => void }) {
  const [context, setContext] = useState<Context | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const r = await fetch("/api/traffic/context", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (!r.ok) throw new Error();
        const payload = await r.json() as Context;
        if (![payload.resources?.cameras, payload.resources?.conditions, payload.resources?.construction].every(r => r && Array.isArray(r.records))) throw new Error();
        if (active) { setContext(payload); setError(""); onConstruction(payload.resources.construction.status === "connected" ? payload.resources.construction.records : []); }
      } catch { if (active) { setError("Traffic context unavailable. Displayed records may be stale; retrying automatically."); onConstruction([]); } }
    };
    void refresh(); const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 300_000);
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, [onConstruction]);
  const match = (row: { roadway: string; location: string }) => `${row.roadway} ${row.location}`.toLowerCase().includes(search.toLowerCase());
  return <section className="surface intelligence-panel" aria-label="Ontario 511 road context"><h2>Ontario 511 road conditions and cameras</h2>
    <p>Incidents refresh every minute. Construction, conditions and camera listings refresh every five minutes while this screen is visible.</p>
    {error && <p role="status">{error}</p>}
    {!context && !error && <p role="status">Loading road context…</p>}
    <label>Filter road or location <input value={search} onChange={e => setSearch(e.target.value)} /></label>
    {context && <>{Object.entries(context.resources).map(([name, r]) => <p key={name}>{name}: {r.status} · {r.records.length} records · fetched {r.fetchedAt ? new Date(r.fetchedAt).toLocaleString() : "never"}</p>)}
      <details><summary>Road conditions</summary>{context.resources.conditions.records.filter(match).slice(0, 100).map(c => <p key={c.id}><strong>{c.roadway}: {c.location}</strong> — {c.conditions.join(", ")} · visibility {c.visibility || "not reported"} · updated {c.updatedAt ? new Date(c.updatedAt).toLocaleString() : "not reported"}</p>)}</details>
      <details><summary>Camera views</summary>{context.resources.cameras.records.filter(match).slice(0, 100).map(c => <p key={c.id}><strong>{c.roadway} — {c.location}</strong> {c.views.filter(v => v.url.startsWith("https://")).map(v => <a key={v.id} href={v.url} target="_blank" rel="noopener noreferrer">Open camera {v.description || v.id} </a>)}</p>)}</details>
      <p>Showing up to 100 matches per list. <a href="https://511on.ca" target="_blank" rel="noopener noreferrer">Source: Ontario 511</a></p>
    </>}
  </section>;
}
