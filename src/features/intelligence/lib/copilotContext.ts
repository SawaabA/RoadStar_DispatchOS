import { buildMorningPlan, DEFAULT_OPTIMIZATION_WEIGHTS, evaluateCandidate } from "../../dispatch/lib/optimizer";
import type { DispatchState } from "../../dispatch/types";
import type { BackhaulSuggestion, OperationalException, ReplanImpact } from "../types";

export type CopilotQuestionId = "at_risk" | "unassigned" | "hos" | "detention" | "plan";

export const COPILOT_QUESTIONS: ReadonlyArray<{ id: CopilotQuestionId; label: string }> = [
  { id: "at_risk", label: "What loads are at risk?" },
  { id: "unassigned", label: "Why are loads unassigned?" },
  { id: "hos", label: "Who is near HOS limits?" },
  { id: "detention", label: "What is our detention exposure?" },
  { id: "plan", label: "Summarize the morning plan" },
];

export type CopilotRef = { type: "load" | "driver" | "truck"; id: string };
export type CopilotFact = { title: string; detail: string; refs: CopilotRef[] };
export type CopilotFacts = { summary: string; items: CopilotFact[] };

export type CopilotRequest = {
  questionId: CopilotQuestionId;
  facts: CopilotFacts;
  directory: {
    loads: Array<{ id: string; billNumber: string }>;
    drivers: Array<{ id: string; name: string }>;
    trucks: Array<{ id: string; number: string }>;
  };
};

export type CopilotInsights = {
  exceptions: OperationalException[];
  impacts: ReplanImpact[];
  backhauls: BackhaulSuggestion[];
};

const MAX_ITEMS = 12;

