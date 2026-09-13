import { describe, expect, it } from "vitest";
import { createDemoState } from "../data/demoData";
import { accountIdleTime } from "./dutyAccounting";
import type { Assignment, DispatchState, Driver, GeofenceVisit } from "../types";

// One driver's truck parked inside a facility, with a single assignment in the
// given status and known clocks, so each rule can be observed in isolation.
function parkedAtFacility(status: Assignment["status"], options: { dutyStatus?: Driver["dutyStatus"]; visits?: GeofenceVisit[] } = {}) {
  const base = createDemoState();
  const facility = base.facilities[0]!;
  const driver = base.drivers[0]!;
  const truckId = driver.truckId;
  const state: DispatchState = {
    ...base,
    visits: options.visits ?? [],
    trucks: base.trucks.map((truck) => (truck.id === truckId ? { ...truck, point: facility.point } : truck)),
    assignments: [{
      ...base.assignments[0]!,
      id: "A-QA",
      loadId: base.loads[0]!.id,
      driverId: driver.id,
      truckId,
      trailerId: driver.trailerId,
      status,
      progress: status === "completed" ? 1 : 0,
    }],
    drivers: base.drivers.map((item) => (item.id === driver.id
      ? { ...item, dutyStatus: options.dutyStatus ?? "on_duty", drivingHoursRemaining: 9, onDutyHoursRemaining: 10, cycleHoursRemaining: 40 }
      : item)),
  };
  return { state, facility, driverId: driver.id, truckId };
}

const openVisit = (truckId: string, facilityId: string, dwellMinutes: number): GeofenceVisit => ({
  id: "V-QA", truckId, facilityId, arrivedAt: new Date(0).toISOString(), dwellMinutes,
});

function ticks(state: DispatchState, count: number, options: Omit<Parameters<typeof accountIdleTime>[1], "minutes"> = {}) {
  let next = state;
  for (let index = 0; index < count; index += 1) next = accountIdleTime(next, { minutes: 2, now: 1_000 + index, ...options });
  return next;
}

const driverIn = (state: DispatchState, id: string) => state.drivers.find((item) => item.id === id)!;

describe("idle operational time", () => {
  it("counts a driver waiting at pickup with an accepted load: the visit opens, dwell grows, on-duty time is spent", () => {
    const { state, facility, driverId, truckId } = parkedAtFacility("accepted");
    const next = ticks(state, 3);

    const visits = next.visits.filter((visit) => visit.truckId === truckId);
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({ facilityId: facility.id, dwellMinutes: 6 });
    expect(visits[0]!.departedAt).toBeUndefined();
    expect(driverIn(next, driverId).onDutyHoursRemaining).toBeCloseTo(10 - 6 / 60);
    expect(driverIn(next, driverId).cycleHoursRemaining).toBeCloseTo(40 - 6 / 60);
    expect(driverIn(next, driverId).drivingHoursRemaining).toBe(9);
  });

  it("keeps accruing detention while unloading after a completed delivery", () => {
    const { state, facility, truckId } = parkedAtFacility("completed", { visits: [] });
    const arrived = { ...state, visits: [openVisit(truckId, facility.id, facility.freeMinutes - 2)] };
    const next = ticks(arrived, 2);
    const visit = next.visits.find((item) => item.truckId === truckId)!;
    expect(visit.dwellMinutes).toBe(facility.freeMinutes + 2);
    expect(Math.max(0, visit.dwellMinutes - facility.freeMinutes)).toBe(2);
  });

  it("never departs an open visit for a stopped truck whose stored position is outside the facility", () => {
    const { state, facility, truckId } = parkedAtFacility("accepted");
    const elsewhere = { lat: facility.point.lat + 1, lng: facility.point.lng };
    const stale = {
      ...state,
      trucks: state.trucks.map((truck) => (truck.id === truckId ? { ...truck, point: elsewhere } : truck)),
      visits: [openVisit(truckId, facility.id, 138)],
    };
    const next = ticks(stale, 3);
    const visit = next.visits.find((item) => item.truckId === truckId)!;
    expect(visit.departedAt).toBeUndefined();
    expect(visit.dwellMinutes).toBe(144);
    expect(next.visits.filter((item) => item.truckId === truckId)).toHaveLength(1);
  });

  it("does not open visits or spend on-duty time for a truck with no work parked at a yard", () => {
    const { state, driverId, truckId } = parkedAtFacility("accepted");
    const idle = { ...state, assignments: [] };
    const next = ticks(idle, 3);
    expect(next.visits.filter((visit) => visit.truckId === truckId)).toHaveLength(0);
    expect(driverIn(next, driverId).onDutyHoursRemaining).toBe(10);
  });

  it("leaves an off-duty driver's clocks alone while the truck's dwell still counts", () => {
    const { state, facility, driverId, truckId } = parkedAtFacility("accepted", { dutyStatus: "off_duty" });
    const next = ticks({ ...state, visits: [openVisit(truckId, facility.id, 30)] }, 2);
    expect(next.visits.find((item) => item.truckId === truckId)!.dwellMinutes).toBe(34);
    expect(driverIn(next, driverId).onDutyHoursRemaining).toBe(10);
    expect(driverIn(next, driverId).cycleHoursRemaining).toBe(40);
  });

  it("leaves trucks on live telemetry to the stream, so time is never counted twice", () => {
    const { state, driverId, truckId } = parkedAtFacility("accepted");
    const next = ticks(state, 3, { skipTruckIds: new Set([truckId]) });
    expect(next.visits.filter((visit) => visit.truckId === truckId)).toHaveLength(0);
    expect(driverIn(next, driverId).onDutyHoursRemaining).toBe(10);
  });

  it("accrues an in-transit truck's open visit once and never touches a moving driver's clocks", () => {
    const { state, facility, driverId, truckId } = parkedAtFacility("in_transit");
    const next = ticks({ ...state, visits: [openVisit(truckId, facility.id, 10)] }, 2);
    expect(next.visits.find((item) => item.truckId === truckId)!.dwellMinutes).toBe(14);
    expect(driverIn(next, driverId)).toMatchObject({ drivingHoursRemaining: 9, onDutyHoursRemaining: 10, cycleHoursRemaining: 40 });
  });

  it("limits accounting to the reporting truck when asked", () => {
    const { state, truckId } = parkedAtFacility("accepted");
    const next = ticks(state, 2, { onlyTruckIds: new Set(["T-NOT-THIS-ONE"]) });
    expect(next.visits.filter((visit) => visit.truckId === truckId)).toHaveLength(0);
  });
});
