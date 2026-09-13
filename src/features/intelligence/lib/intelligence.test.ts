import { describe, expect, it } from "vitest";
import { createDemoState } from "../../dispatch/data/demoData";
import { buildBackhaulSuggestions, buildReplanImpacts, deriveExceptions, providerStatuses } from "./intelligence";
import { createInjectedClosure } from "./trafficProvider";

describe("dispatch intelligence", () => {
  it("deduplicates actionable operational exceptions", () => {
    const exceptions = deriveExceptions(createDemoState(), []);
    expect(exceptions.some((item) => item.type === "detention")).toBe(true);
    expect(new Set(exceptions.map((item) => item.id)).size).toBe(exceptions.length);
  });

  it("names the missing equipment type instead of blaming idle assets", () => {
    // The flatbed load has no matching trailer anywhere in the asset master,
    // which is a record problem a dispatcher must resolve, not a re-plan.
    const flatbed = deriveExceptions(createDemoState(), []).find((item) => item.entityId === "L-4530");

    expect(flatbed?.type).toBe("data");
    expect(flatbed?.title).toMatch(/needs a Flatbed/);
    expect(flatbed?.detail).toMatch(/asset master/i);
    expect(flatbed?.detail).not.toMatch(/unavailable/i);
  });

  it("turns a corridor closure into explainable re-plan impact", () => {
    const impacts = buildReplanImpacts(createDemoState(), [createInjectedClosure()]);
    expect(impacts.length).toBeGreaterThan(0);
    expect(impacts[0].addedDelayMinutes).toBe(35);
    expect(impacts[0].recommendation.length).toBeGreaterThan(20);
  });

  it("finds feasible downstream freight without mutating dispatch state", () => {
    const state = createDemoState();
    const before = JSON.stringify(state);
    const suggestions = buildBackhaulSuggestions(state);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((item) => item.projectedHosMargin >= 0)).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("never labels demo or merely configured providers as live", () => {
    const providers = providerStatuses({
      cloud: true,
      trafficLive: true,
      simulatorLive: true,
      solver: "xflp-0.7.7",
      external: {
        tms: { provider: "TMS", status: "not_configured" },
        eld: { provider: "ELD", status: "not_configured" },
        routing: { provider: "OSRM", status: "configured" },
      },
    });
    expect(providers.find((item) => item.id === "tms")?.mode).toBe("ready");
    expect(providers.find((item) => item.id === "eld")?.mode).toBe("demo");
    expect(providers.find((item) => item.id === "routing")?.mode).toBe("ready");
    expect(providers.find((item) => item.id === "traffic")?.mode).toBe("live");
  });

  it("labels a connected routing engine as live and demo adapters as demo", () => {
    const providers = providerStatuses({
      cloud: true,
      trafficLive: true,
      simulatorLive: true,
      solver: "xflp",
      external: {
        tms: { provider: "RoadStar neutral demo adapter", status: "demo" },
        eld: { provider: "RoadStar simulator", status: "demo" },
        routing: { provider: "RoadStar OSRM Ontario", status: "connected" },
      },
    });
    expect(providers.find((item) => item.id === "tms")?.mode).toBe("demo");
    expect(providers.find((item) => item.id === "eld")?.mode).toBe("demo");
    expect(providers.find((item) => item.id === "routing")?.mode).toBe("live");
  });
});
