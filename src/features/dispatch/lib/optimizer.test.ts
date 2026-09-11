import { describe, expect, it } from 'vitest';
import { buildMorningPlan, evaluateCandidate } from './optimizer';
import { createDemoState } from '../data/demoData';
import type { Assignment, DispatchLoad, Driver, TrailerAsset, TruckAsset } from '../types';

const now = Date.parse('2026-09-11T12:00:00Z');
const at = (hours: number) => new Date(now + hours * 3_600_000).toISOString();
const location = { lat: 43.5, lng: -79.8 };
const load = (patch: Partial<DispatchLoad> = {}): DispatchLoad => ({
  id: 'L1', billNumber: 'RS-1', customer: 'Test', description: 'Test freight',
  status: 'unassigned', equipment: 'Dry Van', origin: 'Milton', originPoint: location,
  destination: 'Milton', destinationPoint: location, pickupStart: at(0), pickupEnd: at(4), deliveryEnd: at(12),
  weightLbs: 10000, pallets: 10, temperatureControlled: false, rate: 1000, priority: 'standard', ...patch,
});
const driver = (patch: Partial<Driver> = {}): Driver => ({
  id: 'D1', name: 'Test Driver', initials: 'TD', status: 'available', dutyStatus: 'on_duty',
  location: 'Milton', point: location, drivingHoursRemaining: 10, onDutyHoursRemaining: 12,
  cycleHoursRemaining: 30, truckId: 'T1', trailerId: 'R1', nextAvailable: 'Now', ...patch,
});
const trailer = (patch: Partial<TrailerAsset> = {}): TrailerAsset => ({
  id: 'R1', number: '1', type: 'Dry Van', status: 'available', capacityLbs: 40000,
  lengthIn: 636, widthIn: 98, heightIn: 102, ...patch,
});
const truck: TruckAsset = { id: 'T1', number: '1', status: 'available', point: location, odometerKm: 0 };
const evaluate = (l = load(), d = driver(), t = trailer()) => evaluateCandidate(l, d, t, { now });

