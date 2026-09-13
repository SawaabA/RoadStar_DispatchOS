import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("supabase/migrations/20260913090218_loading_plan_versions_and_neutral_sync_contract.sql"), "utf8").toLowerCase();

describe("loading plan and integration migration contract", () => {
  it("versions plans atomically and keeps tenant checks on the caller", () => {
    expect(migration).toContain("alter table public.loading_plans");
    expect(migration).toContain("alter column trailer_id drop not null");
    expect(migration).not.toContain("create table public.loading_plans");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("role in ('admin','dispatcher')");
    expect(migration).toContain("create or replace function public.approve_loading_plan");
    expect(migration).toContain("set status = 'superseded'");
  });

  it("supports idempotent two-way sync without exposing the private outbox", () => {
    expect(migration).toContain("create table public.external_record_links");
    expect(migration).toContain("create table public.integration_sync_events");
    expect(migration).toContain("create table public.integration_outbox");
    expect(migration).toContain("unique (organization_id, provider, idempotency_key)");
    expect(migration).not.toContain("grant select, insert, update, delete on public.integration_outbox");
    expect(migration).toContain("grant select, insert on public.integration_sync_events");
    expect(migration).not.toContain("operators delete integration sync events");
  });
});
