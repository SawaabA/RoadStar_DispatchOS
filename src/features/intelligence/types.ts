import type { Coordinates } from "../dispatch/types";

export type RoadIncident = {
  id: string;
  source: "ontario-511" | "demo";
  roadway: string;
  direction: string;
  description: string;
  eventType: string;
  severity: "low" | "medium" | "high" | "critical";
  point: Coordinates;
  reportedAt: string;
  updatedAt: string;
  fullClosure: boolean;
};

export type OperationalException = {
  id: string;
  type: "equipment" | "hos" | "pickup" | "detention" | "traffic" | "data";
  severity: "warning" | "critical";
  title: string;
  detail: string;
  entityId: string;
  recommendedAction: string;
  actionView: "dispatch" | "fleet" | "map" | "detention" | "loads";
};

export type ReplanImpact = {
  id: string;
  assignmentId: string;
  loadId: string;
  incidentId: string;
  addedDelayMinutes: number;
  originalEta: string;
  projectedEta: string;
  deliverySlackMinutes: number;
  hosMarginHours: number;
  risk: "monitor" | "late" | "hos";
  recommendation: string;
};

export type BackhaulSuggestion = {
  id: string;
  assignmentId: string;
  loadId: string;
  driverId: string;
  repositionKm: number;
  baselineEmptyKm: number;
  avoidedEmptyKm: number;
  projectedHosMargin: number;
  score: number;
  explanation: string;
};

export type ProviderStatus = {
  id: string;
  category: "TMS" | "ELD / Telematics" | "Routing" | "Traffic" | "Loading" | "AI" | "Database";
  provider: string;
  mode: "live" | "demo" | "fallback" | "ready";
  status: "connected" | "degraded" | "available";
  capabilities: string[];
  swapTarget: string;
};
