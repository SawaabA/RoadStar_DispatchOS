import { useState } from "react";
import { buildFleetReplan, type FleetReplan } from "../lib/replanning";
import type { RoadIncident } from "../types";
import type { ReturnTypeOfDispatchOperations } from "../viewTypes";

export function FleetReplanPanel({ ops, incidents }: { ops: ReturnTypeOfDispatchOperations; incidents: RoadIncident[] }) {
  const [proposal, setProposal] = useState<FleetReplan | null>(null);
  const [notice, setNotice] = useState("");
  const trafficChanged = proposal && JSON.stringify(proposal.incidents) !== JSON.stringify(incidents);
  return <section className="surface intelligence-panel" aria-label="Fleet re-planning">
    <div className="section-head"><div><p className="kicker">FLEET ASSIGNMENTS</p><h2>Recompute the dispatch plan</h2></div>
      <button className="btn primary" disabled={!ops.canManageDispatch} onClick={() => { setProposal(buildFleetReplan(ops.state, incidents)); setNotice(""); }}>Generate fleet re-plan</button></div>
    <p>Reassign unstarted work and cover open loads. Accepted trips, on-road cargo and reserved successors remain protected. Full closures block intersecting estimated corridors until a verified alternative is available.</p>
    {proposal && <><p>{proposal.plan.candidates.length} assignments proposed · {proposal.plan.rejectedLoads.length} loads remain open · {proposal.locked} trips protected · {proposal.plan.projectedDeadheadKm.toFixed(0)} km estimated deadhead</p>
      <ul>{proposal.changes.map(change => <li key={change}>{change}</li>)}</ul>
      {proposal.plan.rejectedLoads.map(row => <p key={row.loadId}><strong>{row.loadId} remains open:</strong> {row.reasons.join(" ")}</p>)}
      <button className="btn primary" disabled={!ops.canManageDispatch || Boolean(trafficChanged)} onClick={() => { if (ops.applyReplanProposal(proposal)) { setProposal(null); setNotice("Fleet re-plan applied. Review the proposed assignments in dispatch."); } }}>Apply fleet re-plan</button>
      {trafficChanged && <p role="status">Traffic changed. Generate a fresh proposal.</p>}
    </>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
