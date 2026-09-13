import { describe, expect, it } from "vitest";
import { validateTelemetryEvent } from "./telemetryValidation";

const now = Date.parse("2026-09-13T12:00:00Z");
const event = { truckId: "T-067", point: { lat: 43.65, lng: -79.38 }, progress: 0.5, speedKph: 82, distanceKm: 157.4, recordedAt: "2026-09-13T12:00:00Z" };
const options = { knownTruckIds: new Set(["T-067"]), now };

describe("vendor-neutral telemetry boundary", () => {
  it('preserves valid seeded incidents while rejecting malformed or cross-truck incidents', () => {
    const incident = { id: 'incident-1', kind: 'closure', label: 'Lane closed', detail: 'Delay ahead', severity: 'warning', truckId: event.truckId, startedAt: event.recordedAt };
    expect(validateTelemetryEvent({ ...event, event: incident }, options).event?.event).toEqual(incident);
    expect(validateTelemetryEvent({ ...event, event: { ...incident, truckId: 'T-OTHER' } }, options).reason).toContain('incident');
    expect(validateTelemetryEvent({ ...event, event: {} }, options).reason).toContain('incident');
  });
  it("accepts a complete current event", () => expect(validateTelemetryEvent(event, options).event).toEqual(event));
  it("rejects unknown trucks and missing coordinates", () => {
    expect(validateTelemetryEvent({ ...event, truckId: "UNKNOWN" }, options).reason).toBe("unknown truck");
    expect(validateTelemetryEvent({ ...event, point: { lat: Number.NaN, lng: -79 } }, options).reason).toBe("missing numeric field");
  });
  it("rejects duplicates, out-of-order events, stale data, and impossible speeds", () => {
    expect(validateTelemetryEvent(event, { ...options, previousRecordedAt: now }).reason).toContain("out-of-order");
    expect(validateTelemetryEvent({ ...event, recordedAt: "2026-09-13T11:00:00Z" }, options).reason).toContain("stale");
    expect(validateTelemetryEvent({ ...event, speedKph: 500 }, options).reason).toContain("range");
  });
});
