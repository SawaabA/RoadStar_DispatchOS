import { describe, expect, it } from 'vitest'
import { createDemoState } from '../data/demoData'
import { buildMorningPlan, evaluateCandidate } from './optimizer'

describe('dispatch feasibility', () => {
  it('rejects equipment mismatches as hard failures', () => {
    const state = createDemoState()
    const reeferLoad = state.loads.find((load) => load.equipment === 'Reefer' && load.status === 'unassigned')!
    const dryVanDriver = state.drivers.find((driver) => driver.trailerId === 'DV-118')!
    const dryVan = state.trailers.find((trailer) => trailer.id === dryVanDriver.trailerId)!
    const truck = state.trucks.find((item) => item.id === dryVanDriver.truckId)!
    const result = evaluateCandidate(reeferLoad, dryVanDriver, dryVan, truck)

    expect(result.feasible).toBe(false)
    expect(result.reasons.some((reason) => reason.code === 'equipment')).toBe(true)
  })

  it('rejects a load when practical HOS is insufficient', () => {
    const state = createDemoState()
    const load = state.loads.find((item) => item.id === 'L-4521')!
    const driver = { ...state.drivers[0], drivingHoursRemaining: 0.5, onDutyHoursRemaining: 0.75 }
    const trailer = state.trailers.find((item) => item.id === driver.trailerId)!

    const truck = state.trucks.find((item) => item.id === driver.truckId)!
    expect(evaluateCandidate(load, driver, trailer, truck).reasons.map((reason) => reason.code)).toContain('hos')
  })

  it('allows the exact HOS boundary and explains simultaneous hard failures', () => {
    const state = createDemoState()
    const load = state.loads.find((item) => item.id === 'L-4521')!
    const driver = state.drivers[0]
    const trailer = state.trailers.find((item) => item.id === driver.trailerId)!
    const truck = state.trucks.find((item) => item.id === driver.truckId)!
    const baseline = evaluateCandidate(load, driver, trailer, truck)
    const exact = {
      ...driver,
      drivingHoursRemaining: baseline.projectedHours - 1.5,
      onDutyHoursRemaining: baseline.projectedHours,
      cycleHoursRemaining: baseline.projectedHours,
    }
    expect(evaluateCandidate(load, exact, trailer, truck).feasible).toBe(true)

    const failed = evaluateCandidate(
      { ...load, weightLbs: trailer.capacityLbs + 1 },
      { ...exact, status: 'maintenance' },
      { ...trailer, type: 'Reefer' },
      { ...truck, status: 'maintenance' },
    )
    expect(new Set(failed.reasons.map((reason) => reason.code))).toEqual(
      new Set(['status', 'equipment', 'weight']),
    )
  })
})

describe('morning auto-plan', () => {
  it('returns only feasible assignments and never double-books a driver', () => {
    const state = createDemoState()
    const plan = buildMorningPlan(state.loads, state.drivers, state.trailers, state.trucks)
    const driverIds = plan.candidates.map((candidate) => candidate.driverId)

    expect(plan.candidates.every((candidate) => candidate.feasible)).toBe(true)
    expect(new Set(driverIds).size).toBe(driverIds.length)
    expect(plan.rejectedLoads.some((item) => item.loadId === 'L-4530')).toBe(true)
  })

  it('rejects unavailable power units and exhausted cycle clocks', () => {
    const state = createDemoState()
    const load = state.loads.find((item) => item.id === 'L-4521')!
    const driver = state.drivers[0]
    const trailer = state.trailers.find((item) => item.id === driver.trailerId)!
    const truck = { ...state.trucks.find((item) => item.id === driver.truckId)!, status: 'maintenance' as const }
    expect(evaluateCandidate(load, driver, trailer, truck).reasons.map((reason) => reason.code)).toContain('status')
    expect(evaluateCandidate(load, { ...driver, cycleHoursRemaining: 0.5 }, trailer, { ...truck, status: 'available' }).reasons.map((reason) => reason.code)).toContain('hos')
  })

  it('is deterministic for identical operational inputs', () => {
    const state = createDemoState()
    const first = buildMorningPlan(state.loads, state.drivers, state.trailers, state.trucks)
    const second = buildMorningPlan(state.loads, state.drivers, state.trailers, state.trucks)
    expect(second.candidates).toEqual(first.candidates)
    expect(second.rejectedLoads).toEqual(first.rejectedLoads)
  })
})
