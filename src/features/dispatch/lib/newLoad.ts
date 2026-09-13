import type { Coordinates, DispatchCargoItem, DispatchLoad, DispatchStop, EquipmentType } from "../types";

export type NewLoadDraft = {
  billNumber: string;
  customer: string;
  description: string;
  equipment: EquipmentType;
  origin: string;
  originPoint: Coordinates;
  destination: string;
  destinationPoint: Coordinates;
  pickupStart: string;
  pickupEnd: string;
  deliveryEnd: string;
  rate: number;
  currency: "CAD" | "USD";
  priority: DispatchLoad["priority"];
  additionalStops: DispatchStop[];
  cargoItems: DispatchCargoItem[];
};

export function validateNewLoad(draft: NewLoadDraft, existing: DispatchLoad[]): string[] {
  const errors: string[] = [];
  const bill = draft.billNumber.trim().toUpperCase();
  if (!bill) errors.push("Enter a load number.");
  if (existing.some((load) => load.billNumber.toUpperCase() === bill)) errors.push(`${bill} already exists.`);
  if (!draft.customer.trim()) errors.push("Enter a customer.");
  if (!draft.description.trim()) errors.push("Enter a cargo description.");
  if (!draft.origin || !draft.destination) errors.push("Select an origin and destination.");
  if (draft.origin === draft.destination) errors.push("Origin and destination must be different.");
  const pickupStart = Date.parse(draft.pickupStart);
  const pickupEnd = Date.parse(draft.pickupEnd);
  const deliveryEnd = Date.parse(draft.deliveryEnd);
  if (![pickupStart, pickupEnd, deliveryEnd].every(Number.isFinite)) errors.push("Enter valid appointment times.");
  else if (!(pickupStart < pickupEnd && pickupEnd <= deliveryEnd)) errors.push("Pickup must end after it starts and no later than delivery.");
  if (!Number.isFinite(draft.rate) || draft.rate < 0) errors.push("Rate must be zero or greater.");
  for (const [index, stop] of draft.additionalStops.entries()) {
    if (!stop.location.trim()) errors.push(`Stop ${index + 1} requires a location.`);
    const appointmentStart = Date.parse(stop.appointmentStart);
    const appointmentEnd = Date.parse(stop.appointmentEnd);
    if (![appointmentStart, appointmentEnd].every(Number.isFinite) || appointmentEnd < appointmentStart) errors.push(`Stop ${index + 1} requires a valid appointment window.`);
    else if (Number.isFinite(pickupEnd) && Number.isFinite(deliveryEnd) && (appointmentStart < pickupEnd || appointmentEnd > deliveryEnd)) errors.push(`Stop ${index + 1} must be scheduled after pickup and before final delivery.`);
    if (draft.additionalStops.some((candidate, candidateIndex) => candidateIndex !== index && candidate.id === stop.id)) errors.push(`Stop ${index + 1} has a duplicate identifier.`);
  }
  if (!draft.cargoItems.length) errors.push("Add at least one cargo item.");
  for (const [index, item] of draft.cargoItems.entries()) {
    const label = `Cargo item ${index + 1}`;
    if (!item.label.trim()) errors.push(`${label} needs a name.`);
    if (!Number.isInteger(item.quantity) || item.quantity < 1) errors.push(`${label} quantity must be a positive whole number.`);
    if (![item.lengthIn, item.widthIn, item.heightIn, item.unitWeightLbs].every((value) => Number.isFinite(value) && value > 0)) errors.push(`${label} dimensions and unit weight must be positive.`);
    if (item.clearanceIn !== undefined && (!Number.isFinite(item.clearanceIn) || item.clearanceIn < 0)) errors.push(`${label} clearance cannot be negative.`);
    if (item.maxStackWeightLbs !== undefined && (!Number.isFinite(item.maxStackWeightLbs) || item.maxStackWeightLbs < 0)) errors.push(`${label} maximum stack weight cannot be negative.`);
    if (item.floorBearingPsf !== undefined && (!Number.isFinite(item.floorBearingPsf) || item.floorBearingPsf <= 0)) errors.push(`${label} floor-bearing limit must be positive.`);
    if (item.stop !== undefined && (!Number.isInteger(item.stop) || item.stop < 1 || item.stop > draft.additionalStops.length + 1)) errors.push(`${label} delivery stop must be between 1 and ${draft.additionalStops.length + 1}.`);
  }
  return errors;
}

export function buildDispatchLoad(draft: NewLoadDraft): DispatchLoad {
  const billNumber = draft.billNumber.trim().toUpperCase();
  const cargoItems = draft.cargoItems.map((item, index) => ({ ...item, id: `${billNumber}-C${index + 1}`, label: item.label.trim() }));
  return {
    id: `L-${billNumber.replace(/^RS-/i, "").replace(/[^A-Z0-9-]/g, "-")}`,
    billNumber,
    customer: draft.customer.trim(),
    description: draft.description.trim(),
    status: "unassigned",
    equipment: draft.equipment,
    origin: draft.origin,
    originPoint: draft.originPoint,
    destination: draft.destination,
    destinationPoint: draft.destinationPoint,
    pickupStart: new Date(draft.pickupStart).toISOString(),
    pickupEnd: new Date(draft.pickupEnd).toISOString(),
    deliveryEnd: new Date(draft.deliveryEnd).toISOString(),
    weightLbs: cargoItems.reduce((sum, item) => sum + item.quantity * item.unitWeightLbs, 0),
    pallets: cargoItems.reduce((sum, item) => sum + item.quantity, 0),
    temperatureControlled: draft.equipment === "Reefer",
    rate: draft.rate,
    currency: draft.currency,
    priority: draft.priority,
    additionalStops: draft.additionalStops.map((stop) => ({ ...stop, appointmentStart: new Date(stop.appointmentStart).toISOString(), appointmentEnd: new Date(stop.appointmentEnd).toISOString() })),
    cargoItems,
  };
}
