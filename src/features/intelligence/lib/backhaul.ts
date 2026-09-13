import { evaluateCandidate, roadKm } from "../../dispatch/lib/optimizer";
import { assignCandidate } from "../../dispatch/lib/stateTransitions";
import type { DispatchState } from "../../dispatch/types";

export function evaluateBackhaul(state: DispatchState, assignmentId: string, loadId: string, now = Date.now()) {
  const parent = state.assignments.find(a => a.id === assignmentId);
  const load = state.loads.find(l => l.id === loadId);
  const previous = state.loads.find(l => l.id === parent?.loadId);
  const driver = state.drivers.find(d => d.id === parent?.driverId);
  const truck = state.trucks.find(t => t.id === parent?.truckId);
  const trailer = state.trailers.find(t => t.id === parent?.trailerId);
  if (!parent || !load || !previous || !driver || !truck || !trailer ||
    !["accepted", "in_transit", "completed"].includes(parent.status) ||
    driver.truckId !== truck.id || driver.trailerId !== trailer.id ||
    [driver.status, truck.status, trailer.status].some(s => s === "maintenance" || s === "inactive")) return null;
  const eta = Date.parse(parent.eta);
  if (!Number.isFinite(eta) || !Number.isFinite(now)) return null;
  // ETA is completion time. A late active trip needs a fresh ETA before booking.
  if (parent.status !== "completed" && eta <= now) return null;
  const availableAt = parent.status === "completed" ? now : eta;
  const remaining = (availableAt - now) / 3_600_000;
  const projectedDriver = { ...driver, status: "available" as const, nextAvailable: "Now", point: previous.destinationPoint,
    drivingHoursRemaining: driver.drivingHoursRemaining - remaining,
    onDutyHoursRemaining: driver.onDutyHoursRemaining - remaining,
    cycleHoursRemaining: driver.cycleHoursRemaining - remaining };
  const candidate = evaluateCandidate(load, projectedDriver, { ...trailer, status: "available" }, {
    now: availableAt, trucks: [{ ...truck, status: "available" }],
    assignments: state.assignments.filter(a => a.id !== parent.id),
    reservations: state.backhaulReservations, weights: state.optimizationWeights,
  });
  if (!candidate.feasible) return null;
  const terminal = state.facilities[0]?.point;
  const baselineEmptyKm = terminal ? roadKm(previous.destinationPoint, terminal) : candidate.deadheadKm;
  return { candidate, availableAt, parent, baselineEmptyKm, avoidedEmptyKm: Math.max(0, baselineEmptyKm - candidate.deadheadKm) };
}

export function reserveBackhaul(state: DispatchState, assignmentId: string, loadId: string, now = Date.now()): DispatchState {
  const result = evaluateBackhaul(state, assignmentId, loadId, now);
  if (!result) return state;
  const { candidate, availableAt } = result;
  return { ...state,
    loads: state.loads.map(l => l.id === loadId ? { ...l, status: "assigned" } : l),
    backhaulReservations: [...(state.backhaulReservations ?? []), {
      id: `BACKHAUL-${assignmentId}-${loadId}`, assignmentId, loadId,
      driverId: candidate.driverId, truckId: candidate.truckId, trailerId: candidate.trailerId,
      reservedAt: new Date(now).toISOString(), availableAt: new Date(availableAt).toISOString(),
      projectedEta: new Date(availableAt + candidate.projectedHours * 3_600_000).toISOString(),
    }],
  };
}

export function cancelBackhaul(state: DispatchState, id: string): DispatchState {
  const reservation = state.backhaulReservations?.find(r => r.id === id);
  if (!reservation) return state;
  return { ...state, backhaulReservations: state.backhaulReservations!.filter(r => r.id !== id),
    loads: state.loads.map(l => l.id === reservation.loadId ? { ...l, status: "unassigned" } : l) };
}

export function dispatchBackhaul(state: DispatchState, id: string, now = Date.now()): DispatchState {
  const reservation = state.backhaulReservations?.find(r => r.id === id);
  const parent = state.assignments.find(a => a.id === reservation?.assignmentId);
  if (!reservation || parent?.status !== "completed") return state;
  const available = cancelBackhaul({ ...state,
    drivers: state.drivers.map(d => d.id === reservation.driverId ? { ...d, status: "available" as const, point: parent.currentPoint, nextAvailable: "Now" } : d),
    trucks: state.trucks.map(t => t.id === reservation.truckId ? { ...t, status: "available" as const, point: parent.currentPoint } : t),
    trailers: state.trailers.map(t => t.id === reservation.trailerId ? { ...t, status: "available" as const } : t),
  }, id);
  const load = available.loads.find(l => l.id === reservation.loadId);
  const driver = available.drivers.find(d => d.id === reservation.driverId);
  const trailer = available.trailers.find(t => t.id === reservation.trailerId);
  if (!load || !driver || !trailer) return state;
  // Actual current clocks/location/status must pass again; never trust the reservation estimate.
  const candidate = evaluateCandidate(load, driver, trailer, { now, trucks: available.trucks,
    assignments: available.assignments, reservations: available.backhaulReservations });
  const assigned = assignCandidate(available, candidate, "dispatched", now);
  return assigned === available ? state : assigned;
}
