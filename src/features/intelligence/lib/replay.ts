import { buildMorningPlan, evaluateCandidate, PLANNING_ASSUMPTIONS } from "../../dispatch/lib/optimizer";
import { isDispatchState } from "../../dispatch/lib/stateValidation";
import type { DispatchCandidate, DispatchState } from "../../dispatch/types";

export type ActualTrip = { loadId: string; driverId: string; assignedAt: string; completedAt: string;
  emptyKm: number; hosRisk: boolean; detentionMinutes: number; planningSeconds: number };
export type ReplayDataset = { version: 1; name: string; startedAt: string; endedAt: string; initialState: DispatchState;
  releases: { loadId: string; at: string }[]; actual: ActualTrip[] };
export type ReplayMetrics = { coveragePct: number; covered: number; emptyKm: number; hosRisk: number; lateRisk: number;
  detentionMinutes: number; planningSeconds: number };
export type ReplayTrip = { loadId: string; driverId: string; assignedAt: string; completedAt: string; emptyKm: number; hosMargin: number };
const date = (x: unknown) => typeof x === "string" && Number.isFinite(Date.parse(x));
const nonnegative = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0;
const coord = (p: { lat: number; lng: number }) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

export function parseReplayDataset(value: unknown): ReplayDataset {
  const d = value as ReplayDataset;
  const fail = () => { throw new Error("Invalid replay. Supply a version 1, maximum 24-hour pre-dispatch snapshot with valid loads, fleet clocks, one release per load and observed baseline trips. See the exported example."); };
  if (!d || d.version !== 1 || typeof d.name !== "string" || !d.name.trim() || d.name.length > 200 || !date(d.startedAt) || !date(d.endedAt) ||
    Date.parse(d.endedAt) <= Date.parse(d.startedAt) || Date.parse(d.endedAt) - Date.parse(d.startedAt) > 24 * 3_600_000 || !isDispatchState(d.initialState)) return fail();
  const s = d.initialState;
  if (s.loads.length > 300 || !s.loads.length || s.drivers.length > 40 || s.assignments.length || s.backhaulReservations?.length) return fail();
  for (const rows of [s.loads, s.drivers, s.trucks, s.trailers, s.facilities]) if (new Set(rows.map(r => r.id)).size !== rows.length) return fail();
  if (s.loads.some(l => l.status !== "unassigned" || !["Dry Van", "Reefer", "Flatbed"].includes(l.equipment) || !["critical", "high", "standard"].includes(l.priority) ||
    !coord(l.originPoint) || !coord(l.destinationPoint) || !nonnegative(l.weightLbs) || ![l.pickupStart, l.pickupEnd, l.deliveryEnd].every(date) ||
    Date.parse(l.pickupStart) > Date.parse(l.pickupEnd) || Date.parse(l.pickupEnd) > Date.parse(l.deliveryEnd) || l.additionalStops?.length)) return fail();
  if (s.drivers.some(d => !coord(d.point) || typeof d.nextAvailable !== "string" || (d.nextAvailable !== "Now" && !date(d.nextAvailable)) ||
    ![d.drivingHoursRemaining, d.onDutyHoursRemaining, d.cycleHoursRemaining].every(nonnegative) || !["available", "maintenance", "inactive"].includes(d.status))) return fail();
  if (s.trucks.some(t => !coord(t.point)) || s.trailers.some(t => !nonnegative(t.capacityLbs) || t.capacityLbs === 0)) return fail();
  if (!Array.isArray(d.releases) || d.releases.length !== s.loads.length || new Set(d.releases.map(r => r?.loadId)).size !== s.loads.length ||
    d.releases.some(r => !r || !s.loads.some(l => l.id === r.loadId) || !date(r.at) || Date.parse(r.at) < Date.parse(d.startedAt) || Date.parse(r.at) >= Date.parse(d.endedAt))) return fail();
  if (!Array.isArray(d.actual) || d.actual.length > s.loads.length || new Set(d.actual.map(r => r?.loadId)).size !== d.actual.length ||
    d.actual.some(r => !r || !s.loads.some(l => l.id === r.loadId) || !s.drivers.some(d => d.id === r.driverId) || !date(r.assignedAt) || !date(r.completedAt) ||
      Date.parse(r.assignedAt) < Date.parse(d.startedAt) || Date.parse(r.assignedAt) < Date.parse(d.releases.find(l => l.loadId === r.loadId)!.at) ||
      Date.parse(r.completedAt) <= Date.parse(r.assignedAt) || Date.parse(r.completedAt) > Date.parse(d.endedAt) ||
      ![r.emptyKm, r.detentionMinutes, r.planningSeconds].every(nonnegative) || typeof r.hosRisk !== "boolean")) return fail();
  for (const a of d.actual) for (const b of d.actual) {
    const da = s.drivers.find(d => d.id === a.driverId)!, db = s.drivers.find(d => d.id === b.driverId)!;
    if (a !== b && (da.id === db.id || da.truckId === db.truckId || da.trailerId === db.trailerId) && Date.parse(a.assignedAt) < Date.parse(b.completedAt) && Date.parse(b.assignedAt) < Date.parse(a.completedAt)) return fail();
  }
  return structuredClone(d);
}

