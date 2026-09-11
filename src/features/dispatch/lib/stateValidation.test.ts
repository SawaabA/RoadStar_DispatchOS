import { describe, expect, it } from "vitest";
import { createDemoState } from "../data/demoData";
import { isDispatchState } from "./stateValidation";

describe("dispatch state validation", () => {
  it("accepts the complete demo state", () => {
    expect(isDispatchState(createDemoState())).toBe(true);
  });

  it("rejects malformed and orphaned persisted state", () => {
    expect(isDispatchState({ loads: [] })).toBe(false);
    const state = createDemoState();
    state.assignments[0] = { ...state.assignments[0], truckId: "MISSING" };
    expect(isDispatchState(state)).toBe(false);
  });
});
