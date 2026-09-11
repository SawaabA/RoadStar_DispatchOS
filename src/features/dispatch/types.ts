export type LoadStatus =
  | "unassigned"
  | "assigned"
  | "in_transit"
  | "completed"
  | "cancelled";
export type AssetStatus = "available" | "assigned" | "maintenance" | "inactive";
export type DutyStatus = "off_duty" | "sleeper" | "driving" | "on_duty";
export type EquipmentType = "Dry Van" | "Reefer" | "Flatbed";

export type Coordinates = { lat: number; lng: number };

export type DispatchLoad = {
  id: string;
  billNumber: string;
  customer: string;
  description: string;
  status: LoadStatus;
  equipment: EquipmentType;
  origin: string;
  originPoint: Coordinates;
  destination: string;
  destinationPoint: Coordinates;
  pickupStart: string;
  pickupEnd: string;
  deliveryEnd: string;
  weightLbs: number;
  pallets: number;
  temperatureControlled: boolean;
  rate: number;
  priority: "standard" | "high" | "critical";
};

export type Driver = {
  id: string;
  name: string;
  initials: string;
  status: AssetStatus;
  dutyStatus: DutyStatus;
  location: string;
  point: Coordinates;
  drivingHoursRemaining: number;
  onDutyHoursRemaining: number;
  cycleHoursRemaining: number;
  truckId: string;
  trailerId: string;
  nextAvailable: string;
};

export type TruckAsset = {
  id: string;
  number: string;
  status: AssetStatus;
  point: Coordinates;
  odometerKm: number;
};

export type TrailerAsset = {
  id: string;
  number: string;
  type: EquipmentType;
  status: AssetStatus;
  capacityLbs: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
};

export type Assignment = {
  id: string;
  loadId: string;
  driverId: string;
  truckId: string;
  trailerId: string;
  status: "proposed" | "dispatched" | "accepted" | "in_transit" | "completed";
  assignedAt: string;
  acceptedAt?: string;
  progress: number;
  currentPoint: Coordinates;
  breadcrumbs: Coordinates[];
  speedKph: number;
  distanceKm: number;
  eta: string;
};

export type Facility = {
  id: string;
  name: string;
  city: string;
  point: Coordinates;
  radiusKm: number;
  freeMinutes: number;
  detentionRate: number;
};

export type GeofenceVisit = {
  id: string;
  truckId: string;
  facilityId: string;
  arrivedAt: string;
  departedAt?: string;
  dwellMinutes: number;
};

export type FeasibilityReason = {
  code: "equipment" | "weight" | "hos" | "pickup" | "status";
  label: string;
};

export type DispatchCandidate = {
  loadId: string;
  driverId: string;
  truckId: string;
  trailerId: string;
  feasible: boolean;
  reasons: FeasibilityReason[];
  deadheadKm: number;
  tripKm: number;
  pickupEtaMinutes: number;
  projectedHours: number;
  hosRemainingAfter: number;
  score: number;
  explanation: string;
};

export type PlanProposal = {
  id: string;
  generatedAt: string;
  candidates: DispatchCandidate[];
  rejectedLoads: Array<{ loadId: string; reasons: string[] }>;
  projectedDeadheadKm: number;
};

export type ExceptionKind = "equipment" | "detention" | "hos" | "pickup";
export type ExceptionSeverity = "critical" | "warning" | "info";

export type DispatchException = {
  id: string;
  kind: ExceptionKind;
  severity: ExceptionSeverity;
  title: string;
  detail: string;
  // The screen that owns the action resolving this exception.
  view: "dispatch" | "loads" | "fleet" | "detention";
  loadId?: string;
  driverId?: string;
  assignmentId?: string;
  facilityId?: string;
};

export type DispatchState = {
  loads: DispatchLoad[];
  drivers: Driver[];
  trucks: TruckAsset[];
  trailers: TrailerAsset[];
  assignments: Assignment[];
  facilities: Facility[];
  visits: GeofenceVisit[];
};
