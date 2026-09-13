import { describe, expect, it } from "vitest";
import { createDemoState } from "../data/demoData";
import { evaluateCandidate } from "./optimizer";
import { tripLoadIds } from "./tripPlanning";
import { addLoadToTrip, assignCandidate, transitionDriverAssignment, unassignLoad } from "./stateTransitions";
import type { DispatchState } from "../types";

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

// A second dry-van load out of the same shipper, light enough to share the
// trailer, is the realistic consolidation case.
const consolidatableState = (): DispatchState => {
  const base = createDemoState();
  const source = base.loads.find((item) => item.id === "L-4534")!;
  const primary = base.loads.find((item) => item.id === "L-4521")!;
  return {
    ...base,
    loads: base.loads.map((item) =>
      item.id === source.id
        ? {
            ...item,
            weightLbs: 8_000,
            pallets: 5,
            origin: primary.origin,
            originPoint: primary.originPoint,
            destination: primary.destination,
            destinationPoint: primary.destinationPoint,
          }
        : item,
    ),
  };
};

describe("consolidating freight onto one trip", () => {
  const setUp = () => {
    const state = consolidatableState();
    const load = state.loads.find((item) => item.id === "L-4521")!;
    const driver = state.drivers.find((item) => item.id === "D-113")!;
    const trailer = state.trailers.find((item) => item.id === driver.trailerId)!;
    const truck = state.trucks.find((item) => item.id === driver.truckId)!;
    const assigned = assignCandidate(state, evaluateCandidate(load, driver, trailer, truck));
    return { assigned, assignmentId: assigned.assignments.find((item) => item.loadId === load.id)!.id };
  };

  it("adds a compatible load to a trip that has not started", () => {
    const { assigned, assignmentId } = setUp();
    const consolidated = addLoadToTrip(assigned, assignmentId, "L-4534");
    const assignment = consolidated.assignments.find((item) => item.id === assignmentId)!;

    expect(tripLoadIds(assignment)).toEqual(["L-4521", "L-4534"]);
    expect(consolidated.loads.find((item) => item.id === "L-4534")?.status).toBe("assigned");
    // One truck, one driver, one trailer: consolidation never creates a second trip.
    expect(consolidated.assignments).toHaveLength(assigned.assignments.length);
    expect(consolidated.decisionLog?.at(-1)?.summary).toMatch(/Consolidated RS-4534/);
  });

  it("refuses freight the trip cannot legally take, and refuses it twice", () => {
    const { assigned, assignmentId } = setUp();
    // A reefer load can never ride in the dry van already on this trip.
    expect(addLoadToTrip(assigned, assignmentId, "L-4528")).toBe(assigned);
    const consolidated = addLoadToTrip(assigned, assignmentId, "L-4534");
    expect(addLoadToTrip(consolidated, assignmentId, "L-4534")).toBe(consolidated);
  });

  it("keeps the trip running when one consolidated load is removed", () => {
    const { assigned, assignmentId } = setUp();
    const consolidated = addLoadToTrip(assigned, assignmentId, "L-4534");
    const reduced = unassignLoad(consolidated, "L-4534");
    const assignment = reduced.assignments.find((item) => item.id === assignmentId)!;

    expect(tripLoadIds(assignment)).toEqual(["L-4521"]);
    expect(reduced.loads.find((item) => item.id === "L-4534")?.status).toBe("unassigned");
    expect(reduced.drivers.find((item) => item.id === assignment.driverId)?.status).toBe("assigned");
  });

  it("promotes the remaining freight when the first load is removed", () => {
    const { assigned, assignmentId } = setUp();
    const consolidated = addLoadToTrip(assigned, assignmentId, "L-4534");
    const reduced = unassignLoad(consolidated, "L-4521");
    const assignment = reduced.assignments.find((item) => item.id === assignmentId)!;

    expect(assignment.loadId).toBe("L-4534");
    expect(assignment.addedLoadIds).toEqual([]);
    expect(reduced.loads.find((item) => item.id === "L-4521")?.status).toBe("unassigned");
  });

  it("releases the unit only when the last load leaves the trip", () => {
    const { assigned, assignmentId } = setUp();
    const consolidated = addLoadToTrip(assigned, assignmentId, "L-4534");
    const assignment = consolidated.assignments.find((item) => item.id === assignmentId)!;
    const emptied = tripLoadIds(assignment).reduce(
      (state, loadId) => unassignLoad(state, loadId),
      consolidated,
    );

    expect(emptied.assignments.some((item) => item.id === assignmentId)).toBe(false);
    expect(emptied.drivers.find((item) => item.id === assignment.driverId)?.status).toBe("available");
    expect(emptied.trailers.find((item) => item.id === assignment.trailerId)?.status).toBe("available");
  });

  it("moves and returns every load on the trip when the driver accepts or declines", () => {
    const { assigned, assignmentId } = setUp();
    const consolidated = addLoadToTrip(assigned, assignmentId, "L-4534");
    const driverId = consolidated.assignments.find((item) => item.id === assignmentId)!.driverId;

    const accepted = transitionDriverAssignment(consolidated, assignmentId, driverId, "accepted", 1_000);
    const started = transitionDriverAssignment(accepted, assignmentId, driverId, "in_transit", 2_000);
    expect(started.loads.filter((item) => item.status === "in_transit").map((item) => item.id)).toEqual(
      expect.arrayContaining(["L-4521", "L-4534"]),
    );

    const declined = transitionDriverAssignment(consolidated, assignmentId, driverId, "declined", 3_000);
    expect(declined.assignments.some((item) => item.id === assignmentId)).toBe(false);
    expect(
      declined.loads.filter((item) => ["L-4521", "L-4534"].includes(item.id)).map((item) => item.status),
    ).toEqual(["unassigned", "unassigned"]);
  });
});
