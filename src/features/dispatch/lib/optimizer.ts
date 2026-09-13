import type { Assignment, BackhaulReservation, Coordinates, DispatchCandidate, DispatchLoad, Driver, FeasibilityReason, OptimizationWeights, PlanProposal, TrailerAsset, TruckAsset } from '../types';

// Planning estimates, not road routing or a certified HOS calculation.
export const PLANNING_ASSUMPTIONS = {
  roadDistanceFactor: 1.2,
  averageSpeedKph: 60,
  pickupServiceHours: 0.5,
  deliveryServiceHours: 0.5,
  minimumHosMarginHours: 0.5,
  maxSearchNodes: 50_000,
} as const;

export const DEFAULT_OPTIMIZATION_WEIGHTS: OptimizationWeights = { deadhead: 40, onTime: 30, hosBuffer: 20, futurePosition: 10 };
export type PlanningContext = { now?: number; trucks?: TruckAsset[]; assignments?: Assignment[]; reservations?: BackhaulReservation[]; weights?: OptimizationWeights; futurePositionScore?: number; routeImpact?: (load: DispatchLoad, driver: Driver) => { blocked: boolean; delayMinutes: number } };
type Context = PlanningContext;
const round = (value: number) => Math.round(value * 100) / 100;
const validPoint = (p: Coordinates) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
const nonnegative = (n: number) => Number.isFinite(n) && n >= 0;
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function roadKm(a: Coordinates, b: Coordinates): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h)))) * PLANNING_ASSUMPTIONS.roadDistanceFactor;
}

