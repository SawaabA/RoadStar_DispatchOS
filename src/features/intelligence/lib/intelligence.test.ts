import { describe, expect, it } from "vitest";
import { createDemoState } from "../../dispatch/data/demoData";
import { buildBackhaulSuggestions, buildReplanImpacts, deriveExceptions } from "./intelligence";
import { createInjectedClosure } from "./trafficProvider";

describe("dispatch intelligence", () => {
  it("deduplicates actionable operational exceptions", () => {
    const exceptions = deriveExceptions(createDemoState(), []);
    expect(exceptions.some((item) => item.type === "equipment")).toBe(true);
    expect(exceptions.some((item) => item.type === "detention")).toBe(true);
    expect(new Set(exceptions.map((item) => item.id)).size).toBe(exceptions.length);
  });

  it("turns a corridor closure into explainable re-plan impact", () => {
    const impacts = buildReplanImpacts(createDemoState(), [createInjectedClosure()]);
    expect(impacts.length).toBeGreaterThan(0);
    expect(impacts[0].addedDelayMinutes).toBe(35);
    expect(impacts[0].recommendation.length).toBeGreaterThan(20);
  });

  it("finds feasible downstream freight without mutating dispatch state", () => {
    const state = createDemoState();
    const before = JSON.stringify(state);
    const suggestions = buildBackhaulSuggestions(state);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((item) => item.projectedHosMargin >= 0)).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
  });
});
