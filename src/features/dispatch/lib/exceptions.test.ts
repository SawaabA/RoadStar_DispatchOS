import { describe, expect, it } from "vitest";
import { detectExceptions, exceptionSummary } from "./exceptions";
import type { DispatchState } from "../types";

const NOW = Date.UTC(2026, 8, 11, 13, 0, 0);
const offset = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

const MILTON = { lat: 43.5183, lng: -79.8774 };
const LONDON = { lat: 42.9849, lng: -81.2453 };
const MISSISSAUGA = { lat: 43.589, lng: -79.6441 };

// A state with no exceptions in it; each test perturbs exactly one thing.
const baseState = (): DispatchState => ({
  loads: [
    {
      id: "L-1",
      billNumber: "RS-1",
      customer: "Maple Auto",
      description: "Automotive components",
      status: "unassigned",
      equipment: "Dry Van",
      origin: "Milton, ON",
      originPoint: MILTON,
      destination: "London, ON",
      destinationPoint: LONDON,
      pickupStart: offset(60),
      pickupEnd: offset(180),
      deliveryEnd: offset(480),
      weightLbs: 31_200,
      pallets: 18,
      temperatureControlled: false,
      rate: 3850,
      priority: "standard",
    },
  ],
  drivers: [
    {
      id: "D-1",
      name: "Marcus Chen",
      initials: "MC",
      status: "available",
      dutyStatus: "on_duty",
      location: "Mississauga, ON",
      point: MISSISSAUGA,
      drivingHoursRemaining: 8,
      onDutyHoursRemaining: 9,
      cycleHoursRemaining: 30,
      truckId: "T-1",
      trailerId: "DV-1",
      nextAvailable: "Now",
    },
  ],
  trucks: [
    { id: "T-1", number: "84", status: "available", point: MISSISSAUGA, odometerKm: 100 },
  ],
  trailers: [
    {
      id: "DV-1",
      number: "DV1",
      type: "Dry Van",
      status: "available",
      capacityLbs: 44_500,
      lengthIn: 636,
      widthIn: 98,
      heightIn: 102,
    },
  ],
  assignments: [],
  incidents: [],
  facilities: [
    {
      id: "F-1",
      name: "London Terminal",
      city: "London, ON",
      point: LONDON,
      radiusKm: 1,
      freeMinutes: 120,
      detentionRate: 95,
    },
  ],
  visits: [],
});

const kinds = (state: DispatchState) =>
  detectExceptions(state, NOW).map((item) => item.kind);

