import { describe, expect, it } from "vitest";
import { estimatePalletDisplacement } from "./palletEquivalents";

const trailer = { id: "DV", lengthIn: 636, widthIn: 98, heightIn: 102, capacityLbs: 44500, frontAxleLimitLbs: 12000, rearAxleLimitLbs: 34000, axleDistanceIn: 480 };

describe("irregular cargo pallet displacement", () => {
  it("accounts for clearance and discrete floor positions", () => {
    const estimate = estimatePalletDisplacement({ lengthIn: 144, widthIn: 60, heightIn: 84, weightLbs: 9000, quantity: 1, clearanceIn: 3, rotatable: true }, trailer);
    expect(estimate.fitsEnvelope).toBe(true);
    expect(estimate.palletEquivalents).toBeGreaterThanOrEqual(8);
  });
  it("rejects cargo outside the trailer envelope", () => {
    expect(estimatePalletDisplacement({ lengthIn: 100, widthIn: 100, heightIn: 80, weightLbs: 1000, quantity: 1, clearanceIn: 0, rotatable: false }, trailer).fitsEnvelope).toBe(false);
  });
  it("rejects invalid operator input", () => {
    expect(() => estimatePalletDisplacement({ lengthIn: 0, widthIn: 40, heightIn: 40, weightLbs: 1, quantity: 1, clearanceIn: 0, rotatable: true }, trailer)).toThrow();
  });
});
