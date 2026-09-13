import { describe, expect, it } from "vitest";
import { normalizeTrafficContext } from "./traffic-context.mjs";

describe("Ontario 511 context normalization", () => {
  it("normalizes construction and filters out-of-region coordinates", () => {
    const rows = normalizeTrafficContext("construction", [
      { ID: 1, RoadwayName: "401", DirectionOfTravel: "East", Description: "Lane closure", Latitude: 43.6, Longitude: -79.4, IsFullClosure: true, Reported: 1_700_000_000, LastUpdated: 1_700_000_001 },
      { ID: 2, Latitude: 10, Longitude: 10 },
    ], 1_700_000_002_000);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "CONSTRUCTION-1", severity: "critical", fullClosure: true, roadway: "401" });
  });

  it("keeps only safe HTTPS camera view links", () => {
    const rows = normalizeTrafficContext("cameras", [{ Id: 1, Roadway: "401", Location: "Toronto", Latitude: 43.6, Longitude: -79.4, Views: [
      { Id: 1, Status: "Enabled", Url: "https://511on.ca/camera/1" },
      { Id: 2, Status: "Enabled", Url: "javascript:alert(1)" },
      { Id: 3, Status: "Disabled", Url: "https://511on.ca/camera/3" },
    ] }]);
    expect(rows[0].views).toHaveLength(1);
    expect(rows[0].views[0].url).toBe("https://511on.ca/camera/1");
  });
});
