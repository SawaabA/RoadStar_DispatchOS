export type Load = { id: string; origin: string; destination: string; weightLbs: number; pallets: number; stop: number; description: string }
export type Trailer = { id: string; lengthIn: number; widthIn: number; heightIn: number; capacityLbs: number }
export type PackedItem = { id: string; loadId: string; x: number; y: number; z: number; length: number; width: number; height: number; weightLbs: number; stop: number; destination: string; color: string; estimated: boolean }
export type Plan = { items: PackedItem[]; unplanned: PackedItem[]; totalWeight: number; usedFloorArea: number; warnings: string[] }
