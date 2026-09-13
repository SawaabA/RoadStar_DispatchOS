import { describe, expect, it } from "vitest";
import { createDemoState } from "../../dispatch/data/demoData";
import { buildFleetReplan, applyFleetReplan } from "./replanning";
import { createInjectedClosure } from "./trafficProvider";

describe("fleet re-planning", () => {
  it("protects accepted work and returns a deterministic proposal", () => {
    const state = createDemoState();
    const locked = { ...state, assignments: state.assignments.map((a, i) => i === 0 ? { ...a, status: "in_transit" as const } : a) };
    const proposal = buildFleetReplan(locked, [createInjectedClosure()], Date.now());
    expect(proposal.locked).toBeGreaterThanOrEqual(1);
    expect(proposal.fingerprint).toBe(JSON.stringify(locked));
    expect(proposal.plan.candidates.every(c => c.driverId !== locked.assignments[0].driverId)).toBe(true);
  });

  it("rejects stale proposals instead of overwriting a newer dispatch state", () => {
    const state = createDemoState();
    const proposal = buildFleetReplan(state, [], Date.now());
    const changed = { ...state, decisionLog: [{ id: "new", kind: "plan" as const, outcome: "accepted" as const, summary: "newer", createdAt: new Date().toISOString() }] };
    expect(applyFleetReplan(changed, proposal)).toBe(changed);
  });
});
