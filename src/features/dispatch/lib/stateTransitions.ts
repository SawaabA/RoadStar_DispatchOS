import { evaluateCandidate, type PlanningContext } from "./optimizer";
import type {
  Assignment,
  DecisionRecord,
  DispatchCandidate,
  DispatchLoad,
  DispatchState,
  DriverAssignmentAction,
} from "../types";

export function assignCandidate(
  current: DispatchState,
  candidate: DispatchCandidate,
  status: Assignment["status"] = "dispatched",
  now = Date.now(),
  context: PlanningContext = {},
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

  const freshCandidate = evaluateCandidate(load, driver, trailer, { ...context, now, trucks: current.trucks, assignments: current.assignments, reservations: current.backhaulReservations, weights: current.optimizationWeights });
  if (!freshCandidate.feasible) return current;

  const assignedAt = new Date(now).toISOString();
  const assignment: Assignment = {
    id: `A-${load.billNumber.replace("RS-", "")}`,
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

export function unassignLoad(
  current: DispatchState,
  loadId: string,
): DispatchState {
  const assignment = current.assignments.find((item) => item.loadId === loadId);
  if (
    !assignment ||
    assignment.status === "in_transit" ||
    assignment.status === "completed"
  )
    return current;

  // Release a queued successor when its predecessor is withdrawn.
  const reservations = (current.backhaulReservations ?? []).filter(item => item.assignmentId === assignment.id);
  const released = new Set(reservations.map(item => item.loadId));

  return {
    ...current,
    loads: current.loads.map((item) =>
      item.id === loadId || released.has(item.id) ? { ...item, status: "unassigned" } : item,
    ),
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
    backhaulReservations: (current.backhaulReservations ?? []).filter(item => item.assignmentId !== assignment.id),
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
    const next = unassignLoad(current, assignment.loadId);
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
      load.id === assignment.loadId
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
