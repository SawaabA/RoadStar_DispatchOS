import { describe, expect, it } from "vitest";
import { buildMorningPlan, evaluateCandidate } from "./optimizer";
import type {
  DispatchLoad,
  Driver,
  TrailerAsset,
} from "../types";

// A fixed clock keeps every window assertion deterministic; the optimizer takes
// `now` precisely so tests never depend on when they run.
const NOW = Date.UTC(2026, 8, 11, 13, 0, 0);
const offset = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

const MILTON = { lat: 43.5183, lng: -79.8774 };
const LONDON = { lat: 42.9849, lng: -81.2453 };
const MISSISSAUGA = { lat: 43.589, lng: -79.6441 };

const makeLoad = (overrides: Partial<DispatchLoad> = {}): DispatchLoad => ({
  id: "L-1",
  billNumber: "RS-1",
  customer: "Maple Auto",
  description: "Automotive components",
  status: "unassigned",
  equipment: "Dry Van",
  origin: "Milton, ON",
  originPoint: MILTON,
  destination: "London, ON",
  destinationPoint: LONDON,
  pickupStart: offset(60),
  pickupEnd: offset(180),
  deliveryEnd: offset(480),
  weightLbs: 31_200,
  pallets: 18,
  temperatureControlled: false,
  rate: 3850,
  priority: "standard",
  ...overrides,
});

const makeDriver = (overrides: Partial<Driver> = {}): Driver => ({
  id: "D-1",
  name: "Marcus Chen",
  initials: "MC",
  status: "available",
  dutyStatus: "on_duty",
  location: "Mississauga, ON",
  point: MISSISSAUGA,
  drivingHoursRemaining: 8,
  onDutyHoursRemaining: 9,
  cycleHoursRemaining: 30,
  truckId: "T-1",
  trailerId: "DV-1",
  nextAvailable: "Now",
  ...overrides,
});

const makeTrailer = (overrides: Partial<TrailerAsset> = {}): TrailerAsset => ({
  id: "DV-1",
  number: "DV1",
  type: "Dry Van",
  status: "available",
  capacityLbs: 44_500,
  lengthIn: 636,
  widthIn: 98,
  heightIn: 102,
  ...overrides,
});

const codes = (load: DispatchLoad, driver: Driver, trailer: TrailerAsset) =>
  evaluateCandidate(load, driver, trailer, NOW).reasons.map((r) => r.code);

describe("evaluateCandidate", () => {
  it("accepts a compatible pairing inside the pickup window", () => {
    const candidate = evaluateCandidate(makeLoad(), makeDriver(), makeTrailer(), NOW);

    expect(candidate.feasible).toBe(true);
    expect(candidate.reasons).toEqual([]);
    expect(candidate.deadheadKm).toBeGreaterThan(0);
    expect(candidate.tripKm).toBeGreaterThan(candidate.deadheadKm);
    expect(candidate.hosRemainingAfter).toBeLessThan(8);
    expect(candidate.explanation).toContain("deadhead");
  });

  it("carries the driver's truck and trailer onto the candidate", () => {
    const candidate = evaluateCandidate(
      makeLoad(),
      makeDriver({ truckId: "T-99", trailerId: "DV-99" }),
      makeTrailer(),
      NOW,
    );

    expect(candidate.truckId).toBe("T-99");
    expect(candidate.trailerId).toBe("DV-99");
  });

  it("rejects equipment the trailer cannot pull", () => {
    expect(codes(makeLoad({ equipment: "Flatbed" }), makeDriver(), makeTrailer()))
      .toContain("equipment");
  });

  it("rejects temperature-controlled freight on a matching non-reefer trailer", () => {
    // The trailer type matches the load's declared equipment, so only the
    // reefer requirement can catch this data-quality case.
    const reasons = codes(
      makeLoad({ equipment: "Dry Van", temperatureControlled: true }),
      makeDriver(),
      makeTrailer({ type: "Dry Van" }),
    );

    expect(reasons).toContain("equipment");
  });

  it("rejects freight heavier than the trailer capacity", () => {
    expect(codes(makeLoad({ weightLbs: 50_000 }), makeDriver(), makeTrailer({ capacityLbs: 44_500 })))
      .toContain("weight");
  });

  it("rejects a pickup the driver cannot reach before the window closes", () => {
    expect(codes(makeLoad({ pickupStart: offset(-180), pickupEnd: offset(-60) }), makeDriver(), makeTrailer()))
      .toContain("pickup");
  });

  it("rejects a trip that exceeds remaining driving hours", () => {
    expect(codes(makeLoad(), makeDriver({ drivingHoursRemaining: 1 }), makeTrailer()))
      .toContain("hos");
  });

  it("rejects a trip that exceeds the on-duty clock", () => {
    expect(codes(makeLoad(), makeDriver({ onDutyHoursRemaining: 1 }), makeTrailer()))
      .toContain("hos");
  });

  it("rejects a trip that exceeds the cycle balance", () => {
    expect(codes(makeLoad(), makeDriver({ cycleHoursRemaining: 1 }), makeTrailer()))
      .toContain("hos");
  });

  it("rejects an unavailable driver or trailer", () => {
    expect(codes(makeLoad(), makeDriver({ status: "maintenance" }), makeTrailer()))
      .toContain("status");
    expect(codes(makeLoad(), makeDriver(), makeTrailer({ status: "assigned" })))
      .toContain("status");
  });

  it("reports every blocking reason rather than stopping at the first", () => {
    const reasons = codes(
      makeLoad({ equipment: "Flatbed", weightLbs: 90_000 }),
      makeDriver({ status: "inactive" }),
      makeTrailer(),
    );

    expect(new Set(reasons)).toEqual(new Set(["status", "equipment", "weight"]));
  });

  it("is a hard gate: an infeasible pairing is never merely low-scoring", () => {
    const blocked = evaluateCandidate(
      makeLoad({ equipment: "Flatbed" }),
      makeDriver(),
      makeTrailer(),
      NOW,
    );

    expect(blocked.feasible).toBe(false);
    expect(blocked.explanation).not.toContain("deadhead");
  });
});

