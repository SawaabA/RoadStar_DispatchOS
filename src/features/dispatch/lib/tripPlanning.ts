import { STOP_SERVICE_HOURS, driveHours, kmBetween } from "./geo";
import type {
  Assignment,
  Coordinates,
  DispatchLoad,
  Driver,
  TrailerAsset,
  TruckAsset,
} from "../types";

/**
 * A trip is one truck, one driver, one trailer and one or more loads. This
 * module answers the three questions a dispatcher asks before consolidating
 * freight: does it physically fit, does the route still work, and does the
 * driver still have the hours to run it.
 */

export type TripStopKind = "pickup" | "delivery";

export type TripBlockerCode =
  | "status"
  | "equipment"
  | "temperature"
  | "weight"
  | "pallets"
  | "pickup"
  | "delivery"
  | "hos";

export type TripBlocker = { code: TripBlockerCode; label: string };

export type TripStop = {
  loadId: string;
  billNumber: string;
  kind: TripStopKind;
  location: string;
  point: Coordinates;
  windowStart: string | null;
  windowEnd: string;
  legKm: number;
  arrivalAt: string;
  departureAt: string;
  waitMinutes: number;
  lateMinutes: number;
  slackMinutes: number;
  onBoardLbs: number;
  onBoardPallets: number;
};

export type TripPlan = {
  loadIds: string[];
  stops: TripStop[];
  totalKm: number;
  loadedKm: number;
  emptyKm: number;
  drivingHours: number;
  onDutyHours: number;
  waitHours: number;
  startAt: string;
  finishAt: string;
  peakWeightLbs: number;
  peakPallets: number;
  capacityLbs: number;
  palletPositions: number;
  lateStops: number;
  worstLateMinutes: number;
  tightestSlackMinutes: number;
  hosRemainingAfter: number;
  revenue: number;
  revenuePerKm: number;
  feasible: boolean;
  blockers: TripBlocker[];
  warnings: string[];
};

export type TripPlanInput = {
  loads: DispatchLoad[];
  driver: Driver;
  trailer: TrailerAsset;
  truck?: TruckAsset;
  start: Coordinates;
  startAt?: number;
  /** An existing trip already holds its resources, so re-checking availability would always fail. */
  checkAvailability?: boolean;
  /**
   * Freight already on the trailer. A rolling truck must not be re-planned
   * through pickups it has already made, or the plan reports appointments it
   * missed hours ago as live failures.
   */
  pickedUpLoadIds?: string[];
};

// A 53' van holds 26 skids: 13 rows of two 48x40 positions. Deriving it from
// the trailer keeps smaller reefers and future equipment honest.
export const palletPositions = (trailer: TrailerAsset) =>
  Math.max(1, Math.floor(trailer.lengthIn / 48) * Math.floor(trailer.widthIn / 40));

/** Every load riding on one assignment: the primary load plus consolidated freight. */
export const tripLoadIds = (assignment: Assignment) => [
  assignment.loadId,
  ...(assignment.addedLoadIds ?? []),
];

export const tripLoads = (assignment: Assignment, loads: DispatchLoad[]) =>
  tripLoadIds(assignment).flatMap((id) => loads.filter((load) => load.id === id));

/**
 * Freight that is already on the trailer. Once a truck has left, its pickups
 * are history: re-planning them would report appointments the driver made
 * hours ago as missed.
 */
export const carriedLoadIds = (assignment: Assignment) =>
  assignment.status === "in_transit" || assignment.progress > 0 ? tripLoadIds(assignment) : [];

// Beyond this the stop-order search stops being instant, so longer trips keep
// the order the dispatcher built rather than being re-sequenced.
const MAX_SEQUENCED_LOADS = 4;
const TIGHT_SLACK_MINUTES = 30;
const LONG_DEADHEAD_KM = 100;

type PendingStop = { load: DispatchLoad; kind: TripStopKind };

const stopWindowEnd = (stop: PendingStop) =>
  stop.kind === "pickup" ? stop.load.pickupEnd : stop.load.deliveryEnd;

const stopPoint = (stop: PendingStop) =>
  stop.kind === "pickup" ? stop.load.originPoint : stop.load.destinationPoint;

