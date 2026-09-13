import { evaluateCandidate } from "./optimizer";
import { carriedLoadIds, evaluateCoLoad, planTrip, tripLoadIds } from "./tripPlanning";
import type {
  Assignment,
  DecisionRecord,
  DispatchCandidate,
  DispatchLoad,
  DispatchState,
  DriverAssignmentAction,
} from "../types";

const TRIP_EDITABLE_STATUSES: Array<Assignment["status"]> = ["proposed", "dispatched", "accepted"];

const uniqueAssignmentId = (current: DispatchState, billNumber: string) => {
  const base = `A-${billNumber.replace("RS-", "")}`;
  if (!current.assignments.some((item) => item.id === base)) return base;
  let suffix = 2;
  while (current.assignments.some((item) => item.id === `${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
};

/** Re-times a trip from where the truck stands now, over every load it carries. */
function tripEta(
  current: DispatchState,
  assignment: Assignment,
  loadIds: string[],
  now: number,
): string | null {
  const driver = current.drivers.find((item) => item.id === assignment.driverId);
  const trailer = current.trailers.find((item) => item.id === assignment.trailerId);
  const truck = current.trucks.find((item) => item.id === assignment.truckId);
  const loads = loadIds.flatMap((id) => current.loads.filter((load) => load.id === id));
  if (!driver || !trailer || loads.length !== loadIds.length) return null;
  return planTrip({
    loads,
    driver,
    trailer,
    truck,
    start: assignment.currentPoint,
    startAt: now,
    pickedUpLoadIds: carriedLoadIds(assignment),
  }).finishAt;
}

export function assignCandidate(
  current: DispatchState,
  candidate: DispatchCandidate,
  status: Assignment["status"] = "dispatched",
  now = Date.now(),
): DispatchState {
  if (!candidate.feasible) return current;

  const load = current.loads.find((item) => item.id === candidate.loadId);
  const driver = current.drivers.find((item) => item.id === candidate.driverId);
  const trailer = current.trailers.find(
    (item) => item.id === candidate.trailerId,
  );
  const truck = current.trucks.find((item) => item.id === candidate.truckId);
  if (
    !load ||
    !driver ||
    !trailer ||
    !truck ||
    load.status !== "unassigned" ||
    driver.truckId !== truck.id ||
    driver.trailerId !== trailer.id
  )
    return current;

  const freshCandidate = evaluateCandidate(load, driver, trailer, truck, now);
  if (!freshCandidate.feasible) return current;

  const assignedAt = new Date(now).toISOString();
  const assignment: Assignment = {
    id: uniqueAssignmentId(current, load.billNumber),
    loadId: load.id,
    driverId: driver.id,
    truckId: truck.id,
    trailerId: trailer.id,
    status,
    assignedAt,
    progress: 0,
    currentPoint: driver.point,
    breadcrumbs: [driver.point],
    speedKph: 0,
    distanceKm: 0,
    eta: new Date(now + freshCandidate.projectedHours * 3_600_000).toISOString(),
  };

  return {
    ...current,
    loads: current.loads.map((item) =>
      item.id === load.id ? { ...item, status: "assigned" } : item,
    ),
    drivers: current.drivers.map((item) =>
      item.id === driver.id ? { ...item, status: "assigned" } : item,
    ),
    trucks: current.trucks.map((item) =>
      item.id === truck.id ? { ...item, status: "assigned" } : item,
    ),
    trailers: current.trailers.map((item) =>
      item.id === trailer.id ? { ...item, status: "assigned" } : item,
    ),
    assignments: [
      ...current.assignments.filter((item) => item.loadId !== load.id),
      assignment,
    ],
  };
}

/**
 * Consolidates another load onto a trip that has not left yet. The co-load
 * evaluation is re-run here so a stale screen cannot commit a trip that no
 * longer fits the trailer, the appointments, or the driver's clock.
 */
export function addLoadToTrip(
  current: DispatchState,
  assignmentId: string,
  loadId: string,
  now = Date.now(),
): DispatchState {
  const assignment = current.assignments.find((item) => item.id === assignmentId);
  if (!assignment || !TRIP_EDITABLE_STATUSES.includes(assignment.status)) return current;
  if (tripLoadIds(assignment).includes(loadId)) return current;

  const candidate = current.loads.find((item) => item.id === loadId);
  const driver = current.drivers.find((item) => item.id === assignment.driverId);
  const trailer = current.trailers.find((item) => item.id === assignment.trailerId);
  const truck = current.trucks.find((item) => item.id === assignment.truckId);
  if (!candidate || !driver || !trailer || candidate.status !== "unassigned") return current;

  const existing = tripLoadIds(assignment).flatMap((id) =>
    current.loads.filter((load) => load.id === id),
  );
  if (!existing.length) return current;

  const evaluation = evaluateCoLoad({
    tripLoads: existing,
    candidate,
    driver,
    trailer,
    truck,
    start: assignment.currentPoint,
    startAt: now,
    pickedUpLoadIds: carriedLoadIds(assignment),
  });
  if (!evaluation.feasible) return current;

  const decision: DecisionRecord = {
    id: `trip:${assignment.id}:${candidate.id}:${now}`,
    kind: "load",
    outcome: "accepted",
    createdAt: new Date(now).toISOString(),
    summary: `Consolidated ${candidate.billNumber} onto ${assignment.id} (+${Math.round(evaluation.addedKm)} km, +${evaluation.addedMinutes} min)`,
  };

  return {
    ...current,
    loads: current.loads.map((item) =>
      item.id === candidate.id ? { ...item, status: "assigned" } : item,
    ),
    assignments: current.assignments.map((item) =>
      item.id === assignment.id
        ? {
            ...item,
            addedLoadIds: [...(item.addedLoadIds ?? []), candidate.id],
            eta: evaluation.combined.finishAt,
          }
        : item,
    ),
    decisionLog: [...(current.decisionLog ?? []), decision].slice(-500),
  };
}

/**
 * Releases one load. A consolidated trip keeps running with the freight that
 * stays on it; the driver, truck and trailer are only freed when the last load
 * leaves the trip.
 */
export function unassignLoad(
  current: DispatchState,
  loadId: string,
  now = Date.now(),
): DispatchState {
  const assignment = current.assignments.find((item) => tripLoadIds(item).includes(loadId));
  if (
    !assignment ||
    assignment.status === "in_transit" ||
    assignment.status === "completed"
  )
    return current;

  const remaining = tripLoadIds(assignment).filter((id) => id !== loadId);
  const loads = current.loads.map((item) =>
    item.id === loadId ? { ...item, status: "unassigned" as const } : item,
  );

  if (remaining.length) {
    const [primary, ...added] = remaining as [string, ...string[]];
    const retimed = { ...assignment, loadId: primary, addedLoadIds: added };
    const eta = tripEta({ ...current, loads }, retimed, remaining, now) ?? assignment.eta;
    return {
      ...current,
      loads,
      assignments: current.assignments.map((item) =>
        item.id === assignment.id ? { ...retimed, eta } : item,
      ),
    };
  }

  return {
    ...current,
    loads,
    drivers: current.drivers.map((item) =>
      item.id === assignment.driverId ? { ...item, status: "available" } : item,
    ),
    trucks: current.trucks.map((item) =>
      item.id === assignment.truckId ? { ...item, status: "available" } : item,
    ),
    trailers: current.trailers.map((item) =>
      item.id === assignment.trailerId
        ? { ...item, status: "available" }
        : item,
    ),
    assignments: current.assignments.filter((item) => item.id !== assignment.id),
  };
}

export function transitionDriverAssignment(
  current: DispatchState,
  assignmentId: string,
  driverId: string,
  action: DriverAssignmentAction,
  now = Date.now(),
): DispatchState {
  const assignment = current.assignments.find(
    (item) => item.id === assignmentId && item.driverId === driverId,
  );
  if (!assignment) return current;

  const canAccept = action === "accepted" && ["proposed", "dispatched"].includes(assignment.status);
  const canStart = action === "in_transit" && assignment.status === "accepted";
  const canDecline = action === "declined" && ["proposed", "dispatched"].includes(assignment.status);
  if (!canAccept && !canStart && !canDecline) return current;
  if (canDecline) {
    // Declining returns the whole trip, not only its first load.
    const next = tripLoadIds(assignment).reduce(
      (state, loadId) => unassignLoad(state, loadId, now),
      current,
    );
    return {
      ...next,
      decisionLog: [
        ...(next.decisionLog ?? []),
        ({
          id: `driver:${assignmentId}:${now}`,
          kind: "driver",
          outcome: "declined",
          createdAt: new Date(now).toISOString(),
          summary: `Driver declined assignment ${assignmentId}`,
        } satisfies DecisionRecord),
      ].slice(-500),
    };
  }

  const nextStatus = action as Assignment["status"];
  const carried = new Set(tripLoadIds(assignment));
  return {
    ...current,
    assignments: current.assignments.map((item) =>
      item.id === assignmentId
        ? {
            ...item,
            status: nextStatus,
            acceptedAt: action === "accepted" ? new Date(now).toISOString() : item.acceptedAt,
          }
        : item,
    ),
    loads: current.loads.map((load) =>
      carried.has(load.id)
        ? { ...load, status: action === "in_transit" ? "in_transit" : "assigned" }
        : load,
    ),
    decisionLog: [
      ...(current.decisionLog ?? []),
      ({
        id: `driver:${assignmentId}:${now}`,
        kind: "driver",
        outcome: action === "in_transit" ? "started" : "accepted",
        createdAt: new Date(now).toISOString(),
        summary: action === "in_transit"
          ? `Driver started assignment ${assignmentId}`
          : `Driver accepted assignment ${assignmentId}`,
      } satisfies DecisionRecord),
    ].slice(-500),
  };
}

// Adds a new unassigned load. It refuses a duplicate id or bill number rather
// than overwrite a load another dispatcher may already be working.
export function addLoad(current: DispatchState, load: DispatchLoad): DispatchState {
  const bill = load.billNumber.toLowerCase();
  if (load.status !== "unassigned") return current;
  if (current.loads.some((item) => item.id === load.id || item.billNumber.toLowerCase() === bill)) return current;
  return { ...current, loads: [...current.loads, load] };
}
