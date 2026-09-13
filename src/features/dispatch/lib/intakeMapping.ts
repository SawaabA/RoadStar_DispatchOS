import { findOntarioCity } from "../data/ontarioCities";
import type { FieldEvidence, LoadDraft } from "./loadDraft";

// Turns what the model read from a rate confirmation into a pre-filled draft.
// Every interpretation happens here, in code: dates, time windows, equipment
// and cities. Anything ambiguous or outside RoadStar's model is left blank
// with a note, so the dispatcher decides instead of the model guessing.

export type RateConfirmationExtraction = {
  fields: Record<string, unknown>;
  sourceSpans?: Record<string, string | null>;
  confidence?: Record<string, number | null>;
};

export type IntakeMapping = {
  draft: Partial<LoadDraft>;
  evidence: Partial<Record<keyof LoadDraft, FieldEvidence>>;
  notes: string[];
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (value: number) => String(value).padStart(2, "0");

function calendarDate(year: number, month: number, day: number, text: string): { value: string | null; note?: string } {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { value: null, note: `“${text}” is not a real date. Enter it from the document.` };
  }
  return { value: `${year}-${pad(month)}-${pad(day)}` };
}

export function parseDocumentDate(text: string | null): { value: string | null; note?: string } {
  if (!text) return { value: null };
  const trimmed = text.trim();

  let match = trimmed.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (match) return calendarDate(Number(match[1]), Number(match[2]), Number(match[3]), trimmed);

  match = trimmed.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (match) {
    const first = Number(match[1]), second = Number(match[2]), year = Number(match[3]);
    if (first > 12 && second <= 12) return calendarDate(year, second, first, trimmed);
    if (second > 12 && first <= 12) return calendarDate(year, first, second, trimmed);
    if (first === second) return calendarDate(year, first, second, trimmed);
    // Canadian documents use both orders, so 03/04 could be March 4 or April 3.
    return { value: null, note: `“${trimmed}” could be month/day or day/month. Enter the date from the document.` };
  }

  match = trimmed.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (match) {
    const month = MONTHS.indexOf(match[1]!.slice(0, 3).toLowerCase()) + 1;
    if (month) return calendarDate(Number(match[3]), month, Number(match[2]), trimmed);
  }
  match = trimmed.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/);
  if (match) {
    const month = MONTHS.indexOf(match[2]!.slice(0, 3).toLowerCase()) + 1;
    if (month) return calendarDate(Number(match[3]), month, Number(match[1]), trimmed);
  }
  return { value: null, note: `The date “${trimmed}” could not be read. Enter it from the document.` };
}

export function parseTimeWindow(text: string | null): { start: string | null; end: string | null } {
  if (!text) return { start: null, end: null };
  const times = [...text.matchAll(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/gi)]
    .map((match) => {
      let hour = Number(match[1]);
      const minute = Number(match[2]);
      const meridiem = match[3]?.toLowerCase().replace(/\./g, "");
      if (meridiem === "pm" && hour < 12) hour += 12;
      if (meridiem === "am" && hour === 12) hour = 0;
      return hour < 24 && minute < 60 ? `${pad(hour)}:${pad(minute)}` : null;
    })
    .filter((value): value is string => value !== null);
  if (!times.length) return { start: null, end: null };
  // A single time ("by 15:00") is both ends of the window.
  return { start: times[0]!, end: times[times.length - 1]! };
}

