import distance from '@turf/distance'
import { point } from '@turf/helpers'
import type { DispatchCandidate, DispatchLoad, Driver, PlanProposal, TrailerAsset, TruckAsset } from '../types'

const kmBetween = (a: {lat:number;lng:number}, b: {lat:number;lng:number}) => distance(point([a.lng,a.lat]), point([b.lng,b.lat]), { units:'kilometers' })
const driveHours = (km: number) => km / 82

export function evaluateCandidate(
  load: DispatchLoad,
  driver: Driver,
  trailer: TrailerAsset,
  truck?: TruckAsset,
  now = Date.now(),
): DispatchCandidate {
  const reasons: DispatchCandidate['reasons'] = []
  const deadheadKm = kmBetween(driver.point, load.originPoint)
  const tripKm = kmBetween(load.originPoint, load.destinationPoint) * 1.18
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
  const score = Math.max(0, Math.round(100 - deadheadKm*.32 - projectedHours*2.2 + hosRemainingAfter*2 + (load.priority==='critical'?8:load.priority==='high'?4:0)))
  const feasible = reasons.length === 0
  const explanation = feasible
    ? `${driver.name} is ${Math.round(deadheadKm)} km from pickup with compatible ${trailer.type.toLowerCase()} equipment and ${hosRemainingAfter.toFixed(1)} h projected HOS margin.`
    : reasons.map(reason=>reason.label).join(' · ')
  return {loadId:load.id,driverId:driver.id,truckId:driver.truckId,trailerId:trailer.id,feasible,reasons,deadheadKm,tripKm,pickupEtaMinutes:minutesToPickup,projectedHours,hosRemainingAfter,score,explanation}
}

export function buildMorningPlan(loads: DispatchLoad[], drivers: Driver[], trailers: TrailerAsset[], trucks: TruckAsset[] = []): PlanProposal {
  const openLoads = loads.filter(load=>load.status==='unassigned').sort((a,b)=>({critical:0,high:1,standard:2}[a.priority]-({critical:0,high:1,standard:2}[b.priority])))
  const available = drivers.filter(driver=>driver.status==='available')
  const matrices = openLoads.map(load=>available.flatMap(driver=>{
    const trailer = trailers.find(t=>t.id===driver.trailerId)
    if (!trailer) return []
    return [evaluateCandidate(load,driver,trailer,trucks.find(t=>t.id===driver.truckId))]
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
    id:`PLAN-${Date.now()}`,generatedAt:new Date().toISOString(),candidates:best,
    rejectedLoads:openLoads.filter(load=>!selectedLoads.has(load.id)).map(load=>({loadId:load.id,reasons:[...new Set(matrices[openLoads.indexOf(load)].flatMap(c=>c.reasons.map(r=>r.label)))].slice(0,3)})),
    projectedDeadheadKm:best.reduce((sum,item)=>sum+item.deadheadKm,0),
  }
}
