export type TelemetryEvent = {
  truckId: string;
  point: { lat: number; lng: number };
  progress: number;
  speedKph: number;
  distanceKm: number;
  recordedAt: string;
};

export function validateTelemetryEvent(value: unknown, options: { knownTruckIds: Set<string>; previousRecordedAt?: number; now?: number }): { event?: TelemetryEvent; recordedAt?: number; reason?: string } {
  if (!value || typeof value !== "object") return { reason: "invalid payload" };
  const event = value as TelemetryEvent;
  if (typeof event.truckId !== "string" || !options.knownTruckIds.has(event.truckId)) return { reason: "unknown truck" };
  if (![event.point?.lat, event.point?.lng, event.progress, event.speedKph, event.distanceKm].every(Number.isFinite)) return { reason: "missing numeric field" };
  if (event.point.lat < -90 || event.point.lat > 90 || event.point.lng < -180 || event.point.lng > 180) return { reason: "invalid coordinates" };
  if (event.progress < 0 || event.progress > 1 || event.speedKph < 0 || event.speedKph > 180 || event.distanceKm < 0) return { reason: "value outside accepted range" };
  const recordedAt = Date.parse(event.recordedAt);
  const now = options.now ?? Date.now();
  if (!Number.isFinite(recordedAt)) return { reason: "invalid timestamp" };
  if (recordedAt <= (options.previousRecordedAt ?? 0)) return { reason: "duplicate or out-of-order event" };
  if (recordedAt < now - 5 * 60_000 || recordedAt > now + 30_000) return { reason: "stale or future event" };
  return { event, recordedAt };
}
