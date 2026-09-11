import { evaluateCandidate } from "./optimizer";
import type {
  Assignment,
  DispatchCandidate,
  DispatchState,
} from "../types";

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

  return {
    ...current,
    loads: current.loads.map((item) =>
      item.id === loadId ? { ...item, status: "unassigned" } : item,
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
  };
}
