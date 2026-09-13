import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const profiles = {
  dispatcherA: ["ROADSTAR_QA_DISPATCHER_A_EMAIL", "ROADSTAR_QA_DISPATCHER_A_PASSWORD"],
  dispatcherA2: ["ROADSTAR_QA_DISPATCHER_A2_EMAIL", "ROADSTAR_QA_DISPATCHER_A2_PASSWORD"],
  driverA: ["ROADSTAR_QA_DRIVER_A_EMAIL", "ROADSTAR_QA_DRIVER_A_PASSWORD"],
  viewerA: ["ROADSTAR_QA_VIEWER_A_EMAIL", "ROADSTAR_QA_VIEWER_A_PASSWORD"],
  dispatcherB: ["ROADSTAR_QA_DISPATCHER_B_EMAIL", "ROADSTAR_QA_DISPATCHER_B_PASSWORD"],
};

let failures = 0;
const sessions = {};
let originalSnapshot;
let organizationA;

function pass(label, detail = "") {
  console.log(`[PASS] ${label}${detail ? ` - ${detail}` : ""}`);
}

function fail(label, detail) {
  failures += 1;
  console.error(`[FAIL] ${label} - ${detail}`);
}

function requireEnvironment() {
  const missing = [];
  if (!supabaseUrl) missing.push("VITE_SUPABASE_URL");
  if (!supabaseKey) missing.push("VITE_SUPABASE_PUBLISHABLE_KEY");
  for (const keys of Object.values(profiles)) {
    for (const key of keys) if (!process.env[key]) missing.push(key);
  }
  if (missing.length) {
    console.error(`Missing QA configuration: ${missing.join(", ")}`);
    process.exit(2);
  }
}

function newClient() {
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function signIn(name, [emailKey, passwordKey]) {
  const client = newClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: process.env[emailKey],
    password: process.env[passwordKey],
  });
  if (error || !data.user) throw new Error(`${name}: ${error?.message || "no user returned"}`);
  sessions[name] = { client, user: data.user };
}

async function membership(name) {
  const { data, error } = await sessions[name].client
    .from("organization_members")
    .select("organization_id,role");
  if (error) throw error;
  if (data.length !== 1) throw new Error(`${name} has ${data.length} visible memberships; expected one`);
  return data[0];
}

async function snapshot(client, organizationId) {
  const { data, error } = await client
    .from("dispatch_snapshots")
    .select("state,revision,updated_by")
    .eq("organization_id", organizationId)
    .single();
  if (error) throw error;
  return data;
}

async function save(client, organizationId, state, expectedRevision) {
  return client.rpc("save_dispatch_snapshot", {
    p_organization_id: organizationId,
    p_state: state,
    p_expected_revision: expectedRevision,
  });
}

async function waitForSubscription(channel) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Realtime subscription timed out")), 10_000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve();
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        reject(new Error(`Realtime channel status: ${status}`));
      }
    });
  });
}

