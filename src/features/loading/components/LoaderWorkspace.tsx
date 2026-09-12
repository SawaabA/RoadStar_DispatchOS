import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Box, RotateCcw, Sparkles, Truck } from "lucide-react";
import { TrailerScene } from "./TrailerScene";
import { solvePlan } from "../lib/solver";
import { validatePlanInput } from "../lib/planner";
import type { Load, PackedItem, Plan, Trailer } from "../types";

const trailer: Trailer = {
  id: "DV118",
  lengthIn: 636,
  widthIn: 98,
  heightIn: 102,
  capacityLbs: 44500,
  frontAxleLimitLbs: 12000,
  rearAxleLimitLbs: 34000,
  axleDistanceIn: 480,
};
const initial: Load[] = [
  {
    id: "RS-4521",
    origin: "Milton, ON",
    destination: "London, ON",
    weightLbs: 31200,
    pallets: 18,
    stop: 2,
    description: "Automotive components",
    palletLengthIn: 48,
    palletWidthIn: 40,
    palletHeightIn: 48,
    rotatable: true,
    stackable: false,
    bearingLimitLbs: 0,
  },
  {
    id: "RS-4534",
    origin: "Oshawa, ON",
    destination: "Brampton, ON",
    weightLbs: 9800,
    pallets: 5,
    stop: 1,
    description: "Building materials",
    palletLengthIn: 48,
    palletWidthIn: 40,
    palletHeightIn: 48,
    rotatable: true,
    stackable: true,
    bearingLimitLbs: 2500,
  },
];
export function LoaderWorkspace() {
  const [loads, setLoads] = useState(initial),
    [plan, setPlan] = useState<Plan & { engine: string }>({
      items: [],
      unplanned: [],
      totalWeight: 0,
      usedFloorArea: 0,
      warnings: [],
      engine: "connecting",
    }),
    [stop, setStop] = useState(0),
    [selected, setSelected] = useState<PackedItem | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const generatePlan = useCallback(async (nextLoads: Load[]) => {
    const issues = validatePlanInput(nextLoads, trailer);
    if (issues.length) {
      setError(issues.join(" "));
      return;
    }
    setError("");
    setLoading(true);
    try {
      const nextPlan = await solvePlan(nextLoads, trailer);
      setPlan({ ...nextPlan, engine: nextPlan.engine || "browser" });
      setSelected(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to generate a load plan.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void generatePlan(initial);
  }, [generatePlan]);
  const requestedWeight = useMemo(() => loads.reduce((sum, load) => sum + (Number.isFinite(load.weightLbs) ? load.weightLbs : 0), 0), [loads]);
  const weight = Math.round((plan.totalWeight / trailer.capacityLbs) * 100),
    floor = Math.round(
      (plan.usedFloorArea / (trailer.lengthIn * trailer.widthIn)) * 100,
    );
  return (
    <div className="loader-page fade-in">
      <aside>
        <p className="kicker">PHYSICAL LOAD PLANNING</p>
        <h1>3D trailer builder</h1>
        <p>Stop-aware placement using xflp with a browser fallback.</p>
        <div className="loader-trailer">
          <Truck />
          <span>
            <b>{trailer.id}</b>
            <small>53′ Dry Van · 44,500 lb</small>
          </span>
        </div>
        <h3>SHIPMENTS</h3>
        {loads.map((l, i) => (
          <article key={l.id}>
            <div>
              <i className={`cargo c${i}`} />
              <b>{l.id}</b>
              <small>STOP {l.stop}</small>
            </div>
            <p>
              {l.origin} → {l.destination}
            </p>
            <label>
              PALLETS
              <input
                type="number"
                min="1"
                step="1"
                value={l.pallets}
                onChange={(e) =>
                  setLoads((current) =>
                    current.map((x, n) =>
                      n === i ? { ...x, pallets: +e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
            <label>
              TOTAL LB
              <input
                type="number"
                min="1"
                step="1"
                value={l.weightLbs}
                onChange={(e) =>
                  setLoads((current) =>
                    current.map((x, n) =>
                      n === i ? { ...x, weightLbs: +e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
          </article>
        ))}
        <button className="btn primary full" onClick={() => void generatePlan(loads)} disabled={loading}>
          <Sparkles />
          {loading ? "Generating plan…" : "Regenerate plan"}
        </button>
        {error && <p className="loader-error" role="alert">{error}</p>}
      </aside>
      <section className="loader-scene" aria-label={`Interactive trailer plan with ${plan.items.length} planned and ${plan.unplanned.length} unplanned pallets`}>
        <div className="scene-label">
          <span>
            <i />
            INTERACTIVE LOAD PLAN
          </span>
          <small>DRAG TO ORBIT · SCROLL TO ZOOM</small>
        </div>
        <TrailerScene
          trailer={trailer}
          items={plan.items}
          activeStop={stop}
          onSelect={setSelected}
        />
        <div className="stop-filter">
          <button
            className={stop === 0 ? "active" : ""}
            onClick={() => setStop(0)}
          >
            All cargo
          </button>
          {loads.map((l) => (
            <button
              className={stop === l.stop ? "active" : ""}
              key={l.id}
              onClick={() => setStop(l.stop)}
            >
              Stop {l.stop}
            </button>
          ))}
        </div>
      </section>
      <aside className="loader-health">
        <p className="kicker">PLAN HEALTH · {plan.engine.toUpperCase()}</p>
        <div className="health-score">
          {plan.unplanned.length ? 72 : 94}
          <small>/100</small>
        </div>
        <span className="loader-ready" role="status">{loading ? "CALCULATING" : error ? "INPUT NEEDS ATTENTION" : "READY FOR REVIEW"}</span>
        <Metric
          label="Weight"
          value={`${plan.totalWeight.toLocaleString()} / ${trailer.capacityLbs.toLocaleString()} lb`}
          pct={weight}
        />
        <Metric label="Floor used" value={`${floor}%`} pct={floor} />
        <div className="loader-counts">
          <span>
            <Box />
            Planned<b>{plan.items.length}</b>
          </span>
          <span>
            <AlertTriangle />
            Unplanned<b>{plan.unplanned.length}</b>
          </span>
        </div>
        <h3>VALIDATION</h3>
        <p className={requestedWeight <= trailer.capacityLbs ? "valid" : "warning"}>{requestedWeight <= trailer.capacityLbs ? "✓" : "!"} Shipment weight {requestedWeight <= trailer.capacityLbs ? "is within" : "exceeds"} trailer capacity</p>
        <p className={plan.unplanned.length ? "warning" : "valid"}>{plan.unplanned.length ? "! Review unplanned pallets" : "✓ All pallets placed in stop order"}</p>
        <p className="warning">! Estimated pallet dimensions</p>
        {plan.warnings.map((warning) => <p className="warning" key={warning}>! {warning}</p>)}
        {selected && (
          <div className="selected-pallet">
            <button aria-label="Close pallet details" onClick={() => setSelected(null)}>×</button>
            <small>SELECTED PALLET</small>
            <b>{selected.id}</b>
            <p>{selected.destination}</p>
            <span>
              {selected.weightLbs.toLocaleString()} lb · Stop {selected.stop}
            </span>
          </div>
        )}
        <button
          className="btn secondary full"
          onClick={() => {
            setLoads(initial);
            setStop(0);
            void generatePlan(initial);
          }}
        >
          <RotateCcw />
          Reset loads
        </button>
      </aside>
    </div>
  );
}
function Metric({
  label,
  value,
  pct,
}: {
  label: string;
  value: string;
  pct: number;
}) {
  return (
    <div className="loader-metric">
      <span>{label}</span>
      <b>{value}</b>
      <i>
        <em style={{ width: `${Math.min(100, pct)}%` }} />
      </i>
      <small>{pct}%</small>
    </div>
  );
}
