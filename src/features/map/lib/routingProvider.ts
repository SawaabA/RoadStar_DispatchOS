import type { Coordinates } from "../../dispatch/types";

export type RoadRoute = {
  source: string;
  distanceKm: number;
  durationMinutes: number;
  coordinates: Array<[number, number]>;
};

export async function fetchRoadRoute(
  origin: Coordinates,
  destination: Coordinates,
  signal?: AbortSignal,
): Promise<RoadRoute | null> {
  const query = new URLSearchParams({
    origin: `${origin.lng},${origin.lat}`,
    destination: `${destination.lng},${destination.lat}`,
  });
  try {
    const response = await fetch(`/api/routing/route?${query}`, {
      signal: signal ?? AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const value = await response.json() as Partial<RoadRoute>;
    if (
      typeof value.source !== "string" ||
      !Number.isFinite(value.distanceKm) ||
      !Number.isFinite(value.durationMinutes) ||
      !Array.isArray(value.coordinates) ||
      value.coordinates.length < 2 ||
      !value.coordinates.every((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))
    ) return null;
    return value as RoadRoute;
  } catch {
    return null;
  }
}