async function run() {
  requireEnvironment();
  const workflowStartedAt = new Date().toISOString();
  await Promise.all(Object.entries(profiles).map(([name, credentials]) => signIn(name, credentials)));
  pass("five independent accounts authenticated");

  const memberships = Object.fromEntries(await Promise.all(
    Object.keys(profiles).map(async (name) => [name, await membership(name)]),
  ));
  organizationA = memberships.dispatcherA.organization_id;
  const organizationB = memberships.dispatcherB.organization_id;
  const expectedRoles = { dispatcherA: "dispatcher", dispatcherA2: "dispatcher", driverA: "driver", viewerA: "viewer", dispatcherB: "dispatcher" };
  for (const [name, role] of Object.entries(expectedRoles)) {
    if (memberships[name].role !== role) throw new Error(`${name} is ${memberships[name].role}; expected ${role}`);
  }
  if (memberships.dispatcherA2.organization_id !== organizationA || memberships.driverA.organization_id !== organizationA || memberships.viewerA.organization_id !== organizationA || organizationB === organizationA) {
    throw new Error("QA users are not split across the expected two organizations");
  }
  pass("roles and organization fixtures", `Organization A ${organizationA}; Organization B ${organizationB}`);

  originalSnapshot = await snapshot(sessions.dispatcherA.client, organizationA);
  const assignments = Array.isArray(originalSnapshot.state?.assignments) ? originalSnapshot.state.assignments : [];
  const ownAssignment = assignments.find((item) => item.driverId === "D-131");
  const foreignAssignment = assignments.find((item) => item.driverId !== "D-131");
  if (!ownAssignment || !foreignAssignment) throw new Error("QA requires one D-131 assignment and one assignment belonging to another driver");

  let realtimeUpdate;
  const realtimePromise = new Promise((resolve) => { realtimeUpdate = resolve; });
  const viewerChannel = sessions.viewerA.client
    .channel(`roadstar-qa-${Date.now()}`)
    .on("postgres_changes", {
      event: "UPDATE",
      schema: "public",
      table: "dispatch_snapshots",
      filter: `organization_id=eq.${organizationA}`,
    }, (payload) => realtimeUpdate(payload));
  await waitForSubscription(viewerChannel);

  const changedEta = new Date(Date.now() + 75 * 60_000).toISOString();
  const dispatcherState = structuredClone(originalSnapshot.state);
  dispatcherState.assignments = dispatcherState.assignments.map((item) => item.id === ownAssignment.id
    ? { ...item, status: "dispatched", acceptedAt: undefined, eta: changedEta }
    : item);
  const dispatcherSave = await save(sessions.dispatcherA.client, organizationA, dispatcherState, originalSnapshot.revision);
  if (dispatcherSave.error) throw dispatcherSave.error;
  pass("Dispatcher A changed an assignment", `${ownAssignment.id}, revision ${dispatcherSave.data}`);

  const event = await Promise.race([
    realtimePromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Viewer did not receive the snapshot update within 10 seconds")), 10_000)),
  ]);
  if (Number(event.new?.revision) !== Number(dispatcherSave.data)) throw new Error("Viewer received the wrong snapshot revision");
  const viewerSnapshot = await snapshot(sessions.viewerA.client, organizationA);
  const viewerAssignment = viewerSnapshot.state.assignments.find((item) => item.id === ownAssignment.id);
  if (viewerAssignment?.eta !== changedEta) throw new Error("Viewer read did not contain Dispatcher A's assignment change");
  pass("Viewer A received the realtime update", `revision ${event.new.revision}`);

  const viewerWrite = await save(sessions.viewerA.client, organizationA, viewerSnapshot.state, viewerSnapshot.revision);
  if (!viewerWrite.error) throw new Error("Viewer unexpectedly saved the dispatch snapshot");
  pass("Viewer A cannot edit", viewerWrite.error.code || "write denied");

  const driverSnapshotWrite = await save(sessions.driverA.client, organizationA, viewerSnapshot.state, viewerSnapshot.revision);
  if (!driverSnapshotWrite.error) throw new Error("Driver unexpectedly used the dispatcher snapshot save RPC");
  pass("Driver cannot bypass workflow with snapshot save", driverSnapshotWrite.error.code || "write denied");

  const unauthorized = await sessions.driverA.client.rpc("transition_driver_assignment", {
    p_assignment_id: foreignAssignment.id,
    p_action: "accepted",
  });
  if (!unauthorized.error) throw new Error("Driver acted on another driver's assignment");
  pass("cross-driver action denied", unauthorized.error.code || "write denied");

  const unsupported = await sessions.driverA.client.rpc("transition_driver_assignment", {
    p_assignment_id: ownAssignment.id,
    p_action: "completed",
  });
  if (!unsupported.error) throw new Error("Unsupported driver transition unexpectedly succeeded");
  pass("unsupported driver transition denied", unsupported.error.code || "invalid action");

  const accepted = await sessions.driverA.client.rpc("transition_driver_assignment", {
    p_assignment_id: ownAssignment.id,
    p_action: "accepted",
  });
  if (accepted.error) throw accepted.error;
  pass("Driver A accepted own assignment", ownAssignment.id);

  const repeated = await sessions.driverA.client.rpc("transition_driver_assignment", {
    p_assignment_id: ownAssignment.id,
    p_action: "accepted",
  });
  if (!repeated.error) throw new Error("Repeated acceptance unexpectedly succeeded");
  pass("repeated acceptance denied", repeated.error.code || "invalid transition");

  const started = await sessions.driverA.client.rpc("transition_driver_assignment", {
    p_assignment_id: ownAssignment.id,
    p_action: "in_transit",
  });
  if (started.error) throw started.error;
  pass("Driver A started own assignment", ownAssignment.id);

  const { data: decisions, error: decisionError } = await sessions.dispatcherA.client
    .from("decision_records")
    .select("outcome,decided_by,context,created_at")
    .eq("organization_id", organizationA)
    .eq("decided_by", sessions.driverA.user.id)
    .gte("created_at", workflowStartedAt)
    .contains("context", { assignment_id: ownAssignment.id });
  if (decisionError) throw decisionError;
  const outcomes = new Set(decisions.map((item) => item.outcome));
  if (!outcomes.has("accepted") || !outcomes.has("started")) throw new Error(`Missing driver decision records; received ${[...outcomes].join(", ")}`);
  pass("driver decision records created", "accepted and started");

  for (const table of ["dispatch_snapshots", "drivers", "loads", "decision_records"]) {
    const { data, error } = await sessions.dispatcherB.client
      .from(table)
      .select("organization_id")
      .eq("organization_id", organizationA)
      .limit(1);
    if (error) throw error;
    if (data.length) throw new Error(`Dispatcher B received Organization A data from ${table}`);
  }
  pass("Dispatcher B tenant isolation", "Organization A returned no rows across protected tables");

  const beforeRace = await snapshot(sessions.dispatcherA.client, organizationA);
  const stateA = { ...structuredClone(beforeRace.state), qaConcurrencyProbe: "dispatcher-a" };
  const stateA2 = { ...structuredClone(beforeRace.state), qaConcurrencyProbe: "dispatcher-a2" };
  const race = await Promise.all([
    save(sessions.dispatcherA.client, organizationA, stateA, beforeRace.revision),
    save(sessions.dispatcherA2.client, organizationA, stateA2, beforeRace.revision),
  ]);
  const successes = race.filter((result) => !result.error);
  const conflicts = race.filter((result) => result.error?.code === "40001" || /changed in another session/i.test(result.error?.message || ""));
  if (successes.length !== 1 || conflicts.length !== 1) {
    throw new Error(`Expected one save and one revision conflict; received ${successes.length} save(s), ${conflicts.length} conflict(s)`);
  }
  pass("concurrent dispatcher protection", "one save succeeded and one stale save received 40001");

  await sessions.viewerA.client.removeChannel(viewerChannel);
}

async function restore() {
  if (!originalSnapshot || !organizationA || !sessions.dispatcherA) return;
  const current = await snapshot(sessions.dispatcherA.client, organizationA);
  const restored = await save(sessions.dispatcherA.client, organizationA, originalSnapshot.state, current.revision);
  if (restored.error) {
    fail("workspace restoration", restored.error.message);
    return;
  }
  pass("workspace restoration", `revision ${restored.data}`);
}

try {
  await run();
} catch (error) {
  fail("workflow execution", error instanceof Error ? error.message : String(error));
} finally {
  await restore();
  await Promise.all(Object.values(sessions).map(({ client }) => client.auth.signOut({ scope: "local" })));
}

if (failures) {
  console.error(`RoadStar authenticated workflow verification failed with ${failures} finding(s).`);
  process.exit(1);
}
console.log("RoadStar authenticated workflow, tenant isolation, audit, and concurrency verification passed.");
