import { createPlan, validatePlanInput } from './planner'
import type { Load, Plan, Trailer } from '../types'

export async function solvePlan(loads: Load[], trailer: Trailer, objective: "space" | "balance" | "unload" | "damage" = "space"): Promise<Plan> {
  const validationErrors = validatePlanInput(loads, trailer)
  if (validationErrors.length) throw new Error(validationErrors.join(' '))
  try {
    const response = await fetch('/api/plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loads, trailer, objective }), signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`Solver returned ${response.status}`)
    const plan = await response.json() as Plan
    if (!Array.isArray(plan.items) || !Array.isArray(plan.unplanned) || !Array.isArray(plan.warnings)) throw new Error('Solver returned an invalid plan')
    return plan
  } catch {
    return { ...createPlan(loads, trailer, objective), engine: 'browser-fallback' }
  }
}