// Every time, duration, distance and amount is formatted here, before the model
// sees it. The model quotes these strings; it is never asked to convert a
// timestamp or round a number, which is where invented figures come from.
const clock = (iso: string) => new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const hours = (value: number) => `${value.toFixed(1)} h`;
const km = (value: number) => `${Math.round(value)} km`;
const money = (value: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(value);

function exceptionRefs(exception: OperationalException, state: DispatchState, impacts: ReplanImpact[]): CopilotRef[] {
  if (exception.id.startsWith("LOAD-")) return [{ type: "load", id: exception.entityId }];
  if (exception.id.startsWith("HOS-")) return [{ type: "driver", id: exception.entityId }];
  if (exception.type === "detention") {
    const visit = state.visits.find((item) => item.id === exception.entityId);
    return visit ? [{ type: "truck", id: visit.truckId }] : [];
  }
  if (exception.type === "traffic") {
    const impact = impacts.find((item) => item.id === exception.entityId);
    if (!impact) return [];
    const assignment = state.assignments.find((item) => item.id === impact.assignmentId);
    return [
      { type: "load", id: impact.loadId },
      ...(assignment ? [{ type: "driver" as const, id: assignment.driverId }, { type: "truck" as const, id: assignment.truckId }] : []),
    ];
  }
  return [];
}

function atRiskFacts(state: DispatchState, insights: CopilotInsights): CopilotFacts {
  const acknowledged = new Set(state.acknowledgedExceptionIds ?? []);
  const open = insights.exceptions
    .filter((item) => !acknowledged.has(item.id))
    .sort((a, b) => Number(b.severity === "critical") - Number(a.severity === "critical"));
  const critical = open.filter((item) => item.severity === "critical").length;
  const items = open.slice(0, MAX_ITEMS).map((exception) => {
    const impact = exception.type === "traffic" ? insights.impacts.find((item) => item.id === exception.entityId) : undefined;
    const eta = impact ? ` ETA moves from ${clock(impact.originalEta)} to ${clock(impact.projectedEta)}.` : "";
    return {
      title: `${exception.title} (${exception.severity})`,
      detail: `${exception.detail}${eta} Recommended action: ${exception.recommendedAction}.`,
      refs: exceptionRefs(exception, state, insights.impacts),
    };
  });
  return {
    summary: open.length
      ? `${open.length} open exceptions: ${critical} critical and ${open.length - critical} warning.`
      : "There are no open exceptions.",
    items,
  };
}

function unassignedFacts(state: DispatchState, now: number): CopilotFacts {
  const weights = state.optimizationWeights ?? DEFAULT_OPTIMIZATION_WEIGHTS;
  const loads = state.loads.filter((load) => load.status === "unassigned");
  let withFeasibleUnit = 0;
  const items = loads.slice(0, MAX_ITEMS).map((load): CopilotFact => {
    const candidates = state.drivers.flatMap((driver) => {
      const trailer = state.trailers.find((item) => item.id === driver.trailerId);
      const truck = state.trucks.find((item) => item.id === driver.truckId);
      return trailer ? [{ driver, candidate: evaluateCandidate(load, driver, trailer, truck, now, weights) }] : [];
    });
    const title = `${load.billNumber} ${load.origin} to ${load.destination} (${load.priority} priority)`;
    const feasible = candidates.filter((item) => item.candidate.feasible).sort((a, b) => b.candidate.score - a.candidate.score);
    if (feasible.length) {
      withFeasibleUnit += 1;
      const best = feasible[0]!;
      return {
        title,
        detail: `${feasible.length} of ${candidates.length} units are feasible. Best match: ${best.driver.name}, match score ${best.candidate.score}, ${km(best.candidate.deadheadKm)} deadhead. It is waiting for a dispatcher to assign it.`,
        refs: [{ type: "load", id: load.id }, { type: "driver", id: best.driver.id }],
      };
    }
    if (!candidates.length) {
      return { title, detail: "No feasible unit. No driver has a trailer assigned.", refs: [{ type: "load", id: load.id }] };
    }
    // A unit that is already busy or out of service says nothing about why this
    // load is blocked, and busy units usually outnumber every other reason. The
    // reasons shown come only from units that could otherwise have taken it.
    const unavailable = candidates.filter(({ candidate }) => candidate.reasons.some((reason) => reason.code === "status"));
    const available = candidates.filter(({ candidate }) => !candidate.reasons.some((reason) => reason.code === "status"));
    if (!available.length) {
      return { title, detail: `No feasible unit. All ${candidates.length} units are unavailable.`, refs: [{ type: "load", id: load.id }] };
    }
    const counts = new Map<string, number>();
    for (const { candidate } of available) {
      for (const reason of candidate.reasons) counts.set(reason.label, (counts.get(reason.label) ?? 0) + 1);
    }
    const reasons = [...counts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([label, count]) => `${label} (${count} of ${available.length} available units)`);
    const busy = unavailable.length ? `${unavailable.length} of ${candidates.length} units are unavailable. ` : "";
    return {
      title,
      detail: `No feasible unit. ${busy}Among available units: ${reasons.join("; ")}.`,
      refs: [{ type: "load", id: load.id }],
    };
  });
  return {
    summary: loads.length
      ? `${loads.length} loads are unassigned; ${withFeasibleUnit} of them have at least one feasible unit.`
      : "Every load is assigned.",
    items,
  };
}

function hosFacts(state: DispatchState): CopilotFacts {
  const ranked = state.drivers
    .map((driver) => {
      const clocks: Array<[string, number]> = [
        ["driving", driver.drivingHoursRemaining],
        ["on-duty", driver.onDutyHoursRemaining],
        ["cycle", driver.cycleHoursRemaining],
      ];
      const limiting = clocks.reduce((tightest, clockEntry) => (clockEntry[1] < tightest[1] ? clockEntry : tightest));
      return { driver, limiting };
    })
    .sort((a, b) => a.limiting[1] - b.limiting[1]);
  const underFour = ranked.filter((item) => item.limiting[1] < 4).length;
  return {
    summary: `Drivers ordered by their tightest hours-of-service clock. ${underFour} have less than 4.0 h left on it.`,
    items: ranked.slice(0, 6).map(({ driver, limiting }) => ({
      title: driver.name,
      detail: `Limiting clock: ${limiting[0]}, ${hours(limiting[1])} left. Driving ${hours(driver.drivingHoursRemaining)}, on-duty ${hours(driver.onDutyHoursRemaining)}, cycle ${hours(driver.cycleHoursRemaining)} remaining. Status ${driver.status}, at ${driver.location}.`,
      refs: [{ type: "driver", id: driver.id }, { type: "truck", id: driver.truckId }],
    })),
  };
}

function detentionFacts(state: DispatchState): CopilotFacts {
  // Same formula as the command-centre detention metric, so the narrated total
  // always matches the figure already on screen.
  const rows = state.visits
    .map((visit) => {
      const facility = state.facilities.find((item) => item.id === visit.facilityId);
      const freeMinutes = facility?.freeMinutes || 120;
      const rate = facility?.detentionRate || 0;
      const billableMinutes = Math.max(0, visit.dwellMinutes - freeMinutes);
      return { visit, facility, freeMinutes, rate, billableMinutes, charge: (billableMinutes * rate) / 60 };
    })
    .sort((a, b) => b.charge - a.charge);
  const total = rows.reduce((sum, row) => sum + row.charge, 0);
  return {
    summary: rows.length
      ? `Billable detention across ${rows.length} facility visits totals ${money(total)}.`
      : "No facility visits are recorded.",
    items: rows.slice(0, MAX_ITEMS).map((row) => {
      const truck = state.trucks.find((item) => item.id === row.visit.truckId);
      const status = row.visit.departedAt ? `Departed at ${clock(row.visit.departedAt)}.` : "Still on site.";
      return {
        title: `Truck ${truck?.number ?? row.visit.truckId} at ${row.facility?.name ?? "an unknown facility"}`,
        detail: `${Math.round(row.visit.dwellMinutes)} min on site, ${row.freeMinutes} min free, ${Math.round(row.billableMinutes)} billable min at ${money(row.rate)}/h, ${money(row.charge)} billable. Arrived at ${clock(row.visit.arrivedAt)}. ${status}`,
        refs: [{ type: "truck", id: row.visit.truckId }],
      };
    }),
  };
}

function planFacts(state: DispatchState): CopilotFacts {
  const weights = state.optimizationWeights ?? DEFAULT_OPTIMIZATION_WEIGHTS;
  const plan = buildMorningPlan(state.loads, state.drivers, state.trailers, state.trucks, weights);
  const loadOf = (id: string) => state.loads.find((item) => item.id === id);
  const assigned: CopilotFact[] = plan.candidates.map((candidate) => {
    const driver = state.drivers.find((item) => item.id === candidate.driverId);
    return {
      title: `${loadOf(candidate.loadId)?.billNumber ?? candidate.loadId} assigned to ${driver?.name ?? candidate.driverId}`,
      detail: `${candidate.explanation} Match score ${candidate.score}; ${km(candidate.deadheadKm)} deadhead; ${hours(candidate.hosRemainingAfter)} HOS margin after the trip.`,
      refs: [
        { type: "load", id: candidate.loadId },
        { type: "driver", id: candidate.driverId },
        { type: "truck", id: candidate.truckId },
      ],
    };
  });
  const review: CopilotFact[] = plan.rejectedLoads.map((rejected) => ({
    title: `${loadOf(rejected.loadId)?.billNumber ?? rejected.loadId} needs manual review`,
    detail: rejected.reasons.length ? rejected.reasons.join(" · ") : "No available feasible unit.",
    refs: [{ type: "load", id: rejected.loadId }],
  }));
  return {
    summary: `The optimizer proposes ${plan.candidates.length} assignments and leaves ${plan.rejectedLoads.length} loads for manual review, with ${km(plan.projectedDeadheadKm)} projected deadhead. Nothing is applied until a dispatcher approves it.`,
    items: [...assigned, ...review].slice(0, MAX_ITEMS),
  };
}

export function buildCopilotRequest(
  questionId: CopilotQuestionId,
  state: DispatchState,
  insights: CopilotInsights,
  now = Date.now(),
): CopilotRequest {
  const facts =
    questionId === "at_risk" ? atRiskFacts(state, insights)
      : questionId === "unassigned" ? unassignedFacts(state, now)
        : questionId === "hos" ? hosFacts(state)
          : questionId === "detention" ? detentionFacts(state)
            : planFacts(state);
  return {
    questionId,
    facts,
    directory: {
      loads: state.loads.map((load) => ({ id: load.id, billNumber: load.billNumber })),
      drivers: state.drivers.map((driver) => ({ id: driver.id, name: driver.name })),
      trucks: state.trucks.map((truck) => ({ id: truck.id, number: truck.number })),
    },
  };
}
