const equipmentValues = new Set(["dry-van", "reefer", "flatbed"]);

export function normalizeTmsLoad(input) {
  if (!input || typeof input !== "object") throw new Error("TMS load must be an object");
  const value = {
    externalId: String(input.externalId || "").trim(),
    customer: String(input.customer || "").trim(),
    origin: String(input.origin || "").trim(),
    destination: String(input.destination || "").trim(),
    pickupAt: new Date(input.pickupAt).toISOString(),
    deliveryAt: new Date(input.deliveryAt).toISOString(),
    equipment: String(input.equipment || "").toLowerCase(),
    pieces: Number(input.pieces),
    weightLbs: Number(input.weightLbs),
    rateCad: Number(input.rateCad),
    status: String(input.status || "tendered"),
    externalUpdatedAt: input.externalUpdatedAt ? new Date(input.externalUpdatedAt).toISOString() : undefined,
  };
  if (!value.externalId || !value.customer || !value.origin || !value.destination) throw new Error("TMS load is missing identity, customer, or route fields");
  if (value.origin === value.destination || Date.parse(value.deliveryAt) < Date.parse(value.pickupAt)) throw new Error("TMS load has an invalid route or appointment order");
  if (!equipmentValues.has(value.equipment) || !Number.isInteger(value.pieces) || value.pieces < 1 || !(value.weightLbs > 0) || !(value.rateCad >= 0)) throw new Error("TMS load has invalid equipment, pieces, weight, or rate");
  return value;
}

export function resolveSyncDecision({ localUpdatedAt, externalUpdatedAt, authoritative = "roadstar" }) {
  const local = Date.parse(localUpdatedAt || "");
  const external = Date.parse(externalUpdatedAt || "");
  if (!Number.isFinite(external)) return { action: "reject", reason: "missing external update timestamp" };
  if (!Number.isFinite(local) || external > local) return { action: "apply-inbound", reason: "external record is newer" };
  if (external < local) return authoritative === "tms" ? { action: "apply-inbound", reason: "TMS is authoritative" } : { action: "queue-outbound", reason: "RoadStar is authoritative" };
  return { action: "ignore", reason: "record versions are equal" };
}

export function retryDelayMs(attempt) {
  const safeAttempt = Math.max(0, Math.min(8, Number(attempt) || 0));
  return Math.min(300_000, 1000 * 2 ** safeAttempt);
}
