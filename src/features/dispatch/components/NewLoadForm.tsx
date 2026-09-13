import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { ONTARIO_CITIES } from "../data/ontarioCities";
import { EMPTY_LOAD_DRAFT, EQUIPMENT_TYPES, type FieldEvidence, type LoadDraft, type LoadDraftErrors } from "../lib/loadDraft";

type CreateResult = { ok: true; loadId: string } | { ok: false; errors: LoadDraftErrors };

export function NewLoadForm({ onCreate, onClose, initial, evidence, notice, importer }: {
  onCreate: (draft: LoadDraft) => CreateResult;
  onClose: () => void;
  initial?: Partial<LoadDraft>;
  evidence?: Partial<Record<keyof LoadDraft, FieldEvidence>>;
  notice?: ReactNode;
  importer?: ReactNode;
}) {
  const [draft, setDraft] = useState<LoadDraft>({ ...EMPTY_LOAD_DRAFT, ...initial });
  const [errors, setErrors] = useState<LoadDraftErrors>({});
  const firstField = useRef<HTMLInputElement>(null);
  const prefix = useId();

  useEffect(() => { setDraft({ ...EMPTY_LOAD_DRAFT, ...initial }); setErrors({}); }, [initial]);
  useEffect(() => { firstField.current?.focus(); }, []);

  const set = <K extends keyof LoadDraft>(key: K, value: LoadDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const field = (key: keyof LoadDraft, label: string, control: (id: string, describedBy: string | undefined) => ReactNode) => {
    const id = `${prefix}-${key}`;
    const errorId = errors[key] ? `${id}-error` : undefined;
    const source = evidence?.[key];
    const sourceId = source?.source ? `${id}-source` : undefined;
    return <div className={`load-field${errors[key] ? " invalid" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {control(id, [errorId, sourceId].filter(Boolean).join(" ") || undefined)}
      {source?.source && <small id={sourceId} className="field-source">From document: “{source.source}”{source.confidence !== null ? ` · ${Math.round(source.confidence * 100)}% confidence` : ""}</small>}
      {errors[key] && <small id={errorId} className="field-error" role="alert">{errors[key]}</small>}
    </div>;
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const result = onCreate(draft);
    if (result.ok) onClose();
    else setErrors(result.errors);
  };

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="modal load-form-modal" role="dialog" aria-modal="true" aria-labelledby={`${prefix}-title`} onSubmit={submit} noValidate>
      <button type="button" className="close" aria-label="Close" onClick={onClose}><X /></button>
      <p className="kicker">LOAD BOARD</p>
      <h2 id={`${prefix}-title`}>New load</h2>
      <p className="modal-sub">Nothing is created until you choose Create load. The load starts unassigned and is planned like any other.</p>
      {importer}
      {notice}
      <div className="load-form-grid">
        {field("billNumber", "Bill number", (id, describedBy) => <input ref={firstField} id={id} aria-describedby={describedBy} aria-invalid={Boolean(errors.billNumber)} value={draft.billNumber} onChange={(event) => set("billNumber", event.target.value)} placeholder="RS-9001" />)}
        {field("customer", "Customer", (id, describedBy) => <input id={id} aria-describedby={describedBy} aria-invalid={Boolean(errors.customer)} value={draft.customer} onChange={(event) => set("customer", event.target.value)} />)}
        {field("origin", "Pickup city", (id, describedBy) => <select id={id} aria-describedby={describedBy} aria-invalid={Boolean(errors.origin)} value={draft.origin} onChange={(event) => set("origin", event.target.value)}>
          <option value="">Choose a city</option>
          {ONTARIO_CITIES.map((city) => <option key={city.name} value={city.name}>{city.name}</option>)}
        </select>)}
        {field("destination", "Delivery city", (id, describedBy) => <select id={id} aria-describedby={describedBy} aria-invalid={Boolean(errors.destination)} value={draft.destination} onChange={(event) => set("destination", event.target.value)}>
          <option value="">Choose a city</option>
          {ONTARIO_CITIES.map((city) => <option key={city.name} value={city.name}>{city.name}</option>)}
        </select>)}
        {field("pickupStart", "Pickup opens", (id, describedBy) => <input id={id} type="datetime-local" aria-describedby={describedBy} aria-invalid={Boolean(errors.pickupStart)} value={draft.pickupStart} onChange={(event) => set("pickupStart", event.target.value)} />)}
        {field("pickupEnd", "Pickup closes", (id, describedBy) => <input id={id} type="datetime-local" aria-describedby={describedBy} aria-invalid={Boolean(errors.pickupEnd)} value={draft.pickupEnd} onChange={(event) => set("pickupEnd", event.target.value)} />)}
        {field("deliveryEnd", "Deliver by", (id, describedBy) => <input id={id} type="datetime-local" aria-describedby={describedBy} aria-invalid={Boolean(errors.deliveryEnd)} value={draft.deliveryEnd} onChange={(event) => set("deliveryEnd", event.target.value)} />)}
        {field("equipment", "Equipment", (id, describedBy) => <select id={id} aria-describedby={describedBy} aria-invalid={Boolean(errors.equipment)} value={draft.equipment} onChange={(event) => set("equipment", event.target.value as LoadDraft["equipment"])}>
          <option value="">Choose equipment</option>
          {EQUIPMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>)}
        {field("weightLbs", "Weight (lb)", (id, describedBy) => <input id={id} inputMode="numeric" aria-describedby={describedBy} aria-invalid={Boolean(errors.weightLbs)} value={draft.weightLbs} onChange={(event) => set("weightLbs", event.target.value)} />)}
        {field("pallets", "Pallets", (id, describedBy) => <input id={id} inputMode="numeric" aria-describedby={describedBy} aria-invalid={Boolean(errors.pallets)} value={draft.pallets} onChange={(event) => set("pallets", event.target.value)} />)}
        {field("rate", "Rate (CAD)", (id, describedBy) => <input id={id} inputMode="decimal" aria-describedby={describedBy} aria-invalid={Boolean(errors.rate)} value={draft.rate} onChange={(event) => set("rate", event.target.value)} />)}
        {field("priority", "Priority", (id, describedBy) => <select id={id} aria-describedby={describedBy} value={draft.priority} onChange={(event) => set("priority", event.target.value as LoadDraft["priority"])}>
          <option value="standard">Standard</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>)}
        {field("description", "Commodity", (id, describedBy) => <input id={id} aria-describedby={describedBy} value={draft.description} onChange={(event) => set("description", event.target.value)} />)}
        <div className="load-field load-check">
          <label><input type="checkbox" checked={draft.temperatureControlled} onChange={(event) => set("temperatureControlled", event.target.checked)} /> Temperature controlled</label>
        </div>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn primary">Create load</button>
      </div>
    </form>
  </div>;
}
