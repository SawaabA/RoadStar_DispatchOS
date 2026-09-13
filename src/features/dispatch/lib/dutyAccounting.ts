import { updateGeofenceVisits } from "./geofencing";
import type { Assignment, DispatchState } from "../types";

// Operational time that passes while a truck is not moving under a trip:
// waiting at a pickup before the route starts, unloading after delivery, or
// sitting at any facility. Movement code accounts for trucks in transit; this
// covers everything else, so detention dwell and on-duty clocks keep running
// when the wheels stop. Driving time is never charged here.

const WORKING_STATUSES: ReadonlyArray<Assignment["status"]> = ["proposed", "dispatched", "accepted"];

type IdleTimeOptions = {
  minutes: number;
  // Trucks whose time is accounted elsewhere, such as by a live telemetry stream.
  skipTruckIds?: ReadonlySet<string>;
  // When set, only these trucks are accounted.
  onlyTruckIds?: ReadonlySet<string>;
  now?: number;
};

export function accountIdleTime(state: DispatchState, { minutes, skipTruckIds, onlyTruckIds, now = Date.now() }: IdleTimeOptions): DispatchState {
  const included = (truckId: string) => (!onlyTruckIds || onlyTruckIds.has(truckId)) && !skipTruckIds?.has(truckId);
  const moving = new Set(state.assignments.filter((item) => item.status === "in_transit").map((item) => item.truckId));
  // A truck with work, or that has just delivered, can be waiting at a
  // facility. Idle trucks parked at their own yard do not open visits.
  const occupied = new Set(
    state.assignments.filter((item) => WORKING_STATUSES.includes(item.status) || item.status === "completed").map((item) => item.truckId),
  );

  let visits = state.visits;
  const alreadyInside = new Set(state.visits.filter((visit) => !visit.departedAt).map((visit) => visit.truckId));
  for (const truck of state.trucks) {
    if (!included(truck.id) || moving.has(truck.id) || !occupied.has(truck.id)) continue;
    // A truck that is not moving cannot leave a facility, and its stored
    // position may predate the visit, so stationary checks only ever open one.
    if (alreadyInside.has(truck.id)) continue;
    visits = updateGeofenceVisits(visits, state.facilities, truck.id, truck.point, now);
  }
  visits = visits.map((visit) =>
    visit.departedAt || !included(visit.truckId) ? visit : { ...visit, dwellMinutes: visit.dwellMinutes + minutes },
  );

  const working = new Set(state.assignments.filter((item) => WORKING_STATUSES.includes(item.status)).map((item) => item.driverId));
  const atFacility = new Set(visits.filter((visit) => !visit.departedAt).map((visit) => visit.truckId));
  const hours = minutes / 60;
  const drivers = state.drivers.map((driver) => {
    if (!included(driver.truckId) || moving.has(driver.truckId)) return driver;
    if (driver.dutyStatus === "off_duty" || driver.dutyStatus === "sleeper") return driver;
    if (!working.has(driver.id) && !atFacility.has(driver.truckId)) return driver;
    return {
      ...driver,
      onDutyHoursRemaining: Math.max(0, driver.onDutyHoursRemaining - hours),
      cycleHoursRemaining: Math.max(0, driver.cycleHoursRemaining - hours),
    };
  });

  return { ...state, visits, drivers };
}
