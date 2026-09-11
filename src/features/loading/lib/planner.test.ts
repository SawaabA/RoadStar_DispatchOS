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
});
