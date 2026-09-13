import { describe, expect, it } from "vitest";
import { createDemoState } from "../data/demoData";
import { evaluateCoLoad, palletPositions, planTrip, tripLoadIds } from "./tripPlanning";
import type { DispatchLoad } from "../types";

const state = createDemoState();
const driver = state.drivers.find((item) => item.id === "D-113")!;
const trailer = state.trailers.find((item) => item.id === driver.trailerId)!;
const truck = state.trucks.find((item) => item.id === driver.truckId)!;
const load = (id: string) => state.loads.find((item) => item.id === id)!;

const withOverrides = (source: DispatchLoad, overrides: Partial<DispatchLoad>): DispatchLoad => ({
  ...source,
  ...overrides,
});

describe("trip planning", () => {
  it("derives pallet positions from the trailer floor", () => {
    // 53' van: thirteen rows of two 48x40 positions.
    expect(palletPositions(trailer)).toBe(26);
  });

  it("sequences a single load as pickup then delivery and measures the whole run", () => {
    const plan = planTrip({ loads: [load("L-4521")], driver, trailer, truck, start: driver.point });

    expect(plan.stops.map((stop) => stop.kind)).toEqual(["pickup", "delivery"]);
    expect(plan.totalKm).toBeGreaterThan(plan.loadedKm);
    expect(plan.emptyKm).toBeGreaterThan(0);
    // On duty always exceeds driving: two stops carry service time.
    expect(plan.onDutyHours).toBeGreaterThan(plan.drivingHours);
    expect(plan.peakWeightLbs).toBe(load("L-4521").weightLbs);
  });

  it("blocks freight that cannot ride on the trailer at all", () => {
    const overweight = withOverrides(load("L-4521"), {
      id: "L-OVERWEIGHT",
      weightLbs: trailer.capacityLbs + 4_000,
    });
    const plan = planTrip({ loads: [overweight], driver, trailer, truck, start: driver.point });

    expect(plan.feasible).toBe(false);
    expect(plan.blockers.map((blocker) => blocker.code)).toContain("weight");
  });

  it("says so when the trailer cannot hold both loads at once", () => {
    const base = load("L-4521");
    const bulky = withOverrides(load("L-4534"), {
      id: "L-BULKY",
      weightLbs: 4_000,
      pallets: 20,
      origin: base.origin,
      originPoint: base.originPoint,
      destination: base.destination,
      destinationPoint: base.destinationPoint,
    });
    const evaluation = evaluateCoLoad({
      tripLoads: [base],
      candidate: bulky,
      driver,
      trailer,
      truck,
      start: driver.point,
    });

    // 18 + 20 pallets against 26 positions: the weight fits, the floor does not,
    // so the planner never overloads the trailer. It serialises the trip and
    // tells the dispatcher this is not a true consolidation.
    expect(evaluation.palletsAfter).toBeLessThanOrEqual(palletPositions(trailer));
    expect(evaluation.blockers.map((blocker) => blocker.code)).not.toContain("pallets");
    expect(evaluation.warnings.join(" ")).toMatch(/cannot hold all of it at once/i);
  });

  it("keeps two heavy loads legal by delivering the first before collecting the second", () => {
    // Same weights, but the second pickup is far past the first delivery, so no
    // sequence can carry both at once and the planner must run them in series.
    const first = withOverrides(load("L-4521"), { id: "L-SERIES-A", weightLbs: 30_000 });
    const second = withOverrides(load("L-4534"), {
      id: "L-SERIES-B",
      weightLbs: 30_000,
      origin: first.destination,
      originPoint: first.destinationPoint,
    });
    const plan = planTrip({ loads: [first, second], driver, trailer, truck, start: driver.point });

    expect(plan.peakWeightLbs).toBe(30_000);
    expect(plan.blockers.map((blocker) => blocker.code)).not.toContain("weight");
  });

  it("refuses freight the trailer type cannot legally carry", () => {
    const plan = planTrip({ loads: [load("L-4528")], driver, trailer, truck, start: driver.point });

    expect(plan.feasible).toBe(false);
    expect(plan.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining(["equipment", "temperature"]),
    );
  });

  it("prices a co-load as added distance, added time and remaining capacity", () => {
    const base = load("L-4521");
    const nearby = withOverrides(load("L-4534"), {
      id: "L-NEARBY",
      weightLbs: 8_000,
      pallets: 4,
      origin: base.origin,
      originPoint: base.originPoint,
      destination: base.destination,
      destinationPoint: base.destinationPoint,
    });
    const evaluation = evaluateCoLoad({
      tripLoads: [base],
      candidate: nearby,
      driver,
      trailer,
      truck,
      start: driver.point,
    });

    expect(evaluation.feasible).toBe(true);
    expect(evaluation.corridor).toBe("same");
    expect(evaluation.destinationSpreadKm).toBeCloseTo(0, 5);
    expect(evaluation.weightAfterLbs).toBe(base.weightLbs + nearby.weightLbs);
    expect(evaluation.palletsAfter).toBe(base.pallets + nearby.pallets);
    // Same origin and destination: consolidating costs almost no extra distance.
    expect(evaluation.addedKm).toBeLessThan(5);
    // It still costs on-duty time, because the extra dock stops are real.
    expect(evaluation.addedMinutes).toBeGreaterThan(0);
  });

  it("flags freight that leaves the corridor", () => {
    const base = load("L-4521");
    const far = withOverrides(load("L-4534"), { id: "L-FAR", weightLbs: 6_000, pallets: 3 });
    const evaluation = evaluateCoLoad({
      tripLoads: [base],
      candidate: far,
      driver,
      trailer,
      truck,
      start: driver.point,
    });

    expect(evaluation.corridor).toBe("detour");
    expect(evaluation.addedKm).toBeGreaterThan(50);
    expect(evaluation.warnings.join(" ")).toMatch(/outside the same corridor/i);
  });

  it("keeps a workable consolidation in the demo data", () => {
    // RS-4540 is light LTL freight on RS-4521's Milton→London lane. If this
    // stops being feasible the consolidation workflow has nothing to show.
    const evaluation = evaluateCoLoad({
      tripLoads: [load("L-4521")],
      candidate: load("L-4540"),
      driver,
      trailer,
      truck,
      start: driver.point,
    });

    expect(evaluation.feasible).toBe(true);
    expect(evaluation.corridor).toBe("same");
    expect(evaluation.addedKm).toBeLessThan(5);
    expect(evaluation.addedMinutes).toBeGreaterThan(0);
    expect(evaluation.weightAfterLbs).toBeLessThanOrEqual(trailer.capacityLbs);
    expect(evaluation.palletsAfter).toBeLessThanOrEqual(palletPositions(trailer));
    expect(evaluation.combined.lateStops).toBe(0);
  });

  it("reads every load riding on an assignment", () => {
    const assignment = state.assignments[0]!;
    expect(tripLoadIds(assignment)).toEqual([assignment.loadId]);
    expect(tripLoadIds({ ...assignment, addedLoadIds: ["L-4534"] })).toEqual([
      assignment.loadId,
      "L-4534",
    ]);
  });
});
