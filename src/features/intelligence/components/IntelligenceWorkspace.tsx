import { AlertTriangle, Check, Clock3, Eye, RefreshCw, Route, ShieldAlert, SlidersHorizontal, TrafficCone, X } from "lucide-react";
import type { ReturnTypeOfDispatchOperations } from "../viewTypes";
import type { BackhaulSuggestion, OperationalException, ReplanImpact } from "../types";
import type { useRoadIntelligence } from "../hooks/useRoadIntelligence";
import { DEFAULT_OPTIMIZATION_WEIGHTS } from "../../dispatch/lib/optimizer";
import { CopilotPanel } from "./CopilotPanel";

type Intelligence = ReturnType<typeof useRoadIntelligence>;

const time = (value: string) => new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(new Date(value));

const WEIGHT_COPY: Record<string, { label: string; help: string }> = {
  deadhead: { label: "Short empty drive", help: "Prefer the truck that is already closest to the pickup." },
  onTime: { label: "Appointment safety", help: "Prefer the unit with the most room before the window closes." },
  hosBuffer: { label: "Hours-of-service buffer", help: "Prefer the driver who finishes with legal hours to spare." },
  futurePosition: { label: "Where it finishes", help: "Prefer a delivery point with more RoadStar freight nearby." },
};

export function IntelligenceWorkspace({ ops, intelligence }: { ops: ReturnTypeOfDispatchOperations; intelligence: Intelligence }) {
  const acknowledged = new Set(ops.state.acknowledgedExceptionIds ?? []);
  const open = intelligence.exceptions.filter((item) => !acknowledged.has(item.id));
  const decided = new Set((ops.state.decisionLog ?? []).map((item) => item.id));
  const weights = ops.state.optimizationWeights ?? DEFAULT_OPTIMIZATION_WEIGHTS;

  return <div className="page intelligence-page fade-in">
    <div className="page-heading">
      <div>
        <p className="kicker">DISPATCH WATCHTOWER</p>
        <h1>What needs a decision</h1>
        <p>RoadStar keeps re-checking every load, driver clock, dock timer and Ontario 511 road event. Anything a person has to decide arrives here with the numbers behind it — and nothing changes the plan until you say so.</p>
      </div>
      <div className="heading-actions">
        <button className="btn secondary" onClick={() => void intelligence.refresh()} disabled={intelligence.loading}><RefreshCw />{intelligence.loading ? "Refreshing…" : "Refresh Ontario 511"}</button>
        <button className="btn primary" onClick={intelligence.injectClosure}><TrafficCone />Inject demo closure</button>
      </div>
    </div>

    <ol className="how-it-works" aria-label="How this page works">
      <li><span><Eye /></span><div><b>1 · RoadStar watches</b><p>Open loads, HOS clocks, dock dwell and provincial traffic are re-evaluated continuously — no tab switching, no check calls.</p></div></li>
      <li><span><AlertTriangle /></span><div><b>2 · It explains the problem</b><p>Each item says what broke, which load and driver it touches, and the recommended next move.</p></div></li>
      <li><span><Check /></span><div><b>3 · You decide</b><p>Approve, reject or acknowledge. Only your decision changes dispatch, and every one is written to the audit trail below.</p></div></li>
    </ol>

    <div className="p1-summary" aria-label="Intelligence summary">
      <span><AlertTriangle /><b>{open.length}</b><small>need attention</small></span>
      <span><Route /><b>{intelligence.impacts.length}</b><small>plans hit by traffic</small></span>
      <span><Clock3 /><b>{intelligence.backhauls.length}</b><small>return-load options</small></span>
      <span><TrafficCone /><b>{intelligence.traffic.incidents.length}</b><small>{intelligence.traffic.source === "ontario-511" ? "live Ontario 511 events" : "demo road events"}</small></span>
    </div>

    <div className="intelligence-grid">
      <section className="surface intelligence-panel">
        <div className="section-head"><div><p className="kicker">STEP 1 · WATCHLIST</p><h2>Needs attention</h2></div><span className="badge amber">{open.length} open</span></div>
        <p className="panel-help">Problems a dispatcher would otherwise discover by clicking between a load board, an ELD and a dock sheet. Acknowledging one records that you have seen it and clears it from the list.</p>
        {!open.length && <div className="empty-state"><Check /> Nothing requires acknowledgement.</div>}
        {open.map((item: OperationalException) => <article className="exception-row" key={item.id}>
          <span className={item.severity === "critical" ? "risk critical" : "risk"}><ShieldAlert /></span>
          <div><div><b>{item.title}</b><span className={`badge ${item.severity === "critical" ? "red" : "amber"}`}>{item.severity}</span></div><p>{item.detail}</p><small>Next action: {item.recommendedAction}</small></div>
          <button className="btn compact secondary" onClick={() => ops.acknowledgeException(item)}>Acknowledge</button>
        </article>)}
      </section>

      <section className="surface intelligence-panel">
        <div className="section-head"><div><p className="kicker">STEP 2 · APPROVAL REQUIRED</p><h2>Plan changes to approve</h2></div></div>
        <p className="panel-help">A reported incident sits on a truck&apos;s route. Approving writes the later ETA onto the trip; keeping the current plan leaves it untouched. Either way the choice is logged.</p>
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

    <section className="surface intelligence-panel backhaul-panel">
      <div className="section-head"><div><p className="kicker">STEP 3 · REDUCE EMPTY KILOMETRES</p><h2>Return loads after delivery</h2></div><small>Reserving one is a note to yourself — it never dispatches on its own.</small></div>
      <p className="panel-help">Freight that starts near where a truck finishes its current trip, so the unit earns on the way back instead of running home empty. The distance shown is what the pairing could avoid, not a promised saving.</p>
      <div className="backhaul-grid">
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
        {!intelligence.backhauls.length && <div className="empty-state">No open load is positioned to follow a trip that is already out.</div>}
      </div>
    </section>

    {ops.memberRole !== "driver" && <CopilotPanel ops={ops} intelligence={intelligence} />}

    <details className="surface optimizer-controls">
      <summary><SlidersHorizontal /><span><b>How recommendations are ranked</b><small>Change what “best match” means when RoadStar plans your morning. Safety and feasibility rules are never weakened — these only re-order units that are already legal.</small></span></summary>
      <div className="weight-grid">
        {(Object.keys(weights) as Array<keyof typeof weights>).map((key) => <label key={key}>
          <span><b>{WEIGHT_COPY[key]?.label ?? key}</b><small>{WEIGHT_COPY[key]?.help}</small></span>
          <input aria-label={`${WEIGHT_COPY[key]?.label ?? key} weight`} type="range" min="0" max="100" value={weights[key]} onChange={(event) => ops.setOptimizationWeights({ ...weights, [key]: Number(event.target.value) })} />
          <i>{weights[key]}</i>
        </label>)}
      </div>
      <button className="btn compact secondary" onClick={() => ops.setOptimizationWeights(DEFAULT_OPTIMIZATION_WEIGHTS)}>Reset to RoadStar defaults</button>
    </details>

    <section className="surface decision-log">
      <div className="section-head"><div><p className="kicker">AUDIT TRAIL</p><h2>Decision log</h2></div></div>
      {!(ops.state.decisionLog ?? []).length ? <div className="empty-state">Approved, rejected and acknowledged recommendations appear here.</div> :
        <div className="table-list">{[...(ops.state.decisionLog ?? [])].reverse().map((record) => <div key={record.id}><span className={`badge ${record.outcome === "accepted" ? "green" : record.outcome === "rejected" ? "red" : "blue"}`}>{record.outcome}</span><b>{record.summary}</b><time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString("en-CA")}</time></div>)}</div>}
    </section>
  </div>;
}