const stopLocation = (stop: PendingStop) =>
  stop.kind === "pickup" ? stop.load.origin : stop.load.destination;

const parseTime = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function simulate(order: PendingStop[], input: TripPlanInput) {
  const startAt = input.startAt ?? Date.now();
  const capacityLbs = input.trailer.capacityLbs;
  const positions = palletPositions(input.trailer);
  const alreadyOnBoard = new Set(input.pickedUpLoadIds ?? []);
  const carried = input.loads.filter((load) => alreadyOnBoard.has(load.id));
  let position = input.start;
  let clock = startAt;
  let onBoardLbs = carried.reduce((sum, load) => sum + load.weightLbs, 0);
  let onBoardPallets = carried.reduce((sum, load) => sum + load.pallets, 0);
  let totalKm = 0;
  let loadedKm = 0;
  let waitHours = 0;
  let peakWeightLbs = onBoardLbs;
  let peakPallets = onBoardPallets;
  const stops: TripStop[] = [];

  for (const stop of order) {
    const legKm = kmBetween(position, stopPoint(stop));
    const arrival = clock + driveHours(legKm) * 3_600_000;
    const windowEnd = parseTime(stopWindowEnd(stop));
    const windowStart = stop.kind === "pickup" ? parseTime(stop.load.pickupStart) : null;
    const waitMs = windowStart !== null ? Math.max(0, windowStart - arrival) : 0;
    const serviceStart = arrival + waitMs;
    const departure = serviceStart + STOP_SERVICE_HOURS * 3_600_000;
    // A missed window is measured on arrival: a dispatcher cannot unload into a
    // closed dock, however much slack the rest of the trip has.
    const lateMinutes = windowEnd === null ? 0 : Math.max(0, Math.round((arrival - windowEnd) / 60_000));
    const slackMinutes = windowEnd === null ? 0 : Math.round((windowEnd - arrival) / 60_000);

    if (onBoardLbs > 0) loadedKm += legKm;
    totalKm += legKm;
    waitHours += waitMs / 3_600_000;

    if (stop.kind === "pickup") {
      onBoardLbs += stop.load.weightLbs;
      onBoardPallets += stop.load.pallets;
    } else {
      onBoardLbs = Math.max(0, onBoardLbs - stop.load.weightLbs);
      onBoardPallets = Math.max(0, onBoardPallets - stop.load.pallets);
    }
    peakWeightLbs = Math.max(peakWeightLbs, onBoardLbs);
    peakPallets = Math.max(peakPallets, onBoardPallets);

    stops.push({
      loadId: stop.load.id,
      billNumber: stop.load.billNumber,
      kind: stop.kind,
      location: stopLocation(stop),
      point: stopPoint(stop),
      windowStart: stop.kind === "pickup" ? stop.load.pickupStart : null,
      windowEnd: stopWindowEnd(stop),
      legKm,
      arrivalAt: new Date(arrival).toISOString(),
      departureAt: new Date(departure).toISOString(),
      waitMinutes: Math.round(waitMs / 60_000),
      lateMinutes,
      slackMinutes,
      onBoardLbs,
      onBoardPallets,
    });

    position = stopPoint(stop);
    clock = departure;
  }

  const drivingHours = driveHours(totalKm);
  const onDutyHours = drivingHours + order.length * STOP_SERVICE_HOURS + waitHours;
  return {
    stops,
    startAt,
    finishAt: clock,
    totalKm,
    loadedKm,
    drivingHours,
    onDutyHours,
    waitHours,
    peakWeightLbs,
    peakPallets,
    capacityLbs,
    positions,
  };
}

type Simulated = ReturnType<typeof simulate>;

// Late stops and over-capacity legs are penalised rather than forbidden: the
// dispatcher still needs to see the numbers for a sequence that does not work.
const sequenceCost = (result: Simulated) => {
  const overCapacity = result.stops.filter(
    (stop) => stop.onBoardLbs > result.capacityLbs || stop.onBoardPallets > result.positions,
  ).length;
  const late = result.stops.filter((stop) => stop.lateMinutes > 0).length;
  return overCapacity * 1_000_000 + late * 10_000 + result.totalKm;
};

