import { findOntarioCity } from "../data/ontarioCities";
import type { DispatchLoad, EquipmentType } from "../types";

export const EQUIPMENT_TYPES: EquipmentType[] = ["Dry Van", "Reefer", "Flatbed"];

// What the new-load form edits. Numbers stay as the strings the dispatcher
// typed until validation, and times are datetime-local values.
export type LoadDraft = {
  billNumber: string;
  customer: string;
  description: string;
  origin: string;
  destination: string;
  pickupStart: string;
  pickupEnd: string;
  deliveryEnd: string;
  equipment: EquipmentType | "";
  weightLbs: string;
  pallets: string;
  rate: string;
  temperatureControlled: boolean;
  priority: DispatchLoad["priority"];
};

export type LoadDraftErrors = Partial<Record<keyof LoadDraft, string>>;

// Where an imported value came from, shown beside the field it filled so the
// dispatcher can check it against the document before creating the load.
export type FieldEvidence = { source: string | null; confidence: number | null };

export const EMPTY_LOAD_DRAFT: LoadDraft = {
  billNumber: "",
  customer: "",
  description: "",
  origin: "",
  destination: "",
  pickupStart: "",
  pickupEnd: "",
  deliveryEnd: "",
  equipment: "",
  weightLbs: "",
  pallets: "",
  rate: "",
  temperatureControlled: false,
  priority: "standard",
};

const whole = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value.trim()) : null);
const amount = (value: string) => (/^\d+(\.\d{1,2})?$/.test(value.trim().replace(/,/g, "")) ? Number(value.trim().replace(/,/g, "")) : null);
const time = (value: string) => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

export function validateLoadDraft(draft: LoadDraft, existing: DispatchLoad[]): LoadDraftErrors {
  const errors: LoadDraftErrors = {};
  const bill = draft.billNumber.trim();
  if (!bill) errors.billNumber = "Enter a bill number.";
  else if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/.test(bill)) errors.billNumber = "Use letters, numbers and hyphens only.";
  else if (existing.some((load) => load.billNumber.toLowerCase() === bill.toLowerCase())) errors.billNumber = `${bill} already exists.`;

  if (!draft.customer.trim()) errors.customer = "Enter the customer.";
  else if (draft.customer.trim().length > 80) errors.customer = "Keep the customer under 80 characters.";

  if (!findOntarioCity(draft.origin)) errors.origin = "Choose a pickup city from the list.";
  if (!findOntarioCity(draft.destination)) errors.destination = "Choose a delivery city from the list.";
  else if (findOntarioCity(draft.origin)?.name === findOntarioCity(draft.destination)?.name) {
    errors.destination = "Delivery must be in a different city from pickup.";
  }

  const pickupStart = time(draft.pickupStart), pickupEnd = time(draft.pickupEnd), deliveryEnd = time(draft.deliveryEnd);
  if (pickupStart === null) errors.pickupStart = "Enter when pickup opens.";
  if (pickupEnd === null) errors.pickupEnd = "Enter when pickup closes.";
  else if (pickupStart !== null && pickupEnd < pickupStart) errors.pickupEnd = "Pickup must close after it opens.";
  if (deliveryEnd === null) errors.deliveryEnd = "Enter the delivery deadline.";
  else if (pickupStart !== null && deliveryEnd <= pickupStart) errors.deliveryEnd = "Delivery must be after pickup opens.";

  if (!draft.equipment || !EQUIPMENT_TYPES.includes(draft.equipment)) errors.equipment = "Choose the equipment.";
  else if (draft.temperatureControlled && draft.equipment !== "Reefer") errors.equipment = "Temperature-controlled freight needs a Reefer.";

  const weight = whole(draft.weightLbs);
  if (weight === null || weight < 1 || weight > 80_000) errors.weightLbs = "Enter a weight between 1 and 80,000 lb.";
  const pallets = whole(draft.pallets);
  if (pallets === null || pallets > 30) errors.pallets = "Enter 0 to 30 pallets.";
  const rate = amount(draft.rate);
  if (rate === null || rate > 100_000) errors.rate = "Enter the rate in dollars, up to 100,000.";

  return errors;
}

// Builds the load a valid draft describes. The id is path-safe, because
// documents are stored under it, and never collides with an existing load.
export function draftToLoad(draft: LoadDraft, existing: DispatchLoad[]): DispatchLoad {
  const origin = findOntarioCity(draft.origin)!;
  const destination = findOntarioCity(draft.destination)!;
  const base = `L-${draft.billNumber.trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`;
  let id = base;
  for (let suffix = 2; existing.some((load) => load.id === id); suffix += 1) id = `${base}-${suffix}`;
  return {
    id,
    billNumber: draft.billNumber.trim(),
    customer: draft.customer.trim(),
    description: draft.description.trim(),
    status: "unassigned",
    equipment: draft.equipment as EquipmentType,
    origin: `${origin.name}, ON`,
    originPoint: origin.point,
    destination: `${destination.name}, ON`,
    destinationPoint: destination.point,
    pickupStart: new Date(draft.pickupStart).toISOString(),
    pickupEnd: new Date(draft.pickupEnd).toISOString(),
    deliveryEnd: new Date(draft.deliveryEnd).toISOString(),
    weightLbs: Number(draft.weightLbs.trim()),
    pallets: Number(draft.pallets.trim()),
    temperatureControlled: draft.temperatureControlled,
    rate: Number(draft.rate.trim().replace(/,/g, "")),
    priority: draft.priority,
  };
}
