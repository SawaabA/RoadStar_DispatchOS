import { describe, expect, it } from "vitest";
import { normalizeTmsLoad, resolveSyncDecision, retryDelayMs } from "../services/integration-gateway/tms-contract.mjs";

const load = { externalId: "X-1", customer: "Acme", origin: "Milton, ON", destination: "London, ON", pickupAt: "2026-09-13T12:00:00Z", deliveryAt: "2026-09-13T14:00:00Z", equipment: "dry-van", pieces: 2, weightLbs: 2000, rateCad: 900 };

describe("vendor-neutral TMS contract", () => {
  it("normalizes a valid load and rejects partial records", () => {
    expect(normalizeTmsLoad(load)).toMatchObject({ externalId: "X-1", pieces: 2 });
    expect(() => normalizeTmsLoad({ ...load, customer: "" })).toThrow(/missing/);
    expect(() => normalizeTmsLoad({ ...load, pieces: 0 })).toThrow(/invalid/);
  });
  it("uses explicit authority and timestamps to resolve two-way conflicts", () => {
    expect(resolveSyncDecision({ localUpdatedAt: "2026-09-13T13:00:00Z", externalUpdatedAt: "2026-09-13T12:00:00Z", authoritative: "roadstar" }).action).toBe("queue-outbound");
    expect(resolveSyncDecision({ localUpdatedAt: "2026-09-13T13:00:00Z", externalUpdatedAt: "2026-09-13T12:00:00Z", authoritative: "tms" }).action).toBe("apply-inbound");
  });
  it("caps exponential retry delay", () => expect(retryDelayMs(99)).toBeLessThanOrEqual(300_000));
});
