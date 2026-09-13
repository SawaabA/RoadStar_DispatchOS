import type { RoadIncident } from "../types";

const FALLBACK_INCIDENTS: RoadIncident[] = [
  {
    id: "DEMO-401-LONDON",
    source: "demo",
    roadway: "HWY 401",
    direction: "Eastbound",
    description: "Collision near London has one lane blocked. Demo fallback incident.",
    eventType: "collision",
    severity: "high",
    point: { lat: 42.9849, lng: -81.2453 },
    reportedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fullClosure: false,
  },
  {
    id: "DEMO-401-MILTON",
    source: "demo",
    roadway: "HWY 401",
    direction: "Westbound",
    description: "Construction approaching Milton. Demo fallback incident.",
    eventType: "roadwork",
    severity: "medium",
    point: { lat: 43.52, lng: -79.88 },
    reportedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fullClosure: false,
  },
];

export type TrafficResult = {
  incidents: RoadIncident[];
  source: "ontario-511" | "demo";
  fetchedAt: string;
  message?: string;
};

export async function fetchTrafficIncidents(
  signal?: AbortSignal,
): Promise<TrafficResult> {
  try {
    const response = await fetch("/api/traffic/incidents", { signal });
    if (!response.ok) throw new Error(`Traffic provider returned ${response.status}`);
    const result = (await response.json()) as TrafficResult;
    if (!Array.isArray(result.incidents)) throw new Error("Invalid traffic response");
    return result;
  } catch {
    return {
      incidents: FALLBACK_INCIDENTS,
      source: "demo",
      fetchedAt: new Date().toISOString(),
      message: "Ontario 511 is unavailable; using two clearly labelled demo incidents.",
    };
  }
}

export function createInjectedClosure(): RoadIncident {
  const now = new Date().toISOString();
  return {
    id: `INJECTED-401-${Date.now()}`,
    source: "demo",
    roadway: "HWY 401",
    direction: "Eastbound",
    description: "Injected demo: collision closes lanes on the active Highway 401 corridor and threatens active ETAs.",
    eventType: "collision",
    severity: "critical",
    point: { lat: 43.43, lng: -80.05 },
    reportedAt: now,
    updatedAt: now,
    fullClosure: true,
  };
}
