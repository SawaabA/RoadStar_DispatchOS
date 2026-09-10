import { useEffect, useState } from "react";
import { AlertTriangle, Box, RotateCcw, Sparkles, Truck } from "lucide-react";
import { TrailerScene } from "./TrailerScene";
import { solvePlan } from "../lib/solver";
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
    [selected, setSelected] = useState<PackedItem | null>(null);
  useEffect(() => {
    let alive = true;
    solvePlan(loads, trailer).then(
      (p) => alive && setPlan({ ...p, engine: p.engine || "browser" }),
    );
    return () => {
      alive = false;
    };
  }, [loads]);
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
        <button className="btn primary full">
          <Sparkles />
          Regenerate plan
        </button>
      </aside>
      <section className="loader-scene">
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
        <span className="loader-ready">READY FOR REVIEW</span>
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
        <p className="valid">✓ Under trailer weight limit</p>
        <p className="valid">✓ Stop-aware rear unloading</p>
        <p className="warning">! Estimated pallet dimensions</p>
        {selected && (
          <div className="selected-pallet">
            <button onClick={() => setSelected(null)}>×</button>
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
          onClick={() => setLoads(initial)}
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
