import distance from "@turf/distance";
import { point } from "@turf/helpers";
import { DEFAULT_OPTIMIZATION_WEIGHTS, evaluateCandidate } from "../../dispatch/lib/optimizer";
import type { Coordinates, DispatchState } from "../../dispatch/types";
import type {
  BackhaulSuggestion,
  OperationalException,
  ProviderStatus,
  ReplanImpact,
  RoadIncident,
} from "../types";

const kmBetween = (a: Coordinates, b: Coordinates) =>
  distance(point([a.lng, a.lat]), point([b.lng, b.lat]), {
    units: "kilometers",
  });

function distanceToSegmentKm(
  target: Coordinates,
  start: Coordinates,
  end: Coordinates,
) {
  const latitudeScale = 111;
  const longitudeScale = 111 * Math.cos((target.lat * Math.PI) / 180);
  const ax = (start.lng - target.lng) * longitudeScale;
  const ay = (start.lat - target.lat) * latitudeScale;
  const bx = (end.lng - target.lng) * longitudeScale;
  const by = (end.lat - target.lat) * latitudeScale;
  const dx = bx - ax;
  const dy = by - ay;
  const denominator = dx * dx + dy * dy;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function buildReplanImpacts(
  state: DispatchState,
  incidents: RoadIncident[],
): ReplanImpact[] {
  const impacts: ReplanImpact[] = [];
  for (const assignment of state.assignments.filter(
    (item) => item.status !== "completed",
  )) {
    const load = state.loads.find((item) => item.id === assignment.loadId);
    const driver = state.drivers.find((item) => item.id === assignment.driverId);
    if (!load || !driver) continue;
    const incident = incidents
      .map((item) => ({
        item,
        distance: distanceToSegmentKm(
          item.point,
          assignment.currentPoint,
          load.destinationPoint,
        ),
      }))
      .filter((item) => item.distance <= 35)
      .sort((a, b) => {
        const severity = { low: 0, medium: 1, high: 2, critical: 3 };
        const aRisk = severity[a.item.severity] + (a.item.fullClosure ? 2 : 0);
        const bRisk = severity[b.item.severity] + (b.item.fullClosure ? 2 : 0);
        return bRisk - aRisk || a.distance - b.distance;
      })[0]?.item;
    if (!incident) continue;

    const addedDelayMinutes = incident.fullClosure
      ? 35
      : incident.severity === "high" || incident.severity === "critical"
        ? 24
        : incident.severity === "medium"
          ? 14
          : 7;
    const projectedEta = new Date(
      new Date(assignment.eta).getTime() + addedDelayMinutes * 60_000,
    ).toISOString();
    const deliverySlackMinutes = Math.round(
      (new Date(load.deliveryEnd).getTime() - new Date(projectedEta).getTime()) /
        60_000,
    );
    const hosMarginHours = Math.min(
      driver.drivingHoursRemaining,
      driver.onDutyHoursRemaining,
      driver.cycleHoursRemaining,
    ) - addedDelayMinutes / 60;
    const risk = hosMarginHours < 0.75 ? "hos" : deliverySlackMinutes < 0 ? "late" : "monitor";
    impacts.push({
      id: `REPLAN-${assignment.id}-${incident.id}`,
      assignmentId: assignment.id,
      loadId: load.id,
      incidentId: incident.id,
      addedDelayMinutes,
      originalEta: assignment.eta,
      projectedEta,
      deliverySlackMinutes,
      hosMarginHours,
      risk,
      recommendation:
        risk === "hos"
          ? "Protect the driver's HOS margin: review a relay or downstream reassignment."
          : risk === "late"
            ? "Review alternate routing and notify the customer before approving the revised plan."
            : "Monitor the incident; the current assignment remains feasible with reduced margin.",
    });
  }
  return impacts.sort((a, b) =>
    a.risk === b.risk ? a.deliverySlackMinutes - b.deliverySlackMinutes : a.risk === "hos" ? -1 : 1,
  );
}

export function deriveExceptions(
  state: DispatchState,
  incidents: RoadIncident[],
): OperationalException[] {
  const results: OperationalException[] = [];
  for (const load of state.loads.filter((item) => item.status === "unassigned")) {
    const candidates = state.drivers.flatMap((driver) => {
      const trailer = state.trailers.find((item) => item.id === driver.trailerId);
      const truck = state.trucks.find((item) => item.id === driver.truckId);
      return trailer ? [evaluateCandidate(load, driver, trailer, truck)] : [];
    });
    if (candidates.some((candidate) => candidate.feasible)) continue;
    const reasons = [...new Set(candidates.flatMap((candidate) => candidate.reasons.map((reason) => reason.label)))];
    const type = candidates.some((candidate) => candidate.reasons.some((reason) => reason.code === "equipment"))
      ? "equipment"
      : candidates.some((candidate) => candidate.reasons.some((reason) => reason.code === "hos"))
        ? "hos"
        : "pickup";
    results.push({
      id: `LOAD-${load.id}-${type}`,
      type,
      severity: load.priority === "critical" ? "critical" : "warning",
      title: `${load.billNumber} has no feasible unit`,
      detail: reasons.slice(0, 2).join(" · ") || "No complete driver, truck and trailer pairing is available.",
      entityId: load.id,
      recommendedAction: "Review rejected candidates",
      actionView: "dispatch",
    });
  }

  for (const visit of state.visits.filter((item) => !item.departedAt && item.dwellMinutes >= 90)) {
    const facility = state.facilities.find((item) => item.id === visit.facilityId);
    const minutesRemaining = Math.max(0, (facility?.freeMinutes ?? 120) - visit.dwellMinutes);
    results.push({
      id: `DETENTION-${visit.id}`,
      type: "detention",
      severity: minutesRemaining === 0 ? "critical" : "warning",
      title: minutesRemaining === 0 ? "Detention is billable" : "Free time is nearly exhausted",
      detail: `${visit.truckId} at ${facility?.name ?? "facility"}: ${visit.dwellMinutes} minutes dwell.`,
      entityId: visit.id,
      recommendedAction: "Open evidence record",
      actionView: "detention",
    });
  }

  for (const driver of state.drivers.filter(
    (item) => Math.min(item.drivingHoursRemaining, item.onDutyHoursRemaining, item.cycleHoursRemaining) < 4,
  )) {
    results.push({
      id: `HOS-${driver.id}`,
      type: "hos",
      severity: Math.min(driver.drivingHoursRemaining, driver.onDutyHoursRemaining) < 2 ? "critical" : "warning",
      title: `${driver.name}'s HOS margin is tightening`,
      detail: `${Math.min(driver.drivingHoursRemaining, driver.onDutyHoursRemaining, driver.cycleHoursRemaining).toFixed(1)} hours remain on the limiting clock.`,
      entityId: driver.id,
      recommendedAction: "Review driver clocks",
      actionView: "fleet",
    });
  }

  for (const impact of buildReplanImpacts(state, incidents)) {
    const incident = incidents.find((item) => item.id === impact.incidentId)!;
    const load = state.loads.find((item) => item.id === impact.loadId)!;
    results.push({
      id: `TRAFFIC-${impact.id}`,
      type: "traffic",
      severity: impact.risk === "monitor" ? "warning" : "critical",
      title: `${incident.roadway} changes ${load.billNumber}'s ETA`,
      detail: `Projected delay ${impact.addedDelayMinutes} min · ${impact.deliverySlackMinutes} min delivery margin.`,
      entityId: impact.id,
      recommendedAction: "Review re-plan",
      actionView: "map",
    });
  }

  return [...new Map(results.map((item) => [item.id, item])).values()].sort((a, b) =>
    a.severity === b.severity ? a.title.localeCompare(b.title) : a.severity === "critical" ? -1 : 1,
  );
}

export function buildBackhaulSuggestions(state: DispatchState): BackhaulSuggestion[] {
  const terminal = state.facilities[0]?.point;
  if (!terminal) return [];
  const suggestions: BackhaulSuggestion[] = [];
  for (const assignment of state.assignments.filter((item) => item.status !== "completed")) {
    const currentLoad = state.loads.find((item) => item.id === assignment.loadId);
    const driver = state.drivers.find((item) => item.id === assignment.driverId);
    const truck = state.trucks.find((item) => item.id === assignment.truckId);
    const trailer = state.trailers.find((item) => item.id === assignment.trailerId);
    if (!currentLoad || !driver || !truck || !trailer) continue;
    const futureHours = Math.max(0.25, (1 - assignment.progress) * 2.5);
    const availableAt = Date.now() + futureHours * 3_600_000;
    for (const load of state.loads.filter((item) => item.status === "unassigned")) {
      const repositionKm = kmBetween(currentLoad.destinationPoint, load.originPoint);
      const baselineEmptyKm = kmBetween(currentLoad.destinationPoint, terminal);
      const futureDriver = {
        ...driver,
        status: "available" as const,
        point: currentLoad.destinationPoint,
        drivingHoursRemaining: Math.max(0, driver.drivingHoursRemaining - futureHours),
        onDutyHoursRemaining: Math.max(0, driver.onDutyHoursRemaining - futureHours),
        cycleHoursRemaining: Math.max(0, driver.cycleHoursRemaining - futureHours),
      };
      const candidate = evaluateCandidate(
        load,
        futureDriver,
        { ...trailer, status: "available" },
        { ...truck, status: "available" },
        availableAt,
        state.optimizationWeights ?? DEFAULT_OPTIMIZATION_WEIGHTS,
        Math.max(0, 100 - repositionKm),
      );
      if (!candidate.feasible) continue;
      const avoidedEmptyKm = Math.max(0, baselineEmptyKm - repositionKm);
      suggestions.push({
        id: `BACKHAUL-${assignment.id}-${load.id}`,
        assignmentId: assignment.id,
        loadId: load.id,
        driverId: driver.id,
        repositionKm,
        baselineEmptyKm,
        avoidedEmptyKm,
        projectedHosMargin: candidate.hosRemainingAfter,
        score: Math.min(100, Math.round(candidate.score + Math.min(15, avoidedEmptyKm / 5))),
        explanation: `${load.billNumber} begins ${Math.round(repositionKm)} km from ${currentLoad.destination}; pairing it avoids up to ${Math.round(avoidedEmptyKm)} km versus returning to ${state.facilities[0].name}.`,
      });
    }
  }
  return suggestions.sort((a, b) => b.score - a.score);
}

export function providerStatuses(options: {
  cloud: boolean;
  trafficLive: boolean;
  simulatorLive: boolean;
  solver: string;
  external?: Record<string, { provider: string; status: string }>;
}): ProviderStatus[] {
  const tms = options.external?.tms;
  const eld = options.external?.eld;
  const routing = options.external?.routing;
  return [
    { id: "tms", category: "TMS", provider: tms?.provider || "No production TMS configured", mode: tms?.status === "connected" ? "live" : "ready", status: tms?.status === "connected" ? "connected" : tms?.status === "degraded" ? "degraded" : "available", capabilities: ["Loads", "Assignments", "Stops"], swapTarget: "Set TMS health URL and API credential" },
    { id: "eld", category: "ELD / Telematics", provider: eld?.status === "connected" ? eld.provider : options.simulatorLive ? "RoadStar SSE simulator" : "Browser telemetry provider", mode: eld?.status === "connected" ? "live" : options.simulatorLive ? "demo" : "fallback", status: eld?.status === "connected" ? "connected" : eld?.status === "degraded" ? "degraded" : options.simulatorLive ? "available" : "degraded", capabilities: ["GPS", "Speed", "HOS clocks"], swapTarget: "Set ELD health URL and use the RoadStar SSE contract" },
    { id: "routing", category: "Routing", provider: routing?.provider || "Presentation geometry", mode: routing?.status === "configured" ? "ready" : "fallback", status: routing?.status === "configured" ? "available" : "degraded", capabilities: ["Distance", "ETA", "Road route geometry"], swapTarget: "Configure an OSRM-compatible routing service" },
    { id: "traffic", category: "Traffic", provider: options.trafficLive ? "Ontario 511" : "RoadStar incident fallback", mode: options.trafficLive ? "live" : "fallback", status: options.trafficLive ? "connected" : "degraded", capabilities: ["Events", "Construction", "Closures"], swapTarget: "Alternate provincial traffic feed" },
    { id: "loading", category: "Loading", provider: options.solver.startsWith("xflp") ? "xflp 0.7.7" : "Browser shelf packer", mode: options.solver.startsWith("xflp") ? "live" : "fallback", status: options.solver.startsWith("xflp") ? "connected" : "degraded", capabilities: ["Geometry", "Stop order", "Verified axle models"], swapTarget: "skjolber 3D bin packer" },
    { id: "database", category: "Database", provider: options.cloud ? "Supabase Postgres / PostGIS" : "Local deterministic state", mode: options.cloud ? "live" : "demo", status: "connected", capabilities: ["RLS", "Realtime", "Geospatial"], swapTarget: "Portable PostgreSQL" },
  ];
}
