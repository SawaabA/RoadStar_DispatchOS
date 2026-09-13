import { driveHours, kmBetween } from './geo'
import type { DispatchCandidate, DispatchLoad, Driver, OptimizationWeights, PlanProposal, TrailerAsset, TruckAsset } from '../types'

export const DEFAULT_OPTIMIZATION_WEIGHTS: OptimizationWeights = {
  deadhead: 40,
  onTime: 30,
  hosBuffer: 20,
  futurePosition: 10,
}

export function evaluateCandidate(
  load: DispatchLoad,
  driver: Driver,
  trailer: TrailerAsset,
  truck?: TruckAsset,
  now = Date.now(),
  weights: OptimizationWeights = DEFAULT_OPTIMIZATION_WEIGHTS,
  futurePositionScore = 50,
): DispatchCandidate {
  const reasons: DispatchCandidate['reasons'] = []
  const deadheadKm = kmBetween(driver.point, load.originPoint)
  const tripKm = kmBetween(load.originPoint, load.destinationPoint)
  const driving = driveHours(deadheadKm + tripKm)
  const projectedHours = driving + 1.5
  if (driver.status !== 'available') reasons.push({code:'status',label:'Driver or power unit is unavailable'})
  if (!truck || truck.id !== driver.truckId || truck.status !== 'available') reasons.push({code:'status',label:'Power unit is unavailable'})
  if (trailer.status !== 'available') reasons.push({code:'status',label:'Trailer is unavailable'})
  if (trailer.type !== load.equipment) reasons.push({code:'equipment',label:`Requires ${load.equipment}; ${trailer.number} is ${trailer.type}`})
  if (load.weightLbs > trailer.capacityLbs) reasons.push({code:'weight',label:`Over trailer capacity by ${(load.weightLbs-trailer.capacityLbs).toLocaleString()} lb`})
  if (driving > driver.drivingHoursRemaining || projectedHours > driver.onDutyHoursRemaining || projectedHours > driver.cycleHoursRemaining) reasons.push({code:'hos',label:`Trip needs ${projectedHours.toFixed(1)} h on duty; only ${Math.min(driver.drivingHoursRemaining,driver.onDutyHoursRemaining,driver.cycleHoursRemaining).toFixed(1)} h available`})
  const minutesToPickup = driveHours(deadheadKm) * 60
  const pickupClose = new Date(load.pickupEnd).getTime()
  if (!Number.isFinite(pickupClose) || now + minutesToPickup*60000 > pickupClose) reasons.push({code:'pickup',label:'Cannot reach pickup before window closes'})
  const hosRemainingAfter = Math.max(0, Math.min(driver.drivingHoursRemaining-driving, driver.onDutyHoursRemaining-projectedHours, driver.cycleHoursRemaining-projectedHours))
  const pickupSlackMinutes = Number.isFinite(pickupClose)
    ? (pickupClose - (now + minutesToPickup * 60000)) / 60000
    : 0
  const scoreBreakdown = {
    deadhead: Math.max(0, Math.min(100, 100 - deadheadKm * 1.15)),
    onTime: Math.max(0, Math.min(100, 55 + pickupSlackMinutes * 0.75)),
    hosBuffer: Math.max(0, Math.min(100, (hosRemainingAfter / 8) * 100)),
    futurePosition: Math.max(0, Math.min(100, futurePositionScore)),
  }
  const weightTotal = Math.max(1, weights.deadhead + weights.onTime + weights.hosBuffer + weights.futurePosition)
  const weightedScore =
    scoreBreakdown.deadhead * weights.deadhead +
    scoreBreakdown.onTime * weights.onTime +
    scoreBreakdown.hosBuffer * weights.hosBuffer +
    scoreBreakdown.futurePosition * weights.futurePosition
  const priorityBoost = load.priority==='critical' ? 8 : load.priority==='high' ? 4 : 0
  const score = Math.max(0, Math.min(100, Math.round(weightedScore / weightTotal + priorityBoost)))
  const feasible = reasons.length === 0
  const explanation = feasible
    ? `${driver.name} is ${Math.round(deadheadKm)} km from pickup with compatible ${trailer.type.toLowerCase()} equipment and ${hosRemainingAfter.toFixed(1)} h projected HOS margin.`
    : reasons.map(reason=>reason.label).join(' · ')
  return {loadId:load.id,driverId:driver.id,truckId:driver.truckId,trailerId:trailer.id,feasible,reasons,deadheadKm,tripKm,pickupEtaMinutes:minutesToPickup,projectedHours,hosRemainingAfter,score,scoreBreakdown,explanation}
}

export function buildMorningPlan(loads: DispatchLoad[], drivers: Driver[], trailers: TrailerAsset[], trucks: TruckAsset[] = [], weights: OptimizationWeights = DEFAULT_OPTIMIZATION_WEIGHTS): PlanProposal {
  const generatedAt = Date.now()
  const openLoads = loads.filter(load=>load.status==='unassigned').sort((a,b)=>({critical:0,high:1,standard:2}[a.priority]-({critical:0,high:1,standard:2}[b.priority])))
  const available = drivers.filter(driver=>driver.status==='available')
  const matrices = openLoads.map(load=>available.flatMap(driver=>{
    const trailer = trailers.find(t=>t.id===driver.trailerId)
    if (!trailer) return []
    const futureOptions = loads.filter(other=>other.id!==load.id && other.status==='unassigned')
    const nearestFutureKm = futureOptions.length
      ? Math.min(...futureOptions.map(other=>kmBetween(load.destinationPoint, other.originPoint)))
      : 80
    const futureScore = Math.max(0, 100-nearestFutureKm)
    return [evaluateCandidate(load,driver,trailer,trucks.find(t=>t.id===driver.truckId),generatedAt,weights,futureScore)]
  }).sort((a,b)=>b.score-a.score))
  let best: DispatchCandidate[] = []
  let bestScore = -Infinity
  const search = (index:number, used:Set<string>, chosen:DispatchCandidate[], score:number) => {
    if (index===matrices.length) { if(score>bestScore){best=[...chosen];bestScore=score}; return }
    search(index+1,used,chosen,score-15)
    for(const candidate of matrices[index].filter(c=>c.feasible&&!used.has(c.driverId))){
      used.add(candidate.driverId); chosen.push(candidate); search(index+1,used,chosen,score+candidate.score); chosen.pop(); used.delete(candidate.driverId)
    }
  }
  search(0,new Set(),[],0)
  const selectedLoads = new Set(best.map(item=>item.loadId))
  return {
    id:`PLAN-${generatedAt}`,generatedAt:new Date(generatedAt).toISOString(),candidates:best,
    rejectedLoads:openLoads.filter(load=>!selectedLoads.has(load.id)).map(load=>({loadId:load.id,reasons:[...new Set(matrices[openLoads.indexOf(load)].flatMap(c=>c.reasons.map(r=>r.label)))].slice(0,3)})),
    projectedDeadheadKm:best.reduce((sum,item)=>sum+item.deadheadKm,0),
  }
}