describe("buildMorningPlan", () => {
  const trailers = [
    makeTrailer({ id: "DV-1", number: "DV1" }),
    makeTrailer({ id: "DV-2", number: "DV2" }),
  ];
  const drivers = [
    makeDriver({ id: "D-1", truckId: "T-1", trailerId: "DV-1" }),
    makeDriver({ id: "D-2", name: "Priya Shah", truckId: "T-2", trailerId: "DV-2", point: MILTON }),
  ];
  const loads = [
    makeLoad({ id: "L-1", billNumber: "RS-1" }),
    makeLoad({ id: "L-2", billNumber: "RS-2", priority: "critical" }),
  ];

  it("covers the available loads", () => {
    const plan = buildMorningPlan(loads, drivers, trailers, NOW);

    expect(plan.candidates).toHaveLength(2);
    expect(plan.rejectedLoads).toEqual([]);
  });

  it("never returns an infeasible candidate", () => {
    const plan = buildMorningPlan(loads, drivers, trailers, NOW);

    expect(plan.candidates.every((c) => c.feasible)).toBe(true);
  });

  it("never double-books a driver, truck, or trailer", () => {
    const plan = buildMorningPlan(loads, drivers, trailers, NOW);
    const driverIds = plan.candidates.map((c) => c.driverId);
    const truckIds = plan.candidates.map((c) => c.truckId);
    const trailerIds = plan.candidates.map((c) => c.trailerId);

    expect(new Set(driverIds).size).toBe(driverIds.length);
    expect(new Set(truckIds).size).toBe(truckIds.length);
    expect(new Set(trailerIds).size).toBe(trailerIds.length);
  });

  it("assigns each load at most once", () => {
    const plan = buildMorningPlan(loads, drivers, trailers, NOW);
    const loadIds = plan.candidates.map((c) => c.loadId);

    expect(new Set(loadIds).size).toBe(loadIds.length);
  });

  it("only plans unassigned loads", () => {
    const plan = buildMorningPlan(
      [loads[0]!, makeLoad({ id: "L-3", status: "in_transit" })],
      drivers,
      trailers,
      NOW,
    );

    expect(plan.candidates.map((c) => c.loadId)).not.toContain("L-3");
  });

  it("does not mutate the state it is given", () => {
    const snapshot = JSON.stringify({ loads, drivers, trailers });
    buildMorningPlan(loads, drivers, trailers, NOW);

    expect(JSON.stringify({ loads, drivers, trailers })).toBe(snapshot);
  });

  it("reports a load with no compatible trailer in the asset master", () => {
    const plan = buildMorningPlan(
      [makeLoad({ id: "L-F", equipment: "Flatbed" })],
      drivers,
      trailers,
      NOW,
    );

    expect(plan.candidates).toEqual([]);
    expect(plan.rejectedLoads[0]?.loadId).toBe("L-F");
    expect(plan.rejectedLoads[0]?.reasons.join(" ")).toMatch(/Flatbed/);
  });

  it("distinguishes losing a unit to contention from a hard blocker", () => {
    // Two loads, one eligible driver: the uncovered load is not equipment- or
    // HOS-blocked, it simply lost the only unit to a higher-priority load.
    const plan = buildMorningPlan(
      [
        makeLoad({ id: "L-1", priority: "critical" }),
        makeLoad({ id: "L-2", priority: "standard" }),
      ],
      [drivers[0]!],
      trailers,
      NOW,
    );

    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0]?.loadId).toBe("L-1");
    expect(plan.rejectedLoads[0]?.loadId).toBe("L-2");
    expect(plan.rejectedLoads[0]?.reasons[0]).toMatch(/higher-priority/i);
  });

  it("totals projected deadhead across the accepted candidates", () => {
    const plan = buildMorningPlan(loads, drivers, trailers, NOW);
    const expected = plan.candidates.reduce((sum, c) => sum + c.deadheadKm, 0);

    expect(plan.projectedDeadheadKm).toBeCloseTo(expected, 6);
  });

  it("is deterministic for identical inputs", () => {
    const first = buildMorningPlan(loads, drivers, trailers, NOW);
    const second = buildMorningPlan(loads, drivers, trailers, NOW);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
