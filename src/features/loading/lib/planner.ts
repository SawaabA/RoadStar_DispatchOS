import type { Load, PackedItem, Plan, Trailer } from '../types'

const colors = ['#4ee6a8', '#58a6ff', '#f8c35c', '#e77cff', '#ff735c']

export function validatePlanInput(loads: Load[], trailer: Trailer): string[] {
  const errors: string[] = []
  if (!loads.length) errors.push('Add at least one shipment.')
  if (![trailer.lengthIn, trailer.widthIn, trailer.heightIn, trailer.capacityLbs].every((value) => Number.isFinite(value) && value > 0)) errors.push('Trailer dimensions and capacity must be positive numbers.')
  for (const load of loads) {
    if (!Number.isInteger(load.pallets) || load.pallets < 1) errors.push(`${load.id} must have at least one pallet.`)
    if (!Number.isFinite(load.weightLbs) || load.weightLbs <= 0) errors.push(`${load.id} weight must be greater than zero.`)
    if (![load.palletLengthIn, load.palletWidthIn, load.palletHeightIn].every((value) => Number.isFinite(value) && value > 0)) errors.push(`${load.id} pallet dimensions must be positive numbers.`)
    if (!Number.isInteger(load.stop) || load.stop < 1) errors.push(`${load.id} stop must be a positive whole number.`)
  }
  return errors
}

// Deterministic local fallback matching the xflp placement response contract.
// Pallets for later stops are placed toward the nose so earlier stops stay accessible.
export function createPlan(loads: Load[], trailer: Trailer, objective: "space" | "balance" | "unload" | "damage" = "unload"): Plan {
  const errors = validatePlanInput(loads, trailer)
  if (errors.length) throw new Error(errors.join(' '))
  const pallets: PackedItem[] = loads.flatMap((load, li) =>
    Array.from({ length: load.pallets }, (_, i) => ({
      id: `${load.id}-P${String(i + 1).padStart(2, '0')}`, loadId: load.id,
      x: 0, y: 0, z: 0, length: load.palletLengthIn, width: load.palletWidthIn, height: load.palletHeightIn,
      weightLbs: load.weightLbs / load.pallets, stop: load.stop,
      destination: load.destination, color: colors[li % colors.length], estimated: load.estimated ?? true,
    }))
  ).sort((a, b) => objective === "space" ? b.length * b.width * b.height - a.length * a.width * a.height : objective === "balance" ? b.weightLbs - a.weightLbs : objective === "damage" ? Number(Boolean(loads.find((load) => load.id === b.loadId)?.fragile)) - Number(Boolean(loads.find((load) => load.id === a.loadId)?.fragile)) : b.stop - a.stop || b.weightLbs - a.weightLbs)

  const items: PackedItem[] = [], unplanned: PackedItem[] = []
  const supportedWeight = new Map<string, number>()
  let cursorX = 0, cursorY = 0, rowDepth = 0, totalWeight = 0
  for (const item of pallets) {
    const load = loads.find((candidate) => candidate.id === item.loadId)!
    const orientations = [
      { length: item.length, width: item.width, rotated: false },
      ...(load.rotatable && item.length !== item.width
        ? [{ length: item.width, width: item.length, rotated: true }]
        : []),
    ]
    const fitsAtCursor = (orientation: (typeof orientations)[number]) =>
      cursorX + orientation.length <= trailer.lengthIn &&
      cursorY + orientation.width <= trailer.widthIn

    const weightDensityPsf = item.weightLbs / (item.length * item.width) * 144
    if (item.height > trailer.heightIn) { unplanned.push({ ...item, unplannedReason: "Item is taller than the trailer's usable height." }); continue }
    if (totalWeight + item.weightLbs > trailer.capacityLbs) { unplanned.push({ ...item, unplannedReason: "Adding this item would exceed trailer weight capacity." }); continue }
    if (load.floorBearingPsf && weightDensityPsf > load.floorBearingPsf) { unplanned.push({ ...item, unplannedReason: `Floor load ${Math.round(weightDensityPsf)} psf exceeds its ${load.floorBearingPsf} psf limit.` }); continue }

    // Prefer a valid stack before consuming another floor position. A stack must
    // have the same footprint, remain under the ceiling, and respect the base
    // load's declared bearing limit. This is intentionally conservative.
    if (load.stackable) {
      const supports = [...items].sort((a, b) => b.z - a.z)
      const support = supports.find((candidate) => {
        const supportLoad = loads.find((value) => value.id === candidate.loadId)
        if (!supportLoad?.stackable) return false
        const sameFootprint = orientations.some((orientation) =>
          orientation.length === candidate.length && orientation.width === candidate.width)
        if (!sameFootprint || candidate.z + candidate.height + item.height > trailer.heightIn) return false
        const rootKey = `${candidate.x}:${candidate.y}:${candidate.length}:${candidate.width}`
        return (supportedWeight.get(rootKey) ?? 0) + item.weightLbs <= supportLoad.bearingLimitLbs
      })
      if (support) {
        const orientation = orientations.find((value) => value.length === support.length && value.width === support.width)!
        const rootKey = `${support.x}:${support.y}:${support.length}:${support.width}`
        items.push({ ...item, x: support.x, y: support.y, z: support.z + support.height, length: orientation.length, width: orientation.width, rotated: orientation.rotated })
        supportedWeight.set(rootKey, (supportedWeight.get(rootKey) ?? 0) + item.weightLbs)
        totalWeight += item.weightLbs
        continue
      }
    }

    let orientation = orientations.find(fitsAtCursor)
    if (!orientation) {
      cursorX += rowDepth
      cursorY = 0
      rowDepth = 0
      orientation = orientations.find(fitsAtCursor)
    }
    if (!orientation) {
      unplanned.push({ ...item, unplannedReason: "No collision-free floor or supported stack position remains." })
      continue
    }
    const placed = {
      ...item,
      x: cursorX,
      y: cursorY,
      z: 0,
      length: orientation.length,
      width: orientation.width,
      rotated: orientation.rotated,
    }
    items.push(placed)
    supportedWeight.set(`${placed.x}:${placed.y}:${placed.length}:${placed.width}`, 0)
    cursorY += orientation.width
    rowDepth = Math.max(rowDepth, orientation.length)
    totalWeight += item.weightLbs
  }
  const usedFloorArea = items.filter((item) => item.z === 0).reduce((sum, item) => sum + item.length * item.width, 0)
  const warnings = loads.some((load) => load.estimated ?? true)
    ? ['Pallet geometry and individual weights are estimated from shipment totals. Verify before operational use.']
    : []
  if (unplanned.length) warnings.push(`${unplanned.length} pallet${unplanned.length === 1 ? '' : 's'} could not be planned due to space or weight capacity.`)
  if (!trailer.axleModelVerified) warnings.push('Axle geometry is not calibrated for this tractor pairing. Verify axle weights before release.')
  return { items, unplanned, totalWeight, usedFloorArea, warnings, engine: 'browser-fallback' }
}
