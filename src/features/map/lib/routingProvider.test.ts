import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRoadRoute } from "./routingProvider";

afterEach(() => vi.restoreAllMocks());

describe("road routing provider", () => {
  it("accepts a valid OSRM-compatible RoadStar response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      source: "test-router",
      distanceKm: 42,
      durationMinutes: 31,
      coordinates: [[-79.4, 43.6], [-79.1, 43.8]],
    }), { status: 200 }));
    await expect(fetchRoadRoute({ lat: 43.6, lng: -79.4 }, { lat: 43.8, lng: -79.1 })).resolves.toMatchObject({ source: "test-router", distanceKm: 42 });
  });

  it("fails safely when routing is unavailable or malformed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 503 }));
    await expect(fetchRoadRoute({ lat: 43.6, lng: -79.4 }, { lat: 43.8, lng: -79.1 })).resolves.toBeNull();
  });
});
