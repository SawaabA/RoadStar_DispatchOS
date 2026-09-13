import { describe, expect, it } from "vitest";
import { createDemoState } from "../data/demoData";
import { mapRateConfirmation, parseDocumentDate, parseTimeWindow } from "./intakeMapping";
import { EMPTY_LOAD_DRAFT, validateLoadDraft } from "./loadDraft";

// The fields spur-glm-5-2 returned for a real rate confirmation in the live run.
const LIVE = {
  fields: {
    customer: "Maple Freight Brokerage", reference_number: "MF-88213", origin: "Milton, ON", destination: "London, ON",
    pickup_date: "09/14/2026", pickup_window: "08:00-10:00", delivery_date: "09/14/2026", delivery_window: "by 15:00",
    equipment: "53' Dry Van", weight_lbs: 31200, pallets: 18, rate_amount: 1850, currency: "CAD",
    temperature_controlled: false, commodity: "Automotive components",
  },
  sourceSpans: { reference_number: "Load #: MF-88213", weight_lbs: "Weight: 31,200 lbs", pickup_date: "09/14/2026", pickup_window: "08:00-10:00" },
  confidence: { reference_number: 0.95, weight_lbs: 0.9, pickup_date: 0.9, pickup_window: 0.8 },
};

describe("document dates and times", () => {
  it("reads unambiguous numeric, ISO and written dates", () => {
    expect(parseDocumentDate("09/14/2026").value).toBe("2026-09-14");
    expect(parseDocumentDate("14/09/2026").value).toBe("2026-09-14");
    expect(parseDocumentDate("2026-09-14").value).toBe("2026-09-14");
    expect(parseDocumentDate("Sep. 14, 2026").value).toBe("2026-09-14");
    expect(parseDocumentDate("14 September 2026").value).toBe("2026-09-14");
  });

  it("refuses to guess a date that could be month/day or day/month", () => {
    const result = parseDocumentDate("03/04/2026");
    expect(result.value).toBeNull();
    expect(result.note).toContain("month/day or day/month");
  });

  it("rejects impossible dates", () => {
    expect(parseDocumentDate("02/30/2026").value).toBeNull();
  });

  it("reads windows, single deadlines and 12-hour times", () => {
    expect(parseTimeWindow("08:00-10:00")).toEqual({ start: "08:00", end: "10:00" });
    expect(parseTimeWindow("by 15:00")).toEqual({ start: "15:00", end: "15:00" });
    expect(parseTimeWindow("1:30 p.m. to 3:00 PM")).toEqual({ start: "13:30", end: "15:00" });
    expect(parseTimeWindow("12:15 am")).toEqual({ start: "00:15", end: "00:15" });
    expect(parseTimeWindow("anytime")).toEqual({ start: null, end: null });
  });
});

describe("rate confirmation to new load", () => {
  it("turns the live extraction into a draft the form accepts as-is", () => {
    const { draft, evidence, notes } = mapRateConfirmation(LIVE);
    expect(draft).toMatchObject({
      billNumber: "MF-88213", customer: "Maple Freight Brokerage", description: "Automotive components",
      origin: "Milton", destination: "London", pickupStart: "2026-09-14T08:00", pickupEnd: "2026-09-14T10:00",
      deliveryEnd: "2026-09-14T15:00", equipment: "Dry Van", weightLbs: "31200", pallets: "18", rate: "1850",
    });
    expect(notes).toEqual([]);
    expect(evidence.weightLbs).toEqual({ source: "Weight: 31,200 lbs", confidence: 0.9 });
    expect(evidence.pickupStart).toEqual({ source: "09/14/2026 · 08:00-10:00", confidence: 0.8 });
    expect(validateLoadDraft({ ...EMPTY_LOAD_DRAFT, ...draft }, createDemoState().loads)).toEqual({});
  });

  it("leaves a city outside the service area blank and says so", () => {
    const { draft, notes } = mapRateConfirmation({ fields: { ...LIVE.fields, destination: "Romulus, MI" } });
    expect(draft.destination).toBeUndefined();
    expect(notes.join(" ")).toContain("Romulus, MI");
  });

  it("does not convert a USD rate", () => {
    const { draft, notes } = mapRateConfirmation({ fields: { ...LIVE.fields, rate_amount: 1400, currency: "USD" } });
    expect(draft.rate).toBeUndefined();
    expect(notes.join(" ")).toContain("does not convert currency");
  });

  it("leaves pickup blank when only a date is known, instead of inventing a time", () => {
    const { draft, notes } = mapRateConfirmation({ fields: { ...LIVE.fields, pickup_window: null } });
    expect(draft.pickupStart).toBeUndefined();
    expect(notes.join(" ")).toContain("no time");
  });

  it("maps equipment by keyword and refuses anything else", () => {
    expect(mapRateConfirmation({ fields: { equipment: "53ft Refrigerated trailer" } }).draft.equipment).toBe("Reefer");
    expect(mapRateConfirmation({ fields: { equipment: "Flat bed w/ tarps" } }).draft.equipment).toBe("Flatbed");
    const tanker = mapRateConfirmation({ fields: { equipment: "Tanker" } });
    expect(tanker.draft.equipment).toBeUndefined();
    expect(tanker.notes[0]).toContain("Tanker");
  });

  it("fills nothing the model did not read", () => {
    expect(mapRateConfirmation({ fields: {} })).toEqual({ draft: {}, evidence: {}, notes: [] });
  });
});
