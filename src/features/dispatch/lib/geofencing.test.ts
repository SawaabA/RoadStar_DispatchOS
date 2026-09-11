import { describe, expect, it } from "vitest";
import { createDemoState } from "../data/demoData";
import { updateGeofenceVisits } from "./geofencing";

describe("geofence visit transitions", () => {
  it("enters and exits once with a boundary buffer that resists GPS chatter", () => {
    const state = createDemoState();
    const facility = { ...state.facilities[0], radiusKm: 1 };
    const inside = facility.point;
    const nearBoundary = { ...inside, lat: inside.lat + 0.0095 };
    const outside = { ...inside, lat: inside.lat + 0.02 };

    const entered = updateGeofenceVisits([], [facility], "T-QA", inside, 1);
    expect(entered).toHaveLength(1);
    expect(updateGeofenceVisits(entered, [facility], "T-QA", inside, 2)).toHaveLength(1);

    const buffered = updateGeofenceVisits(entered, [facility], "T-QA", nearBoundary, 3);
    expect(buffered[0].departedAt).toBeUndefined();

    const departed = updateGeofenceVisits(buffered, [facility], "T-QA", outside, 4);
    expect(departed[0].departedAt).toBeDefined();
  });
});