describe("detectExceptions", () => {
  it("reports nothing when the board is healthy", () => {
    expect(detectExceptions(baseState(), NOW)).toEqual([]);
  });

  it("does not mutate the state it is given", () => {
    const state = baseState();
    const snapshot = JSON.stringify(state);
    detectExceptions(state, NOW);

    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it("flags a load with no compatible trailer in the asset master", () => {
    const state = baseState();
    state.loads[0]!.equipment = "Flatbed";
    const [exception] = detectExceptions(state, NOW);

    expect(exception?.kind).toBe("equipment");
    expect(exception?.severity).toBe("critical");
    expect(exception?.detail).toMatch(/Flatbed/);
    expect(exception?.view).toBe("dispatch");
    expect(exception?.loadId).toBe("L-1");
  });

  it("does not raise an equipment exception while a feasible unit exists", () => {
    expect(kinds(baseState())).not.toContain("equipment");
  });

  it("flags a pickup window no available unit can reach", () => {
    const state = baseState();
    state.loads[0]!.pickupStart = offset(-180);
    state.loads[0]!.pickupEnd = offset(-60);

    expect(kinds(state)).toContain("pickup");
  });

  it("flags an in-flight trip that will outlast the driver's HOS", () => {
    const state = baseState();
    state.drivers[0]!.drivingHoursRemaining = 1;
    state.loads[0]!.status = "assigned";
    state.assignments = [
      {
        id: "A-1",
        loadId: "L-1",
        driverId: "D-1",
        truckId: "T-1",
        trailerId: "DV-1",
        status: "in_transit",
        assignedAt: offset(-60),
        progress: 0.4,
        currentPoint: MILTON,
        breadcrumbs: [MILTON],
        speedKph: 80,
        distanceKm: 40,
        eta: offset(240), // four hours out against one hour of driving left
      },
    ];
    const hos = detectExceptions(state, NOW).find((item) => item.kind === "hos");

    expect(hos?.severity).toBe("critical");
    expect(hos?.assignmentId).toBe("A-1");
    expect(hos?.view).toBe("fleet");
  });

  it("does not flag an in-flight trip the driver can legally finish", () => {
    const state = baseState();
    state.loads[0]!.status = "assigned";
    state.assignments = [
      {
        id: "A-1",
        loadId: "L-1",
        driverId: "D-1",
        truckId: "T-1",
        trailerId: "DV-1",
        status: "in_transit",
        assignedAt: offset(-60),
        progress: 0.4,
        currentPoint: MILTON,
        breadcrumbs: [MILTON],
        speedKph: 80,
        distanceKm: 40,
        eta: offset(120), // two hours out against eight hours of driving left
      },
    ];

    expect(kinds(state)).not.toContain("hos");
  });

  it("warns when an available driver's margin is thin", () => {
    const state = baseState();
    state.drivers[0]!.drivingHoursRemaining = 2;
    const hos = detectExceptions(state, NOW).find((item) => item.kind === "hos");

    expect(hos?.severity).toBe("warning");
    expect(hos?.driverId).toBe("D-1");
  });

  it("raises billable detention once the free allowance is spent", () => {
    const state = baseState();
    state.visits = [
      {
        id: "V-1",
        truckId: "T-1",
        facilityId: "F-1",
        arrivedAt: offset(-138),
        dwellMinutes: 138,
      },
    ];
    const detention = detectExceptions(state, NOW).find((i) => i.kind === "detention");

    expect(detention?.severity).toBe("critical");
    expect(detention?.detail).toMatch(/18 billable min/);
    // 18 minutes at $95/h rounds to $29.
    expect(detention?.detail).toMatch(/\$29/);
    expect(detention?.view).toBe("detention");
  });

  it("warns before the free allowance is spent, without billing", () => {
    const state = baseState();
    state.visits = [
      { id: "V-1", truckId: "T-1", facilityId: "F-1", arrivedAt: offset(-100), dwellMinutes: 100 },
    ];
    const detention = detectExceptions(state, NOW).find((i) => i.kind === "detention");

    expect(detention?.severity).toBe("warning");
    expect(detention?.detail).toMatch(/20 min/);
  });

  it("ignores a visit the truck has already departed", () => {
    const state = baseState();
    state.visits = [
      {
        id: "V-1",
        truckId: "T-1",
        facilityId: "F-1",
        arrivedAt: offset(-200),
        departedAt: offset(-10),
        dwellMinutes: 190,
      },
    ];

    expect(kinds(state)).not.toContain("detention");
  });

  it("uses the truck's own number rather than its identifier", () => {
    const state = baseState();
    state.visits = [
      { id: "V-1", truckId: "T-1", facilityId: "F-1", arrivedAt: offset(-138), dwellMinutes: 138 },
    ];

    expect(detectExceptions(state, NOW)[0]?.detail).toMatch(/Truck 84/);
  });

  it("orders critical exceptions ahead of warnings", () => {
    const state = baseState();
    state.drivers[0]!.drivingHoursRemaining = 2; // warning
    state.loads[0]!.equipment = "Flatbed"; // critical
    const severities = detectExceptions(state, NOW).map((item) => item.severity);

    expect(severities).toEqual([...severities].sort((a, b) => (a === "critical" ? -1 : 1)));
    expect(severities[0]).toBe("critical");
  });

  it("keeps identifiers stable and unique across recomputations", () => {
    const state = baseState();
    state.loads[0]!.equipment = "Flatbed";
    state.visits = [
      { id: "V-1", truckId: "T-1", facilityId: "F-1", arrivedAt: offset(-138), dwellMinutes: 138 },
    ];
    const first = detectExceptions(state, NOW).map((item) => item.id);
    const second = detectExceptions(state, NOW + 1000).map((item) => item.id);

    expect(new Set(first).size).toBe(first.length);
    expect(second).toEqual(first);
  });

  it("only inspects unassigned loads", () => {
    const state = baseState();
    state.loads[0]!.equipment = "Flatbed";
    state.loads[0]!.status = "completed";

    expect(kinds(state)).not.toContain("equipment");
  });

  it("surfaces a road incident from the telemetry provider", () => {
    const state = baseState();
    state.incidents = [
      {
        id: "E-1",
        kind: "closure",
        label: "Highway 401 lane closure",
        detail: "Incident ahead has closed a lane.",
        severity: "critical",
        truckId: "T-1",
        startedAt: offset(-5),
      },
    ];
    const route = detectExceptions(state, NOW).find((i) => i.kind === "route");

    expect(route?.severity).toBe("critical");
    expect(route?.view).toBe("map");
    expect(route?.detail).toMatch(/Truck 84/);
    expect(route?.id).toBe("route:E-1");
  });

  it("tolerates a snapshot written before incidents existed", () => {
    const state = baseState();
    delete state.incidents;

    expect(() => detectExceptions(state, NOW)).not.toThrow();
    expect(kinds(state)).not.toContain("route");
  });

  it("summarises totals for the command centre badge", () => {
    const state = baseState();
    state.loads[0]!.equipment = "Flatbed";
    state.drivers[0]!.drivingHoursRemaining = 2;

    expect(exceptionSummary(detectExceptions(state, NOW))).toEqual({
      total: 2,
      critical: 1,
    });
  });
});