// Accept the clock and truck call signatures used by the two feature branches.
export function evaluateCandidate(load: DispatchLoad, driver: Driver, trailer: TrailerAsset, input: Context | TruckAsset | number = {}, at?: number, weights = DEFAULT_OPTIMIZATION_WEIGHTS, futurePositionScore = 50): DispatchCandidate {
  const context: Context = typeof input === 'number' ? { now: input } : 'id' in input ? { trucks: [input], now: at, weights, futurePositionScore } : input;
  const now = context.now ?? Date.now();
  const reasons: FeasibilityReason[] = [];
  const reject = (code: FeasibilityReason['code'], label: string) => reasons.push({ code, label });
  if (load.status !== 'unassigned') reject('status', 'Load is not unassigned.');
  if (driver.status !== 'available') reject('status', 'Driver is not available.');
  if (trailer.status !== 'available') reject('status', 'Trailer is not available.');
  if (!driver.truckId || driver.trailerId !== trailer.id) reject('status', 'Driver must have the selected trailer and a truck paired.');
  if (context.trucks) {
    const truck = context.trucks.find(t => t.id === driver.truckId);
    if (!truck || truck.status !== 'available') reject('status', 'Paired truck is missing or unavailable.');
  }
  if (context.assignments?.some(a => a.status !== 'completed' && (a.loadId === load.id || a.driverId === driver.id || a.truckId === driver.truckId || a.trailerId === trailer.id))) {
    reject('status', 'Load or unit already has an active assignment.');
  }
  if (context.reservations?.some(a => a.loadId === load.id || a.driverId === driver.id || a.truckId === driver.truckId || a.trailerId === trailer.id)) reject('status', 'Load or unit is reserved for a backhaul.');
  const impact = context.routeImpact?.(load, driver);
  if (impact?.blocked) reject('pickup', 'A reported full closure intersects the estimated route; a verified alternative is required.');
  const delayHours = Math.max(0, impact?.delayMinutes ?? 0) / 60;
  if (load.equipment !== trailer.type || (load.temperatureControlled && trailer.type !== 'Reefer')) reject('equipment', `Requires ${load.equipment}${load.temperatureControlled ? ' with refrigeration' : ''}; trailer equipment is ${trailer.type}.`);
  if (!nonnegative(load.weightLbs) || !Number.isFinite(trailer.capacityLbs) || trailer.capacityLbs <= 0 || load.weightLbs > trailer.capacityLbs) reject('weight', 'Load weight is invalid or exceeds trailer capacity.');

  const coordinatesValid = [load.originPoint, load.destinationPoint, driver.point].every(validPoint);
  if (!coordinatesValid) reject('pickup', 'Valid driver, pickup, and delivery coordinates are required.');
  const deadheadKm = coordinatesValid ? roadKm(driver.point, load.originPoint) : 0;
  const tripKm = coordinatesValid ? roadKm(load.originPoint, load.destinationPoint) : 0;
  const pickupStart = Date.parse(load.pickupStart), pickupEnd = Date.parse(load.pickupEnd), deliveryEnd = Date.parse(load.deliveryEnd);
  const datesValid = [now, pickupStart, pickupEnd, deliveryEnd].every(Number.isFinite) && pickupStart <= pickupEnd && pickupStart <= deliveryEnd;
  if (!datesValid) reject('pickup', 'Valid pickup and delivery windows are required.');
  const availableAt = driver.nextAvailable.trim().toLowerCase() === 'now' ? now : Date.parse(driver.nextAvailable);
  if (!Number.isFinite(availableAt)) reject('status', 'Driver availability must be Now or a dated timestamp.');
  const startDelay = Number.isFinite(availableAt) && Number.isFinite(now) ? Math.max(0, (availableAt - now) / 3_600_000) : 0;
  const drivingHours = (deadheadKm + tripKm) / PLANNING_ASSUMPTIONS.averageSpeedKph + delayHours;
  const arrivalHours = startDelay + deadheadKm / PLANNING_ASSUMPTIONS.averageSpeedKph + delayHours;
  const pickupHours = datesValid ? Math.max(arrivalHours, (pickupStart - now) / 3_600_000) : arrivalHours;
  const waitingHours = pickupHours - arrivalHours;
  const workHours = drivingHours + waitingHours + PLANNING_ASSUMPTIONS.pickupServiceHours + PLANNING_ASSUMPTIONS.deliveryServiceHours;
  const alreadyOnDuty = driver.dutyStatus === 'on_duty' || driver.dutyStatus === 'driving';
  const dutyHours = workHours + (alreadyOnDuty ? startDelay : 0);
  const projectedHours = startDelay + workHours;
  if (datesValid && now + pickupHours * 3_600_000 > pickupEnd) reject('pickup', 'Estimated pickup arrival misses the pickup window.');
  if (datesValid && now + projectedHours * 3_600_000 > deliveryEnd) reject('pickup', 'Estimated delivery completion misses the delivery deadline.');
  const clocksValid = [driver.drivingHoursRemaining, driver.onDutyHoursRemaining, driver.cycleHoursRemaining].every(nonnegative);
  if (!clocksValid) reject('hos', 'Valid remaining driving, on-duty, and cycle hours are required.');
  const margins = clocksValid ? [driver.drivingHoursRemaining - drivingHours, driver.onDutyHoursRemaining - dutyHours, driver.cycleHoursRemaining - dutyHours] : [0, 0, 0];
  const labels = ['Driving', 'On-duty', 'Cycle'];
  if (clocksValid) margins.forEach((margin, i) => {
    if (margin < PLANNING_ASSUMPTIONS.minimumHosMarginHours) reject('hos', `${labels[i]} hours cannot cover the trip with a 30-minute reserve.`);
  });
  const hosRemainingAfter = Math.min(...margins);
  const feasible = reasons.length === 0;
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const scoreBreakdown = {
    deadhead: clamp(100 - deadheadKm * 1.15),
    onTime: datesValid ? clamp(55 + ((pickupEnd - now) / 60_000 - pickupHours * 60) * 0.75) : 0,
    hosBuffer: clamp(hosRemainingAfter / 8 * 100),
    futurePosition: clamp(context.futurePositionScore ?? 50),
  };
  const selectedWeights = context.weights ?? DEFAULT_OPTIMIZATION_WEIGHTS;
  const entries = Object.keys(scoreBreakdown) as (keyof OptimizationWeights)[];
  const weightTotal = entries.reduce((sum, key) => sum + Math.max(0, selectedWeights[key]), 0);
  const score = feasible ? Math.round(entries.reduce((sum, key) => sum + scoreBreakdown[key] * Math.max(0, selectedWeights[key]), 0) / Math.max(1, weightTotal)) : 0;
  return {
    loadId: load.id, driverId: driver.id, truckId: driver.truckId, trailerId: trailer.id,
    feasible, reasons, scoreBreakdown, deadheadKm: round(deadheadKm), tripKm: round(tripKm),
    pickupEtaMinutes: round(pickupHours * 60), projectedHours: round(projectedHours), hosRemainingAfter: round(hosRemainingAfter), score,
    explanation: feasible ? `Compatible equipment; about ${Math.round(deadheadKm)} km deadhead and ${hosRemainingAfter.toFixed(1)} h minimum HOS remaining. Travel and service times are estimates.` : reasons.map(r => r.label).join(' '),
  };
}

