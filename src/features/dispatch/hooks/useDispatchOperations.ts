import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createDemoState } from "../data/demoData";
import { buildMorningPlan, evaluateCandidate } from "../lib/optimizer";
import { assignCandidate, unassignLoad } from "../lib/stateTransitions";
import { isDispatchState } from "../lib/stateValidation";
import { updateGeofenceVisits } from "../lib/geofencing";
import type {
  Assignment,
  DecisionRecord,
  DispatchCandidate,
  DispatchState,
  OptimizationWeights,
  PlanProposal,
} from "../types";
import type { BackhaulSuggestion, OperationalException, ReplanImpact } from "../../intelligence/types";
import { supabase } from "../../../shared/lib/supabase";

const STORAGE_KEY = "roadstar-dispatch-state-v2";

const loadInitialState = (): DispatchState => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return createDemoState();
    const parsed: unknown = JSON.parse(stored);
    return isDispatchState(parsed) ? parsed : createDemoState();
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
    "local" | "connecting" | "synced" | "conflict" | "error"
  >("local");
  const stateRef = useRef(state);
  const organizationId = useRef<number | null>(null);
  const syncReady = useRef(false);
  const externalTelemetryAt = useRef(new Map<string, number>());
  const lastSyncedState = useRef<string | null>(null);
  const snapshotRevision = useRef(0);
  const persistedDecisionIds = useRef(new Set<string>());
  stateRef.current = state;

  useEffect(() => {
    if (!userEmail && organizationId.current === null)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, userEmail]);

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
      const leavingCloudWorkspace = organizationId.current !== null;
      organizationId.current = null;
      syncReady.current = false;
      lastSyncedState.current = null;
      snapshotRevision.current = 0;
      persistedDecisionIds.current.clear();
      setSyncStatus("local");
      if (leavingCloudWorkspace) setState(createDemoState());
      return;
    }
    const client = supabase;
    let active = true;
    let channel: ReturnType<typeof client.channel> | null = null;
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
        .select("state, revision")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (!active) return;
      if (error) {
        setSyncStatus("error");
        return;
      }
      if (snapshot?.state) {
        if (!isDispatchState(snapshot.state)) {
          setSyncStatus("error");
          return;
        }
        lastSyncedState.current = JSON.stringify(snapshot.state);
        snapshotRevision.current = Number(snapshot.revision ?? 0);
        setState(snapshot.state);
      } else {
        const { error: insertError } = await client
          .from("dispatch_snapshots")
          .insert({ organization_id: orgId, state: stateRef.current });
        if (insertError) {
          setSyncStatus("error");
          return;
        }
        lastSyncedState.current = JSON.stringify(stateRef.current);
      }
      if (!active) return;
      syncReady.current = true;
      channel = client
        .channel(`roadstar-dispatch-state-${orgId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "dispatch_snapshots",
            filter: `organization_id=eq.${orgId}`,
          },
          (payload) => {
            const row = payload.new as {
              organization_id?: number;
              state?: DispatchState;
              revision?: number;
            };
            if (
              !isDispatchState(row.state) ||
              !active ||
              Number(row.organization_id) !== orgId
            )
              return;
            const serialized = JSON.stringify(row.state);
            const localSerialized = JSON.stringify(stateRef.current);
            const hasUnsavedLocalEdit = lastSyncedState.current !== null && localSerialized !== lastSyncedState.current;
            if (hasUnsavedLocalEdit && serialized !== localSerialized) {
              setSyncStatus("conflict");
              return;
            }
            lastSyncedState.current = serialized;
            snapshotRevision.current = Number(row.revision ?? snapshotRevision.current);
            if (serialized !== localSerialized)
              setState(row.state);
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") setSyncStatus("synced");
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
            setSyncStatus("error");
        });
    };
    void connect();
    return () => {
      active = false;
      syncReady.current = false;
      if (channel) void client.removeChannel(channel);
    };
  }, [userEmail]);

  useEffect(() => {
    if (!supabase || !syncReady.current || !organizationId.current) return;
    const serialized = JSON.stringify(state);
    if (serialized === lastSyncedState.current) return;
    const client = supabase;
    const timer = window.setTimeout(async () => {
      setSyncStatus("connecting");
      const { data, error } = await client.rpc("save_dispatch_snapshot", {
        p_organization_id: organizationId.current,
        p_state: state,
        p_expected_revision: snapshotRevision.current,
      });
      if (error?.code === "40001") setSyncStatus("conflict");
      else if (error) setSyncStatus("error");
      else {
        snapshotRevision.current = Number(data);
        lastSyncedState.current = serialized;
        setSyncStatus("synced");
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (!supabase || !syncReady.current || !organizationId.current) return;
    const unsaved = (state.decisionLog ?? []).filter((item) => !persistedDecisionIds.current.has(item.id));
    if (!unsaved.length) return;
    const client = supabase;
    const orgId = organizationId.current;
    void (async () => {
      const { data: user } = await client.auth.getUser();
      const { error } = await client.from("decision_records").upsert(unsaved.map((item) => ({
        organization_id: orgId,
        external_id: item.id,
        kind: item.kind,
        outcome: item.outcome,
        summary: item.summary,
        decided_by: user.user?.id,
        created_at: item.createdAt,
      })), { onConflict: "organization_id,external_id" });
      if (error) { setSyncStatus("error"); return; }
      unsaved.forEach((item) => persistedDecisionIds.current.add(item.id));
    })();
  }, [state.decisionLog]);

  const candidateFor = useCallback(
    (loadId: string, driverId: string): DispatchCandidate | null => {
      const load = state.loads.find((item) => item.id === loadId),
        driver = state.drivers.find((item) => item.id === driverId);
      const trailer = state.trailers.find(
        (item) => item.id === driver?.trailerId,
      );
      const truck = state.trucks.find((item) => item.id === driver?.truckId);
      return load && driver && trailer
        ? evaluateCandidate(load, driver, trailer, truck)
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
      setState((current) => assignCandidate(current, candidate, status));
      return true;
    },
    [],
  );

  const unassign = useCallback(
    (loadId: string) => setState((current) => unassignLoad(current, loadId)),
    [],
  );

  const generatePlan = useCallback(
    () => setProposal(buildMorningPlan(state.loads, state.drivers, state.trailers, state.trucks, state.optimizationWeights)),
    [state],
  );
  const applyPlan = useCallback(() => {
    if (!proposal) return;
    proposal.candidates.forEach((item) => assign(item, "proposed"));
    setState((current) => ({
      ...current,
      decisionLog: [...(current.decisionLog ?? []), ({
        id: `${proposal.id}:accepted`,
        kind: "plan",
        outcome: "accepted",
        createdAt: new Date().toISOString(),
        summary: `Approved morning plan with ${proposal.candidates.length} assignments`,
      } satisfies DecisionRecord)].slice(-500),
    }));
    setProposal(null);
  }, [proposal, assign]);

  const recordDecision = useCallback((record: DecisionRecord) => setState((current) => ({
    ...current,
    decisionLog: [...(current.decisionLog ?? []).filter((item) => item.id !== record.id), record].slice(-500),
  })), []);

  const acknowledgeException = useCallback((exception: OperationalException) => setState((current) => ({
    ...current,
    acknowledgedExceptionIds: [...new Set([...(current.acknowledgedExceptionIds ?? []), exception.id])],
    decisionLog: [...(current.decisionLog ?? []), ({
      id: `${exception.id}:acknowledged`, kind: "exception", outcome: "acknowledged",
      createdAt: new Date().toISOString(), summary: `Acknowledged: ${exception.title}`,
    } satisfies DecisionRecord)].slice(-500),
  })), []);

  const resolveReplan = useCallback((impact: ReplanImpact, outcome: "accepted" | "rejected") => setState((current) => ({
    ...current,
    assignments: outcome === "accepted" ? current.assignments.map((item) =>
      item.id === impact.assignmentId ? { ...item, eta: impact.projectedEta } : item,
    ) : current.assignments,
    decisionLog: [...(current.decisionLog ?? []), ({
      id: `${impact.id}:${outcome}`, kind: "replan", outcome,
      createdAt: new Date().toISOString(),
      summary: `${outcome === "accepted" ? "Approved" : "Rejected"} ${impact.addedDelayMinutes}-minute ETA re-plan for ${impact.loadId}`,
    } satisfies DecisionRecord)].slice(-500),
  })), []);

  const resolveBackhaul = useCallback((suggestion: BackhaulSuggestion, outcome: "accepted" | "rejected") => recordDecision({
    id: `${suggestion.id}:${outcome}`, kind: "backhaul", outcome,
    createdAt: new Date().toISOString(),
    summary: `${outcome === "accepted" ? "Reserved" : "Dismissed"} ${suggestion.loadId} after ${suggestion.assignmentId} (${Math.round(suggestion.avoidedEmptyKm)} km opportunity)`,
  }), [recordDecision]);

  const setOptimizationWeights = useCallback((optimizationWeights: OptimizationWeights) =>
    setState((current) => ({ ...current, optimizationWeights })), []);

  const reloadCloud = useCallback(async () => {
    if (!supabase || !organizationId.current) return;
    setSyncStatus("connecting");
    const { data, error } = await supabase.from("dispatch_snapshots").select("state, revision").eq("organization_id", organizationId.current).single();
    if (error || !isDispatchState(data?.state)) { setSyncStatus("error"); return; }
    snapshotRevision.current = Number(data.revision ?? 0);
    lastSyncedState.current = JSON.stringify(data.state);
    setState(data.state);
    setSyncStatus("synced");
  }, []);

  const saveP1Record = useCallback(async (
    table: "historical_replay_runs" | "cargo_items",
    values: Record<string, unknown>,
  ) => {
    if (!supabase || !organizationId.current)
      return "Available locally; sign in to persist this record to Supabase.";
    const payload = { ...values, organization_id: organizationId.current };
    const { error } = table === "cargo_items"
      ? await supabase.from(table).upsert(payload, { onConflict: "organization_id,external_id" })
      : await supabase.from(table).insert(payload);
    if (error) { setSyncStatus("error"); return error.message; }
    return null;
  }, []);

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
      externalTelemetryAt.current.clear();
      return;
    }
    const stream = new EventSource("/api/telemetry/events");
    stream.onmessage = (message) => {
      let telemetry: {
        truckId: string;
        point: { lat: number; lng: number };
        progress: number;
        speedKph: number;
        distanceKm: number;
      };
      try {
        telemetry = JSON.parse(message.data) as typeof telemetry;
      } catch {
        return;
      }
      if (
        typeof telemetry.truckId !== "string" ||
        !Number.isFinite(telemetry.point?.lat) ||
        !Number.isFinite(telemetry.point?.lng) ||
        !Number.isFinite(telemetry.progress) ||
        !Number.isFinite(telemetry.speedKph) ||
        !Number.isFinite(telemetry.distanceKm)
      )
        return;
      externalTelemetryAt.current.set(telemetry.truckId, Date.now());
      setState((current) => {
        const assignment = current.assignments.find((item) => item.truckId === telemetry.truckId && item.status === "in_transit");
        if (!assignment) return current;
        const nextStatus: Assignment["status"] =
          telemetry.progress >= 1 ? "completed" : "in_transit";
        let visits = current.visits.map((visit) =>
          visit.departedAt || visit.truckId !== telemetry.truckId
            ? visit
            : { ...visit, dwellMinutes: visit.dwellMinutes + 2 },
        );
        visits = updateGeofenceVisits(
          visits,
          current.facilities,
          telemetry.truckId,
          telemetry.point,
        );
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
                  status: nextStatus === "completed" ? "available" : "assigned",
                  nextAvailable: nextStatus === "completed" ? "Now" : driver.nextAvailable,
                }
              : driver,
          ),
          trailers: current.trailers.map((trailer) =>
            trailer.id === assignment.trailerId && nextStatus === "completed"
              ? { ...trailer, status: "available" }
              : trailer,
          ),
        };
      });
    };
    return () => {
      externalTelemetryAt.current.clear();
      stream.close();
    };
  }, [simulationRunning]);

  useEffect(() => {
    if (!simulationRunning) return;
    const timer = window.setInterval(
      () =>
        setState((current) => {
          let visits = [...current.visits];
          const fallbackTruckIds = new Set<string>();
          const assignments = current.assignments.map((assignment) => {
            const externalIsFresh = Date.now() - (externalTelemetryAt.current.get(assignment.truckId) || 0) < 2500;
            if (externalIsFresh) return assignment;
            if (
              assignment.status !== "in_transit"
            )
              return assignment;
            fallbackTruckIds.add(assignment.truckId);
            const load = current.loads.find(
              (item) => item.id === assignment.loadId,
            );
            if (!load) return assignment;
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
            visits = updateGeofenceVisits(
              visits,
              current.facilities,
              assignment.truckId,
              currentPoint,
            );
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
            v.departedAt || !fallbackTruckIds.has(v.truckId)
              ? v
              : { ...v, dwellMinutes: v.dwellMinutes + 2 },
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
              const finished = assignments.find((a) => a.driverId === driver.id && a.status === "completed");
              if (active)
                return {
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
                };
              return finished
                ? { ...driver, status: "available", dutyStatus: "on_duty", nextAvailable: "Now" }
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
                : assignments.some((a) => a.truckId === truck.id && a.status === "completed")
                  ? { ...truck, status: "available" }
                  : truck;
            }),
            trailers: current.trailers.map((trailer) => {
              const active = assignments.some(
                (assignment) =>
                  assignment.trailerId === trailer.id &&
                  assignment.status !== "completed",
              );
              if (active) return trailer;
              return assignments.some(
                (assignment) =>
                  assignment.trailerId === trailer.id &&
                  assignment.status === "completed",
              )
                ? { ...trailer, status: "available" }
                : trailer;
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
    lastSyncedState.current = null;
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
    acknowledgeException,
    resolveReplan,
    resolveBackhaul,
    recordDecision,
    setOptimizationWeights,
    reloadCloud,
    saveP1Record,
    reset,
  };
}