export function mapRateConfirmation(extraction: RateConfirmationExtraction): IntakeMapping {
  const fields = extraction.fields ?? {};
  const spans = extraction.sourceSpans ?? {};
  const confidence = extraction.confidence ?? {};
  const draft: Partial<LoadDraft> = {};
  const evidence: Partial<Record<keyof LoadDraft, FieldEvidence>> = {};
  const notes: string[] = [];

  const text = (key: string) => (typeof fields[key] === "string" && (fields[key] as string).trim() ? (fields[key] as string).trim() : null);
  const number = (key: string) => (typeof fields[key] === "number" && Number.isFinite(fields[key]) ? (fields[key] as number) : null);
  const cite = (target: keyof LoadDraft, ...keys: string[]) => {
    const sources = keys.map((key) => spans[key]).filter((value): value is string => Boolean(value));
    if (!sources.length) return;
    const scores = keys.map((key) => confidence[key]).filter((value): value is number => typeof value === "number");
    evidence[target] = { source: sources.join(" · "), confidence: scores.length ? Math.min(...scores) : null };
  };

  const reference = text("reference_number");
  if (reference) { draft.billNumber = reference.replace(/\s+/g, "-"); cite("billNumber", "reference_number"); }
  const customer = text("customer");
  if (customer) { draft.customer = customer; cite("customer", "customer"); }
  const commodity = text("commodity");
  if (commodity) { draft.description = commodity; cite("description", "commodity"); }

  for (const [key, label] of [["origin", "Pickup"], ["destination", "Delivery"]] as const) {
    const raw = text(key);
    if (!raw) continue;
    const city = findOntarioCity(raw);
    if (city) { draft[key] = city.name; cite(key, key); }
    else notes.push(`${label} city “${raw}” is not in the service-area list. Choose a listed city or check the document.`);
  }

  const pickupDate = parseDocumentDate(text("pickup_date"));
  if (pickupDate.note) notes.push(`Pickup: ${pickupDate.note}`);
  const pickupWindow = parseTimeWindow(text("pickup_window"));
  if (pickupDate.value && pickupWindow.start) {
    draft.pickupStart = `${pickupDate.value}T${pickupWindow.start}`;
    draft.pickupEnd = `${pickupDate.value}T${pickupWindow.end}`;
    cite("pickupStart", "pickup_date", "pickup_window");
    cite("pickupEnd", "pickup_date", "pickup_window");
  } else if (pickupDate.value) {
    notes.push("Pickup has a date but no time. Enter the appointment window from the document.");
  }

  const deliveryDate = parseDocumentDate(text("delivery_date"));
  if (deliveryDate.note) notes.push(`Delivery: ${deliveryDate.note}`);
  const deliveryWindow = parseTimeWindow(text("delivery_window"));
  if (deliveryDate.value && deliveryWindow.end) {
    draft.deliveryEnd = `${deliveryDate.value}T${deliveryWindow.end}`;
    cite("deliveryEnd", "delivery_date", "delivery_window");
  } else if (deliveryDate.value) {
    notes.push("Delivery has a date but no time. Enter the deadline from the document.");
  }

  const equipment = text("equipment");
  if (equipment) {
    const type = /reefer|refrigerat/i.test(equipment) ? "Reefer" : /flat\s*bed/i.test(equipment) ? "Flatbed" : /\bvan\b/i.test(equipment) ? "Dry Van" : null;
    if (type) { draft.equipment = type; cite("equipment", "equipment"); }
    else notes.push(`Equipment “${equipment}” is not Dry Van, Reefer or Flatbed. Choose it manually.`);
  }

  const weight = number("weight_lbs");
  if (weight !== null && Number.isInteger(weight)) { draft.weightLbs = String(weight); cite("weightLbs", "weight_lbs"); }
  const pallets = number("pallets");
  if (pallets !== null && Number.isInteger(pallets)) { draft.pallets = String(pallets); cite("pallets", "pallets"); }

  const rate = number("rate_amount");
  const currency = text("currency");
  if (rate !== null) {
    if (currency && !/^(cad|c\$|can)/i.test(currency)) {
      notes.push(`The rate is in ${currency}. RoadStar records rates in CAD and does not convert currency, so enter the CAD amount.`);
    } else {
      draft.rate = rate.toFixed(2).replace(/\.00$/, "");
      cite("rate", "rate_amount");
    }
  }

  if (fields.temperature_controlled === true) { draft.temperatureControlled = true; cite("temperatureControlled", "temperature_controlled"); }

  return { draft, evidence, notes };
}
