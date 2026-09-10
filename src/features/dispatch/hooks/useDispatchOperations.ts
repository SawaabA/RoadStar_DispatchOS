import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import distance from "@turf/distance";
import { point } from "@turf/helpers";
import { createDemoState } from "../data/demoData";
import { buildMorningPlan, evaluateCandidate } from "../lib/optimizer";
import type {
  Assignment,
  DispatchCandidate,
  DispatchState,
  PlanProposal,
} from "../types";
import { supabase } from "../../../shared/lib/supabase";

const STORAGE_KEY = "roadstar-dispatch-state-v2";

const loadInitialState = (): DispatchState => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as DispatchState) : createDemoState();
  } catch {
    return createDemoState();
  }
};

export function useDispatchOperations() {
  const [state, setState] = useState<DispatchState>(loadInitialState);
  const [proposal, setProposal] = useState<PlanProposal | null>(null);
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<
    "local" | "connecting" | "synced" | "error"
  >("local");
  const stateRef = useRef(state);
  const organizationId = useRef<number | null>(null);
  const syncReady = useRef(false);
  const externalSimulator = useRef(false);
  stateRef.current = state;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth
      .getSession()
      .then(({ data }) => setUserEmail(data.session?.user.email || null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) =>
      setUserEmail(session?.user.email || null),
    );
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !userEmail) {
      organizationId.current = null;
      syncReady.current = false;
      setSyncStatus("local");
      return;
    }
    const client = supabase;
    let active = true;
    setSyncStatus("connecting");
    const connect = async () => {
      const { data: membership, error: membershipError } = await client
        .from("organization_members")
        .select("organization_id")
        .limit(1)
        .maybeSingle();
      if (!active) return;
      if (membershipError || !membership) {
        setSyncStatus("error");
        return;
      }
      const orgId = Number(membership.organization_id);
      organizationId.current = orgId;
      const { data: snapshot, error } = await client
        .from("dispatch_snapshots")
        .select("state")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (!active) return;
      if (error) {
        setSyncStatus("error");
        return;
      }
      if (snapshot?.state) setState(snapshot.state as DispatchState);
      else
        await client
          .from("dispatch_snapshots")
          .insert({ organization_id: orgId, state: stateRef.current });
      syncReady.current = true;
      setSyncStatus("synced");
    };
    void connect();
    const channel = client
      .channel("roadstar-dispatch-state")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dispatch_snapshots" },
        (payload) => {
          const next = (payload.new as { state?: DispatchState }).state;
          if (next && active) setState(next);
        },
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
          setSyncStatus("error");
      });
    return () => {
      active = false;
      syncReady.current = false;
      void client.removeChannel(channel);
    };
  }, [userEmail]);

  useEffect(() => {
    if (!supabase || !syncReady.current || !organizationId.current) return;
    const client = supabase;
    const timer = window.setTimeout(async () => {
      const { data } = await client.auth.getUser();
      const { error } = await client.from("dispatch_snapshots").upsert({
        organization_id: organizationId.current,
        state,
        updated_by: data.user?.id,
        updated_at: new Date().toISOString(),
      });
      setSyncStatus(error ? "error" : "synced");
    }, 600);
    return () => window.clearTimeout(timer);
  }, [state]);

  const candidateFor = useCallback(
    (loadId: string, driverId: string): DispatchCandidate | null => {
      const load = state.loads.find((item) => item.id === loadId),
        driver = state.drivers.find((item) => item.id === driverId);
      const trailer = state.trailers.find(
        (item) => item.id === driver?.trailerId,
      );
      return load && driver && trailer
        ? evaluateCandidate(load, driver, trailer)
        : null;
    },
    [state],
  );

  const assign = useCallback(
    (
      candidate: DispatchCandidate,
      status: Assignment["status"] = "dispatched",
    ) => {
      if (!candidate.feasible) return false;
      setState((current) => {
        const load = current.loads.find(
          (item) => item.id === candidate.loadId,
        )!;
        const driver = current.drivers.find(
          (item) => item.id === candidate.driverId,
        )!;
        const assignment: Assignment = {
          id: `A-${load.billNumber.replace("RS-", "")}`,
          loadId: load.id,
          driverId: driver.id,
          truckId: candidate.truckId,
          trailerId: candidate.trailerId,
          status,
          assignedAt: new Date().toISOString(),
          progress: 0,
          currentPoint: driver.point,
          breadcrumbs: [driver.point],
          speedKph: 0,
          distanceKm: 0,
          eta: new Date(
            Date.now() + candidate.projectedHours * 3600000,
          ).toISOString(),
        };
        return {
          ...current,
          loads: current.loads.map((item) =>
            item.id === load.id ? { ...item, status: "assigned" } : item,
          ),
          drivers: current.drivers.map((item) =>
            item.id === driver.id ? { ...item, status: "assigned" } : item,
          ),
          trucks: current.trucks.map((item) =>
            item.id === candidate.truckId
              ? { ...item, status: "assigned" }
              : item,
          ),
          trailers: current.trailers.map((item) =>
            item.id === candidate.trailerId
              ? { ...item, status: "assigned" }
              : item,
          ),
          assignments: [
            ...current.assignments.filter((item) => item.loadId !== load.id),
            assignment,
          ],
        };
      });
      return true;
    },
    [],
  );

  const unassign = useCallback(
    (loadId: string) =>
      setState((current) => {
        const assignment = current.assignments.find(
          (item) => item.loadId === loadId,
        );
        if (!assignment) return current;
        return {
          ...current,
          loads: current.loads.map((item) =>
            item.id === loadId ? { ...item, status: "unassigned" } : item,
          ),
          drivers: current.drivers.map((item) =>
            item.id === assignment.driverId
              ? { ...item, status: "available" }
              : item,
          ),
          trucks: current.trucks.map((item) =>
            item.id === assignment.truckId
              ? { ...item, status: "available" }
              : item,
          ),
          trailers: current.trailers.map((item) =>
            item.id === assignment.trailerId
              ? { ...item, status: "available" }
              : item,
          ),
          assignments: current.assignments.filter(
            (item) => item.id !== assignment.id,
          ),
        };
      }),
    [],
  );

  const generatePlan = useCallback(
    () =>
      setProposal(buildMorningPlan(state.loads, state.drivers, state.trailers)),
    [state],
  );
  const applyPlan = useCallback(() => {
    if (!proposal) return;
    proposal.candidates.forEach((item) => assign(item, "proposed"));
    setProposal(null);
  }, [proposal, assign]);

  const updateAssignmentStatus = useCallback(
    (assignmentId: string, status: Assignment["status"]) =>
      setState((current) => ({
        ...current,
        assignments: current.assignments.map((item) =>
          item.id === assignmentId
            ? {
                ...item,
                status,
                acceptedAt:
                  status === "accepted"
                    ? new Date().toISOString()
                    : item.acceptedAt,
              }
            : item,
        ),
        loads: current.loads.map((load) => {
          const assignment = current.assignments.find(
            (item) => item.id === assignmentId,
          );
          if (!assignment || load.id !== assignment.loadId) return load;
          return {
            ...load,
            status:
              status === "in_transit"
                ? "in_transit"
                : status === "completed"
                  ? "completed"
                  : "assigned",
          };
        }),
      })),
    [],
  );

  useEffect(() => {
    if (!simulationRunning) {
      externalSimulator.current = false;
      return;
    }
    const stream = new EventSource("/api/telemetry/events");
    stream.onopen = () => {
      externalSimulator.current = true;
    };
    stream.onerror = () => {
      externalSimulator.current = false;
    };
    stream.onmessage = (message) => {
      const telemetry = JSON.parse(message.data) as {
        truckId: string;
        point: { lat: number; lng: number };
        progress: number;
        speedKph: number;
        distanceKm: number;
      };
      setState((current) => {
        const assignment = current.assignments.find(
          (item) =>
            item.truckId === telemetry.truckId && item.status !== "completed",
        );
        if (!assignment) return current;
        const nextStatus: Assignment["status"] =
          telemetry.progress >= 1 ? "completed" : "in_transit";
        let visits = current.visits.map((visit) =>
          visit.departedAt
            ? visit
            : { ...visit, dwellMinutes: visit.dwellMinutes + 2 },
        );
        for (const facility of current.facilities) {
          const inside =
            distance(
              point([telemetry.point.lng, telemetry.point.lat]),
              point([facility.point.lng, facility.point.lat]),
              { units: "kilometers" },
            ) <= facility.radiusKm;
          const open = visits.find(
            (visit) =>
              visit.truckId === telemetry.truckId &&
              visit.facilityId === facility.id &&
              !visit.departedAt,
          );
          if (inside && !open)
            visits.push({
              id: `V-${Date.now()}-${facility.id}`,
              truckId: telemetry.truckId,
              facilityId: facility.id,
              arrivedAt: new Date().toISOString(),
              dwellMinutes: 0,
            });
          if (!inside && open)
            visits = visits.map((visit) =>
              visit.id === open.id
                ? { ...visit, departedAt: new Date().toISOString() }
                : visit,
            );
        }
        return {
          ...current,
          visits,
          assignments: current.assignments.map((item) =>
            item.id === assignment.id
              ? {
                  ...item,
                  currentPoint: telemetry.point,
                  progress: telemetry.progress,
                  speedKph: telemetry.speedKph,
                  distanceKm: telemetry.distanceKm,
                  status: nextStatus,
                  breadcrumbs: [
                    ...(item.breadcrumbs || []),
                    telemetry.point,
                  ].slice(-300),
                }
              : item,
          ),
          loads: current.loads.map((load) =>
            load.id === assignment.loadId
              ? {
                  ...load,
                  status:
                    nextStatus === "completed" ? "completed" : "in_transit",
                }
              : load,
          ),
          trucks: current.trucks.map((truck) =>
            truck.id === telemetry.truckId
              ? {
                  ...truck,
                  point: telemetry.point,
                  status: nextStatus === "completed" ? "available" : "assigned",
                }
              : truck,
          ),
          drivers: current.drivers.map((driver) =>
            driver.id === assignment.driverId
              ? {
                  ...driver,
                  point: telemetry.point,
                  dutyStatus:
                    nextStatus === "completed" ? "on_duty" : "driving",
                  drivingHoursRemaining: Math.max(
                    0,
                    driver.drivingHoursRemaining - 2 / 60,
                  ),
                  onDutyHoursRemaining: Math.max(
                    0,
                    driver.onDutyHoursRemaining - 2 / 60,
                  ),
                  cycleHoursRemaining: Math.max(
                    0,
                    driver.cycleHoursRemaining - 2 / 60,
                  ),
                }
              : driver,
          ),
        };
      });
    };
    return () => {
      externalSimulator.current = false;
      stream.close();
    };
  }, [simulationRunning]);

  useEffect(() => {
    if (!simulationRunning) return;
    const timer = window.setInterval(
      () =>
        setState((current) => {
          if (externalSimulator.current) return current;
          let visits = [...current.visits];
          const assignments = current.assignments.map((assignment) => {
            if (
              !["accepted", "in_transit", "dispatched", "proposed"].includes(
                assignment.status,
              )
            )
              return assignment;
            const load = current.loads.find(
              (item) => item.id === assignment.loadId,
            )!;
            const progress = Math.min(1, assignment.progress + 0.012);
            const start = load.originPoint,
              end = load.destinationPoint;
            const currentPoint = {
              lat: start.lat + (end.lat - start.lat) * progress,
              lng: start.lng + (end.lng - start.lng) * progress,
            };
            const status: Assignment["status"] =
              progress >= 1
                ? "completed"
                : progress > 0.03
                  ? "in_transit"
                  : assignment.status;
            const speedKph =
              status === "completed"
                ? 0
                : 76 + Math.round(Math.sin(progress * 20) * 14);
            for (const facility of current.facilities) {
              const inside =
                distance(
                  point([currentPoint.lng, currentPoint.lat]),
                  point([facility.point.lng, facility.point.lat]),
                  { units: "kilometers" },
                ) <= facility.radiusKm;
              const open = visits.find(
                (v) =>
                  v.truckId === assignment.truckId &&
                  v.facilityId === facility.id &&
                  !v.departedAt,
              );
              if (inside && !open)
                visits.push({
                  id: `V-${Date.now()}-${facility.id}`,
                  truckId: assignment.truckId,
                  facilityId: facility.id,
                  arrivedAt: new Date().toISOString(),
                  dwellMinutes: 0,
                });
              if (!inside && open)
                visits = visits.map((v) =>
                  v.id === open.id
                    ? { ...v, departedAt: new Date().toISOString() }
                    : v,
                );
            }
            return {
              ...assignment,
              progress,
              currentPoint,
              breadcrumbs: [
                ...(assignment.breadcrumbs || [start]),
                currentPoint,
              ].slice(-300),
              status,
              speedKph,
              distanceKm: assignment.distanceKm + speedKph / 360,
              eta: new Date(
                Date.now() + Math.max(0, 1 - progress) * 2.5 * 3600000,
              ).toISOString(),
            };
          });
          visits = visits.map((v) =>
            v.departedAt ? v : { ...v, dwellMinutes: v.dwellMinutes + 2 },
          );
          const completed = new Set(
            assignments
              .filter((a) => a.status === "completed")
              .map((a) => a.loadId),
          );
          return {
            ...current,
            assignments,
            visits,
            loads: current.loads.map((load) =>
              completed.has(load.id)
                ? { ...load, status: "completed" }
                : assignments.some(
                      (a) => a.loadId === load.id && a.status === "in_transit",
                    )
                  ? { ...load, status: "in_transit" }
                  : load,
            ),
            drivers: current.drivers.map((driver) => {
              const active = assignments.find(
                (a) => a.driverId === driver.id && a.status === "in_transit",
              );
              return active
                ? {
                    ...driver,
                    point: active.currentPoint,
                    dutyStatus: "driving",
                    drivingHoursRemaining: Math.max(
                      0,
                      driver.drivingHoursRemaining - 2 / 60,
                    ),
                    onDutyHoursRemaining: Math.max(
                      0,
                      driver.onDutyHoursRemaining - 2 / 60,
                    ),
                    cycleHoursRemaining: Math.max(
                      0,
                      driver.cycleHoursRemaining - 2 / 60,
                    ),
                  }
                : driver;
            }),
            trucks: current.trucks.map((truck) => {
              const active = assignments.find(
                (a) => a.truckId === truck.id && a.status === "in_transit",
              );
              return active
                ? {
                    ...truck,
                    point: active.currentPoint,
                    odometerKm: truck.odometerKm + active.speedKph / 360,
                  }
                : truck;
            }),
          };
        }),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [simulationRunning]);

  const reset = useCallback(() => {
    setState(createDemoState());
    setProposal(null);
    setSimulationRunning(false);
  }, []);
  const sendMagicLink = useCallback(async (email: string) => {
    if (!supabase) return "Supabase is not configured.";
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    return error?.message || null;
  }, []);
  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);
  const metrics = useMemo(
    () => ({
      open: state.loads.filter((l) => l.status === "unassigned").length,
      active: state.assignments.filter((a) => a.status !== "completed").length,
      available: state.drivers.filter((d) => d.status === "available").length,
      revenue: state.loads
        .filter((l) => l.status !== "cancelled")
        .reduce((sum, l) => sum + l.rate, 0),
      detention: state.visits.reduce((sum, v) => {
        const f = state.facilities.find((x) => x.id === v.facilityId);
        return (
          sum +
          (Math.max(0, v.dwellMinutes - (f?.freeMinutes || 120)) *
            (f?.detentionRate || 0)) /
            60
        );
      }, 0),
    }),
    [state],
  );

  return {
    state,
    metrics,
    proposal,
    setProposal,
    simulationRunning,
    setSimulationRunning,
    userEmail,
    syncStatus,
    sendMagicLink,
    signOut,
    candidateFor,
    assign,
    unassign,
    generatePlan,
    applyPlan,
    updateAssignmentStatus,
    reset,
  };
}
