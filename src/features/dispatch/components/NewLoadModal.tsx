import { useMemo, useState } from "react";
import { Box, Plus, Trash2, X } from "lucide-react";
import { cityPoints } from "../data/demoData";
import { buildDispatchLoad, validateNewLoad, type NewLoadDraft } from "../lib/newLoad";
import type { DispatchCargoItem, DispatchLoad, DispatchStop, EquipmentType } from "../types";

const localDateTime = (minutesFromNow: number) => {
  const date = new Date(Date.now() + minutesFromNow * 60_000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

const asLocalDateTime = (value: string) => {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

const newCargo = (index: number): DispatchCargoItem => ({
  id: `draft-${index}`,
  label: index ? `Cargo ${index + 1}` : "Standard pallet",
  quantity: 1,
  lengthIn: 48,
  widthIn: 40,
  heightIn: 48,
  unitWeightLbs: 1200,
  rotatable: true,
  stackable: false,
  maxStackWeightLbs: 0,
  floorBearingPsf: 250,
  clearanceIn: 0,
  fragile: false,
  priority: false,
  stop: 1,
});

const newStop = (index: number): DispatchStop => ({
  id: `draft-stop-${index}`,
  location: "Milton, ON",
  point: cityPoints.Milton,
  appointmentStart: localDateTime(180 + index * 60),
  appointmentEnd: localDateTime(240 + index * 60),
});

export function NewLoadModal({
  existing,
  onCreate,
  onClose,
  initial,
}: {
  existing: DispatchLoad[];
  onCreate: (load: DispatchLoad) => boolean;
  onClose: () => void;
  initial?: DispatchLoad;
}) {
  const cities = Object.entries(cityPoints);
  const [step, setStep] = useState<1 | 2>(1);
  const [draft, setDraft] = useState<NewLoadDraft>(() => initial ? {
    billNumber: initial.billNumber, customer: initial.customer, description: initial.description,
    equipment: initial.equipment, origin: initial.origin, originPoint: initial.originPoint,
    destination: initial.destination, destinationPoint: initial.destinationPoint,
    pickupStart: asLocalDateTime(initial.pickupStart), pickupEnd: asLocalDateTime(initial.pickupEnd),
    deliveryEnd: asLocalDateTime(initial.deliveryEnd), rate: initial.rate, currency: initial.currency ?? "CAD",
    priority: initial.priority,
    additionalStops: (initial.additionalStops ?? []).map((stop) => ({ ...stop, appointmentStart: asLocalDateTime(stop.appointmentStart), appointmentEnd: asLocalDateTime(stop.appointmentEnd) })),
    cargoItems: initial.cargoItems?.map((item) => ({ ...item })) ?? [newCargo(0)],
  } : {
    billNumber: `RS-${Math.max(5000, ...existing.map((load) => Number(load.billNumber.match(/\d+/)?.[0] || 0))) + 1}`,
    customer: "",
    description: "",
    equipment: "Dry Van",
    origin: "Milton, ON",
    originPoint: cityPoints.Milton,
    destination: "London, ON",
    destinationPoint: cityPoints.London,
    pickupStart: localDateTime(60),
    pickupEnd: localDateTime(120),
    deliveryEnd: localDateTime(360),
    rate: 0,
    currency: "CAD",
    priority: "standard",
    additionalStops: [],
    cargoItems: [newCargo(0)],
  });
  const [errors, setErrors] = useState<string[]>([]);
  const totals = useMemo(() => ({
    pieces: draft.cargoItems.reduce((sum, item) => sum + (Number.isFinite(item.quantity) ? item.quantity : 0), 0),
    weight: draft.cargoItems.reduce((sum, item) => sum + (Number.isFinite(item.quantity * item.unitWeightLbs) ? item.quantity * item.unitWeightLbs : 0), 0),
  }), [draft.cargoItems]);
  const updateCargo = (index: number, values: Partial<DispatchCargoItem>) => setDraft((current) => ({
    ...current,
    cargoItems: current.cargoItems.map((item, itemIndex) => itemIndex === index ? { ...item, ...values } : item),
  }));
  const selectCity = (field: "origin" | "destination", city: string) => {
    const point = cityPoints[city as keyof typeof cityPoints];
    setDraft((current) => ({ ...current, [field]: `${city}, ON`, [`${field}Point`]: point }));
  };
  const submit = () => {
    const validation = validateNewLoad(draft, existing.filter((load) => load.id !== initial?.id));
    setErrors(validation);
    if (validation.length) return;
    const built = buildDispatchLoad(draft);
    if (!onCreate(initial ? { ...built, id: initial.id } : built)) {
      setErrors(["Your account does not have permission to create loads."]);
      return;
    }
    onClose();
  };

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="modal new-load-modal" role="dialog" aria-modal="true" aria-labelledby="new-load-title" onSubmit={(event) => event.preventDefault()}>
      <button type="button" className="close" aria-label="Close new load dialog" autoFocus onClick={onClose}><X /></button>
      <p className="kicker">{initial ? "EDIT CUSTOMER ORDER" : "NEW CUSTOMER ORDER"}</p>
      <h2 id="new-load-title">{initial ? "Edit dispatch load" : "Create a dispatch-ready load"}</h2>
      <p className="modal-sub">Appointments and cargo are validated before the load enters the shared dispatch workspace.</p>
      <div className="form-steps" aria-label={`Step ${step} of 2`}><span className={step === 1 ? "active" : "complete"}>1 · Order and route</span><span className={step === 2 ? "active" : ""}>2 · Stops and cargo</span></div>
      {errors.length > 0 && <div className="form-errors" role="alert"><b>Review {errors.length} field{errors.length === 1 ? "" : "s"}</b><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
      {step === 1 && <div className="new-load-grid">
        <label>LOAD NUMBER<input value={draft.billNumber} onChange={(event) => setDraft({ ...draft, billNumber: event.target.value })} /></label>
        <label>CUSTOMER<input value={draft.customer} onChange={(event) => setDraft({ ...draft, customer: event.target.value })} placeholder="Customer name" /></label>
        <label className="wide">DESCRIPTION<input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Commodity or handling notes" /></label>
        <label>EQUIPMENT<select value={draft.equipment} onChange={(event) => setDraft({ ...draft, equipment: event.target.value as EquipmentType })}><option>Dry Van</option><option>Reefer</option><option>Flatbed</option></select></label>
        <label>PRIORITY<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as DispatchLoad["priority"] })}><option value="standard">Standard</option><option value="high">High</option><option value="critical">Critical</option></select></label>
        <label>ORIGIN<select value={draft.origin.replace(", ON", "")} onChange={(event) => selectCity("origin", event.target.value)}>{cities.map(([city]) => <option key={city}>{city}</option>)}</select></label>
        <label>DESTINATION<select value={draft.destination.replace(", ON", "")} onChange={(event) => selectCity("destination", event.target.value)}>{cities.map(([city]) => <option key={city}>{city}</option>)}</select></label>
        <label>PICKUP START<input type="datetime-local" value={draft.pickupStart} onChange={(event) => setDraft({ ...draft, pickupStart: event.target.value })} /></label>
        <label>PICKUP END<input type="datetime-local" value={draft.pickupEnd} onChange={(event) => setDraft({ ...draft, pickupEnd: event.target.value })} /></label>
        <label>DELIVER BY<input type="datetime-local" value={draft.deliveryEnd} onChange={(event) => setDraft({ ...draft, deliveryEnd: event.target.value })} /></label>
        <label>RATE ({draft.currency})<input type="number" min="0" step="0.01" value={draft.rate} onChange={(event) => setDraft({ ...draft, rate: Number(event.target.value) })} /></label>
        <label>CURRENCY<select value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value as "CAD" | "USD" })}><option>CAD</option><option>USD</option></select></label>
      </div>}
      {step === 2 && <>
      <div className="cargo-manifest-heading"><div><Box /><span><b>Additional stops</b><small>{draft.additionalStops.length} intermediate appointment{draft.additionalStops.length === 1 ? "" : "s"}</small></span></div><button type="button" className="btn secondary compact" onClick={() => setDraft((current) => ({ ...current, additionalStops: [...current.additionalStops, newStop(current.additionalStops.length)] }))}><Plus />Add stop</button></div>
      <div className="additional-stop-editor">{draft.additionalStops.map((stop, index) => <fieldset key={stop.id}><legend>Stop {index + 1}</legend><label>LOCATION<select value={stop.location.replace(", ON", "")} onChange={(event) => { const city = event.target.value; setDraft((current) => ({ ...current, additionalStops: current.additionalStops.map((item, itemIndex) => itemIndex === index ? { ...item, location: `${city}, ON`, point: cityPoints[city as keyof typeof cityPoints] } : item) })); }}>{cities.map(([city]) => <option key={city}>{city}</option>)}</select></label><label>WINDOW START<input type="datetime-local" value={stop.appointmentStart} onChange={(event) => setDraft((current) => ({ ...current, additionalStops: current.additionalStops.map((item, itemIndex) => itemIndex === index ? { ...item, appointmentStart: event.target.value } : item) }))} /></label><label>WINDOW END<input type="datetime-local" value={stop.appointmentEnd} onChange={(event) => setDraft((current) => ({ ...current, additionalStops: current.additionalStops.map((item, itemIndex) => itemIndex === index ? { ...item, appointmentEnd: event.target.value } : item) }))} /></label><button type="button" className="icon-danger" aria-label={`Remove stop ${index + 1}`} onClick={() => setDraft((current) => ({ ...current, additionalStops: current.additionalStops.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 /></button></fieldset>)}</div>
      <div className="cargo-manifest-heading"><div><Box /><span><b>Cargo manifest</b><small>{totals.pieces} pieces · {totals.weight.toLocaleString()} lb</small></span></div><button type="button" className="btn secondary compact" onClick={() => setDraft((current) => ({ ...current, cargoItems: [...current.cargoItems, newCargo(current.cargoItems.length)] }))}><Plus />Add cargo type</button></div>
      <div className="cargo-manifest-editor">
        {draft.cargoItems.map((item, index) => <fieldset key={item.id}>
          <legend>Cargo type {index + 1}</legend>
          <label>NAME<input value={item.label} onChange={(event) => updateCargo(index, { label: event.target.value })} /></label>
          <label>QTY<input type="number" min="1" step="1" value={item.quantity} onChange={(event) => updateCargo(index, { quantity: Number(event.target.value) })} /></label>
          <label>LENGTH (IN)<input type="number" min="1" value={item.lengthIn} onChange={(event) => updateCargo(index, { lengthIn: Number(event.target.value) })} /></label>
          <label>WIDTH (IN)<input type="number" min="1" value={item.widthIn} onChange={(event) => updateCargo(index, { widthIn: Number(event.target.value) })} /></label>
          <label>HEIGHT (IN)<input type="number" min="1" value={item.heightIn} onChange={(event) => updateCargo(index, { heightIn: Number(event.target.value) })} /></label>
          <label>UNIT LB<input type="number" min="1" value={item.unitWeightLbs} onChange={(event) => updateCargo(index, { unitWeightLbs: Number(event.target.value) })} /></label>
          <label>CLEARANCE (IN)<input type="number" min="0" value={item.clearanceIn ?? 0} onChange={(event) => updateCargo(index, { clearanceIn: Number(event.target.value) })} /></label>
          <label>MAX STACK LB<input type="number" min="0" value={item.maxStackWeightLbs ?? 0} onChange={(event) => updateCargo(index, { maxStackWeightLbs: Number(event.target.value) })} /></label>
          <label>FLOOR LIMIT PSF<input type="number" min="1" value={item.floorBearingPsf ?? 250} onChange={(event) => updateCargo(index, { floorBearingPsf: Number(event.target.value) })} /></label>
          <label>DELIVERY STOP<input type="number" min="1" step="1" value={item.stop ?? 1} onChange={(event) => updateCargo(index, { stop: Number(event.target.value) })} /></label>
          <label className="check"><input type="checkbox" checked={item.rotatable} onChange={(event) => updateCargo(index, { rotatable: event.target.checked })} />May rotate</label>
          <label className="check"><input type="checkbox" checked={item.stackable} onChange={(event) => updateCargo(index, { stackable: event.target.checked })} />May stack</label>
          <label className="check"><input type="checkbox" checked={item.fragile ?? false} onChange={(event) => updateCargo(index, { fragile: event.target.checked })} />Fragile</label>
          <label className="check"><input type="checkbox" checked={item.priority ?? false} onChange={(event) => updateCargo(index, { priority: event.target.checked })} />Priority cargo</label>
          <button type="button" className="icon-danger" aria-label={`Remove cargo type ${index + 1}`} disabled={draft.cargoItems.length === 1} onClick={() => setDraft((current) => ({ ...current, cargoItems: current.cargoItems.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 /></button>
        </fieldset>)}
      </div>
      </>}
      <div className="modal-actions"><button type="button" className="btn secondary" onClick={step === 1 ? onClose : () => setStep(1)}>{step === 1 ? "Cancel" : "Back"}</button>{step === 1 ? <button className="btn primary" type="button" onClick={() => { const validation = validateNewLoad(draft, existing.filter((load) => load.id !== initial?.id)); const firstStepErrors = validation.filter((error) => !error.startsWith("Cargo item") && !error.startsWith("Stop ") && error !== "Add at least one cargo item."); setErrors(firstStepErrors); if (!firstStepErrors.length) setStep(2); }}>Continue to cargo</button> : <button className="btn primary" type="button" onClick={submit}>{initial ? "Save changes" : "Create load"}</button>}</div>
    </form>
  </div>;
}
