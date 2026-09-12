import type { DispatchState } from "../types";

export function isDispatchState(value: unknown): value is DispatchState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DispatchState>;
  if (
    !Array.isArray(candidate.loads) ||
    !Array.isArray(candidate.drivers) ||
    !Array.isArray(candidate.trucks) ||
    !Array.isArray(candidate.trailers) ||
    !Array.isArray(candidate.assignments) ||
    !Array.isArray(candidate.facilities) ||
    !Array.isArray(candidate.visits)
  )
    return false;

  const loadIds = new Set(candidate.loads.map((item) => item?.id));
  const driverIds = new Set(candidate.drivers.map((item) => item?.id));
  const truckIds = new Set(candidate.trucks.map((item) => item?.id));
  const trailerIds = new Set(candidate.trailers.map((item) => item?.id));
  const facilityIds = new Set(candidate.facilities.map((item) => item?.id));
  const weights = candidate.optimizationWeights;
  const validWeights = !weights || [weights.deadhead, weights.onTime, weights.hosBuffer, weights.futurePosition]
    .every((item) => Number.isFinite(item) && item >= 0 && item <= 100);
  const validAcknowledgements = !candidate.acknowledgedExceptionIds || (
    Array.isArray(candidate.acknowledgedExceptionIds) && candidate.acknowledgedExceptionIds.every((item) => typeof item === "string")
  );
  const validDecisions = !candidate.decisionLog || (
    Array.isArray(candidate.decisionLog) && candidate.decisionLog.every((item) =>
      item && typeof item.id === "string" && typeof item.summary === "string" &&
      ["plan", "replan", "exception", "backhaul", "driver"].includes(item.kind) &&
      ["accepted", "rejected", "acknowledged", "started", "declined"].includes(item.outcome) &&
      Number.isFinite(Date.parse(item.createdAt)),
    )
  );

  return (
    validWeights && validAcknowledgements && validDecisions &&
    candidate.loads.every((item) => item && typeof item.id === "string") &&
    candidate.drivers.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        truckIds.has(item.truckId) &&
        trailerIds.has(item.trailerId),
    ) &&
    candidate.assignments.every(
      (item) =>
        item &&
        loadIds.has(item.loadId) &&
        driverIds.has(item.driverId) &&
        truckIds.has(item.truckId) &&
        trailerIds.has(item.trailerId),
    ) &&
    candidate.visits.every(
      (item) =>
        item && truckIds.has(item.truckId) && facilityIds.has(item.facilityId),
    )
  );
}
