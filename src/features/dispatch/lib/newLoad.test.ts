import { describe, expect, it } from "vitest";
import { buildDispatchLoad, validateNewLoad, type NewLoadDraft } from "./newLoad";

const draft: NewLoadDraft = {
  billNumber: "rs-9001", customer: "Acme", description: "Mixed freight", equipment: "Dry Van",
  origin: "Toronto, ON", originPoint: { lat: 43.65, lng: -79.38 }, destination: "Hamilton, ON", destinationPoint: { lat: 43.25, lng: -79.87 },
  pickupStart: "2026-09-14T09:00", pickupEnd: "2026-09-14T10:00", deliveryEnd: "2026-09-14T13:00", rate: 1250, currency: "CAD", priority: "high", additionalStops: [],
  cargoItems: [{ id: "draft", label: "Crates", quantity: 2, lengthIn: 48, widthIn: 40, heightIn: 50, unitWeightLbs: 900, rotatable: true, stackable: false }],
};

describe("new load workflow", () => {
  it("normalizes a multi-piece load and calculates totals", () => {
    const load = buildDispatchLoad(draft);
    expect(load).toMatchObject({ id: "L-9001", billNumber: "RS-9001", pallets: 2, weightLbs: 1800, status: "unassigned" });
    expect(load.cargoItems?.[0].id).toBe("RS-9001-C1");
  });

  it("rejects duplicate IDs and unsafe appointment order", () => {
    const bad = { ...draft, pickupEnd: "2026-09-14T08:00" };
    const errors = validateNewLoad(bad, [buildDispatchLoad(draft)]);
    expect(errors).toContain("RS-9001 already exists.");
    expect(errors).toContain("Pickup must end after it starts and no later than delivery.");
  });

  it("keeps intermediate stops inside the trip window and cargo stop numbers in range", () => {
    const withBadStop: NewLoadDraft = {
      ...draft,
      additionalStops: [{ id: "S1", location: "Milton, ON", point: { lat: 43.52, lng: -79.88 }, appointmentStart: "2026-09-14T08:30", appointmentEnd: "2026-09-14T11:00" }],
      cargoItems: [{ ...draft.cargoItems[0], stop: 3 }],
    };
    const errors = validateNewLoad(withBadStop, []);
    expect(errors).toContain("Stop 1 must be scheduled after pickup and before final delivery.");
    expect(errors).toContain("Cargo item 1 delivery stop must be between 1 and 2.");
  });
});
