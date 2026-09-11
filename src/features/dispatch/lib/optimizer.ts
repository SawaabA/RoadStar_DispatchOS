import distance from "@turf/distance";
import { point } from "@turf/helpers";
import type {
  DispatchCandidate,
  DispatchLoad,
  Driver,
  FeasibilityReason,
  PlanProposal,
  TrailerAsset,
} from "../types";

// Practical Southern Ontario dispatch assumptions. HOS values follow the
// Canadian daily limits the fleet cards display; they are a feasibility aid,
// not a certified ELD calculation.
const AVERAGE_SPEED_KPH = 78;
const ROAD_CIRCUITY = 1.18;
const LOADING_HOURS = 0.75;
const UNLOADING_HOURS = 0.75;
const HOS_RESERVE_HOURS = 0.5;

const km = (from: { lat: number; lng: number }, to: { lat: number; lng: number }) =>
  distance(point([from.lng, from.lat]), point([to.lng, to.lat]), {
    units: "kilometers",
  }) * ROAD_CIRCUITY;

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const round1 = (value: number) => Math.round(value * 10) / 10;

const PRIORITY_BONUS = { critical: 12, high: 6, standard: 0 } as const;

export function evaluateCandidate(
  load: DispatchLoad,
  driver: Driver,
  trailer: TrailerAsset,
  now = Date.now(),
): DispatchCandidate {
  const deadheadKm = km(driver.point, load.originPoint);
  const tripKm = km(load.originPoint, load.destinationPoint);
  const pickupEtaMinutes = (deadheadKm / AVERAGE_SPEED_KPH) * 60;
  const drivingHours = (deadheadKm + tripKm) / AVERAGE_SPEED_KPH;
  const projectedHours = drivingHours + LOADING_HOURS + UNLOADING_HOURS;
  const hosRemainingAfter = driver.drivingHoursRemaining - drivingHours;

  const arrival = now + pickupEtaMinutes * 60_000;
  const pickupEnd = new Date(load.pickupEnd).getTime();
  const pickupStart = new Date(load.pickupStart).getTime();
  const waitMinutes = Math.max(0, (pickupStart - arrival) / 60_000);
  const slackMinutes = (pickupEnd - arrival) / 60_000;

  const reasons: FeasibilityReason[] = [];
  if (driver.status !== "available")
    reasons.push({ code: "status", label: `${driver.name} is ${driver.status}` });
  if (trailer.status !== "available")
    reasons.push({
      code: "status",
      label: `Trailer ${trailer.number} is ${trailer.status}`,
    });
  if (trailer.type !== load.equipment)
    reasons.push({
      code: "equipment",
      label: `Needs ${load.equipment}, unit pulls ${trailer.type}`,
    });
  else if (load.temperatureControlled && trailer.type !== "Reefer")
    reasons.push({
      code: "equipment",
      label: "Temperature-controlled freight needs a reefer",
    });
  if (load.weightLbs > trailer.capacityLbs)
    reasons.push({
      code: "weight",
      label: `${load.weightLbs.toLocaleString()} lb exceeds the ${trailer.capacityLbs.toLocaleString()} lb capacity`,
    });
  if (slackMinutes < 0)
    reasons.push({
      code: "pickup",
      label: `Arrives ${clock(new Date(arrival).toISOString())} after the ${clock(load.pickupEnd)} window closes`,
    });
  if (hosRemainingAfter < HOS_RESERVE_HOURS)
    reasons.push({
      code: "hos",
      label: `Needs ${round1(drivingHours)} h driving against ${round1(driver.drivingHoursRemaining)} h remaining`,
    });
  else if (projectedHours + waitMinutes / 60 > driver.onDutyHoursRemaining)
    reasons.push({
      code: "hos",
      label: `Needs ${round1(projectedHours)} h on duty against ${round1(driver.onDutyHoursRemaining)} h remaining`,
    });
  else if (projectedHours > driver.cycleHoursRemaining)
    reasons.push({
      code: "hos",
      label: `Trip exceeds the ${round1(driver.cycleHoursRemaining)} h cycle balance`,
    });

  const feasible = reasons.length === 0;
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        88 -
          deadheadKm * 0.35 -
          waitMinutes * 0.08 -
          Math.max(0, 3 - hosRemainingAfter) * 6 +
          Math.min(12, Math.max(0, slackMinutes) * 0.05) +
          PRIORITY_BONUS[load.priority] -
          reasons.length * 25,
      ),
    ),
  );

  const explanation = feasible
    ? `${Math.round(deadheadKm)} km deadhead, arrives ${clock(new Date(arrival).toISOString())} for the ${clock(load.pickupStart)}–${clock(load.pickupEnd)} window, ${round1(hosRemainingAfter)} h driving margin after delivery.`
    : reasons.map((reason) => reason.label).join(" · ");

  return {
    loadId: load.id,
    driverId: driver.id,
    truckId: driver.truckId,
    trailerId: driver.trailerId,
    feasible,
    reasons,
    deadheadKm,
    tripKm,
    pickupEtaMinutes,
    projectedHours,
    hosRemainingAfter,
    score,
    explanation,
  };
}