export function runConstrainedReplay(input: ReplayDataset) {
  const dataset = parseReplayDataset(input), state = dataset.initialState;
  const started = performance.now(), start = Date.parse(dataset.startedAt), end = Date.parse(dataset.endedAt);
  const trips: ReplayTrip[] = [];
  const pending = new Map<string, { ends: number; candidate: DispatchCandidate }>();
  const done = new Set<string>();
  let detention = 0;
  const reasons = new Map<string, string[]>();
  // Event-driven: reconsider at releases, completions, and dated driver availability.
  const events = new Set([start, ...dataset.releases.map(r => Date.parse(r.at)), ...state.drivers.map(d => Date.parse(d.nextAvailable)).filter(Number.isFinite)]);
  while (events.size) {
    const now = Math.min(...events); events.delete(now);
    if (now < start || now >= end) continue;
    for (const [driverId, job] of pending) if (job.ends <= now) {
      const load = state.loads.find(l => l.id === job.candidate.loadId)!;
      const driver = state.drivers.find(d => d.id === driverId)!;
      const drive = (job.candidate.deadheadKm + job.candidate.tripKm) / PLANNING_ASSUMPTIONS.averageSpeedKph;
      driver.point = load.destinationPoint; driver.status = "available"; driver.nextAvailable = "Now";
      driver.drivingHoursRemaining = Math.max(0, driver.drivingHoursRemaining - drive);
      driver.onDutyHoursRemaining = Math.max(0, driver.onDutyHoursRemaining - job.candidate.projectedHours);
      driver.cycleHoursRemaining = Math.max(0, driver.cycleHoursRemaining - job.candidate.projectedHours);
      state.trucks.find(t => t.id === driver.truckId)!.status = "available";
      state.trailers.find(t => t.id === driver.trailerId)!.status = "available";
      pending.delete(driverId);
    }
    const loads = state.loads.filter(l => !done.has(l.id) && Date.parse(dataset.releases.find(r => r.loadId === l.id)!.at) <= now);
    const plan = buildMorningPlan(loads, state.drivers, state.trailers, { now, trucks: state.trucks, weights: state.optimizationWeights });
    for (const rejected of plan.rejectedLoads) reasons.set(rejected.loadId, rejected.reasons);
    for (const candidate of plan.candidates) {
      const completedAt = now + candidate.projectedHours * 3_600_000;
      if (completedAt > end) { reasons.set(candidate.loadId, ["Trip cannot complete within the replay horizon."]); continue; }
      const driver = state.drivers.find(d => d.id === candidate.driverId)!;
      // Same candidate evaluator as dispatch; sequential availability never resets HOS.
      const load = state.loads.find(l => l.id === candidate.loadId)!;
      const fresh = evaluateCandidate(load, driver, state.trailers.find(t => t.id === driver.trailerId)!, { now, trucks: state.trucks });
      if (!fresh.feasible) continue;
      driver.status = "assigned";
      state.trucks.find(t => t.id === driver.truckId)!.status = "assigned";
      state.trailers.find(t => t.id === driver.trailerId)!.status = "assigned";
      done.add(load.id); pending.set(driver.id, { ends: completedAt, candidate }); events.add(completedAt);
      trips.push({ loadId: load.id, driverId: driver.id, assignedAt: new Date(now).toISOString(), completedAt: new Date(completedAt).toISOString(), emptyKm: candidate.deadheadKm, hosMargin: candidate.hosRemainingAfter });
      // Appointment waiting is known; unobserved queue/service delays are not invented.
      const waitMinutes = Math.max(0, candidate.pickupEtaMinutes - candidate.deadheadKm / PLANNING_ASSUMPTIONS.averageSpeedKph * 60);
      const facility = state.facilities.find(f => coord(f.point) && Math.abs(f.point.lat - load.originPoint.lat) < 0.005 && Math.abs(f.point.lng - load.originPoint.lng) < 0.005);
      if (facility) detention += Math.max(0, waitMinutes + 30 - facility.freeMinutes);
    }
  }
  const metrics = (rows: { emptyKm: number }[], hosRisk: number, lateRisk: number, detentionMinutes: number, planningSeconds: number): ReplayMetrics => ({
    covered: rows.length, coveragePct: rows.length / state.loads.length * 100, emptyKm: rows.reduce((s, r) => s + r.emptyKm, 0), hosRisk, lateRisk, detentionMinutes, planningSeconds,
  });
  const baseline = metrics(dataset.actual, dataset.actual.filter(a => a.hosRisk).length,
    dataset.actual.filter(a => Date.parse(a.completedAt) > Date.parse(state.loads.find(l => l.id === a.loadId)!.deliveryEnd)).length,
    dataset.actual.reduce((s, a) => s + a.detentionMinutes, 0), dataset.actual.reduce((s, a) => s + a.planningSeconds, 0));
  const optimized = metrics(trips, trips.filter(t => t.hosMargin < 0.5).length, 0, detention, (performance.now() - started) / 1000);
  return { name: dataset.name, baseline, optimized, trips, unassigned: state.loads.filter(l => !done.has(l.id)).map(l => ({ loadId: l.id, reasons: reasons.get(l.id) ?? ["No feasible unit before the horizon."] })),
    assumptions: "Baseline is supplied observed data; optimized travel uses 1.2× great-circle distance at 60 km/h, 30-minute pickup/delivery service, a 30-minute HOS reserve and no inferred rest resets. Optimized detention models appointment waiting only, excluding unknown queues. Solver time is not human planning time. Single-stop loads only; maximum 24-hour horizon, 300 loads and 40 drivers." };
}

export function workspaceMetrics(state: DispatchState, now = Date.now()) {
  const loads = state.loads.filter(l => !["cancelled", "archived"].includes(l.status));
  return { coveragePct: loads.length ? loads.filter(l => l.status !== "unassigned").length / loads.length * 100 : 0,
    hosRisk: state.drivers.filter(d => Math.min(d.drivingHoursRemaining, d.onDutyHoursRemaining, d.cycleHoursRemaining) < 0.5).length,
    lateRisk: state.assignments.filter(a => a.status !== "completed" && Math.max(now, Date.parse(a.eta)) > Date.parse(state.loads.find(l => l.id === a.loadId)?.deliveryEnd ?? "")).length,
    detentionMinutes: state.visits.reduce((sum, v) => sum + Math.max(0, v.dwellMinutes - (state.facilities.find(f => f.id === v.facilityId)?.freeMinutes ?? 120)), 0) };
}
