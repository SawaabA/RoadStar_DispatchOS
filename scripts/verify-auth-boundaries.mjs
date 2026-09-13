import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const profiles = [
  { id: "dispatcher-a", role: "dispatcher", tenant: "a", emailKey: "ROADSTAR_QA_DISPATCHER_A_EMAIL", passwordKey: "ROADSTAR_QA_DISPATCHER_A_PASSWORD" },
  { id: "dispatcher-a2", role: "dispatcher", tenant: "a", emailKey: "ROADSTAR_QA_DISPATCHER_A2_EMAIL", passwordKey: "ROADSTAR_QA_DISPATCHER_A2_PASSWORD" },
  { id: "driver-a", role: "driver", tenant: "a", emailKey: "ROADSTAR_QA_DRIVER_A_EMAIL", passwordKey: "ROADSTAR_QA_DRIVER_A_PASSWORD" },
  { id: "viewer-a", role: "viewer", tenant: "a", emailKey: "ROADSTAR_QA_VIEWER_A_EMAIL", passwordKey: "ROADSTAR_QA_VIEWER_A_PASSWORD" },
  { id: "dispatcher-b", role: "dispatcher", tenant: "b", emailKey: "ROADSTAR_QA_DISPATCHER_B_EMAIL", passwordKey: "ROADSTAR_QA_DISPATCHER_B_PASSWORD" },
];

let failures = 0;

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
  for (const profile of profiles) {
    if (!process.env[profile.emailKey]) missing.push(profile.emailKey);
    if (!process.env[profile.passwordKey]) missing.push(profile.passwordKey);
  }
  if (missing.length) {
    console.error("Missing QA configuration:");
    for (const name of missing) console.error(`  ${name}`);
    console.error("Copy .env.qa.example to .env.qa.local and fill in dedicated test accounts.");
    process.exit(2);
  }
}

function client() {
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function signIn(profile) {
  const supabase = client();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: process.env[profile.emailKey],
    password: process.env[profile.passwordKey],
  });
  if (error || !data.user) {
    fail(`${profile.id} authentication`, error?.message || "No user returned");
    return null;
  }
  pass(`${profile.id} authentication`, data.user.id);
  return supabase;
}

async function oneMembership(profile, supabase) {
  const { data, error } = await supabase
    .from("organization_members")
    .select("organization_id,role,user_id");
  if (error) {
    fail(`${profile.id} membership read`, error.message);
    return null;
  }
  if (data.length !== 1 || data[0].role !== profile.role) {
    fail(`${profile.id} membership`, `expected one ${profile.role} membership, received ${JSON.stringify(data)}`);
    return null;
  }
  pass(`${profile.id} membership`, `${profile.role} in organization ${data[0].organization_id}`);
  return data[0].organization_id;
}

async function visibleOrganizations(profile, supabase, organizationId) {
  const { data, error } = await supabase.from("organizations").select("id,slug");
  if (error) {
    fail(`${profile.id} organization read`, error.message);
    return;
  }
  if (data.length !== 1 || data[0].id !== organizationId) {
    fail(`${profile.id} organization isolation`, `expected only ${organizationId}, received ${JSON.stringify(data)}`);
    return;
  }
  pass(`${profile.id} organization isolation`, data[0].slug);
}

async function tenantTables(profile, supabase, organizationId) {
  for (const table of ["dispatch_snapshots", "drivers", "loads", "decision_records"]) {
    const own = await supabase
      .from(table)
      .select("organization_id", { count: "exact", head: true })
      .eq("organization_id", organizationId);
    const foreign = await supabase
      .from(table)
      .select("organization_id")
      .neq("organization_id", organizationId)
      .limit(1);
    if (own.error || foreign.error) {
      fail(`${profile.id} ${table} read`, own.error?.message || foreign.error?.message);
      continue;
    }
    if (foreign.data.length) fail(`${profile.id} ${table} isolation`, "received a row from another organization");
    else pass(`${profile.id} ${table} isolation`, `${own.count ?? 0} own row(s), 0 foreign row(s)`);
  }
}

async function driverLinkVisibility(profile, supabase, organizationId) {
  const { data, error } = await supabase
    .from("driver_user_links")
    .select("organization_id,user_id,driver_external_id");
  if (error) {
    fail(`${profile.id} driver-link read`, error.message);
    return;
  }
  if (data.some((row) => row.organization_id !== organizationId)) {
    fail(`${profile.id} driver-link isolation`, "received a link from another organization");
    return;
  }
  if (profile.role === "driver" && data.length !== 1) {
    fail(`${profile.id} own driver link`, `expected exactly one link, received ${data.length}`);
    return;
  }
  if (profile.role === "viewer" && data.length !== 0) {
    fail(`${profile.id} driver-link privilege`, `viewer received ${data.length} link(s)`);
    return;
  }
  pass(`${profile.id} driver-link visibility`, `${data.length} visible link(s)`);
}

requireEnvironment();
const results = [];

for (const profile of profiles) {
  const supabase = await signIn(profile);
  if (!supabase) continue;
  const organizationId = await oneMembership(profile, supabase);
  if (organizationId !== null) {
    results.push({ ...profile, organizationId });
    await visibleOrganizations(profile, supabase, organizationId);
    await tenantTables(profile, supabase, organizationId);
    await driverLinkVisibility(profile, supabase, organizationId);
  }
  await supabase.auth.signOut({ scope: "local" });
}

const tenantA = new Set(results.filter((item) => item.tenant === "a").map((item) => item.organizationId));
const tenantB = new Set(results.filter((item) => item.tenant === "b").map((item) => item.organizationId));
if (tenantA.size === 1 && tenantB.size === 1 && !tenantB.has([...tenantA][0])) {
  pass("cross-organization fixture", `organization A ${[...tenantA][0]} differs from organization B ${[...tenantB][0]}`);
} else {
  fail("cross-organization fixture", "accounts are missing or are not divided across exactly two organizations");
}

if (failures) {
  console.error(`RoadStar authentication verification failed with ${failures} finding(s).`);
  process.exit(1);
}

console.log("RoadStar authenticated multi-user and tenant-isolation verification passed.");
