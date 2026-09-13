import { describe, expect, it } from "vitest";
import { createDemoState } from "../../dispatch/data/demoData";
import { buildMorningPlan, DEFAULT_OPTIMIZATION_WEIGHTS } from "../../dispatch/lib/optimizer";
import type { DispatchState } from "../../dispatch/types";
import type { RoadIncident } from "../types";
import { buildBackhaulSuggestions, buildReplanImpacts, deriveExceptions } from "./intelligence";
import { buildCopilotRequest, COPILOT_QUESTIONS } from "./copilotContext";

const insightsFor = (state: DispatchState, incidents: RoadIncident[] = []) => ({
  exceptions: deriveExceptions(state, incidents),
  impacts: buildReplanImpacts(state, incidents),
  backhauls: buildBackhaulSuggestions(state),
});

describe("copilot facts", () => {
  it("builds a summary and item list for every suggested question", () => {
    const state = createDemoState();
    for (const question of COPILOT_QUESTIONS) {
      const request = buildCopilotRequest(question.id, state, insightsFor(state));
      expect(request.questionId).toBe(question.id);
      expect(request.facts.summary.length).toBeGreaterThan(0);
      expect(Array.isArray(request.facts.items)).toBe(true);
    }
  });

  it("sends no raw timestamps, so the model never has to convert a time", () => {
    const state = createDemoState();
    for (const question of COPILOT_QUESTIONS) {
      const text = JSON.stringify(buildCopilotRequest(question.id, state, insightsFor(state)).facts);
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    }
  });

  it("references only records that exist in the directory it sends", () => {
    const state = createDemoState();
    for (const question of COPILOT_QUESTIONS) {
      const request = buildCopilotRequest(question.id, state, insightsFor(state));
      const known = {
        load: new Set(request.directory.loads.map((item) => item.id)),
        driver: new Set(request.directory.drivers.map((item) => item.id)),
        truck: new Set(request.directory.trucks.map((item) => item.id)),
      };
      for (const item of request.facts.items) for (const ref of item.refs) expect(known[ref.type].has(ref.id)).toBe(true);
    }
  });

  it("reports the same detention total as the command-centre metric", () => {
    const state = createDemoState();
    const expected = state.visits.reduce((sum, visit) => {
      const facility = state.facilities.find((item) => item.id === visit.facilityId);
      return sum + (Math.max(0, visit.dwellMinutes - (facility?.freeMinutes || 120)) * (facility?.detentionRate || 0)) / 60;
    }, 0);
    const formatted = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(expected);
    const facts = buildCopilotRequest("detention", state, insightsFor(state)).facts;

    expect(state.visits.length).toBeGreaterThan(0);
    expect(facts.summary).toContain(formatted);
    expect(facts.items).toHaveLength(Math.min(state.visits.length, 12));
  });

  it("explains that the flatbed load has no compatible equipment", () => {
    const state = createDemoState();
    const facts = buildCopilotRequest("unassigned", state, insightsFor(state)).facts;
    const flatbed = facts.items.find((item) => item.refs.some((ref) => ref.type === "load" && ref.id === "L-4530"));

    expect(flatbed?.detail).toContain("No feasible unit");
    expect(flatbed?.detail).toMatch(/Flatbed/);
    // Busy units are counted, but never offered as the reason the load is blocked.
    expect(flatbed?.detail).not.toMatch(/unavailable \(/);
  });

  it("leaves acknowledged exceptions out of the at-risk facts", () => {
    const state = createDemoState();
    const insights = insightsFor(state);
    expect(insights.exceptions.length).toBeGreaterThan(0);
    const acknowledged = insights.exceptions[0]!;
    const before = buildCopilotRequest("at_risk", state, insights).facts.items.length;
    const after = buildCopilotRequest("at_risk", { ...state, acknowledgedExceptionIds: [acknowledged.id] }, insights).facts.items;

    expect(after.length).toBe(Math.min(before, insights.exceptions.length - 1));
    expect(after.some((item) => item.title.startsWith(acknowledged.title))).toBe(false);
  });

  it("mirrors the optimizer's proposal rather than re-deriving a plan", () => {
    const state = createDemoState();
    const plan = buildMorningPlan(state.loads, state.drivers, state.trailers, state.trucks, DEFAULT_OPTIMIZATION_WEIGHTS);
    const facts = buildCopilotRequest("plan", state, insightsFor(state)).facts;

    expect(facts.summary).toContain(`proposes ${plan.candidates.length} assignments`);
    expect(facts.summary).toContain(`${plan.rejectedLoads.length} loads for manual review`);
    expect(facts.items).toHaveLength(Math.min(plan.candidates.length + plan.rejectedLoads.length, 12));
  });
});