/** Maximize covered loads, then priority, then weighted score, then minimize deadhead. No input mutation.
 * A deterministic search budget keeps the browser responsive on larger inputs;
 * its best feasible proposal is returned when the budget is exhausted.
 */
export function buildMorningPlan(loads: DispatchLoad[], drivers: Driver[], trailers: TrailerAsset[], input: Context | TruckAsset[] | number = {}, weights = DEFAULT_OPTIMIZATION_WEIGHTS): PlanProposal {
  const context: Context = typeof input === 'number' ? { now: input } : Array.isArray(input) ? { trucks: input, weights } : input;
  const now = context.now ?? Date.now();
  const options = { ...context, now };
  const priority = { critical: 3, high: 2, standard: 1 };
  const rows = loads.filter(l => l.status === 'unassigned').map(load => {
    const futureLoads = loads.filter(other => other.id !== load.id && other.status === 'unassigned' && validPoint(other.originPoint));
    const futurePositionScore = validPoint(load.destinationPoint) && futureLoads.length ? Math.max(0, 100 - Math.min(...futureLoads.map(other => roadKm(load.destinationPoint, other.originPoint)))) : 20;
    const evaluated = drivers.flatMap(driver => {
      const trailer = trailers.find(t => t.id === driver.trailerId);
      return trailer ? [evaluateCandidate(load, driver, trailer, { ...options, futurePositionScore })] : [];
    });
    return { load, evaluated, candidates: evaluated.filter(c => c.feasible).sort((a, b) => a.deadheadKm - b.deadheadKm || compareId(a.driverId, b.driverId)) };
  }).sort((a, b) => a.candidates.length - b.candidates.length || priority[b.load.priority] - priority[a.load.priority] || compareId(a.load.id, b.load.id));
  let best: DispatchCandidate[] = [], bestPriority = -1, bestScore = -1, bestKm = Infinity, nodes = 0;
  const chosen: DispatchCandidate[] = [];
  const usedDrivers = new Set<string>(), usedTrucks = new Set<string>(), usedTrailers = new Set<string>(), usedLoads = new Set<string>();
  function search(index: number, points: number, km: number, score = 0) {
    if (++nodes > PLANNING_ASSUMPTIONS.maxSearchNodes) return;
    if (chosen.length > best.length || (chosen.length === best.length && (points > bestPriority || (points === bestPriority && (score > bestScore || (score === bestScore && km < bestKm)))))) {
      best = [...chosen]; bestPriority = points; bestScore = score; bestKm = km;
    }
    if (index === rows.length || chosen.length + rows.length - index < best.length) return;
    const row = rows[index];
    for (const c of row.candidates) {
      if (usedLoads.has(c.loadId) || usedDrivers.has(c.driverId) || usedTrucks.has(c.truckId) || usedTrailers.has(c.trailerId)) continue;
      usedLoads.add(c.loadId); usedDrivers.add(c.driverId); usedTrucks.add(c.truckId); usedTrailers.add(c.trailerId); chosen.push(c);
      search(index + 1, points + priority[row.load.priority], km + c.deadheadKm, score + c.score);
      chosen.pop(); usedLoads.delete(c.loadId); usedDrivers.delete(c.driverId); usedTrucks.delete(c.truckId); usedTrailers.delete(c.trailerId);
      if (nodes > PLANNING_ASSUMPTIONS.maxSearchNodes) break;
    }
    search(index + 1, points, km, score);
  }
  search(0, 0, 0);
  return {
    id: `plan-${now}`, generatedAt: new Date(now).toISOString(), candidates: best,
    projectedDeadheadKm: round(best.reduce((sum, c) => sum + c.deadheadKm, 0)),
    rejectedLoads: rows.filter(r => !best.some(c => c.loadId === r.load.id)).map(row => ({
      loadId: row.load.id,
      reasons: row.candidates.length ? ['No unreserved unit selected in this fleet proposal.'] : [...new Set(row.evaluated.flatMap(c => c.reasons.map(r => r.label)))].concat(row.evaluated.length ? [] : ['No driver has a matching trailer in the fleet.']),
    })),
  };
}
