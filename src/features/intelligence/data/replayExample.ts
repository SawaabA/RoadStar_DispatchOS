import { createDemoState, cityPoints } from "../../dispatch/data/demoData";
import type { ReplayDataset } from "../lib/replay";

export function createReplayExample(): ReplayDataset {
  const state = createDemoState();
  const at = (hour: number) => `2026-09-14T${String(hour).padStart(2, "0")}:00:00.000Z`;
  state.assignments = []; state.visits = []; state.incidents = []; state.decisionLog = [];
  state.loads = [0, 1, 2].map((n) => ({ ...state.loads[0], id: `REPLAY-${n + 1}`, billNumber: `EXAMPLE-${n + 1}`,
    originPoint: n === 2 ? cityPoints.London : cityPoints.Milton, destinationPoint: n === 2 ? cityPoints.Milton : cityPoints.London,
    origin: n === 2 ? "London" : "Milton", destination: n === 2 ? "Milton" : "London", status: "unassigned",
    pickupStart: at(n === 2 ? 13 : 8), pickupEnd: at(n === 2 ? 15 : 10), deliveryEnd: at(n === 2 ? 19 : 13), equipment: "Dry Van", temperatureControlled: false,
    weightLbs: 10_000, additionalStops: [], cargoItems: [] }));
  state.drivers = state.drivers.slice(0, 2).map(d => ({ ...d, status: "available", nextAvailable: "Now", dutyStatus: "off_duty", point: cityPoints.Milton,
    drivingHoursRemaining: 13, onDutyHoursRemaining: 14, cycleHoursRemaining: 60 }));
  state.trucks = state.trucks.filter(t => state.drivers.some(d => d.truckId === t.id)).map(t => ({ ...t, status: "available", point: cityPoints.Milton }));
  state.trailers = state.trailers.filter(t => state.drivers.some(d => d.trailerId === t.id)).map(t => ({ ...t, status: "available", type: "Dry Van" }));
  return { version: 1, name: "Synthetic three-load shift — not RoadStar historical results", startedAt: at(8), endedAt: at(20), initialState: state,
    releases: state.loads.map((l, n) => ({ loadId: l.id, at: at(n === 2 ? 13 : 8) })),
    actual: state.loads.slice(0, 2).map((l, n) => ({ loadId: l.id, driverId: state.drivers[n].id, assignedAt: at(8), completedAt: at(12), emptyKm: 40, hosRisk: false, detentionMinutes: 10, planningSeconds: 120 })) };
}
