import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Box, Boxes, Eye, Layers3, Lock, Play, Plus, Printer, RotateCcw, Sparkles, Trash2, Truck, Upload } from "lucide-react";
import type { DispatchLoad } from "../../dispatch/types";
import { TrailerScene, type CameraView, type ColorMode } from "./TrailerScene";
import { solvePlan } from "../lib/solver";
import { validatePlanInput } from "../lib/planner";
import { estimatePalletDisplacement } from "../lib/palletEquivalents";
import type { Load, PackedItem, Plan, Trailer } from "../types";

const trailer: Trailer = {
  id: "DV118", lengthIn: 636, widthIn: 98, heightIn: 102, capacityLbs: 44500,
  frontAxleLimitLbs: 12000, rearAxleLimitLbs: 34000, axleDistanceIn: 480, axleModelVerified: false,
};

const initial: Load[] = [
  { id: "RS-4521-A", origin: "Milton, ON", destination: "London, ON", weightLbs: 20800, pallets: 12, stop: 2, description: "Automotive pallets", palletLengthIn: 48, palletWidthIn: 40, palletHeightIn: 48, rotatable: true, stackable: false, bearingLimitLbs: 0, cargoKind: "pallet", estimated: true },
  { id: "RS-4521-B", origin: "Milton, ON", destination: "London, ON", weightLbs: 10400, pallets: 6, stop: 2, description: "Long component crates", palletLengthIn: 60, palletWidthIn: 36, palletHeightIn: 42, rotatable: true, stackable: true, bearingLimitLbs: 2200, cargoKind: "irregular", estimated: false },
  { id: "RS-4534-A", origin: "Oshawa, ON", destination: "Brampton, ON", weightLbs: 9800, pallets: 5, stop: 1, description: "Building materials", palletLengthIn: 48, palletWidthIn: 40, palletHeightIn: 40, rotatable: true, stackable: true, bearingLimitLbs: 2500, cargoKind: "pallet", estimated: true },
];

const cargoPresets = {
  pallet: { label: "Standard pallet", lengthIn: 48, widthIn: 40, heightIn: 48, weightLbs: 1500 },
  forklift: { label: "Forklift", lengthIn: 144, widthIn: 60, heightIn: 84, weightLbs: 9000 },
  machine: { label: "Industrial machine", lengthIn: 96, widthIn: 72, heightIn: 78, weightLbs: 6500 },
  crate: { label: "Oversized crate", lengthIn: 72, widthIn: 60, heightIn: 60, weightLbs: 3000 },
  drum: { label: "Drum group", lengthIn: 48, widthIn: 40, heightIn: 38, weightLbs: 1200 },
  custom: { label: "Custom cargo", lengthIn: 48, widthIn: 40, heightIn: 48, weightLbs: 1500 },
};

function dispatchToPlanner(loads: DispatchLoad[]): Load[] {
  return loads.filter((load) => !["cancelled", "completed", "archived"].includes(load.status)).flatMap<Load>((load, loadIndex): Load[] => {
    const stop = loadIndex + 1;
    if (!load.cargoItems?.length) return [{
      id: `${load.billNumber}-PALLETS`, origin: load.origin, destination: load.destination,
      weightLbs: load.weightLbs, pallets: Math.max(1, load.pallets), stop, description: load.description,
      palletLengthIn: 48, palletWidthIn: 40, palletHeightIn: 48, rotatable: true,
      stackable: false, bearingLimitLbs: 0, cargoKind: "pallet" as const, estimated: true,
    }];
    return load.cargoItems.map((cargo, cargoIndex) => ({
      id: `${load.billNumber}-C${cargoIndex + 1}`, origin: load.origin, destination: load.destination,
      weightLbs: cargo.unitWeightLbs * cargo.quantity, pallets: cargo.quantity, stop: cargo.stop ?? stop,
      description: cargo.label, palletLengthIn: cargo.lengthIn + (cargo.clearanceIn ?? 0) * 2, palletWidthIn: cargo.widthIn + (cargo.clearanceIn ?? 0) * 2,
      palletHeightIn: cargo.heightIn + (cargo.clearanceIn ?? 0) * 2, rotatable: cargo.rotatable, stackable: cargo.stackable,
      bearingLimitLbs: cargo.stackable ? cargo.maxStackWeightLbs ?? cargo.unitWeightLbs * 3 : 0,
      floorBearingPsf: cargo.floorBearingPsf, fragile: cargo.fragile, priority: cargo.priority,
      cargoKind: cargo.lengthIn === 48 && cargo.widthIn === 40 ? "pallet" as const : "irregular" as const,
      cargoLabel: cargo.label, clearanceIn: cargo.clearanceIn, estimated: false,
    }));
  });
}

