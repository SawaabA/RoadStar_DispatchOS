import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20260913082708_load_documents_and_storage.sql"),
  "utf8",
).toLowerCase();

const count = (needle: string) => migration.split(needle).length - 1;

describe("load documents migration contract", () => {
  it("keeps the document bucket private and bounded to the table's limits", () => {
    expect(migration).toContain("values ('load-documents', 'load-documents', false, 10485760");
    expect(migration).toContain("byte_size <= 10485760");
    expect(migration).toContain("'application/pdf'");
  });

  it("grants no direct insert or update on document records", () => {
    expect(migration).toContain("revoke all on public.load_documents from anon, authenticated");
    expect(migration).toContain("grant select, delete on public.load_documents to authenticated");
    expect(migration).not.toMatch(/grant[^;]*insert[^;]*on public\.load_documents/);
    expect(migration).not.toMatch(/grant[^;]*update[^;]*on public\.load_documents/);
  });

  it("pins the search path on every function", () => {
    expect(count("create or replace function")).toBeGreaterThan(0);
    expect(count("set search_path = ''")).toBe(count("create or replace function"));
  });

  it("authorizes drivers through their link and the snapshot assignment", () => {
    expect(migration).toContain("member.role = 'driver'");
    expect(migration).toContain("item ->> 'driverid' = v_driver_external_id");
    expect(migration).toContain("item ->> 'loadid' = p_load_external_id");
  });

  it("trusts Storage's record of the file, not the client's", () => {
    expect(migration).toContain("metadata ->> 'mimetype'");
    expect(migration).toContain("metadata ->> 'size'");
  });

  it("enables row-level security, publishes changes and records the schema version", () => {
    expect(migration).toContain("alter table public.load_documents enable row level security");
    expect(migration).toContain("alter publication supabase_realtime add table public.load_documents");
    expect(migration).toContain("set schema_version = '20260913082708'");
  });
});
