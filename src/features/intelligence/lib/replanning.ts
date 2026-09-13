import { buildMorningPlan, type PlanningContext } from "../../dispatch/lib/optimizer";
import { assignCandidate, unassignLoad } from "../../dispatch/lib/stateTransitions";
import type { DispatchState, PlanProposal } from "../../dispatch/types";
import type { RoadIncident } from "../types";
import { distanceToSegmentKm } from "./intelligence";

export type FleetReplan = { plan: PlanProposal; fingerprint: string; incidents: RoadIncident[]; released: string[]; locked: number; changes: string[] };
// Include all operational state: proposals must not overwrite telemetry, load edits,
// new reservations or a driver's acceptance that arrived after preview.
export const planningFingerprint = (state: DispatchState) => JSON.stringify(state);

export function trafficContext(incidents: RoadIncident[], now: number): PlanningContext {
  return { now, routeImpact: (load, driver) => {
    const relevant = incidents.filter(i => distanceToSegmentKm(i.point, driver.point, load.originPoint) < 5 || distanceToSegmentKm(i.point, load.originPoint, load.destinationPoint) < 5);
    return { blocked: relevant.some(i => i.fullClosure), delayMinutes: relevant.reduce((sum, i) => sum + (i.severity === "high" || i.severity === "critical" ? 24 : i.severity === "medium" ? 14 : 7), 0) };
  } };
}

function releaseUnstarted(state: DispatchState) {
  // Accepted/on-road work and predecessors with reservations remain locked.
  const released = state.assignments.filter(a => ["proposed", "dispatched"].includes(a.status) && !state.backhaulReservations?.some(r => r.assignmentId === a.id)).map(a => a.loadId);
  return { released, state: released.reduce((next, id) => unassignLoad(next, id), state) };
}

export function buildFleetReplan(current: DispatchState, incidents: RoadIncident[], now = Date.now()): FleetReplan {
  const { state, released } = releaseUnstarted(current);
  const plan = buildMorningPlan(state.loads, state.drivers, state.trailers, { ...trafficContext(incidents, now),
    trucks: state.trucks, assignments: state.assignments, reservations: state.backhaulReservations, weights: state.optimizationWeights });
  const changes = plan.candidates.map(c => {
    const prior = current.assignments.find(a => a.loadId === c.loadId);
    return `${c.loadId}: ${prior?.driverId ?? "unassigned"} → ${c.driverId}; ${c.deadheadKm.toFixed(0)} km deadhead; ${c.hosRemainingAfter.toFixed(1)} h HOS reserve`;
  });
  return { plan, fingerprint: planningFingerprint(current), incidents: structuredClone(incidents), released,
    locked: state.assignments.filter(a => a.status !== "completed").length, changes };
}

export function applyFleetReplan(current: DispatchState, proposal: FleetReplan, now = Date.now()): DispatchState {
  if (planningFingerprint(current) !== proposal.fingerprint || now - Date.parse(proposal.plan.generatedAt) > 60_000) return current;
  let next = releaseUnstarted(current).state;
  for (const candidate of proposal.plan.candidates) {
    const assigned = assignCandidate(next, candidate, "proposed", now, trafficContext(proposal.incidents, now));
    if (assigned === next) return current; // All-or-nothing even if a deadline expired.
    next = assigned;
  }
  return { ...next, decisionLog: [...(next.decisionLog ?? []), {
    id: `${proposal.plan.id}:fleet`, kind: "replan", outcome: "accepted", createdAt: new Date(now).toISOString(),
    summary: `Applied fleet re-plan: ${proposal.plan.candidates.length} proposed assignments; ${proposal.plan.rejectedLoads.length} unassigned; ${proposal.locked} accepted/on-road or reserved trips protected.`,
  }].slice(-500) as DispatchState["decisionLog"] };
}
