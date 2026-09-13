import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createDemoState } from "../data/demoData";
import { buildMorningPlan, evaluateCandidate } from "../lib/optimizer";
import { addLoad, addLoadToTrip, assignCandidate, transitionDriverAssignment, unassignLoad } from "../lib/stateTransitions";
import { carriedLoadIds, evaluateCoLoad, planTrip, tripLoadIds, type CoLoadEvaluation, type TripPlan } from "../lib/tripPlanning";
import { isDispatchState } from "../lib/stateValidation";
import { updateGeofenceVisits } from "../lib/geofencing";
import { accountIdleTime } from "../lib/dutyAccounting";
import { validateTelemetryEvent } from "../lib/telemetryValidation";
import { draftToLoad, validateLoadDraft, type LoadDraft, type LoadDraftErrors } from "../lib/loadDraft";
import type {
  Assignment,
  DecisionRecord,
  DispatchCandidate,
  DispatchLoad,
  DispatchState,
  DriverAssignmentAction,
  OptimizationWeights,
  OrganizationRole,
  PlanProposal,
} from "../types";
import type { BackhaulSuggestion, OperationalException, ReplanImpact } from "../../intelligence/types";
import { supabase } from "../../../shared/lib/supabase";
import { passwordSignInMessage } from "../../../shared/lib/authMessages";

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
  const [memberRole, setMemberRole] = useState<OrganizationRole | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<
    "local" | "connecting" | "synced" | "conflict" | "error"
  >("local");
  const stateRef = useRef(state);
  const organizationId = useRef<number | null>(null);
  // Mirrors the ref for components that must re-render when the workspace changes.
  const [activeOrganizationId, setActiveOrganizationId] = useState<number | null>(null);
  const syncReady = useRef(false);
  const externalTelemetryAt = useRef(new Map<string, number>());
  const externalTelemetryRecordedAt = useRef(new Map<string, number>());
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
      setActiveOrganizationId(null);
      syncReady.current = false;
      lastSyncedState.current = null;
      snapshotRevision.current = 0;
      persistedDecisionIds.current.clear();
      setMemberRole(null);
      setDriverId(null);
      setActionError(null);
      setSyncStatus("local");
      if (leavingCloudWorkspace) setState(createDemoState());
      return;
    }
    const client = supabase;
    let active = true;
    let channel: ReturnType<typeof client.channel> | null = null;
    let reconciliationTimer: number | null = null;
    setSyncStatus("connecting");
    const connect = async () => {
      const { data: membership, error: membershipError } = await client
        .from("organization_members")
        .select("organization_id, role")
        .limit(1)
        .maybeSingle();
      if (!active) return;
      if (membershipError || !membership) {
        setSyncStatus("error");
        return;
      }
      const orgId = Number(membership.organization_id);
      const role = membership.role as OrganizationRole;
      organizationId.current = orgId;
      setActiveOrganizationId(orgId);
      setMemberRole(role);
      if (role === "driver") {
        const { data: link, error: linkError } = await client
          .from("driver_user_links")
          .select("driver_external_id")
          .eq("organization_id", orgId)
          .maybeSingle();
        if (!active) return;
        if (linkError || !link?.driver_external_id) {
          setDriverId(null);
          setActionError("Your account is a driver but has not been linked to a fleet driver profile. Ask an administrator to complete the link.");
        } else {
          setDriverId(String(link.driver_external_id));
          setActionError(null);
        }
      } else {
        setDriverId(null);
        setActionError(null);
      }
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
        if (role !== "admin" && role !== "dispatcher") {
          setSyncStatus("error");
          setActionError("An administrator must initialize this organization workspace before read-only or driver accounts can use it.");
          return;
        }
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
      const applyRemoteSnapshot = (row: {
        organization_id?: number;
        state?: DispatchState;
        revision?: number;
      }) => {
        if (!isDispatchState(row.state) || !active || Number(row.organization_id) !== orgId) return;
        const remoteRevision = Number(row.revision ?? 0);
        if (remoteRevision <= snapshotRevision.current) return;
        const serialized = JSON.stringify(row.state);
        const localSerialized = JSON.stringify(stateRef.current);
        const hasUnsavedLocalEdit = lastSyncedState.current !== null && localSerialized !== lastSyncedState.current;
        if (hasUnsavedLocalEdit && serialized !== localSerialized) {
          setSyncStatus("conflict");
          return;
        }
        lastSyncedState.current = serialized;
        snapshotRevision.current = remoteRevision;
        if (serialized !== localSerialized) setState(row.state);
        setSyncStatus("synced");
      };
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
          (payload) => applyRemoteSnapshot(payload.new as Parameters<typeof applyRemoteSnapshot>[0]),
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") setSyncStatus("synced");
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
            setSyncStatus("error");
        });
      // Realtime is the fast path, but websocket delivery is not guaranteed.
      // Revision polling repairs a missed event without overwriting local edits.
      reconciliationTimer = window.setInterval(async () => {
        const { data: remote, error: reconciliationError } = await client
          .from("dispatch_snapshots")
          .select("organization_id, state, revision")
          .eq("organization_id", orgId)
          .maybeSingle();
        if (!active) return;
        if (reconciliationError) {
          setSyncStatus("error");
          return;
        }
        if (remote) applyRemoteSnapshot(remote as Parameters<typeof applyRemoteSnapshot>[0]);
      }, 15_000);
    };
    void connect();
    return () => {
      active = false;
      syncReady.current = false;
      if (reconciliationTimer !== null) window.clearInterval(reconciliationTimer);
      if (channel) void client.removeChannel(channel);
    };
  }, [userEmail]);

  useEffect(() => {
    if (!supabase || !syncReady.current || !organizationId.current || (userEmail && memberRole !== "admin" && memberRole !== "dispatcher")) return;
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
      if (error?.code === "P0001" && /changed in another session/i.test(error.message)) setSyncStatus("conflict");
      else if (error) setSyncStatus("error");
      else {
        snapshotRevision.current = Number(data);
        lastSyncedState.current = serialized;
        setSyncStatus("synced");
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [state, memberRole, userEmail]);

  useEffect(() => {
    if (!supabase || !syncReady.current || !organizationId.current || (memberRole !== "admin" && memberRole !== "dispatcher")) return;
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
  }, [state.decisionLog, memberRole]);

  const canManageDispatch = !userEmail || memberRole === "admin" || memberRole === "dispatcher";

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
      if (!candidate.feasible || !canManageDispatch) return false;
      setState((current) => assignCandidate(current, candidate, status));
      return true;
    },
    [canManageDispatch],
  );

  const createLoadFromDraft = useCallback(
    (draft: LoadDraft): { ok: true; loadId: string } | { ok: false; errors: LoadDraftErrors } => {
      if (!canManageDispatch) return { ok: false, errors: { billNumber: "Your role cannot create loads." } };
      const errors = validateLoadDraft(draft, stateRef.current.loads);
      if (Object.keys(errors).length) return { ok: false, errors };
      const load = draftToLoad(draft, stateRef.current.loads);
      setState((current) => addLoad(current, load));
      return { ok: true, loadId: load.id };
    },
    [canManageDispatch],
  );

  const unassign = useCallback(
    (loadId: string) => {
      if (!canManageDispatch) return;
      setState((current) => unassignLoad(current, loadId));
    },
    [canManageDispatch],
  );

  /** The sequenced stop plan, distance, on-duty time and capacity use of a trip. */
  const tripPlanFor = useCallback(
    (assignmentId: string): TripPlan | null => {
      const assignment = state.assignments.find((item) => item.id === assignmentId);
      if (!assignment) return null;
      const driver = state.drivers.find((item) => item.id === assignment.driverId);
      const trailer = state.trailers.find((item) => item.id === assignment.trailerId);
      const truck = state.trucks.find((item) => item.id === assignment.truckId);
      const loads = tripLoadIds(assignment).flatMap((id) =>
        state.loads.filter((load) => load.id === id),
      );
      if (!driver || !trailer || !loads.length) return null;
      return planTrip({
        loads,
        driver,
        trailer,
        truck,
        start: assignment.currentPoint,
        pickedUpLoadIds: carriedLoadIds(assignment),
      });
    },
    [state],
  );

  /** What a single load would cost a new trip run by this driver, from scratch. */
  const soloTripPlanFor = useCallback(
    (loadId: string, driverId: string): TripPlan | null => {
      const load = state.loads.find((item) => item.id === loadId);
      const driver = state.drivers.find((item) => item.id === driverId);
      const trailer = state.trailers.find((item) => item.id === driver?.trailerId);
      const truck = state.trucks.find((item) => item.id === driver?.truckId);
      if (!load || !driver || !trailer) return null;
      return planTrip({
        loads: [load],
        driver,
        trailer,
        truck,
        start: driver.point,
        checkAvailability: true,
      });
    },
    [state],
  );

  /** Trips that could still take more freight, scored against one open load. */
  const coLoadOptionsFor = useCallback(
    (loadId: string): Array<CoLoadEvaluation & { assignmentId: string }> => {
      const candidate = state.loads.find((item) => item.id === loadId);
      if (!candidate || candidate.status !== "unassigned") return [];
      return state.assignments
        .filter((assignment) => ["proposed", "dispatched", "accepted"].includes(assignment.status))
        .flatMap((assignment) => {
          const driver = state.drivers.find((item) => item.id === assignment.driverId);
          const trailer = state.trailers.find((item) => item.id === assignment.trailerId);
          const truck = state.trucks.find((item) => item.id === assignment.truckId);
          const existing = tripLoadIds(assignment).flatMap((id) =>
            state.loads.filter((load) => load.id === id),
          );
          if (!driver || !trailer || !existing.length) return [];
          return [
            {
              assignmentId: assignment.id,
              ...evaluateCoLoad({
                tripLoads: existing,
                candidate,
                driver,
                trailer,
                truck,
                start: assignment.currentPoint,
                pickedUpLoadIds: carriedLoadIds(assignment),
              }),
            },
          ];
        })
        .sort((left, right) => Number(right.feasible) - Number(left.feasible) || right.score - left.score);
    },
    [state],
  );

  /** Open loads that could join an existing trip, best fit first. */
  const coLoadCandidatesFor = useCallback(
    (assignmentId: string): Array<CoLoadEvaluation & { assignmentId: string }> => {
      const assignment = state.assignments.find((item) => item.id === assignmentId);
      if (!assignment || !["proposed", "dispatched", "accepted"].includes(assignment.status)) return [];
      const driver = state.drivers.find((item) => item.id === assignment.driverId);
      const trailer = state.trailers.find((item) => item.id === assignment.trailerId);
      const truck = state.trucks.find((item) => item.id === assignment.truckId);
      const existing = tripLoadIds(assignment).flatMap((id) =>
        state.loads.filter((load) => load.id === id),
      );
      if (!driver || !trailer || !existing.length) return [];
      return state.loads
        .filter((load) => load.status === "unassigned")
        .map((candidate) => ({
          assignmentId,
          ...evaluateCoLoad({
            tripLoads: existing,
            candidate,
            driver,
            trailer,
            truck,
            start: assignment.currentPoint,
            pickedUpLoadIds: carriedLoadIds(assignment),
          }),
        }))
        .sort((left, right) => Number(right.feasible) - Number(left.feasible) || right.score - left.score);
    },
    [state],
  );

  const addToTrip = useCallback(
    (assignmentId: string, loadId: string) => {
      if (!canManageDispatch) return false;
      const next = addLoadToTrip(stateRef.current, assignmentId, loadId);
      if (next === stateRef.current) return false;
      setState(next);
      return true;
    },
    [canManageDispatch],
  );

  const generatePlan = useCallback(
    () => {
      if (!canManageDispatch) return;
      setProposal(buildMorningPlan(state.loads, state.drivers, state.trailers, state.trucks, state.optimizationWeights));
    },
    [state, canManageDispatch],
  );
  const applyPlan = useCallback(() => {
    if (!proposal || !canManageDispatch) return;
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
  }, [proposal, assign, canManageDispatch]);

  const recordDecision = useCallback((record: DecisionRecord) => {
    if (!canManageDispatch) return;
    setState((current) => ({
    ...current,
    decisionLog: [...(current.decisionLog ?? []).filter((item) => item.id !== record.id), record].slice(-500),
    }));
  }, [canManageDispatch]);

  const acknowledgeException = useCallback((exception: OperationalException) => {
    if (!canManageDispatch) return;
    setState((current) => ({
    ...current,
    acknowledgedExceptionIds: [...new Set([...(current.acknowledgedExceptionIds ?? []), exception.id])],
    decisionLog: [...(current.decisionLog ?? []), ({
      id: `${exception.id}:acknowledged`, kind: "exception", outcome: "acknowledged",
      createdAt: new Date().toISOString(), summary: `Acknowledged: ${exception.title}`,
    } satisfies DecisionRecord)].slice(-500),
    }));
  }, [canManageDispatch]);

  const resolveReplan = useCallback((impact: ReplanImpact, outcome: "accepted" | "rejected") => {
    if (!canManageDispatch) return;
    setState((current) => ({
    ...current,
    assignments: outcome === "accepted" ? current.assignments.map((item) =>
      item.id === impact.assignmentId ? { ...item, eta: impact.projectedEta } : item,
    ) : current.assignments,
    decisionLog: [...(current.decisionLog ?? []), ({
      id: `${impact.id}:${outcome}`, kind: "replan", outcome,
      createdAt: new Date().toISOString(),
      summary: `${outcome === "accepted" ? "Approved" : "Rejected"} ${impact.addedDelayMinutes}-minute ETA re-plan for ${impact.loadId}`,
    } satisfies DecisionRecord)].slice(-500),
    }));
  }, [canManageDispatch]);

  const resolveBackhaul = useCallback((suggestion: BackhaulSuggestion, outcome: "accepted" | "rejected") => recordDecision({
    id: `${suggestion.id}:${outcome}`, kind: "backhaul", outcome,
    createdAt: new Date().toISOString(),
    summary: `${outcome === "accepted" ? "Reserved" : "Dismissed"} ${suggestion.loadId} after ${suggestion.assignmentId} (${Math.round(suggestion.avoidedEmptyKm)} km opportunity)`,
  }), [recordDecision]);

  const setOptimizationWeights = useCallback((optimizationWeights: OptimizationWeights) => {
    if (!canManageDispatch) return;
    setState((current) => ({ ...current, optimizationWeights }));
  }, [canManageDispatch]);

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
    if (!canManageDispatch) return "Your account does not have permission to save this record.";
    const payload = { ...values, organization_id: organizationId.current };
    const { error } = table === "cargo_items"
      ? await supabase.from(table).upsert(payload, { onConflict: "organization_id,external_id" })
      : await supabase.from(table).insert(payload);
    if (error) { setSyncStatus("error"); return error.message; }
    return null;
  }, [canManageDispatch]);

  const updateAssignmentStatus = useCallback(async (
    assignmentId: string,
    action: DriverAssignmentAction,
  ) => {
    setActionError(null);
    if (userEmail && memberRole === "driver") {
      if (!supabase || !driverId) {
        setActionError("This driver account is not linked to a RoadStar driver profile.");
        return false;
      }
      const { data, error } = await supabase.rpc("transition_driver_assignment", {
        p_assignment_id: assignmentId,
        p_action: action,
      });
      if (error) {
        setActionError(error.message);
        return false;
      }
      const result = data as { state?: unknown; revision?: unknown } | null;
      if (!result || !isDispatchState(result.state)) {
        setActionError("The cloud returned an invalid workspace update. Reload and try again.");
        return false;
      }
      const serialized = JSON.stringify(result.state);
      snapshotRevision.current = Number(result.revision ?? snapshotRevision.current);
      lastSyncedState.current = serialized;
      setState(result.state);
      setSyncStatus("synced");
      return true;
    }
    if (userEmail && !canManageDispatch) {
      setActionError("Your account does not have permission to change assignments.");
      return false;
    }
    const targetDriverId = stateRef.current.assignments.find((item) => item.id === assignmentId)?.driverId;
    if (!targetDriverId) return false;
    const next = transitionDriverAssignment(stateRef.current, assignmentId, targetDriverId, action);
    if (next === stateRef.current) return false;
    setState(next);
    return true;
  }, [userEmail, memberRole, driverId, canManageDispatch]);

  useEffect(() => {
    if (!simulationRunning) {
      externalTelemetryAt.current.clear();
      externalTelemetryRecordedAt.current.clear();
      return;
    }
    const stream = new EventSource("/api/telemetry/events");
    stream.onmessage = (message) => {
      let raw: unknown;
      try {
        raw = JSON.parse(message.data);
      } catch {
        return;
      }
      const truckId = raw && typeof raw === "object" && "truckId" in raw ? String(raw.truckId) : "";
      const validated = validateTelemetryEvent(raw, { knownTruckIds: new Set(stateRef.current.trucks.map((truck) => truck.id)), previousRecordedAt: externalTelemetryRecordedAt.current.get(truckId) });
      if (!validated.event || validated.recordedAt === undefined) return;
      const telemetry = validated.event;
      const recordedAt = validated.recordedAt;
      externalTelemetryRecordedAt.current.set(telemetry.truckId, recordedAt);
      externalTelemetryAt.current.set(telemetry.truckId, Date.now());
      setState((current) => {
        const assignment = current.assignments.find((item) => item.truckId === telemetry.truckId && item.status === "in_transit");
        // A truck that is not on a trip still waits at facilities and keeps its
        // driver on duty. The simulator moves its vehicles independently of
        // dispatch state, so a parked truck keeps its known position.
        if (!assignment) return accountIdleTime(current, { minutes: 2, onlyTruckIds: new Set([telemetry.truckId]) });
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
            tripLoadIds(assignment).includes(load.id)
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
          const liveTruckIds = new Set(
            current.trucks
              .filter((truck) => Date.now() - (externalTelemetryAt.current.get(truck.id) || 0) < 2500)
              .map((truck) => truck.id),
          );
          const assignments = current.assignments.map((assignment) => {
            const externalIsFresh = Date.now() - (externalTelemetryAt.current.get(assignment.truckId) || 0) < 2500;
            if (externalIsFresh) return assignment;
            if (
              assignment.status !== "in_transit"
            )
              return assignment;
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
          const completed = new Set(
            assignments
              .filter((a) => a.status === "completed")
              .flatMap((a) => tripLoadIds(a)),
          );
          const next: DispatchState = {
            ...current,
            assignments,
            visits,
            loads: current.loads.map((load) =>
              completed.has(load.id)
                ? { ...load, status: "completed" }
                : assignments.some(
                      (a) => a.status === "in_transit" && tripLoadIds(a).includes(load.id),
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
          // Dwell for every open facility visit and on-duty time for working
          // drivers who are not moving. Trucks on live telemetry are accounted
          // by the stream handler instead.
          return accountIdleTime(next, { minutes: 2, skipTruckIds: liveTruckIds });
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
  const createLoad = useCallback((load: DispatchLoad) => {
    if (!canManageDispatch) return false;
    if (stateRef.current.loads.some((item) => item.id === load.id || item.billNumber.toUpperCase() === load.billNumber.toUpperCase())) return false;
    setState((current) => {
      const decision: DecisionRecord = {
        id: `load:${load.id}:${Date.now()}`,
        kind: "load",
        outcome: "accepted",
        createdAt: new Date().toISOString(),
        summary: `Created ${load.billNumber} for ${load.customer} with ${load.cargoItems?.length ?? 1} cargo type(s)`,
      };
      return {
        ...current,
        loads: [load, ...current.loads],
        decisionLog: [...(current.decisionLog ?? []), decision].slice(-500),
      };
    });
    return true;
  }, [canManageDispatch]);
  const saveLoadingPlan = useCallback(async (values: { externalId: string; name: string; objective: string; manifest: unknown; plan: unknown }) => {
    if (!supabase || !organizationId.current) return "Available locally; sign in to save versioned plans to Supabase.";
    if (!canManageDispatch) return "Your account does not have permission to save loading plans.";
    const { error } = await supabase.rpc("save_loading_plan", { p_organization_id: organizationId.current, p_external_id: values.externalId, p_name: values.name, p_objective: values.objective, p_manifest: values.manifest, p_plan: values.plan });
    if (error) { setSyncStatus("error"); return error.message; }
    return null;
  }, [canManageDispatch]);
  const listLoadingPlans = useCallback(async () => {
    if (!supabase || !organizationId.current) return [];
    const { data, error } = await supabase.from("loading_plans").select("id, external_id, version, name, objective, status, manifest, plan, created_at").eq("organization_id", organizationId.current).order("created_at", { ascending: false }).limit(20);
    if (error) { setSyncStatus("error"); return []; }
    return data ?? [];
  }, []);
  const approveLoadingPlan = useCallback(async (planId: string) => {
    if (!supabase || !canManageDispatch) return false;
    const { error } = await supabase.rpc("approve_loading_plan", { p_plan_id: planId });
    if (error) { setSyncStatus("error"); return false; }
    return true;
  }, [canManageDispatch]);
  const updateLoad = useCallback((load: DispatchLoad) => {
    if (!canManageDispatch) return false;
    const previous = stateRef.current.loads.find((item) => item.id === load.id);
    if (!previous || previous.status !== "unassigned") return false;
    if (stateRef.current.loads.some((item) => item.id !== load.id && item.billNumber.toUpperCase() === load.billNumber.toUpperCase())) return false;
    const decision: DecisionRecord = { id: `load:${load.id}:edited:${Date.now()}`, kind: "load", outcome: "accepted", createdAt: new Date().toISOString(), summary: `Updated ${load.billNumber} customer, route, appointments, or cargo manifest` };
    setState((current) => ({ ...current, loads: current.loads.map((item) => item.id === load.id ? load : item), decisionLog: [...(current.decisionLog ?? []), decision].slice(-500) }));
    return true;
  }, [canManageDispatch]);
  const duplicateLoad = useCallback((loadId: string) => {
    if (!canManageDispatch) return null;
    const source = stateRef.current.loads.find((item) => item.id === loadId);
    if (!source) return null;
    let suffix = 1;
    let billNumber = `${source.billNumber}-COPY`;
    while (stateRef.current.loads.some((item) => item.billNumber.toUpperCase() === billNumber.toUpperCase())) billNumber = `${source.billNumber}-COPY-${++suffix}`;
    const duplicate: DispatchLoad = { ...source, id: `L-${billNumber.replace(/^RS-/i, "").replace(/[^A-Z0-9-]/gi, "-")}`, billNumber, status: "unassigned", cargoItems: source.cargoItems?.map((item, index) => ({ ...item, id: `${billNumber}-C${index + 1}` })) };
    const decision: DecisionRecord = { id: `load:${duplicate.id}:duplicated:${Date.now()}`, kind: "load", outcome: "accepted", createdAt: new Date().toISOString(), summary: `Duplicated ${source.billNumber} as ${billNumber}` };
    setState((current) => ({ ...current, loads: [duplicate, ...current.loads], decisionLog: [...(current.decisionLog ?? []), decision].slice(-500) }));
    return duplicate;
  }, [canManageDispatch]);
  const setLoadLifecycle = useCallback((loadId: string, status: "cancelled" | "archived" | "unassigned") => {
    if (!canManageDispatch) return false;
    const load = stateRef.current.loads.find((item) => item.id === loadId);
    if (!load) return false;
    const allowed = status === "cancelled" ? load.status === "unassigned" : status === "archived" ? ["cancelled", "completed"].includes(load.status) : load.status === "archived";
    if (!allowed) return false;
    const decision: DecisionRecord = { id: `load:${load.id}:${status}:${Date.now()}`, kind: "load", outcome: status === "cancelled" ? "rejected" : "acknowledged", createdAt: new Date().toISOString(), summary: `${status === "unassigned" ? "Restored" : status === "cancelled" ? "Cancelled" : "Archived"} ${load.billNumber}` };
    setState((current) => ({ ...current, loads: current.loads.map((item) => item.id === loadId ? { ...item, status } : item), decisionLog: [...(current.decisionLog ?? []), decision].slice(-500) }));
    return true;
  }, [canManageDispatch]);
  const sendMagicLink = useCallback(async (email: string) => {
    if (!supabase) return "Supabase is not configured.";
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    return error?.message || null;
  }, []);
  // Returns a message to show, or null once Supabase has stored the session;
  // the auth state listener above then switches the workspace to the account.
  const signInWithPassword = useCallback(async (email: string, password: string) => {
    if (!supabase) return "Supabase is not configured.";
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      return passwordSignInMessage(error);
    } catch (error) {
      return passwordSignInMessage({ message: error instanceof Error ? error.message : "", status: 0 });
    }
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
    memberRole,
    driverId,
    organizationId: activeOrganizationId,
    canManageDispatch,
    actionError,
    syncStatus,
    sendMagicLink,
    signInWithPassword,
    signOut,
    candidateFor,
    createLoadFromDraft,
    assign,
    unassign,
    addToTrip,
    tripPlanFor,
    soloTripPlanFor,
    coLoadOptionsFor,
    coLoadCandidatesFor,
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
    saveLoadingPlan,
    listLoadingPlans,
    approveLoadingPlan,
    createLoad,
    updateLoad,
    duplicateLoad,
    setLoadLifecycle,
    reset,
  };
}
