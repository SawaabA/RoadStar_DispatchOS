import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20260913131500_consolidated_trip_driver_transitions.sql"),
  "utf8",
).toLowerCase();

describe("consolidated trip driver transition contract", () => {
  it("moves every load on the trip, not only the primary one", () => {
    expect(migration).toContain("v_load_ids text[]");
    expect(migration).toContain("array[v_assignment ->> 'loadid']");
    expect(migration).toContain("v_assignment -> 'addedloadids'");
    // Both the decline and the accept/start branches must match the whole trip.
    expect(migration.match(/item ->> 'id' = any\(v_load_ids\)/g)?.length).toBe(2);
    expect(migration).not.toContain("item ->> 'id' = v_load_id ");
  });

  it("keeps the privileged function private and authorization unchanged", () => {
    expect(migration).toContain("create or replace function private.apply_driver_assignment_transition");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("member.role = 'driver'");
    expect(migration).toContain("item ->> 'driverid' = v_driver_external_id");
    expect(migration).toContain("for update;");
    expect(migration).toContain("p_action not in ('accepted', 'in_transit', 'declined')");
    expect(migration).toContain("revoke all on function private.apply_driver_assignment_transition");
    expect(migration).toContain("revision = revision + 1");
    expect(migration).toContain("insert into public.decision_records");
  });
});
