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
export function createPlan(loads: Load[], trailer: Trailer): Plan {
  const errors = validatePlanInput(loads, trailer)
  if (errors.length) throw new Error(errors.join(' '))
  const pallets: PackedItem[] = loads.flatMap((load, li) =>
    Array.from({ length: load.pallets }, (_, i) => ({
      id: `${load.id}-P${String(i + 1).padStart(2, '0')}`, loadId: load.id,
      x: 0, y: 0, z: 0, length: load.palletLengthIn, width: load.palletWidthIn, height: load.palletHeightIn,
      weightLbs: load.weightLbs / load.pallets, stop: load.stop,
      destination: load.destination, color: colors[li % colors.length], estimated: true,
    }))
  ).sort((a, b) => b.stop - a.stop || b.weightLbs - a.weightLbs)

  const items: PackedItem[] = [], unplanned: PackedItem[] = []
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

    if (item.height > trailer.heightIn || totalWeight + item.weightLbs > trailer.capacityLbs) {
      unplanned.push(item); continue
    }
    let orientation = orientations.find(fitsAtCursor)
    if (!orientation) {
      cursorX += rowDepth
      cursorY = 0
      rowDepth = 0
      orientation = orientations.find(fitsAtCursor)
    }
    if (!orientation) {
      unplanned.push(item)
      continue
    }
    items.push({
      ...item,
      x: cursorX,
      y: cursorY,
      z: 0,
      length: orientation.length,
      width: orientation.width,
      rotated: orientation.rotated,
    })
    cursorY += orientation.width
    rowDepth = Math.max(rowDepth, orientation.length)
    totalWeight += item.weightLbs
  }
  const usedFloorArea = items.reduce((s, p) => s + p.length * p.width, 0)
  const warnings = ['Pallet geometry and individual weights are estimated from shipment totals. Verify before operational use.']
  if (unplanned.length) warnings.push(`${unplanned.length} pallet${unplanned.length === 1 ? '' : 's'} could not be planned due to space or weight capacity.`)
  return { items, unplanned, totalWeight, usedFloorArea, warnings, engine: 'browser-fallback' }
}
