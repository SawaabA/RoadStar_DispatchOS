import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20260912231741_production_driver_workflow_and_observability.sql"),
  "utf8",
).toLowerCase();

describe("production driver migration contract", () => {
  it("keeps privileged driver mutations private and explicitly authorized", () => {
    expect(migration).toContain("create table public.driver_user_links");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("member.role = 'driver'");
    expect(migration).toContain("item ->> 'driverid' = v_driver_external_id");
    expect(migration).toContain("revoke all on function private.apply_driver_assignment_transition");
    expect(migration).toContain("revoke all on function public.transition_driver_assignment");
  });

  it("locks the snapshot and permits only explicit state transitions", () => {
    expect(migration).toContain("for update;");
    expect(migration).toContain("p_action not in ('accepted', 'in_transit', 'declined')");
    expect(migration).toContain("revision = revision + 1");
    expect(migration).toContain("insert into public.decision_records");
  });
});
