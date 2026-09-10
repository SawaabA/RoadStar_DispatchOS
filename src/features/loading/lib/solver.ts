import { createPlan } from './planner'
import type { Load, Plan, Trailer } from '../types'

export async function solvePlan(loads: Load[], trailer: Trailer): Promise<Plan> {
  try {
    const response = await fetch('/api/plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loads, trailer }), signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`Solver returned ${response.status}`)
    return await response.json() as Plan
  } catch {
    return { ...createPlan(loads, trailer), engine: 'browser-fallback' }
  }
}