function bestOrder(loads: DispatchLoad[], input: TripPlanInput): PendingStop[] {
  const onBoard = new Set(input.pickedUpLoadIds ?? []);
  const sequential = loads.flatMap<PendingStop>((load) =>
    onBoard.has(load.id)
      ? [{ load, kind: "delivery" }]
      : [
          { load, kind: "pickup" },
          { load, kind: "delivery" },
        ],
  );
  const stopCount = sequential.length;
  if (loads.length <= 1 || loads.length > MAX_SEQUENCED_LOADS) return sequential;

  let best = sequential;
  let bestCost = sequenceCost(simulate(sequential, input));
  const chosen: PendingStop[] = [];
  const pickedUp = new Set<string>(onBoard);
  const delivered = new Set<string>();

  const search = () => {
    if (chosen.length === stopCount) {
      const cost = sequenceCost(simulate([...chosen], input));
      if (cost < bestCost) {
        bestCost = cost;
        best = [...chosen];
      }
      return;
    }
    for (const load of loads) {
      const kind: TripStopKind | null = !pickedUp.has(load.id)
        ? "pickup"
        : !delivered.has(load.id)
          ? "delivery"
          : null;
      if (!kind) continue;
      if (kind === "pickup") pickedUp.add(load.id);
      else delivered.add(load.id);
      chosen.push({ load, kind });
      search();
      chosen.pop();
      if (kind === "pickup") pickedUp.delete(load.id);
      else delivered.delete(load.id);
    }
  };
  search();
  return best;
}

