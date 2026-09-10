import type { Load, PackedItem, Plan, Trailer } from '../types'

const colors = ['#4ee6a8', '#58a6ff', '#f8c35c', '#e77cff', '#ff735c']

// Deterministic local fallback matching the xflp placement response contract.
// Pallets for later stops are placed toward the nose so earlier stops stay accessible.
export function createPlan(loads: Load[], trailer: Trailer): Plan {
  const pallets: PackedItem[] = loads.flatMap((load, li) =>
    Array.from({ length: load.pallets }, (_, i) => ({
      id: `${load.id}-P${String(i + 1).padStart(2, '0')}`, loadId: load.id,
      x: 0, y: 0, z: 0, length: 48, width: 40, height: 48,
      weightLbs: Math.round(load.weightLbs / load.pallets), stop: load.stop,
      destination: load.destination, color: colors[li % colors.length], estimated: true,
    }))
  ).sort((a, b) => b.stop - a.stop || b.weightLbs - a.weightLbs)

  const items: PackedItem[] = [], unplanned: PackedItem[] = []
  let cursorX = 0, cursorY = 0, rowDepth = 0
  for (const item of pallets) {
    if (cursorY + item.width > trailer.widthIn) { cursorY = 0; cursorX += rowDepth; rowDepth = 0 }
    if (cursorX + item.length > trailer.lengthIn || items.reduce((s, p) => s + p.weightLbs, 0) + item.weightLbs > trailer.capacityLbs) {
      unplanned.push(item); continue
    }
    items.push({ ...item, x: cursorX, y: cursorY, z: 0 })
    cursorY += item.width; rowDepth = Math.max(rowDepth, item.length)
  }
  const totalWeight = items.reduce((s, p) => s + p.weightLbs, 0)
  const usedFloorArea = items.reduce((s, p) => s + p.length * p.width, 0)
  const warnings = ['Pallet geometry and individual weights are estimated from shipment totals. Verify before operational use.']
  if (unplanned.length) warnings.push(`${unplanned.length} pallet${unplanned.length === 1 ? '' : 's'} could not be planned due to space or weight capacity.`)
  return { items, unplanned, totalWeight, usedFloorArea, warnings, engine: 'browser-fallback' }
}
