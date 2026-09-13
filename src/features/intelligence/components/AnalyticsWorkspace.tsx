import { useState } from "react";
import { BarChart3, Play, TrendingDown, Truck } from "lucide-react";
import { ROADSTAR_HISTORY, runHistoricalReplay } from "../data/historicalSummary";
import type { ReturnTypeOfDispatchOperations } from "../viewTypes";
import { ConstrainedReplayPanel } from "./ConstrainedReplayPanel";

const number = (value: number) => new Intl.NumberFormat("en-CA").format(value);

export function AnalyticsWorkspace({ ops }: { ops: ReturnTypeOfDispatchOperations }) {
  const [scenario, setScenario] = useState<ReturnType<typeof runHistoricalReplay> | null>(null);
  const [saveMessage, setSaveMessage] = useState("");
  const accepted = (ops.state.decisionLog ?? []).filter((item) => item.outcome === "accepted").length;
  return <div className="page analytics-page fade-in">
    <div className="page-heading"><div><p className="kicker">MEASURED OPERATIONS</p><h1>KPI and historical replay</h1><p>Live workspace performance beside an auditable replay of supplied RoadStar history.</p></div><button className="btn primary" onClick={async () => { const result = runHistoricalReplay(); setScenario(result); const message = await ops.saveP1Record("historical_replay_runs", { source_name: ROADSTAR_HISTORY.source, period_start: ROADSTAR_HISTORY.periodStart, period_end: ROADSTAR_HISTORY.periodEnd, baseline_metrics: ROADSTAR_HISTORY, scenario_metrics: result, assumptions: [result.note] }); setSaveMessage(message ?? "Replay saved to Supabase."); }}><Play />Run lane-match replay</button></div>
    <ConstrainedReplayPanel ops={ops} />
    {saveMessage && <p className="save-notice" role="status">{saveMessage}</p>}
    <div className="metric-grid">
      <article className="metric-card"><span className="metric-icon teal"><Truck /></span><div><small>ACTIVE TRIPS</small><strong>{ops.metrics.active}</strong><em>{ops.metrics.open} open loads</em></div></article>
      <article className="metric-card"><span className="metric-icon blue"><BarChart3 /></span><div><small>DECISIONS APPROVED</small><strong>{accepted}</strong><em>{(ops.state.decisionLog ?? []).length} total recorded</em></div></article>
      <article className="metric-card"><span className="metric-icon amber"><TrendingDown /></span><div><small>HISTORICAL EMPTY KM</small><strong>{number(ROADSTAR_HISTORY.emptyKm)}</strong><em>{ROADSTAR_HISTORY.emptyDistancePct}% of distance</em></div></article>
      <article className="metric-card"><span className="metric-icon violet"><Truck /></span><div><small>COMPLETED LEGS</small><strong>{number(ROADSTAR_HISTORY.completedLegs)}</strong><em>{number(ROADSTAR_HISTORY.uniqueLoads)} unique loads</em></div></article>
    </div>
    <div className="analytics-grid">
      <section className="surface replay-card"><p className="kicker">SUPPLIED WORKBOOK BASELINE</p><h2>{ROADSTAR_HISTORY.periodStart} – {ROADSTAR_HISTORY.periodEnd}</h2><p className="source-note">Source: {ROADSTAR_HISTORY.source}</p><div className="replay-bars"><div><span>Loaded distance <b>{number(ROADSTAR_HISTORY.loadedKm)} km</b></span><i><em style={{width:"86.1%"}} /></i></div><div><span>Empty distance <b>{number(ROADSTAR_HISTORY.emptyKm)} km</b></span><i><em className="empty" style={{width:"13.9%"}} /></i></div></div><dl><div><dt>Loaded legs</dt><dd>{number(ROADSTAR_HISTORY.loadedLegs)}</dd></div><div><dt>Empty legs</dt><dd>{number(ROADSTAR_HISTORY.emptyLegs)}</dd></div></dl></section>
      <section className="surface replay-card scenario"><p className="kicker">DIRECTIONAL MATCH SCENARIO</p>{scenario ? <><h2>{number(scenario.projectedEmptyKm)} projected empty km</h2><strong className="opportunity">{number(ROADSTAR_HISTORY.recoverableEmptyKm)} km opportunity</strong><div className="comparison"><span><small>Baseline</small><b>{ROADSTAR_HISTORY.emptyDistancePct}%</b></span><span>→</span><span><small>Scenario</small><b>{scenario.projectedEmptyPct}%</b></span></div><p>{scenario.note}</p></> : <div className="empty-state">Run the replay to compare reverse-lane matches against the historical baseline.</div>}</section>
    </div>
    <section className="surface opportunity-table"><div className="section-head"><div><p className="kicker">TOP UPPER-BOUND OPPORTUNITIES</p><h2>Reverse-lane matches</h2></div></div>{ROADSTAR_HISTORY.topOpportunities.map((row) => <div className="opportunity-row" key={row.lane}><b>{row.lane}</b><span>{row.matches} matches</span><strong>{number(row.recoverableKm)} km</strong></div>)}<p className="source-note">This is planning evidence, not guaranteed savings. It does not yet model appointment compatibility, equipment availability, or customer constraints.</p></section>
  </div>;
}
