import { describe, expect, it } from "vitest";
import { createDemoState } from "../../dispatch/data/demoData";
import { reserveBackhaul, cancelBackhaul, dispatchBackhaul } from "./backhaul";
import { buildBackhaulSuggestions } from "./intelligence";

describe("backhaul reservations", () => {
  it("reserves the suggested load and protects it from duplicate suggestions", () => {
    const state = createDemoState();
    const suggestion = buildBackhaulSuggestions(state)[0];
    expect(suggestion).toBeDefined();
    const reserved = reserveBackhaul(state, suggestion.assignmentId, suggestion.loadId, Date.now());
    expect(reserved.loads.find(l => l.id === suggestion.loadId)?.status).toBe("assigned");
    expect(reserved.backhaulReservations).toHaveLength(1);
    expect(buildBackhaulSuggestions(reserved).some(s => s.loadId === suggestion.loadId)).toBe(false);
  });

  it("cancels a reservation without touching the predecessor", () => {
    const state = createDemoState();
    const suggestion = buildBackhaulSuggestions(state)[0];
    const reserved = reserveBackhaul(state, suggestion.assignmentId, suggestion.loadId);
    const cancelled = cancelBackhaul(reserved, reserved.backhaulReservations![0].id);
    expect(cancelled.loads.find(l => l.id === suggestion.loadId)?.status).toBe("unassigned");
    expect(cancelled.assignments).toEqual(state.assignments);
  });

  it("requires predecessor completion and a fresh feasibility check before dispatch", () => {
    const state = createDemoState();
    const suggestion = buildBackhaulSuggestions(state)[0];
    const reserved = reserveBackhaul(state, suggestion.assignmentId, suggestion.loadId);
    const blocked = dispatchBackhaul(reserved, reserved.backhaulReservations![0].id);
    expect(blocked).toBe(reserved);
    const completed = { ...reserved, assignments: reserved.assignments.map(a => a.id === suggestion.assignmentId ? { ...a, status: "completed" as const } : a) };
    const dispatched = dispatchBackhaul(completed, completed.backhaulReservations![0].id, Date.now());
    expect(dispatched.loads.find(l => l.id === suggestion.loadId)?.status).toBe("assigned");
    expect(dispatched.assignments.some(a => a.loadId === suggestion.loadId)).toBe(true);
  });
});
