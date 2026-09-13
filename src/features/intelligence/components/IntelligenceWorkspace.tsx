import { AlertTriangle, Check, Clock3, RefreshCw, Route, ShieldAlert, TrafficCone, X } from "lucide-react";
import type { ReturnTypeOfDispatchOperations } from "../viewTypes";
import type { BackhaulSuggestion, OperationalException, ReplanImpact } from "../types";
import type { useRoadIntelligence } from "../hooks/useRoadIntelligence";
import { DEFAULT_OPTIMIZATION_WEIGHTS } from "../../dispatch/lib/optimizer";
import { CopilotPanel } from "./CopilotPanel";
import { FleetReplanPanel } from "./FleetReplanPanel";
import { TrafficContextPanel } from "./TrafficContextPanel";

type Intelligence = ReturnType<typeof useRoadIntelligence>;

const time = (value: string) => new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(new Date(value));

export function IntelligenceWorkspace({ ops, intelligence }: { ops: ReturnTypeOfDispatchOperations; intelligence: Intelligence }) {
  const acknowledged = new Set(ops.state.acknowledgedExceptionIds ?? []);
  const open = intelligence.exceptions.filter((item) => !acknowledged.has(item.id));
  const decided = new Set((ops.state.decisionLog ?? []).map((item) => item.id));
  const weights = ops.state.optimizationWeights ?? DEFAULT_OPTIMIZATION_WEIGHTS;

  return <div className="page intelligence-page fade-in">
    <div className="page-heading">
      <div><p className="kicker">DECISION INTELLIGENCE</p><h1>Exceptions and automatic re-planning</h1><p>Traffic, HOS, equipment and dwell risk in one approval-first queue.</p></div>
      <div className="heading-actions">
        <button className="btn secondary" onClick={() => void intelligence.refresh()} disabled={intelligence.loading}><RefreshCw />{intelligence.loading ? "Refreshing…" : "Refresh Ontario 511"}</button>
        <button className="btn primary" onClick={intelligence.injectClosure}><TrafficCone />Inject demo closure</button>
      </div>
    </div>

    <section className="surface optimizer-controls">
      <div><p className="kicker">OPERATOR PREFERENCES</p><h2>Recommendation weights</h2><p>Adjust what “best match” means. Hard safety and feasibility rules are never weakened.</p></div>
      <div>{(Object.keys(weights) as Array<keyof typeof weights>).map((key) => <label key={key}>{key === "hosBuffer" ? "HOS buffer" : key === "futurePosition" ? "Future position" : key[0].toUpperCase() + key.slice(1)}<input aria-label={`${key} recommendation weight`} type="range" min="0" max="100" value={weights[key]} onChange={(event) => ops.setOptimizationWeights({ ...weights, [key]: Number(event.target.value) })} /><b>{weights[key]}</b></label>)}</div>
      <button className="btn compact secondary" onClick={() => ops.setOptimizationWeights(DEFAULT_OPTIMIZATION_WEIGHTS)}>Reset weights</button>
    </section>

    <div className="p1-summary" aria-label="Intelligence summary">
      <span><AlertTriangle /><b>{open.length}</b><small>open exceptions</small></span>
      <span><Route /><b>{intelligence.impacts.length}</b><small>plans affected</small></span>
      <span><Clock3 /><b>{intelligence.backhauls.length}</b><small>backhaul options</small></span>
      <span><TrafficCone /><b>{intelligence.traffic.incidents.length}</b><small>{intelligence.traffic.source === "ontario-511" ? "Ontario 511 events" : "demo events"}</small></span>
    </div>

    {ops.memberRole !== "driver" && <CopilotPanel ops={ops} intelligence={intelligence} />}

    <div className="intelligence-grid">
      <section className="surface intelligence-panel">
        <div className="section-head"><div><p className="kicker">ACTION QUEUE</p><h2>Exceptions inbox</h2></div><span className="badge amber">{open.length} open</span></div>
        {!open.length && <div className="empty-state"><Check /> Nothing requires acknowledgement.</div>}
        {open.map((item: OperationalException) => <article className="exception-row" key={item.id}>
          <span className={item.severity === "critical" ? "risk critical" : "risk"}><ShieldAlert /></span>
          <div><div><b>{item.title}</b><span className={`badge ${item.severity === "critical" ? "red" : "amber"}`}>{item.severity}</span></div><p>{item.detail}</p><small>Next action: {item.recommendedAction}</small></div>
          <button className="btn compact secondary" onClick={() => ops.acknowledgeException(item)}>Acknowledge</button>
        </article>)}
      </section>

      <section className="surface intelligence-panel">
        <div className="section-head"><div><p className="kicker">APPROVAL REQUIRED</p><h2>Re-plan impacts</h2></div></div>
        {!intelligence.impacts.length && <div className="empty-state">No active route currently intersects a reported incident. Inject a demo closure to test the workflow.</div>}
        {intelligence.impacts.map((impact: ReplanImpact) => {
          const accepted = decided.has(`${impact.id}:accepted`), rejected = decided.has(`${impact.id}:rejected`);
          return <article className="decision-card" key={impact.id}>
            <div><span className={`badge ${impact.risk === "monitor" ? "amber" : "red"}`}>{impact.risk}</span><b>ETA {time(impact.originalEta)} → {time(impact.projectedEta)}</b><strong>+{impact.addedDelayMinutes} min</strong></div>
            <p>{impact.recommendation}</p><small>{impact.deliverySlackMinutes} min delivery margin · {impact.hosMarginHours.toFixed(1)} h HOS margin</small>
            <div className="decision-actions">
              <button className="btn compact primary" disabled={accepted || rejected} onClick={() => ops.resolveReplan(impact, "accepted")}><Check />Approve ETA</button>
              <button className="btn compact secondary" disabled={accepted || rejected} onClick={() => ops.resolveReplan(impact, "rejected")}><X />Keep current plan</button>
              {(accepted || rejected) && <span role="status">Decision recorded: {accepted ? "approved" : "rejected"}</span>}
            </div>
          </article>;
        })}
      </section>
    </div>

    <FleetReplanPanel ops={ops} incidents={intelligence.traffic.incidents} />
    <TrafficContextPanel onConstruction={intelligence.setConstruction} />
    {ops.actionError && <p className="save-notice" role="alert">{ops.actionError}</p>}
    <section className="surface intelligence-panel backhaul-panel">
      <div className="section-head"><div><p className="kicker">NEXT-LOAD ASSISTANT</p><h2>Deadhead and backhaul opportunities</h2></div><small>Suggestions never change dispatch state without approval.</small></div>
      <div className="backhaul-grid">
        {!intelligence.backhauls.length && <p>No feasible unreserved successors at the current ETAs and HOS clocks.</p>}
        {intelligence.backhauls.slice(0, 6).map((suggestion: BackhaulSuggestion) => {
          const load = ops.state.loads.find((item) => item.id === suggestion.loadId);
          const accepted = decided.has(`${suggestion.id}:accepted`), rejected = decided.has(`${suggestion.id}:rejected`);
          return <article key={suggestion.id}>
            <div><span className="score">{suggestion.score}</span><div><b>{load?.billNumber}</b><small>match score</small></div></div>
            <p>{suggestion.explanation}</p>
            <dl><div><dt>Potentially avoided</dt><dd>{Math.round(suggestion.avoidedEmptyKm)} km</dd></div><div><dt>Reposition</dt><dd>{Math.round(suggestion.repositionKm)} km</dd></div><div><dt>HOS after</dt><dd>{suggestion.projectedHosMargin.toFixed(1)} h</dd></div></dl>
            <div className="decision-actions"><button className="btn compact primary" disabled={accepted || rejected} onClick={() => ops.resolveBackhaul(suggestion, "accepted")}>Reserve next</button><button className="btn compact secondary" disabled={accepted || rejected} onClick={() => ops.resolveBackhaul(suggestion, "rejected")}>Dismiss</button></div>
          </article>;
        })}
      </div>
      <h3>Reserved successors</h3>
      {!(ops.state.backhaulReservations ?? []).length && <p>No backhauls reserved.</p>}
      {(ops.state.backhaulReservations ?? []).map(reservation => <article className="decision-card" key={reservation.id}>
        <b>{reservation.loadId} reserved after {reservation.assignmentId}</b>
        <p>Estimated availability {time(reservation.availableAt)} · completion {time(reservation.projectedEta)}. Dispatch will recheck actual clocks and equipment.</p>
        <div className="decision-actions"><button className="btn primary" disabled={!ops.canManageDispatch || !ops.state.assignments.some(a => a.id === reservation.assignmentId && a.status === "completed")} onClick={() => ops.updateBackhaulReservation(reservation.id, "dispatch")}>Dispatch reserved load</button>
          <button className="btn secondary" disabled={!ops.canManageDispatch} onClick={() => ops.updateBackhaulReservation(reservation.id, "cancel")}>Cancel reservation</button></div>
      </article>)}
    </section>

    <section className="surface decision-log">
      <div className="section-head"><div><p className="kicker">AUDIT TRAIL</p><h2>Decision log</h2></div></div>
      {!(ops.state.decisionLog ?? []).length ? <div className="empty-state">Approved, rejected and acknowledged recommendations appear here.</div> :
        <div className="table-list">{[...(ops.state.decisionLog ?? [])].reverse().map((record) => <div key={record.id}><span className={`badge ${record.outcome === "accepted" ? "green" : record.outcome === "rejected" ? "red" : "blue"}`}>{record.outcome}</span><b>{record.summary}</b><time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString("en-CA")}</time></div>)}</div>}
    </section>
  </div>;
}
