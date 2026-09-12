import { evaluateCandidate } from "./optimizer";
import type {
  DispatchCandidate,
  DispatchException,
  DispatchState,
  ExceptionSeverity,
} from "../types";

// A driver below this remaining driving margin is worth a dispatcher's
// attention before the clock becomes a hard feasibility failure.
const HOS_WARNING_HOURS = 3.5;
// Warn this far ahead of the facility's free allowance expiring.
const DETENTION_WARNING_MINUTES = 30;

const SEVERITY_RANK: Record<ExceptionSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const hoursMinutes = (hours: number) => {
  const total = Math.max(0, Math.round(hours * 60));
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
};

const money = (value: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);

/**
 * Derives the dispatcher's action list from live state. Pure: it never mutates
 * the state it is given and never persists anything. Every exception points at
 * the screen that owns the action resolving it.
 */
export function detectExceptions(
  state: DispatchState,
  now = Date.now(),
): DispatchException[] {
  const exceptions: DispatchException[] = [];

  const availableDrivers = state.drivers.filter(
    (driver) => driver.status === "available",
  );
  const openLoads = state.loads.filter((load) => load.status === "unassigned");

  // Candidate evaluation is bounded to unassigned loads against available
  // drivers so this stays cheap enough to recompute on every telemetry tick.
  for (const load of openLoads) {
    const candidates = availableDrivers
      .map((driver) => {
        const trailer = state.trailers.find((item) => item.id === driver.trailerId);
        return trailer ? evaluateCandidate(load, driver, trailer, { now, trucks: state.trucks, assignments: state.assignments }) : null;
      })
      .filter((candidate): candidate is DispatchCandidate => candidate !== null);

    if (!candidates.length || candidates.some((candidate) => candidate.feasible))
      continue;

    const has = (code: string) =>
      candidates.every((candidate) =>
        candidate.reasons.some((reason) => reason.code === code),
      );

    if (has("equipment")) {
      exceptions.push({
        id: `equipment:${load.id}`,
        kind: "equipment",
        severity: "critical",
        title: "No compatible trailer",
        detail: `${load.billNumber} requires ${load.equipment}; none appears in the active asset master. Manual review required.`,
        view: "dispatch",
        loadId: load.id,
      });
      continue;
    }

    if (candidates.some((c) => c.reasons.some((r) => r.code === "pickup"))) {
      exceptions.push({
        id: `pickup:${load.id}`,
        kind: "pickup",
        severity: "warning",
        title: "Pickup window at risk",
        detail: `No available unit can reach ${load.origin} before ${load.billNumber} closes its pickup window.`,
        view: "dispatch",
        loadId: load.id,
      });
    }
  }

  // A trip already under way that the driver cannot legally finish is the
  // dock/HOS collision the brief calls out as a hidden operational problem.
  for (const assignment of state.assignments) {
    if (!["dispatched", "accepted", "in_transit"].includes(assignment.status))
      continue;
    const driver = state.drivers.find((item) => item.id === assignment.driverId);
    const load = state.loads.find((item) => item.id === assignment.loadId);
    if (!driver || !load) continue;

    const hoursToEta = (new Date(assignment.eta).getTime() - now) / 3_600_000;
    if (hoursToEta > driver.drivingHoursRemaining) {
      exceptions.push({
        id: `hos:${assignment.id}`,
        kind: "hos",
        severity: "critical",
        title: "HOS will expire before delivery",
        detail: `${driver.name} needs ${hoursMinutes(hoursToEta)} to complete ${load.billNumber} with ${hoursMinutes(driver.drivingHoursRemaining)} driving left.`,
        view: "fleet",
        driverId: driver.id,
        assignmentId: assignment.id,
        loadId: load.id,
      });
    }
  }

  for (const driver of state.drivers) {
    if (driver.status !== "available") continue;
    if (driver.drivingHoursRemaining >= HOS_WARNING_HOURS) continue;
    exceptions.push({
      id: `hos:${driver.id}`,
      kind: "hos",
      severity: "warning",
      title: "HOS margin tightening",
      detail: `${driver.name} has ${hoursMinutes(driver.drivingHoursRemaining)} driving remaining.`,
      view: "fleet",
      driverId: driver.id,
    });
  }

  // Road disruptions arrive from the telemetry provider and are surfaced here
  // so a 401 incident reaches the dispatcher's action list, not just the map.
  for (const incident of state.incidents ?? []) {
    const truck = state.trucks.find((item) => item.id === incident.truckId);
    exceptions.push({
      id: `route:${incident.id}`,
      kind: "route",
      severity: incident.severity,
      title: incident.label,
      detail: truck
        ? `Truck ${truck.number}: ${incident.detail}`
        : incident.detail,
      view: "map",
    });
  }

  for (const visit of state.visits) {
    if (visit.departedAt) continue;
    const facility = state.facilities.find((item) => item.id === visit.facilityId);
    if (!facility) continue;

    const truck = state.trucks.find((item) => item.id === visit.truckId);
    const truckLabel = truck?.number ?? visit.truckId;
    const billable = visit.dwellMinutes - facility.freeMinutes;
    if (billable >= 0) {
      exceptions.push({
        id: `detention:${visit.id}`,
        kind: "detention",
        severity: "critical",
        title: "Detention now billable",
        detail: `Truck ${truckLabel} has been at ${facility.name} for ${hoursMinutes(visit.dwellMinutes / 60)} — ${Math.round(billable)} billable min, ${money((billable / 60) * facility.detentionRate)}.`,
        view: "detention",
        facilityId: facility.id,
      });
    } else if (billable >= -DETENTION_WARNING_MINUTES) {
      exceptions.push({
        id: `detention:${visit.id}`,
        kind: "detention",
        severity: "warning",
        title: "Free time nearly used",
        detail: `Truck ${truckLabel} reaches billable detention at ${facility.name} in ${Math.round(-billable)} min.`,
        view: "detention",
        facilityId: facility.id,
      });
    }
  }

  // Stable ordering: severity first, then identifier, so the list does not
  // reshuffle between telemetry ticks.
  return exceptions.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.id.localeCompare(b.id),
  );
}

export const exceptionSummary = (exceptions: DispatchException[]) => ({
  total: exceptions.length,
  critical: exceptions.filter((item) => item.severity === "critical").length,
});
