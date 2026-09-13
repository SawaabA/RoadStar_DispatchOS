export type LoadStatus =
  | "unassigned"
  | "assigned"
  | "in_transit"
  | "completed"
  | "cancelled"
  | "archived";
export type AssetStatus = "available" | "assigned" | "maintenance" | "inactive";
export type DutyStatus = "off_duty" | "sleeper" | "driving" | "on_duty";
export type EquipmentType = "Dry Van" | "Reefer" | "Flatbed";

export type Coordinates = { lat: number; lng: number };

export type OptimizationWeights = {
  deadhead: number;
  onTime: number;
  hosBuffer: number;
  futurePosition: number;
};

export type DecisionRecord = {
  id: string;
  kind: "plan" | "replan" | "exception" | "backhaul" | "driver" | "load";
  summary: string;
  outcome: "accepted" | "rejected" | "acknowledged" | "started" | "declined";
  createdAt: string;
};

export type DispatchCargoItem = {
  id: string;
  label: string;
  quantity: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  unitWeightLbs: number;
  rotatable: boolean;
  stackable: boolean;
  maxStackWeightLbs?: number;
  floorBearingPsf?: number;
  clearanceIn?: number;
  fragile?: boolean;
  priority?: boolean;
  stop?: number;
};

export type DispatchStop = {
  id: string;
  location: string;
  point: Coordinates;
  appointmentStart: string;
  appointmentEnd: string;
};

export type OrganizationRole = "admin" | "dispatcher" | "driver" | "viewer";
export type DriverAssignmentAction = "accepted" | "in_transit" | "declined";

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
  currency?: "CAD" | "USD";
  priority: "standard" | "high" | "critical";
  additionalStops?: DispatchStop[];
  cargoItems?: DispatchCargoItem[];
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
  scoreBreakdown: {
    deadhead: number;
    onTime: number;
    hosBuffer: number;
    futurePosition: number;
  };
  explanation: string;
};

export type PlanProposal = {
  id: string;
  generatedAt: string;
  candidates: DispatchCandidate[];
  rejectedLoads: Array<{ loadId: string; reasons: string[] }>;
  projectedDeadheadKm: number;
};

export type RoadIncident = {
  id: string;
  kind: "traffic" | "closure" | "dock_wait" | "duty_change";
  label: string;
  detail: string;
  severity: "critical" | "warning" | "info";
  truckId: string;
  startedAt: string;
};

export type ExceptionKind =
  | "equipment"
  | "detention"
  | "hos"
  | "pickup"
  | "route";
export type ExceptionSeverity = "critical" | "warning" | "info";

export type DispatchException = {
  id: string;
  kind: ExceptionKind;
  severity: ExceptionSeverity;
  title: string;
  detail: string;
  // The screen that owns the action resolving this exception.
  view: "dispatch" | "loads" | "fleet" | "detention" | "map";
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
  // Absent in snapshots written before road incidents existed; read as [].
  incidents?: RoadIncident[];
  acknowledgedExceptionIds?: string[];
  decisionLog?: DecisionRecord[];
  optimizationWeights?: OptimizationWeights;
};