export function planTrip(input: TripPlanInput): TripPlan {
  const loads = input.loads;
  const { driver, trailer, truck } = input;
  const result = simulate(bestOrder(loads, input), input);
  const blockers: TripBlocker[] = [];
  const warnings: string[] = [];

  if (input.checkAvailability) {
    if (driver.status !== "available")
      blockers.push({ code: "status", label: "Driver or power unit is unavailable" });
    if (!truck || truck.id !== driver.truckId || truck.status !== "available")
      blockers.push({ code: "status", label: "Power unit is unavailable" });
    if (trailer.status !== "available")
      blockers.push({ code: "status", label: "Trailer is unavailable" });
  }

  const wrongEquipment = loads.filter((load) => load.equipment !== trailer.type);
  if (wrongEquipment.length)
    blockers.push({
      code: "equipment",
      label: `${wrongEquipment.map((load) => load.billNumber).join(", ")} needs ${[...new Set(wrongEquipment.map((load) => load.equipment))].join("/")}; ${trailer.number} is ${trailer.type}`,
    });
  if (loads.some((load) => load.temperatureControlled) && trailer.type !== "Reefer")
    blockers.push({ code: "temperature", label: "Temperature-controlled freight needs a reefer" });
  if (result.peakWeightLbs > result.capacityLbs)
    blockers.push({
      code: "weight",
      label: `Peak on-board weight exceeds ${trailer.number} by ${(result.peakWeightLbs - result.capacityLbs).toLocaleString()} lb`,
    });
  if (result.peakPallets > result.positions)
    blockers.push({
      code: "pallets",
      label: `Needs ${result.peakPallets} pallet positions; ${trailer.number} has ${result.positions}`,
    });

  const latePickups = result.stops.filter((stop) => stop.kind === "pickup" && stop.lateMinutes > 0);
  if (latePickups.length)
    blockers.push({
      code: "pickup",
      label: `Arrives after the pickup window at ${latePickups.map((stop) => stop.billNumber).join(", ")}`,
    });
  const lateDeliveries = result.stops.filter(
    (stop) => stop.kind === "delivery" && stop.lateMinutes > 0,
  );
  if (lateDeliveries.length)
    blockers.push({
      code: "delivery",
      label: `Delivers ${lateDeliveries.map((stop) => `${stop.billNumber} ${stop.lateMinutes} min late`).join(", ")}`,
    });

  const limitingHours = Math.min(driver.onDutyHoursRemaining, driver.cycleHoursRemaining);
  if (result.drivingHours > driver.drivingHoursRemaining || result.onDutyHours > limitingHours)
    blockers.push({
      code: "hos",
      label: `Trip needs ${result.onDutyHours.toFixed(1)} h on duty and ${result.drivingHours.toFixed(1)} h driving; ${driver.name} has ${limitingHours.toFixed(1)} h and ${driver.drivingHoursRemaining.toFixed(1)} h`,
    });

  const temperatureMix = new Set(loads.map((load) => load.temperatureControlled));
  if (loads.length > 1 && temperatureMix.size > 1)
    warnings.push("Mixed temperature requirements share this trailer — confirm one set point works.");
  const tightest = result.stops.reduce(
    (lowest, stop) => Math.min(lowest, stop.slackMinutes),
    Number.POSITIVE_INFINITY,
  );
  if (Number.isFinite(tightest) && tightest >= 0 && tightest < TIGHT_SLACK_MINUTES)
    warnings.push(`Only ${Math.round(tightest)} min of appointment slack at the tightest stop.`);
  const firstLeg = result.stops[0]?.legKm ?? 0;
  if (firstLeg > LONG_DEADHEAD_KM)
    warnings.push(`${Math.round(firstLeg)} km of empty running before the first pickup.`);
  if (result.waitHours > 1)
    warnings.push(`${Math.round(result.waitHours * 60)} min of on-duty waiting for appointment windows.`);

  const revenue = loads.reduce((sum, load) => sum + (Number.isFinite(load.rate) ? load.rate : 0), 0);
  const hosRemainingAfter = Math.max(
    0,
    Math.min(
      driver.drivingHoursRemaining - result.drivingHours,
      driver.onDutyHoursRemaining - result.onDutyHours,
      driver.cycleHoursRemaining - result.onDutyHours,
    ),
  );

  return {
    loadIds: loads.map((load) => load.id),
    stops: result.stops,
    totalKm: result.totalKm,
    loadedKm: result.loadedKm,
    emptyKm: Math.max(0, result.totalKm - result.loadedKm),
    drivingHours: result.drivingHours,
    onDutyHours: result.onDutyHours,
    waitHours: result.waitHours,
    startAt: new Date(result.startAt).toISOString(),
    finishAt: new Date(result.finishAt).toISOString(),
    peakWeightLbs: result.peakWeightLbs,
    peakPallets: result.peakPallets,
    capacityLbs: result.capacityLbs,
    palletPositions: result.positions,
    lateStops: result.stops.filter((stop) => stop.lateMinutes > 0).length,
    worstLateMinutes: result.stops.reduce((worst, stop) => Math.max(worst, stop.lateMinutes), 0),
    tightestSlackMinutes: Number.isFinite(tightest) ? Math.round(tightest) : 0,
    hosRemainingAfter,
    revenue,
    revenuePerKm: result.totalKm > 0 ? revenue / result.totalKm : 0,
    feasible: blockers.length === 0,
    blockers,
    warnings,
  };
}

export type CoLoadCorridor = "same" | "adjacent" | "detour";

export type CoLoadEvaluation = {
  loadId: string;
  base: TripPlan;
  combined: TripPlan;
  addedKm: number;
  addedMinutes: number;
  destinationSpreadKm: number;
  pickupSpreadKm: number;
  corridor: CoLoadCorridor;
  weightAfterLbs: number;
  weightUtilization: number;
  palletsAfter: number;
  palletUtilization: number;
  hosAfterHours: number;
  addedRevenue: number;
  revenuePerAddedKm: number;
  feasible: boolean;
  blockers: TripBlocker[];
  warnings: string[];
  score: number;
  explanation: string;
};

export type CoLoadInput = {
  tripLoads: DispatchLoad[];
  candidate: DispatchLoad;
  driver: Driver;
  trailer: TrailerAsset;
  /** The truck is optional: an existing trip already holds it. */
  truck?: TruckAsset;
  start: Coordinates;
  startAt?: number;
  pickedUpLoadIds?: string[];
};

// Freight this far apart is a second trip, not a consolidation.
const SAME_CORRIDOR_KM = 40;
const ADJACENT_CORRIDOR_KM = 95;

