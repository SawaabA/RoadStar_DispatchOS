import { describe, expect, it } from "vitest";
import { createReplayExample } from "../data/replayExample";
import { parseReplayDataset, runConstrainedReplay } from "./replay";

describe("constrained replay", () => {
  it("runs the synthetic example and returns comparable baseline metrics", () => {
    const result = runConstrainedReplay(createReplayExample());
    expect(result.baseline.covered).toBe(2);
    expect(result.optimized.coveragePct).toBeGreaterThanOrEqual(0);
    expect(result.assumptions).toMatch(/30-minute HOS reserve/);
  });

  it("rejects invalid or oversized replay horizons", () => {
    const example = createReplayExample();
    expect(() => parseReplayDataset({ ...example, endedAt: "2026-09-16T20:00:00.000Z" })).toThrow(/Invalid replay/);
    expect(() => parseReplayDataset({ ...example, initialState: { ...example.initialState, loads: Array.from({ length: 301 }, (_, i) => ({ ...example.initialState.loads[0], id: String(i) })) } })).toThrow(/Invalid replay/);
  });
});