describe('pairing feasibility', () => {
  it('accepts a valid pairing and includes both service stops in its ETA', () => {
    const c = evaluate();
    expect(c.feasible).toBe(true);
    expect(c.reasons).toEqual([]);
    expect(c.projectedHours).toBe(1);
    expect(c.hosRemainingAfter).toBe(10);
    expect(c.explanation).toContain('Compatible equipment');
  });
  it.each(['Reefer', 'Flatbed'] as const)('rejects incompatible %s equipment', equipment => {
    expect(evaluate(load({ equipment })).reasons).toContainEqual(expect.objectContaining({ code: 'equipment' }));
  });
  it('requires refrigeration even when the equipment label says Dry Van', () => {
    expect(evaluate(load({ temperatureControlled: true })).feasible).toBe(false);
    expect(evaluate(load({ temperatureControlled: true, equipment: 'Reefer' }), driver(), trailer({ type: 'Reefer' })).feasible).toBe(true);
  });
  it('accepts exact capacity but rejects excess weight', () => {
    expect(evaluate(load({ weightLbs: 40000 })).feasible).toBe(true);
    expect(evaluate(load({ weightLbs: 40001 })).reasons).toContainEqual(expect.objectContaining({ code: 'weight' }));
  });
  it.each(['assigned', 'maintenance', 'inactive'] as const)('rejects %s assets', status => {
    expect(evaluate(load(), driver({ status })).feasible).toBe(false);
    expect(evaluate(load(), driver(), trailer({ status })).feasible).toBe(false);
    expect(evaluateCandidate(load(), driver(), trailer(), { now, trucks: [{ ...truck, status }] }).feasible).toBe(false);
  });
  it('rejects unavailable loads, missing trucks and mismatched trailers', () => {
    expect(evaluate(load({ status: 'completed' })).feasible).toBe(false);
    expect(evaluate(load(), driver({ trailerId: 'missing' })).feasible).toBe(false);
    expect(evaluateCandidate(load(), driver(), trailer(), { now, trucks: [] }).feasible).toBe(false);
  });
  it.each(['drivingHoursRemaining', 'onDutyHoursRemaining', 'cycleHoursRemaining'] as const)('requires the reserve on the %s clock', clock => {
    const boundary = clock === 'drivingHoursRemaining' ? 0.5 : 1.5;
    expect(evaluate(load(), driver({ [clock]: boundary })).feasible).toBe(true);
    expect(evaluate(load(), driver({ [clock]: boundary - 0.001 })).reasons).toContainEqual(expect.objectContaining({ code: 'hos' }));
  });
  it('counts early pickup waiting against duty and cycle hours, not driving', () => {
    const l = load({ pickupStart: at(3) });
    const c = evaluate(l, driver({ drivingHoursRemaining: 0.5, onDutyHoursRemaining: 4.5, cycleHoursRemaining: 4.5 }));
    expect(c.feasible).toBe(true);
    expect(c.pickupEtaMinutes).toBe(180);
    expect(c.projectedHours).toBe(4);
    expect(evaluate(l, driver({ onDutyHoursRemaining: 4 })).feasible).toBe(false);
    expect(evaluate(l, driver({ cycleHoursRemaining: 4 })).feasible).toBe(false);
  });
  it('includes deadhead and loaded travel when checking driving hours', () => {
    const c = evaluate(load({ destinationPoint: { lat: 44.5, lng: -79.8 } }), driver({ point: { lat: 42.5, lng: -79.8 }, drivingHoursRemaining: 4 }));
    expect(c.deadheadKm).toBeGreaterThan(130);
    expect(c.tripKm).toBeGreaterThan(130);
    expect(c.feasible).toBe(false);
    expect(c.reasons.some(r => r.label.startsWith('Driving'))).toBe(true);
  });
  it('accepts window boundaries and rejects late pickup or delivery', () => {
    expect(evaluate(load({ pickupEnd: at(0), deliveryEnd: at(1) })).feasible).toBe(true);
    expect(evaluate(load({ pickupStart: at(-2), pickupEnd: at(-1) })).feasible).toBe(false);
    expect(evaluate(load({ deliveryEnd: at(0.9) })).feasible).toBe(false);
  });
  it('honors future driver availability without assuming clock resets', () => {
    const c = evaluate(load(), driver({ nextAvailable: at(2) }));
    expect(c.pickupEtaMinutes).toBe(120);
    expect(c.projectedHours).toBe(3);
    expect(evaluate(load({ pickupEnd: at(1) }), driver({ nextAvailable: at(2) })).feasible).toBe(false);
    expect(evaluate(load(), driver({ nextAvailable: '11:15' })).feasible).toBe(false);
  });
  it('charges availability delay to a driver already on duty and never replenishes resting clocks', () => {
    expect(evaluate(load(), driver({ nextAvailable: at(2), onDutyHoursRemaining: 2 })).feasible).toBe(false);
    expect(evaluate(load(), driver({ nextAvailable: at(2), dutyStatus: 'off_duty', onDutyHoursRemaining: 2 })).feasible).toBe(true);
    expect(evaluate(load(), driver({ nextAvailable: at(2), dutyStatus: 'off_duty', onDutyHoursRemaining: 1 })).feasible).toBe(false);
  });
  it.each([
    [load({ weightLbs: NaN }), driver(), trailer()],
    [load(), driver({ drivingHoursRemaining: NaN }), trailer()],
    [load(), driver({ point: { lat: 100, lng: 0 } }), trailer()],
    [load({ pickupStart: 'invalid' }), driver(), trailer()],
    [load({ pickupStart: at(5), pickupEnd: at(4) }), driver(), trailer()],
    [load(), driver(), trailer({ capacityLbs: -1 })],
  ])('fails closed for malformed planning inputs (%#)', (l, d, t) => {
    const c = evaluate(l, d, t);
    expect(c.feasible).toBe(false);
    expect(c.reasons.length).toBeGreaterThan(0);
    expect(Number.isFinite(c.score)).toBe(true);
  });
});

