export const ROADSTAR_HISTORY = {
  source: "data/raw/roadstar-hackathon-data.xlsx · Dispatch sheet",
  periodStart: "2026-06-26",
  periodEnd: "2026-08-28",
  completedLegs: 10_479,
  uniqueLoads: 3_683,
  emptyLegs: 3_723,
  loadedLegs: 6_756,
  emptyKm: 358_296,
  loadedKm: 2_210_361,
  emptyDistancePct: 13.9,
  matchedBackhaulLegs: 1_105,
  recoverableEmptyKm: 147_760,
  topOpportunities: [
    { lane: "Milton, ON ↔ Whitby, ON", matches: 51, recoverableKm: 20_780 },
    { lane: "Milton, ON ↔ Walton, KY", matches: 61, recoverableKm: 11_746 },
    { lane: "Milton, ON ↔ Richmond, IN", matches: 60, recoverableKm: 10_997 },
    { lane: "Phoenix, AZ ↔ Milton, ON", matches: 17, recoverableKm: 5_814 },
    { lane: "Milton, ON ↔ Saint Peters, MO", matches: 20, recoverableKm: 4_970 },
  ],
} as const;

export function runHistoricalReplay() {
  const projectedEmptyKm = ROADSTAR_HISTORY.emptyKm - ROADSTAR_HISTORY.recoverableEmptyKm;
  return {
    projectedEmptyKm,
    projectedEmptyPct: Number(
      ((projectedEmptyKm / (projectedEmptyKm + ROADSTAR_HISTORY.loadedKm)) * 100).toFixed(1),
    ),
    improvementPct: Number(
      ((ROADSTAR_HISTORY.recoverableEmptyKm / ROADSTAR_HISTORY.emptyKm) * 100).toFixed(1),
    ),
    matchedBackhaulLegs: ROADSTAR_HISTORY.matchedBackhaulLegs,
    note: "Directional lane-match opportunity using completed RoadStar legs; an upper-bound scenario, not guaranteed savings.",
  };
}