const PRIORITY_ORDER = { critical: 0, high: 1, standard: 2 } as const;

// Fleet-wide backtracking search. It never mutates live state and never
// double-books a driver, truck, or trailer; the dispatcher approves the result.
export function buildMorningPlan(
  loads: DispatchLoad[],
  drivers: Driver[],
  trailers: TrailerAsset[],
  now = Date.now(),
): PlanProposal {
  const open = loads
    .filter((load) => load.status === "unassigned")
    .sort(
      (a, b) =>
        PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
        new Date(a.pickupEnd).getTime() - new Date(b.pickupEnd).getTime() ||
        a.id.localeCompare(b.id),
    );

  const options = new Map<string, DispatchCandidate[]>();
  for (const load of open) {
    const feasible: DispatchCandidate[] = [];
    for (const driver of drivers) {
      const trailer = trailers.find((item) => item.id === driver.trailerId);
      if (!trailer) continue;
      const candidate = evaluateCandidate(load, driver, trailer, now);
      if (candidate.feasible) feasible.push(candidate);
    }
    feasible.sort((a, b) => b.score - a.score || a.driverId.localeCompare(b.driverId));
    options.set(load.id, feasible);
  }

  let best: DispatchCandidate[] = [];
  let bestValue = -1;
  const used = new Set<string>();
  const chosen: DispatchCandidate[] = [];

  const value = (plan: DispatchCandidate[]) =>
    plan.reduce((total, item) => total + 1000 + item.score, 0);

  const search = (index: number) => {
    if (index === open.length) {
      const current = value(chosen);
      if (current > bestValue) {
        bestValue = current;
        best = [...chosen];
      }
      return;
    }
    // Optimistic bound: every remaining load placed at a perfect score.
    if (value(chosen) + (open.length - index) * 1100 <= bestValue) return;

    for (const candidate of options.get(open[index]!.id) ?? []) {
      if (used.has(candidate.driverId) || used.has(candidate.truckId)) continue;
      if (used.has(candidate.trailerId)) continue;
      used.add(candidate.driverId);
      used.add(candidate.truckId);
      used.add(candidate.trailerId);
      chosen.push(candidate);
      search(index + 1);
      chosen.pop();
      used.delete(candidate.trailerId);
      used.delete(candidate.truckId);
      used.delete(candidate.driverId);
    }
    // Leaving a load for manual review is always a legal branch.
    search(index + 1);
  };

  search(0);

  const covered = new Set(best.map((candidate) => candidate.loadId));
  const rejectedLoads = open
    .filter((load) => !covered.has(load.id))
    .map((load) => {
      // A load with feasible units that still went uncovered lost the unit to a
      // higher-priority load; per-driver blockers would misexplain that.
      if ((options.get(load.id) ?? []).length)
        return {
          loadId: load.id,
          reasons: ["Every feasible unit is committed to a higher-priority load"],
        };
      const blockers = drivers
        .map((driver) => {
          const trailer = trailers.find((item) => item.id === driver.trailerId);
          return trailer ? evaluateCandidate(load, driver, trailer, now) : null;
        })
        .filter((candidate): candidate is DispatchCandidate => candidate !== null);
      const labels = blockers.flatMap((candidate) =>
        candidate.reasons.map((reason) => reason.label),
      );
      return {
        loadId: load.id,
        reasons: labels.length ? [...new Set(labels)] : ["No available feasible unit"],
      };
    });

  return {
    id: `PLAN-${new Date(now).toISOString()}`,
    generatedAt: new Date(now).toISOString(),
    candidates: best.sort(
      (a, b) =>
        PRIORITY_ORDER[loads.find((l) => l.id === a.loadId)!.priority] -
          PRIORITY_ORDER[loads.find((l) => l.id === b.loadId)!.priority] ||
        b.score - a.score,
    ),
    rejectedLoads,
    projectedDeadheadKm: best.reduce((total, item) => total + item.deadheadKm, 0),
  };
}
