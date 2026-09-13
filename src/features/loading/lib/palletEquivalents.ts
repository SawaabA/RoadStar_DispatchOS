import type { Trailer } from "../types";

export type CargoEstimateInput = {
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  weightLbs: number;
  quantity: number;
  clearanceIn: number;
  rotatable: boolean;
};

const STANDARD = { length: 48, width: 40, height: 48 };

export function estimatePalletDisplacement(input: CargoEstimateInput, trailer: Trailer) {
  const dimensions = [input.lengthIn, input.widthIn, input.heightIn, input.weightLbs, input.quantity, input.clearanceIn];
  if (!dimensions.every(Number.isFinite) || dimensions.slice(0, 5).some((value) => value <= 0) || input.clearanceIn < 0 || !Number.isInteger(input.quantity)) {
    throw new Error("Enter positive dimensions, weight and a whole-number quantity; clearance may be zero.");
  }
  const length = input.lengthIn + input.clearanceIn * 2;
  const width = input.widthIn + input.clearanceIn * 2;
  const height = input.heightIn + input.clearanceIn;
  const orientations = [{ length, width }, ...(input.rotatable ? [{ length: width, width: length }] : [])]
    .filter((item) => item.width <= trailer.widthIn && item.length <= trailer.lengthIn);
  if (!orientations.length || height > trailer.heightIn) {
    return { palletEquivalents: 0, fitsEnvelope: false, floorEquivalent: 0, volumeEquivalent: 0, weightEquivalent: 0, protectedDimensions: { length, width, height } };
  }
  const floorEquivalent = Math.min(...orientations.map((item) =>
    Math.ceil(item.length / STANDARD.length) * Math.ceil(item.width / STANDARD.width),
  )) * input.quantity;
  const volumeEquivalent = Math.ceil((length * width * height * input.quantity) / (STANDARD.length * STANDARD.width * STANDARD.height));
  const standardFloorSlots = Math.max(1, Math.floor(trailer.lengthIn / STANDARD.length) * Math.floor(trailer.widthIn / STANDARD.width));
  const nominalPalletWeight = trailer.capacityLbs / standardFloorSlots;
  const weightEquivalent = Math.ceil((input.weightLbs * input.quantity) / nominalPalletWeight);
  return {
    palletEquivalents: Math.max(1, floorEquivalent, volumeEquivalent, weightEquivalent),
    fitsEnvelope: true,
    floorEquivalent,
    volumeEquivalent,
    weightEquivalent,
    protectedDimensions: { length, width, height },
  };
}