export function evaluateCoLoad(input: CoLoadInput): CoLoadEvaluation {
  const shared = {
    driver: input.driver,
    trailer: input.trailer,
    truck: input.truck,
    start: input.start,
    startAt: input.startAt,
    pickedUpLoadIds: input.pickedUpLoadIds,
  };
  const base = planTrip({ ...shared, loads: input.tripLoads });
  const combined = planTrip({ ...shared, loads: [...input.tripLoads, input.candidate] });
  const addedKm = Math.max(0, combined.totalKm - base.totalKm);
  const addedMinutes = Math.max(0, Math.round((combined.onDutyHours - base.onDutyHours) * 60));
  const destinationSpreadKm = input.tripLoads.length
    ? Math.min(
        ...input.tripLoads.map((load) =>
          kmBetween(load.destinationPoint, input.candidate.destinationPoint),
        ),
      )
    : 0;
  const pickupSpreadKm = input.tripLoads.length
    ? Math.min(
        ...input.tripLoads.map((load) => kmBetween(load.originPoint, input.candidate.originPoint)),
      )
    : 0;
  const corridor: CoLoadCorridor =
    destinationSpreadKm <= SAME_CORRIDOR_KM
      ? "same"
      : destinationSpreadKm <= ADJACENT_CORRIDOR_KM
        ? "adjacent"
        : "detour";

  const weightUtilization = (combined.peakWeightLbs / combined.capacityLbs) * 100;
  const palletUtilization = (combined.peakPallets / combined.palletPositions) * 100;
  const detourReference = Math.max(60, base.totalKm);
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        40 * (1 - Math.min(1, addedKm / detourReference)) +
          25 * (1 - Math.min(1, destinationSpreadKm / (ADJACENT_CORRIDOR_KM + 25))) +
          20 * Math.min(1, Math.max(weightUtilization, palletUtilization) / 100) +
          15 * Math.min(1, combined.hosRemainingAfter / 3),
      ),
    ),
  );

  const warnings = [...combined.warnings];
  // When everything cannot ride at once the planner serialises the trip rather
  // than overloading the trailer. That is a legitimate plan, but the dispatcher
  // has to know consolidation is not what they are getting.
  const allLoads = [...input.tripLoads, input.candidate];
  const simultaneousLbs = allLoads.reduce((sum, load) => sum + load.weightLbs, 0);
  const simultaneousPallets = allLoads.reduce((sum, load) => sum + load.pallets, 0);
  if (
    simultaneousLbs > combined.capacityLbs ||
    simultaneousPallets > combined.palletPositions
  )
    warnings.push(
      `${input.trailer.number} cannot hold all of it at once (${simultaneousLbs.toLocaleString()} lb and ${simultaneousPallets} pallet positions against ${combined.capacityLbs.toLocaleString()} lb and ${combined.palletPositions}), so the plan delivers one load before collecting the next.`,
    );
  if (corridor === "detour")
    warnings.push(
      `Deliveries are ${Math.round(destinationSpreadKm)} km apart — outside the same corridor. Two trips may run cheaper.`,
    );
  const explanation = combined.feasible
    ? `Adds ${Math.round(addedKm)} km and ${addedMinutes} min. Delivery sits ${Math.round(destinationSpreadKm)} km from the nearest stop already planned, filling the trailer to ${Math.round(weightUtilization)}% of weight and ${Math.round(palletUtilization)}% of pallet positions with ${combined.hosRemainingAfter.toFixed(1)} h HOS left.`
    : combined.blockers.map((blocker) => blocker.label).join(" · ");

  return {
    loadId: input.candidate.id,
    base,
    combined,
    addedKm,
    addedMinutes,
    destinationSpreadKm,
    pickupSpreadKm,
    corridor,
    weightAfterLbs: combined.peakWeightLbs,
    weightUtilization,
    palletsAfter: combined.peakPallets,
    palletUtilization,
    hosAfterHours: combined.hosRemainingAfter,
    addedRevenue: input.candidate.rate,
    revenuePerAddedKm: addedKm > 0 ? input.candidate.rate / addedKm : input.candidate.rate,
    feasible: combined.feasible,
    blockers: combined.blockers,
    warnings,
    score,
    explanation,
  };
}
