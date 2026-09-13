import { useEffect, useRef, useState } from "react";
import { createReplayExample } from "../data/replayExample";
import { parseReplayDataset, workspaceMetrics, type ReplayDataset, type ReplayMetrics, type runConstrainedReplay } from "../lib/replay";
import type { ReturnTypeOfDispatchOperations } from "../viewTypes";

const metricRows: [keyof ReplayMetrics, string][] = [["covered", "Loads covered"], ["coveragePct", "Coverage (%)"], ["emptyKm", "Empty kilometres"], ["hosRisk", "HOS risk trips"], ["lateRisk", "Late trips"], ["detentionMinutes", "Billable dwell minutes"], ["planningSeconds", "Planning seconds (human / solver)"]];
export function ConstrainedReplayPanel({ ops }: { ops: ReturnTypeOfDispatchOperations }) {
  const [dataset, setDataset] = useState<ReplayDataset>(() => createReplayExample());
  const [result, setResult] = useState<ReturnType<typeof runConstrainedReplay> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null);
  const [saveNotice, setSaveNotice] = useState("");
  useEffect(() => () => worker.current?.terminate(), []);
  const live = workspaceMetrics(ops.state);
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(createReplayExample(), null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "roadstar-replay-example.json"; anchor.click(); URL.revokeObjectURL(url);
  };
  return <section className="surface intelligence-panel" aria-label="Constrained optimization replay">
    <p className="kicker">CONSTRAINT-AWARE REPLAY</p><h2>Replay an observed dispatch shift</h2>
    <p>Current workspace: {live.coveragePct.toFixed(1)}% covered · {live.hosRisk} drivers below reserve · {live.lateRisk} late-risk trips · {live.detentionMinutes.toFixed(0)} billable dwell minutes.</p>
    <p>Load a pre-dispatch fleet snapshot, timed load releases and observed baseline trips. The replay uses the dispatch optimizer and carries availability and HOS forward after each completion.</p>
    <div className="decision-actions"><button className="btn secondary" onClick={download}>Download replay example</button>
      <label>Import replay JSON <input type="file" accept=".json,application/json" disabled={busy} onChange={async e => {
        const file = e.target.files?.[0]; if (!file) return;
        try { if (file.size > 3_000_000) throw new Error("Replay file must be under 3 MB."); setDataset(parseReplayDataset(JSON.parse(await file.text()))); setResult(null); setError(""); setSaveNotice(""); }
        catch (e) { setError(e instanceof Error ? e.message : "Invalid replay file."); }
      }} /></label>
      <button className="btn primary" disabled={busy} onClick={() => {
        setBusy(true); setError(""); setResult(null); setSaveNotice("");
        const active = new Worker(new URL("../lib/replay.worker.ts", import.meta.url), { type: "module" }); worker.current = active;
        active.onmessage = e => { setBusy(false); active.terminate(); if (e.data.error) setError(e.data.error); else setResult(e.data.result); };
        active.onerror = () => { setBusy(false); setError("Replay worker failed. Try a smaller dataset."); active.terminate(); };
        active.postMessage(dataset);
      }}>{busy ? "Replaying…" : "Run constrained replay"}</button>
      {busy && <button className="btn secondary" onClick={() => { worker.current?.terminate(); setBusy(false); }}>Cancel replay</button>}
    </div>
    <p>{dataset.name}</p>{error && <p role="alert">{error}</p>}
    {result && <><table className="p1-metrics"><caption>Observed baseline versus modeled optimized dispatch</caption><thead><tr><th>Metric</th><th>Baseline</th><th>Optimized</th><th>Change</th></tr></thead><tbody>{metricRows.map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td>{result.baseline[key].toFixed(1)}</td><td>{result.optimized[key].toFixed(1)}</td><td>{(result.optimized[key] - result.baseline[key]).toFixed(1)}</td></tr>)}</tbody></table>
      <p>{result.assumptions}</p>
      <details><summary>Inspect {result.trips.length} planned trips and {result.unassigned.length} rejected loads</summary>
        {result.trips.map(t => <p key={t.loadId}>{t.loadId} → {t.driverId}: {t.assignedAt} – {t.completedAt}; {t.emptyKm.toFixed(0)} km empty; {t.hosMargin.toFixed(1)} h HOS reserve</p>)}
        {result.unassigned.map(r => <p key={r.loadId}>{r.loadId}: {r.reasons.join(" ")}</p>)}</details>
      <button className="btn secondary" disabled={!ops.canManageDispatch} onClick={async () => {
        const message = await ops.saveP1Record("historical_replay_runs", { source_name: dataset.name, period_start: dataset.startedAt.slice(0, 10), period_end: dataset.endedAt.slice(0, 10), baseline_metrics: result.baseline, scenario_metrics: result.optimized, assumptions: [result.assumptions] });
        setSaveNotice(message ?? "Constrained replay saved to Supabase.");
      }}>Save replay metrics</button>
    </>}{saveNotice && <p role="status">{saveNotice}</p>}
  </section>;
}
