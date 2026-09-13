import { describe, expect, it } from "vitest";
import { createDemoState } from "../data/demoData";
import { findOntarioCity } from "../data/ontarioCities";
import { buildMorningPlan } from "./optimizer";
import { addLoad } from "./stateTransitions";
import { isDispatchState } from "./stateValidation";
import { draftToLoad, EMPTY_LOAD_DRAFT, validateLoadDraft, type LoadDraft } from "./loadDraft";

const valid: LoadDraft = {
  ...EMPTY_LOAD_DRAFT,
  billNumber: "RS-9001",
  customer: "Maple Freight Brokerage",
  description: "Automotive components",
  origin: "Guelph",
  destination: "Hamilton",
  pickupStart: "2026-09-14T08:00",
  pickupEnd: "2026-09-14T10:00",
  deliveryEnd: "2026-09-14T15:00",
  equipment: "Dry Van",
  weightLbs: "22000",
  pallets: "12",
  rate: "1,450.00",
};

describe("city matching", () => {
  it("matches the way documents write Ontario cities", () => {
    expect(findOntarioCity("Milton, ON")?.name).toBe("Milton");
    expect(findOntarioCity("St. Catharines, Ontario")?.name).toBe("St. Catharines");
    expect(findOntarioCity("saint catharines")?.name).toBe("St. Catharines");
    expect(findOntarioCity("  richmond   hill ")?.name).toBe("Richmond Hill");
  });

  it("never guesses: partial names and cities outside the list do not match", () => {
    expect(findOntarioCity("Milt")).toBeNull();
    expect(findOntarioCity("Romulus, MI")).toBeNull();
    expect(findOntarioCity("")).toBeNull();
  });
});

describe("new load validation", () => {
  const { loads } = createDemoState();

  it("accepts a complete draft", () => {
    expect(validateLoadDraft(valid, loads)).toEqual({});
  });

  it("names every missing field", () => {
    expect(Object.keys(validateLoadDraft(EMPTY_LOAD_DRAFT, loads)).sort()).toEqual(
      ["billNumber", "customer", "deliveryEnd", "destination", "equipment", "origin", "pallets", "pickupEnd", "pickupStart", "rate", "weightLbs"].sort(),
    );
  });

  it("refuses a bill number that already exists, ignoring case", () => {
    expect(validateLoadDraft({ ...valid, billNumber: "rs-4521" }, loads).billNumber).toContain("already exists");
  });

  it("refuses a delivery city equal to pickup and times out of order", () => {
    const errors = validateLoadDraft({ ...valid, destination: "Guelph", pickupEnd: "2026-09-14T07:00", deliveryEnd: "2026-09-14T08:00" }, loads);
    expect(errors.destination).toContain("different city");
    expect(errors.pickupEnd).toContain("after it opens");
    expect(errors.deliveryEnd).toContain("after pickup opens");
  });

  it("requires a reefer for temperature-controlled freight", () => {
    expect(validateLoadDraft({ ...valid, temperatureControlled: true }, loads).equipment).toContain("Reefer");
    expect(validateLoadDraft({ ...valid, temperatureControlled: true, equipment: "Reefer" }, loads).equipment).toBeUndefined();
  });

  it("bounds weight, pallets and rate", () => {
    const errors = validateLoadDraft({ ...valid, weightLbs: "90000", pallets: "31", rate: "abc" }, loads);
    expect(errors).toMatchObject({ weightLbs: expect.any(String), pallets: expect.any(String), rate: expect.any(String) });
  });
});

describe("creating a load", () => {
  it("builds an unassigned load with list coordinates and ISO times", () => {
    const { loads } = createDemoState();
    const load = draftToLoad(valid, loads);
    expect(load).toMatchObject({ id: "L-RS9001", status: "unassigned", origin: "Guelph, ON", destination: "Hamilton, ON", weightLbs: 22000, pallets: 12, rate: 1450 });
    expect(load.originPoint).toEqual(findOntarioCity("Guelph")!.point);
    expect(Date.parse(load.pickupStart)).toBe(new Date("2026-09-14T08:00").getTime());
  });

  it("keeps ids unique and safe to use as a storage folder", () => {
    const state = createDemoState();
    const first = draftToLoad(valid, state.loads);
    const second = draftToLoad({ ...valid, billNumber: "RS 9001" }, [...state.loads, first]);
    expect(second.id).toBe("L-RS9001-2");
    expect(second.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/);
  });

  it("adds the load to a state that still validates, and the optimizer plans it", () => {
    const state = createDemoState();
    const load = draftToLoad(valid, state.loads);
    const next = addLoad(state, load);
    expect(next.loads).toHaveLength(state.loads.length + 1);
    expect(isDispatchState(next)).toBe(true);
    const plan = buildMorningPlan(next.loads, next.drivers, next.trailers, next.trucks);
    const planned = [...plan.candidates.map((item) => item.loadId), ...plan.rejectedLoads.map((item) => item.loadId)];
    expect(planned).toContain(load.id);
  });

  it("refuses a duplicate rather than overwriting an existing load", () => {
    const state = createDemoState();
    const load = draftToLoad(valid, state.loads);
    const once = addLoad(state, load);
    expect(addLoad(once, { ...load, customer: "Someone else" })).toBe(once);
  });
});