const layerValues = (items: PackedItem[]) => [...new Set(items.map((item) => item.z))].sort((a, b) => a - b);
type PlanStrategy = "space" | "balance" | "unload" | "damage";
type SavedLoadingPlan = { id: string; external_id: string; version: number; name: string; objective: PlanStrategy; status: string; manifest: Load[]; plan: Plan; created_at: string };

export function LoaderWorkspace({ dispatchLoads = [], onPersistCargo, onSavePlan, onLoadPlans, onApprovePlan }: {
  dispatchLoads?: DispatchLoad[];
  onPersistCargo?: (values: Record<string, unknown>) => Promise<string | null>;
  onSavePlan?: (values: { externalId: string; name: string; objective: string; manifest: Load[]; plan: Plan }) => Promise<string | null>;
  onLoadPlans?: () => Promise<unknown[]>;
  onApprovePlan?: (planId: string) => Promise<boolean>;
}) {
  const [loads, setLoads] = useState(initial);
  const [plan, setPlan] = useState<Plan & { engine: string }>({ items: [], unplanned: [], totalWeight: 0, usedFloorArea: 0, warnings: [], engine: "connecting" });
  const [stop, setStop] = useState(0);
  const [layer, setLayer] = useState<number | "all">("all");
  const [cameraView, setCameraView] = useState<CameraView>("perspective");
  const [colorMode, setColorMode] = useState<ColorMode>("load");
  const [exploded, setExploded] = useState(false);
  const [labels, setLabels] = useState(true);
  const [axleHeat, setAxleHeat] = useState(false);
  const [unit, setUnit] = useState<"imperial" | "metric">("imperial");
  const [strategy, setStrategy] = useState<PlanStrategy>("space");
  const [cameraReset, setCameraReset] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [locked, setLocked] = useState<string[]>([]);
  const lockedPlacements = useRef(new Map<string, PackedItem>());
  const [selected, setSelected] = useState<PackedItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cargo, setCargo] = useState({ ...cargoPresets.forklift, quantity: 1, clearanceIn: 3, rotatable: true, stackable: false, maxStackWeightLbs: 0, floorBearingPsf: 250, fragile: false, priority: false, stop: 1, destination: "Next configured stop" });
  const [saveMessage, setSaveMessage] = useState("");
  const [planMessage, setPlanMessage] = useState("");
  const [savedPlans, setSavedPlans] = useState<SavedLoadingPlan[]>([]);

  const refreshSavedPlans = useCallback(async () => {
    const records = await onLoadPlans?.() ?? [];
    setSavedPlans(records.filter((record): record is SavedLoadingPlan => Boolean(record && typeof record === "object" && "id" in record && "version" in record && "manifest" in record && Array.isArray((record as SavedLoadingPlan).manifest) && "plan" in record && Array.isArray((record as SavedLoadingPlan).plan?.items))));
  }, [onLoadPlans]);

  const cargoEstimate = useMemo(() => { try { return estimatePalletDisplacement(cargo, trailer); } catch { return null; } }, [cargo]);
  const generatePlan = useCallback(async (nextLoads: Load[]) => {
    const issues = validatePlanInput(nextLoads, trailer);
    if (issues.length) { setError(issues.join(" ")); return; }
    setError(""); setLoading(true);
    try {
      const ordered = [...nextLoads].sort((left, right) => strategy === "unload" ? right.stop - left.stop : strategy === "balance" ? right.weightLbs - left.weightLbs : strategy === "damage" ? Number(Boolean(right.fragile)) - Number(Boolean(left.fragile)) : right.palletLengthIn * right.palletWidthIn * right.palletHeightIn - left.palletLengthIn * left.palletWidthIn * left.palletHeightIn);
      const nextPlan = await solvePlan(ordered, trailer, strategy);
      const kept: PackedItem[] = [];
      const displaced: PackedItem[] = [];
      for (const proposed of nextPlan.items) {
        const candidate = lockedPlacements.current.get(proposed.id) ?? proposed;
        const collision = kept.some((other) => candidate.x < other.x + other.length && candidate.x + candidate.length > other.x && candidate.y < other.y + other.width && candidate.y + candidate.width > other.y && candidate.z < other.z + other.height && candidate.z + candidate.height > other.z);
        if (collision && !lockedPlacements.current.has(proposed.id)) displaced.push(proposed); else kept.push(candidate);
      }
      setPlan({ ...nextPlan, items: kept, unplanned: [...nextPlan.unplanned, ...displaced], totalWeight: kept.reduce((sum, item) => sum + item.weightLbs, 0), usedFloorArea: kept.filter((item) => item.z === 0).reduce((sum, item) => sum + item.length * item.width, 0), warnings: displaced.length ? [...nextPlan.warnings, `${displaced.length} item(s) were left unplanned to preserve locked placements.`] : nextPlan.warnings, engine: nextPlan.engine || "browser" });
      setSelected(null); setLayer("all");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to generate a load plan."); }
    finally { setLoading(false); }
  }, [strategy]);
  useEffect(() => { void generatePlan(initial); }, [generatePlan]);
  useEffect(() => { void refreshSavedPlans(); }, [refreshSavedPlans]);

  const requestedWeight = loads.reduce((sum, load) => sum + (Number.isFinite(load.weightLbs) ? load.weightLbs : 0), 0);
  const layers = layerValues(plan.items);
  const uniqueStops = useMemo(() => [...new Set(loads.map((load) => load.stop))].sort((a, b) => a - b), [loads]);
  useEffect(() => {
    if (!playing || !uniqueStops.length) return;
    const timer = window.setInterval(() => setStop((current) => {
      const currentIndex = uniqueStops.indexOf(current);
      if (currentIndex >= uniqueStops.length - 1) { setPlaying(false); return 0; }
      return uniqueStops[currentIndex + 1] ?? uniqueStops[0];
    }), 1200);
    return () => window.clearInterval(timer);
  }, [playing, uniqueStops]);
  const weight = Math.round((plan.totalWeight / trailer.capacityLbs) * 100);
  const floor = Math.round((plan.usedFloorArea / (trailer.lengthIn * trailer.widthIn)) * 100);
  const volume = Math.round(plan.items.reduce((sum, item) => sum + item.length * item.width * item.height, 0) / (trailer.lengthIn * trailer.widthIn * trailer.heightIn) * 100);
  const centre = plan.totalWeight ? plan.items.reduce((sum, item) => sum + (item.x + item.length / 2) * item.weightLbs, 0) / plan.totalWeight : 0;
  const centrePct = Math.round(centre / trailer.lengthIn * 100);
  const health = Math.max(25, 100 - plan.unplanned.length * 8 - (weight > 100 ? 25 : 0) - (centrePct < 35 || centrePct > 65 ? 8 : 0));

  const updateLoad = (index: number, changes: Partial<Load>) => setLoads((current) => current.map((load, itemIndex) => itemIndex === index ? { ...load, ...changes } : load));
  const addCargo = async () => {
    if (!cargoEstimate?.fitsEnvelope || !cargo.label.trim()) return;
    const id = `CARGO-${Date.now()}`;
    const next: Load = {
      id, origin: "Milton, ON", destination: cargo.destination, weightLbs: cargo.weightLbs * cargo.quantity,
      pallets: cargo.quantity, stop: cargo.stop, description: cargo.label,
      palletLengthIn: cargoEstimate.protectedDimensions.length, palletWidthIn: cargoEstimate.protectedDimensions.width,
      palletHeightIn: cargoEstimate.protectedDimensions.height, rotatable: cargo.rotatable,
      stackable: cargo.stackable, bearingLimitLbs: cargo.stackable ? cargo.maxStackWeightLbs || cargo.weightLbs * 3 : 0,
      floorBearingPsf: cargo.floorBearingPsf, fragile: cargo.fragile, priority: cargo.priority,
      cargoKind: cargo.label === "Standard pallet" ? "pallet" : "irregular", cargoLabel: cargo.label,
      clearanceIn: cargo.clearanceIn, estimated: false,
    };
    setLoads((current) => [...current, next]);
    const message = await onPersistCargo?.({ external_id: id, cargo_kind: next.cargoKind, label: cargo.label, quantity: cargo.quantity, length_in: cargo.lengthIn, width_in: cargo.widthIn, height_in: cargo.heightIn, weight_lbs: cargo.weightLbs, clearance_in: cargo.clearanceIn, rotatable: cargo.rotatable, stackable: cargo.stackable, max_stack_weight_lbs: cargo.maxStackWeightLbs || null, floor_bearing_psf: cargo.floorBearingPsf, fragile: cargo.fragile, priority: cargo.priority, delivery_stop: cargo.stop, estimated: false, pallet_equivalents: cargoEstimate.palletEquivalents });
    setSaveMessage(message ?? (onPersistCargo ? "Cargo specification saved to Supabase." : "Cargo specification added to this plan."));
  };

  const moveSelected = (deltaX: number, deltaY: number, rotate = false) => {
    if (!selected) return;
    const candidate = { ...selected, x: selected.x + deltaX, y: selected.y + deltaY, length: rotate ? selected.width : selected.length, width: rotate ? selected.length : selected.width, rotated: rotate ? !selected.rotated : selected.rotated };
    const inBounds = candidate.x >= 0 && candidate.y >= 0 && candidate.x + candidate.length <= trailer.lengthIn && candidate.y + candidate.width <= trailer.widthIn;
    const collision = plan.items.some((other) => other.id !== selected.id && candidate.x < other.x + other.length && candidate.x + candidate.length > other.x && candidate.y < other.y + other.width && candidate.y + candidate.width > other.y && candidate.z < other.z + other.height && candidate.z + candidate.height > other.z);
    if (!inBounds || collision) { setError("That manual placement would cross the trailer boundary or collide with cargo."); return; }
    setError("");
    setPlan((current) => ({ ...current, items: current.items.map((item) => item.id === candidate.id ? candidate : item) }));
    setSelected(candidate);
    if (lockedPlacements.current.has(candidate.id)) lockedPlacements.current.set(candidate.id, candidate);
  };
  const distanceValue = (inches: number) => unit === "metric" ? Math.round(inches * 2.54 * 10) / 10 : inches;
  const distanceInput = (value: number) => unit === "metric" ? value / 2.54 : value;
  const weightValue = (pounds: number) => unit === "metric" ? Math.round(pounds * 0.453592 * 10) / 10 : pounds;
  const weightInput = (value: number) => unit === "metric" ? value / 0.453592 : value;
  const savePlanVersion = async () => {
    const message = await onSavePlan?.({ externalId: trailer.id, name: `${trailer.id} ${new Date().toLocaleString()}`, objective: strategy, manifest: loads, plan });
    setPlanMessage(message ?? (onSavePlan ? "A new immutable plan version was saved to Supabase." : "Sign in to save plan versions."));
    if (!message) await refreshSavedPlans();
  };
  const restorePlan = (saved: SavedLoadingPlan) => {
    const errors = validatePlanInput(saved.manifest, trailer);
    if (errors.length) { setError(`Saved plan is invalid: ${errors.join(" ")}`); return; }
    setLoads(saved.manifest); setPlan({ ...saved.plan, engine: saved.plan.engine || "saved-plan" }); setStrategy(saved.objective); setSelected(null); setStop(0); setLayer("all"); setPlanMessage(`Restored ${saved.name}, version ${saved.version}.`);
  };

  return <div className="loader-page fade-in">
    <aside className="loader-manifest">
      <p className="kicker">PHYSICAL LOAD PLANNING</p><h1>3D trailer builder</h1>
      <p>Mix pallets, crates, machinery, and unusual freight. xflp evaluates actual protected dimensions, weight, stacking, and stop order.</p>
      <div className="loader-trailer"><Truck /><span><b>{trailer.id}</b><small>53′ Dry Van · 44,500 lb</small></span></div>
      <div className="unit-toggle" aria-label="Measurement system"><button className={unit === "imperial" ? "active" : ""} onClick={() => setUnit("imperial")}>Imperial</button><button className={unit === "metric" ? "active" : ""} onClick={() => setUnit("metric")}>Metric</button></div>
      {dispatchLoads.length > 0 && <button className="btn secondary full import-loads" onClick={() => { const imported = dispatchToPlanner(dispatchLoads); setLoads(imported); void generatePlan(imported); }}><Upload />Import {dispatchLoads.filter((item) => !["cancelled", "completed", "archived"].includes(item.status)).length} active dispatch loads</button>}
      <div className="manifest-title"><h3>CARGO MANIFEST</h3><span>{loads.length} types</span></div>
      {loads.map((load, index) => <details className="cargo-card" key={load.id} open={index < 2}>
        <summary><i className={`cargo c${index % 5}`} /><span><b>{load.cargoLabel ?? load.description}</b><small>{load.id} · Stop {load.stop}</small></span><strong>{load.pallets} × {Math.round(load.weightLbs / Math.max(1, load.pallets)).toLocaleString()} lb</strong></summary>
        <p>{load.origin} → {load.destination}</p>
        <div className="cargo-fields">
          <label>QTY<input type="number" min="1" step="1" value={load.pallets} onChange={(event) => updateLoad(index, { pallets: Number(event.target.value) })} /></label>
          <label>TOTAL {unit === "metric" ? "KG" : "LB"}<input type="number" min="1" value={weightValue(load.weightLbs)} onChange={(event) => updateLoad(index, { weightLbs: weightInput(Number(event.target.value)) })} /></label>
          <label>LENGTH {unit === "metric" ? "CM" : "IN"}<input type="number" min="1" value={distanceValue(load.palletLengthIn)} onChange={(event) => updateLoad(index, { palletLengthIn: distanceInput(Number(event.target.value)) })} /></label>
          <label>WIDTH {unit === "metric" ? "CM" : "IN"}<input type="number" min="1" value={distanceValue(load.palletWidthIn)} onChange={(event) => updateLoad(index, { palletWidthIn: distanceInput(Number(event.target.value)) })} /></label>
          <label>HEIGHT {unit === "metric" ? "CM" : "IN"}<input type="number" min="1" value={distanceValue(load.palletHeightIn)} onChange={(event) => updateLoad(index, { palletHeightIn: distanceInput(Number(event.target.value)) })} /></label>
          <label>STOP<input type="number" min="1" step="1" value={load.stop} onChange={(event) => updateLoad(index, { stop: Number(event.target.value) })} /></label>
        </div>
        <div className="cargo-options"><label><input type="checkbox" checked={load.rotatable} onChange={(event) => updateLoad(index, { rotatable: event.target.checked })} />Rotate</label><label><input type="checkbox" checked={load.stackable} onChange={(event) => updateLoad(index, { stackable: event.target.checked, bearingLimitLbs: event.target.checked ? Math.max(load.bearingLimitLbs, load.weightLbs / load.pallets * 3) : 0 })} />Stack</label><button onClick={() => setLoads((current) => current.filter((item) => item.id !== load.id))}><Trash2 />Remove</button></div>
      </details>)}
      <details className="cargo-estimator"><summary><Plus />Add cargo type</summary>
        <p>Choose a template or enter the real outer dimensions. Clearance reserves handling space.</p>
        <label className="wide">TEMPLATE<select value={Object.entries(cargoPresets).find(([, value]) => value.label === cargo.label)?.[0] ?? "custom"} onChange={(event) => { const preset = cargoPresets[event.target.value as keyof typeof cargoPresets]; setCargo((current) => ({ ...current, ...preset })); }}>{Object.entries(cargoPresets).map(([id, value]) => <option key={id} value={id}>{value.label}</option>)}</select></label>
        <label className="wide">CARGO NAME<input value={cargo.label} onChange={(event) => setCargo((current) => ({ ...current, label: event.target.value }))} /></label>
        {(["lengthIn", "widthIn", "heightIn", "weightLbs", "quantity", "clearanceIn", "stop", "maxStackWeightLbs", "floorBearingPsf"] as const).map((field) => { const distance = ["lengthIn", "widthIn", "heightIn", "clearanceIn"].includes(field); const itemWeight = ["weightLbs", "maxStackWeightLbs"].includes(field); const value = distance ? distanceValue(cargo[field]) : itemWeight ? weightValue(cargo[field]) : cargo[field]; const label = ({ lengthIn: `LENGTH ${unit === "metric" ? "CM" : "IN"}`, widthIn: `WIDTH ${unit === "metric" ? "CM" : "IN"}`, heightIn: `HEIGHT ${unit === "metric" ? "CM" : "IN"}`, weightLbs: `${unit === "metric" ? "KG" : "LB"} / ITEM`, quantity: "QUANTITY", clearanceIn: `CLEARANCE ${unit === "metric" ? "CM" : "IN"}`, stop: "STOP", maxStackWeightLbs: `MAX STACK ${unit === "metric" ? "KG" : "LB"}`, floorBearingPsf: "FLOOR LIMIT PSF" })[field]; return <label key={field}>{label}<input type="number" min={field === "clearanceIn" || field === "maxStackWeightLbs" ? 0 : 1} step="1" value={value} onChange={(event) => { const entered = Number(event.target.value); setCargo((current) => ({ ...current, [field]: distance ? distanceInput(entered) : itemWeight ? weightInput(entered) : entered })); }} /></label>; })}
        <label className="wide">DESTINATION<input value={cargo.destination} onChange={(event) => setCargo((current) => ({ ...current, destination: event.target.value }))} /></label>
        <label className="cargo-check"><input type="checkbox" checked={cargo.rotatable} onChange={(event) => setCargo((current) => ({ ...current, rotatable: event.target.checked }))} />May rotate</label>
        <label className="cargo-check"><input type="checkbox" checked={cargo.stackable} onChange={(event) => setCargo((current) => ({ ...current, stackable: event.target.checked }))} />May stack</label>
        <label className="cargo-check"><input type="checkbox" checked={cargo.fragile} onChange={(event) => setCargo((current) => ({ ...current, fragile: event.target.checked }))} />Fragile</label>
        <label className="cargo-check"><input type="checkbox" checked={cargo.priority} onChange={(event) => setCargo((current) => ({ ...current, priority: event.target.checked }))} />Priority</label>
        <div className={`cargo-result ${cargoEstimate?.fitsEnvelope ? "" : "blocked"}`} role="status">{cargoEstimate ? cargoEstimate.fitsEnvelope ? <><strong>≈ {cargoEstimate.palletEquivalents} pallet positions forgone</strong><small>Floor {cargoEstimate.floorEquivalent} · volume {cargoEstimate.volumeEquivalent} · weight {cargoEstimate.weightEquivalent}; conservative maximum.</small></> : <strong>This cargo does not fit the trailer envelope.</strong> : <strong>Complete every field with a valid value.</strong>}</div>
        <button type="button" className="btn primary full" disabled={!cargoEstimate?.fitsEnvelope || !cargo.label.trim()} onClick={() => void addCargo()}><Plus />Add to manifest</button>
        {saveMessage && <small className="estimate-note" role="status">{saveMessage}</small>}
      </details>
      <button className="btn primary full" onClick={() => void generatePlan(loads)} disabled={loading}><Sparkles />{loading ? "Optimizing…" : "Optimize trailer"}</button>
      {error && <p className="loader-error" role="alert">{error}</p>}
    </aside>

    <section className="loader-scene" aria-label={`Interactive trailer plan with ${plan.items.length} planned and ${plan.unplanned.length} unplanned pieces`}>
      <div className="scene-label"><span><i />INTERACTIVE LOAD PLAN</span><small>DRAG TO ORBIT · SCROLL TO ZOOM</small></div>
      <div className="scene-tools" aria-label="3D view controls">
        <div><Eye />{(["perspective", "driver", "top", "side", "rear"] as CameraView[]).map((view) => <button key={view} className={cameraView === view ? "active" : ""} onClick={() => setCameraView(view)}>{view}</button>)}<button onClick={() => setCameraReset((value) => value + 1)}>Reset camera</button></div>
        <div><Layers3 /><button className={exploded ? "active" : ""} onClick={() => setExploded(!exploded)} aria-pressed={exploded}>Explode</button><button className={labels ? "active" : ""} onClick={() => setLabels(!labels)} aria-pressed={labels}>Labels</button><button className={axleHeat ? "active" : ""} onClick={() => setAxleHeat(!axleHeat)} aria-pressed={axleHeat}>Axle heat</button></div>
        <div><Boxes /><select aria-label="Color cargo by" value={colorMode} onChange={(event) => setColorMode(event.target.value as ColorMode)}><option value="load">Colour by load</option><option value="stop">Colour by stop</option><option value="weight">Weight heat map</option><option value="constraint">Constraint status</option></select><select aria-label="Optimization objective" value={strategy} onChange={(event) => setStrategy(event.target.value as PlanStrategy)}><option value="space">Best space use</option><option value="balance">Best weight balance</option><option value="unload">Fastest unloading</option><option value="damage">Lowest damage risk</option></select></div>
        <div><Play /><button className={playing ? "active" : ""} onClick={() => { setStop(0); setPlaying(!playing); }}>{playing ? "Stop animation" : "Animate unload"}</button><button onClick={() => window.print()}><Printer />Print manifest</button></div>
      </div>
      <TrailerScene key={`${cameraView}-${cameraReset}`} trailer={trailer} items={plan.items} activeStop={stop} activeLayer={layer} view={cameraView} colorMode={colorMode} exploded={exploded} showLabels={labels} showAxleHeat={axleHeat} focusItem={selected} onSelect={setSelected} />
      <p className="sr-only" aria-live="polite">{plan.items.length} pieces placed across {layers.length} vertical layers. {plan.unplanned.length} pieces are unplanned. Weight utilization is {weight} percent and volume utilization is {volume} percent.</p>
      <div className="layer-filter"><button className={layer === "all" ? "active" : ""} onClick={() => setLayer("all")}>All layers</button>{layers.map((value, index) => <button key={value} className={layer === value ? "active" : ""} onClick={() => setLayer(value)}>L{index + 1} · {value}″</button>)}</div>
      <div className="stop-filter"><button className={stop === 0 ? "active" : ""} onClick={() => setStop(0)}>All stops</button>{uniqueStops.map((value) => <button className={stop === value ? "active" : ""} key={value} onClick={() => setStop(value)}>Stop {value}</button>)}</div>
    </section>

    <aside className="loader-health">
      <p className="kicker">PLAN HEALTH · {plan.engine.toUpperCase()}</p><div className="health-score">{health}<small>/100</small></div>
      <span className="loader-ready" role="status">{loading ? "CALCULATING" : error ? "INPUT NEEDS ATTENTION" : "READY FOR REVIEW"}</span>
      <Metric label="Weight" value={`${plan.totalWeight.toLocaleString()} / ${trailer.capacityLbs.toLocaleString()} lb`} pct={weight} />
      <Metric label="Floor demand" value={`${floor}%`} pct={floor} /><Metric label="Volume used" value={`${volume}%`} pct={volume} /><Metric label="Weight centre" value={`${centrePct}% from nose`} pct={centrePct} />
      <div className="loader-counts"><span><Box />Planned<b>{plan.items.length}</b></span><span><AlertTriangle />Unplanned<b>{plan.unplanned.length}</b></span><span><Layers3 />Layers<b>{layers.length}</b></span><span><Truck />Stops<b>{uniqueStops.length}</b></span></div>
      <h3>VALIDATION</h3>
      <p className={requestedWeight <= trailer.capacityLbs ? "valid" : "warning"}>{requestedWeight <= trailer.capacityLbs ? "✓" : "!"} Shipment weight {requestedWeight <= trailer.capacityLbs ? "is within" : "exceeds"} capacity</p>
      <p className={plan.unplanned.length ? "warning" : "valid"}>{plan.unplanned.length ? `! ${plan.unplanned.length} pieces need review` : "✓ Every piece has a placement"}</p>
      <p className={centrePct >= 35 && centrePct <= 65 ? "valid" : "warning"}>{centrePct >= 35 && centrePct <= 65 ? "✓" : "!"} Weight centre is {centrePct}% from trailer nose</p>
      {!trailer.axleModelVerified && <p className="warning">! Axle geometry is not calibrated; verify axle weights before release.</p>}
      {loads.some((load) => load.estimated ?? true) && <p className="warning">! Estimated dimensions are marked; verify before loading.</p>}
      {plan.warnings.map((warning) => <p className="warning" key={warning}>! {warning}</p>)}
      {selected && <div className="selected-pallet"><button aria-label="Close cargo details" onClick={() => setSelected(null)}>×</button><small>SELECTED CARGO</small><b>{selected.id}</b><p>{selected.destination}</p><span>{selected.length} × {selected.width} × {selected.height} in</span><span>{selected.weightLbs.toLocaleString()} lb · Stop {selected.stop} · Layer {layers.indexOf(selected.z) + 1}</span><div className="placement-actions"><button onClick={() => moveSelected(-6, 0)}>← 6in</button><button onClick={() => moveSelected(6, 0)}>6in →</button><button onClick={() => moveSelected(0, -6)}>← width</button><button onClick={() => moveSelected(0, 6)}>width →</button><button onClick={() => moveSelected(0, 0, true)}>Rotate 90°</button><button className={locked.includes(selected.id) ? "active" : ""} onClick={() => { const isLocked = locked.includes(selected.id); if (isLocked) lockedPlacements.current.delete(selected.id); else lockedPlacements.current.set(selected.id, selected); setLocked((current) => isLocked ? current.filter((id) => id !== selected.id) : [...current, selected.id]); }}><Lock />{locked.includes(selected.id) ? "Unlock" : "Lock"}</button></div></div>}
      {plan.unplanned.length > 0 && <details className="unplanned-list"><summary>Why cargo was left out</summary>{plan.unplanned.map((item) => <p key={item.id}><b>{item.id}</b><span>{item.length} × {item.width} × {item.height} in · {item.weightLbs.toLocaleString()} lb</span><em>{item.unplannedReason ?? "The solver could not satisfy space, weight, stack, floor, or unloading constraints."}</em></p>)}</details>}
      <button className="btn primary full" onClick={() => void savePlanVersion()} disabled={loading || plan.items.length === 0}>Save plan version</button>
      {planMessage && <small className="estimate-note" role="status">{planMessage}</small>}
      {savedPlans.length > 0 && <details className="saved-plans"><summary>Saved plan history ({savedPlans.length})</summary>{savedPlans.map((saved) => <article key={saved.id}><span><b>v{saved.version} · {saved.status}</b><small>{new Date(saved.created_at).toLocaleString()}</small></span><div><button onClick={() => restorePlan(saved)}>Restore</button>{saved.status !== "approved" && onApprovePlan && <button onClick={async () => { if (await onApprovePlan(saved.id)) { setPlanMessage(`Approved version ${saved.version}.`); await refreshSavedPlans(); } }}>Approve</button>}</div></article>)}</details>}
      <button className="btn secondary full" onClick={() => { lockedPlacements.current.clear(); setLocked([]); setLoads(initial); setStop(0); setLayer("all"); void generatePlan(initial); }}><RotateCcw />Reset demo manifest</button>
    </aside>
  </div>;
}

function Metric({ label, value, pct }: { label: string; value: string; pct: number }) {
  return <div className="loader-metric"><span>{label}</span><b>{value}</b><i><em style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></i><small>{pct}%</small></div>;
}