describe('fleet planning', () => {
  const secondDriver = driver({ id: 'D2', truckId: 'T2', trailerId: 'R2' });
  const secondTrailer = trailer({ id: 'R2' });
  it('finds two assignments where choosing the nearest driver greedily would cover only one', () => {
    const loads = [load({ id: 'flexible', pickupEnd: at(5) }), load({ id: 'urgent', pickupEnd: at(0.1) })];
    const drivers = [driver(), { ...secondDriver, point: { lat: 44, lng: -79.8 } }];
    const plan = buildMorningPlan(loads, drivers, [trailer(), secondTrailer], { now });
    expect(plan.candidates).toHaveLength(2);
    expect(plan.candidates.find(c => c.loadId === 'urgent')?.driverId).toBe('D1');
  });
  it.each(['id', 'truckId', 'trailerId'] as const)('never reuses a driver resource (%s)', key => {
    const plan = buildMorningPlan([load(), load({ id: 'L2' })], [driver(), { ...secondDriver, [key]: driver()[key] }], [trailer(), secondTrailer], { now });
    expect(plan.candidates).toHaveLength(1);
    expect(plan.rejectedLoads).toHaveLength(1);
  });
  it.each(['loadId', 'driverId', 'truckId', 'trailerId'] as const)('respects existing active reservations by %s', key => {
    const assignment: Assignment = {
      id: 'A1', assignedAt: at(-1), progress: 0.5, currentPoint: location,
      breadcrumbs: [location], speedKph: 60, distanceKm: 10, eta: at(1),
      loadId: 'other', driverId: 'other', truckId: 'other', trailerId: 'other', status: 'in_transit',
      [key]: { loadId: 'L1', driverId: 'D1', truckId: 'T1', trailerId: 'R1' }[key],
    };
    expect(buildMorningPlan([load()], [driver()], [trailer()], { now, assignments: [assignment] }).candidates).toHaveLength(0);
    expect(buildMorningPlan([load()], [driver()], [trailer()], { now, assignments: [{ ...assignment, status: 'completed' }] }).candidates).toHaveLength(1);
  });
  it('prefers critical freight when coverage is tied', () => {
    const plan = buildMorningPlan([load(), load({ id: 'critical', priority: 'critical' })], [driver()], [trailer()], { now });
    expect(plan.candidates.map(c => c.loadId)).toEqual(['critical']);
  });
  it('minimizes deadhead when coverage and priority are tied', () => {
    const plan = buildMorningPlan([load()], [{ ...secondDriver, point: { lat: 44, lng: -79.8 } }, driver()], [trailer(), secondTrailer], { now });
    expect(plan.candidates[0].driverId).toBe('D1');
    expect(plan.projectedDeadheadKm).toBe(0);
  });
  it('explains incompatible and missing equipment and ignores closed loads', () => {
    const plan = buildMorningPlan([load({ equipment: 'Flatbed' }), load({ id: 'closed', status: 'completed' })], [driver()], [trailer()], { now });
    expect(plan.candidates).toEqual([]);
    expect(plan.rejectedLoads).toHaveLength(1);
    expect(plan.rejectedLoads[0].reasons.join(' ')).toContain('equipment');
    expect(buildMorningPlan([load()], [driver()], [], { now }).rejectedLoads[0].reasons[0]).toContain('matching trailer');
    expect(buildMorningPlan([], [], [], { now }).rejectedLoads).toEqual([]);
  });
  it('is deterministic across input order and does not mutate the input', () => {
    const loads = [load(), load({ id: 'L2' })], drivers = [driver(), secondDriver], trailers = [trailer(), secondTrailer];
    const before = structuredClone({ loads, drivers, trailers });
    const a = buildMorningPlan(loads, drivers, trailers, { now });
    expect(buildMorningPlan([...loads].reverse(), [...drivers].reverse(), [...trailers].reverse(), { now })).toEqual(a);
    expect({ loads, drivers, trailers }).toEqual(before);
  });
  it('produces feasible, distinct proposals for the supplied demo fleet', () => {
    const state = createDemoState();
    const context = { now: Date.now(), trucks: state.trucks, assignments: state.assignments };
    const plan = buildMorningPlan(state.loads, state.drivers, state.trailers, context);
    expect(plan.candidates.length).toBeGreaterThan(0);
    for (const field of ['loadId', 'driverId', 'truckId', 'trailerId'] as const) expect(new Set(plan.candidates.map(c => c[field])).size).toBe(plan.candidates.length);
    expect(plan.candidates.every(c => c.feasible)).toBe(true);
    expect(plan.rejectedLoads.some(r => r.loadId === 'L-4530')).toBe(true);
  });
});
