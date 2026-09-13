import { describe, expect, it } from "vitest";
import { createDemoState } from "../data/demoData";
import { evaluateCandidate } from "./optimizer";
import { assignCandidate, transitionDriverAssignment, unassignLoad } from "./stateTransitions";

const eligibleCandidate = () => {
  const state = createDemoState();
  const load = state.loads.find((item) => item.id === "L-4521")!;
  const driver = state.drivers.find((item) => item.id === "D-113")!;
  const trailer = state.trailers.find((item) => item.id === driver.trailerId)!;
  const truck = state.trucks.find((item) => item.id === driver.truckId)!;
  return { state, candidate: evaluateCandidate(load, driver, trailer, truck) };
};

describe("atomic dispatch transitions", () => {
  it("assigns all paired resources and can safely undo before transit", () => {
    const { state, candidate } = eligibleCandidate();
    const assigned = assignCandidate(state, candidate);

    expect(assigned).not.toBe(state);
    expect(assigned.loads.find((item) => item.id === candidate.loadId)?.status).toBe(
      "assigned",
    );
    expect(assigned.drivers.find((item) => item.id === candidate.driverId)?.status).toBe(
      "assigned",
    );
    expect(assigned.assignments).toHaveLength(state.assignments.length + 1);

    const restored = unassignLoad(assigned, candidate.loadId);
    expect(restored.loads.find((item) => item.id === candidate.loadId)?.status).toBe(
      "unassigned",
    );
    expect(restored.drivers.find((item) => item.id === candidate.driverId)?.status).toBe(
      "available",
    );
  });

  it("rejects a stale repeated assignment and protects active trips from unassign", () => {
    const { state, candidate } = eligibleCandidate();
    const assigned = assignCandidate(state, candidate);

    expect(assignCandidate(assigned, candidate)).toBe(assigned);
    expect(unassignLoad(state, "L-4509")).toBe(state);
  });

  it("allows only the assigned driver to accept, start, or decline in sequence", () => {
    const { state, candidate } = eligibleCandidate();
    const assigned = assignCandidate(state, candidate);
    const assignment = assigned.assignments.find((item) => item.loadId === candidate.loadId)!;

    expect(transitionDriverAssignment(assigned, assignment.id, "D-NOT-OWNER", "accepted")).toBe(assigned);
    expect(transitionDriverAssignment(assigned, assignment.id, candidate.driverId, "in_transit")).toBe(assigned);

    const accepted = transitionDriverAssignment(assigned, assignment.id, candidate.driverId, "accepted", 1_000);
    expect(accepted.assignments.find((item) => item.id === assignment.id)?.status).toBe("accepted");
    const started = transitionDriverAssignment(accepted, assignment.id, candidate.driverId, "in_transit", 2_000);
    expect(started.assignments.find((item) => item.id === assignment.id)?.status).toBe("in_transit");
    expect(started.loads.find((item) => item.id === candidate.loadId)?.status).toBe("in_transit");

    const declined = transitionDriverAssignment(assigned, assignment.id, candidate.driverId, "declined", 3_000);
    expect(declined.assignments.some((item) => item.id === assignment.id)).toBe(false);
    expect(declined.loads.find((item) => item.id === candidate.loadId)?.status).toBe("unassigned");
  });
});
