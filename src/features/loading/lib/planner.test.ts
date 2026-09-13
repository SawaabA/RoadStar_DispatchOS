import { describe, expect, it } from "vitest";
import { createPlan, validatePlanInput } from "./planner";
import type { Load, Trailer } from "../types";

const trailer: Trailer = { id: "QA", lengthIn: 120, widthIn: 80, heightIn: 90, capacityLbs: 5000, frontAxleLimitLbs: 0, rearAxleLimitLbs: 0, axleDistanceIn: 0 };
const load: Load = { id: "QA-L", origin: "A", destination: "B", weightLbs: 1000, pallets: 1, stop: 1, description: "QA", palletLengthIn: 60, palletWidthIn: 30, palletHeightIn: 55, rotatable: false, stackable: false, bearingLimitLbs: 0 };

describe("browser loading plan", () => {
  it("uses the shipment pallet dimensions", () => {
    const plan = createPlan([load], trailer);
    expect(plan.items[0]).toMatchObject({ length: 60, width: 30, height: 55 });
  });

  it("rejects zero pallets and non-positive weights", () => {
    expect(validatePlanInput([{ ...load, pallets: 0, weightLbs: 0 }], trailer)).toEqual([
      "QA-L must have at least one pallet.",
      "QA-L weight must be greater than zero.",
    ]);
  });

  it("rotates only when allowed and never places freight outside the trailer", () => {
    const rotatable = createPlan(
      [{ ...load, palletLengthIn: 90, palletWidthIn: 60, rotatable: true }],
      { ...trailer, lengthIn: 70, widthIn: 100 },
    );
    expect(rotatable.items[0]).toMatchObject({
      length: 60,
      width: 90,
      rotated: true,
    });

    const impossible = createPlan(
      [{ ...load, palletWidthIn: 100, palletHeightIn: 100, rotatable: false }],
      trailer,
    );
    expect(impossible.items).toHaveLength(0);
    expect(impossible.unplanned).toHaveLength(1);
  });

  it("keeps every multi-pallet placement in bounds without floor overlap", () => {
    const plan = createPlan([{ ...load, pallets: 4, weightLbs: 4000 }], trailer);
    expect(plan.unplanned).toHaveLength(0);
    for (const item of plan.items) {
      expect(item.x + item.length).toBeLessThanOrEqual(trailer.lengthIn);
      expect(item.y + item.width).toBeLessThanOrEqual(trailer.widthIn);
      expect(item.z + item.height).toBeLessThanOrEqual(trailer.heightIn);
    }
    for (let left = 0; left < plan.items.length; left += 1) {
      for (let right = left + 1; right < plan.items.length; right += 1) {
        const a = plan.items[left];
        const b = plan.items[right];
        const separated =
          a.x + a.length <= b.x ||
          b.x + b.length <= a.x ||
          a.y + a.width <= b.y ||
          b.y + b.width <= a.y;
        expect(separated).toBe(true);
      }
    }
  });

  it("creates real vertical layers for compatible stackable freight", () => {
    const plan = createPlan([
      { ...load, pallets: 2, weightLbs: 2000, palletLengthIn: 60, palletWidthIn: 40, palletHeightIn: 40, stackable: true, bearingLimitLbs: 1500 },
    ], { ...trailer, lengthIn: 60, widthIn: 40 });

    expect(plan.unplanned).toHaveLength(0);
    expect(plan.items.map((item) => item.z).sort((a, b) => a - b)).toEqual([0, 40]);
    expect(plan.usedFloorArea).toBe(2400);
  });

  it("rejects concentrated cargo that exceeds its floor-bearing limit", () => {
    const plan = createPlan([{ ...load, weightLbs: 4000, palletLengthIn: 24, palletWidthIn: 24, floorBearingPsf: 500 }], trailer);
    expect(plan.items).toHaveLength(0);
    expect(plan.unplanned[0].unplannedReason).toMatch(/floor load/i);
  });

  it("keeps a large mixed manifest within physical limits", () => {
    const manifest = Array.from({ length: 20 }, (_, index): Load => ({
      ...load,
      id: `MIX-${index}`,
      pallets: 2,
      weightLbs: 1200,
      palletLengthIn: index % 3 === 0 ? 60 : 48,
      palletWidthIn: index % 2 === 0 ? 40 : 36,
      palletHeightIn: 40,
      stop: (index % 4) + 1,
      rotatable: true,
      stackable: true,
      bearingLimitLbs: 1800,
      fragile: index % 7 === 0,
    }));
    const plan = createPlan(manifest, { ...trailer, lengthIn: 636, widthIn: 98, heightIn: 102, capacityLbs: 44500 }, "damage");
    expect(plan.totalWeight).toBeLessThanOrEqual(44500);
    for (const item of plan.items) {
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.z).toBeGreaterThanOrEqual(0);
      expect(item.x + item.length).toBeLessThanOrEqual(636);
      expect(item.y + item.width).toBeLessThanOrEqual(98);
      expect(item.z + item.height).toBeLessThanOrEqual(102);
    }
  });
});
