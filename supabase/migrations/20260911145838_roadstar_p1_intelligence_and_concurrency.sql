begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.dispatch_snapshots
  add column if not exists revision bigint not null default 0 check (revision >= 0);

create table public.road_incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id bigint not null references public.organizations(id) on delete cascade,
  provider text not null,
  external_id text not null,
  roadway text not null,
  direction text,
  description text not null,
  event_type text not null,
  severity text not null check (severity in ('low','medium','high','critical')),
  location extensions.geography(point, 4326) not null,
  full_closure boolean not null default false,
  reported_at timestamptz,
  provider_updated_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_payload) = 'object'),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, external_id)
);

create table public.optimization_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id bigint not null references public.organizations(id) on delete cascade,
  trigger_type text not null check (trigger_type in ('morning_plan','traffic','manual','historical_replay')),
  status text not null default 'proposed' check (status in ('running','proposed','approved','rejected','failed','superseded')),
  weights jsonb not null default '{}'::jsonb check (jsonb_typeof(weights) = 'object'),
  baseline_metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(baseline_metrics) = 'object'),
  proposed_metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(proposed_metrics) = 'object'),
  explanation text,
  created_by uuid references auth.users(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.decision_records (
  id uuid primary key default gen_random_uuid(),
  organization_id bigint not null references public.organizations(id) on delete cascade,
  external_id text not null,
  optimization_run_id uuid references public.optimization_runs(id) on delete set null,
  kind text not null check (kind in ('plan','replan','exception','backhaul')),
  outcome text not null check (outcome in ('accepted','rejected','acknowledged')),
  summary text not null,
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  decided_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, external_id)
);

create table public.historical_replay_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id bigint not null references public.organizations(id) on delete cascade,
  source_name text not null,
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  baseline_metrics jsonb not null check (jsonb_typeof(baseline_metrics) = 'object'),
  scenario_metrics jsonb not null check (jsonb_typeof(scenario_metrics) = 'object'),
  assumptions text[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id bigint not null references public.organizations(id) on delete cascade,
  category text not null,
  provider text not null,
  status text not null default 'available' check (status in ('connected','degraded','available','disabled')),
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  last_health_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, category, provider)
);

create table public.cargo_items (
  id uuid primary key default gen_random_uuid(),
  organization_id bigint not null references public.organizations(id) on delete cascade,
  load_id bigint references public.loads(id) on delete cascade,
  external_id text not null,
  cargo_kind text not null check (cargo_kind in ('pallet','irregular')),
  label text not null,
  quantity integer not null check (quantity > 0),
  length_in numeric(8,2) not null check (length_in > 0),
  width_in numeric(8,2) not null check (width_in > 0),
  height_in numeric(8,2) not null check (height_in > 0),
  weight_lbs numeric(10,2) not null check (weight_lbs > 0),
  clearance_in numeric(6,2) not null default 0 check (clearance_in >= 0),
  rotatable boolean not null default true,
  stackable boolean not null default false,
  estimated boolean not null default false,
  pallet_equivalents integer check (pallet_equivalents > 0),
  created_at timestamptz not null default now(),
  unique (organization_id, external_id)
);

-- Tenant-safe composite reference for optional normalized cargo-to-load links.
alter table public.cargo_items add constraint cargo_items_organization_load_fkey
  foreign key (organization_id, load_id)
  references public.loads (organization_id, id);

create index road_incidents_org_active_idx on public.road_incidents (organization_id, updated_at desc)
  where expires_at is null;
create index road_incidents_location_gix on public.road_incidents using gist (location);
create index optimization_runs_org_created_idx on public.optimization_runs (organization_id, created_at desc);
create index optimization_runs_created_by_idx on public.optimization_runs (created_by) where created_by is not null;
create index optimization_runs_decided_by_idx on public.optimization_runs (decided_by) where decided_by is not null;
create index decision_records_org_created_idx on public.decision_records (organization_id, created_at desc);
create index decision_records_run_idx on public.decision_records (optimization_run_id) where optimization_run_id is not null;
create index decision_records_decided_by_idx on public.decision_records (decided_by) where decided_by is not null;
create index historical_replay_org_created_idx on public.historical_replay_runs (organization_id, created_at desc);
create index historical_replay_created_by_idx on public.historical_replay_runs (created_by) where created_by is not null;
create index provider_connections_org_status_idx on public.provider_connections (organization_id, status);
create index cargo_items_org_load_idx on public.cargo_items (organization_id, load_id) where load_id is not null;

alter table public.road_incidents enable row level security;
alter table public.optimization_runs enable row level security;
alter table public.decision_records enable row level security;
alter table public.historical_replay_runs enable row level security;
alter table public.provider_connections enable row level security;
alter table public.cargo_items enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['road_incidents','optimization_runs','decision_records','historical_replay_runs','provider_connections','cargo_items']
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid())))',
      'members select ' || replace(table_name, '_', ' '), table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid()) and role in (''admin'',''dispatcher'')))',
      'operators insert ' || replace(table_name, '_', ' '), table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid()) and role in (''admin'',''dispatcher''))) with check (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid()) and role in (''admin'',''dispatcher'')))',
      'operators update ' || replace(table_name, '_', ' '), table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid()) and role in (''admin'',''dispatcher'')))',
      'operators delete ' || replace(table_name, '_', ' '), table_name
    );
  end loop;
end $$;

revoke all on public.road_incidents, public.optimization_runs, public.decision_records,
  public.historical_replay_runs, public.provider_connections, public.cargo_items from anon, authenticated;
grant select, insert, update, delete on public.road_incidents, public.optimization_runs,
  public.decision_records, public.historical_replay_runs, public.provider_connections,
  public.cargo_items to authenticated;

create or replace function public.save_dispatch_snapshot(
  p_organization_id bigint,
  p_state jsonb,
  p_expected_revision bigint
) returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare next_revision bigint;
begin
  update public.dispatch_snapshots
  set state = p_state,
      revision = revision + 1,
      updated_by = (select auth.uid()),
      updated_at = now()
  where organization_id = p_organization_id
    and revision = p_expected_revision
  returning revision into next_revision;

  if next_revision is null then
    raise exception using
      errcode = '40001',
      message = 'RoadStar workspace changed in another session. Reload before saving.';
  end if;
  return next_revision;
end;
$$;

revoke all on function public.save_dispatch_snapshot(bigint, jsonb, bigint) from public, anon;
grant execute on function public.save_dispatch_snapshot(bigint, jsonb, bigint) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'decision_records'
  ) then
    alter publication supabase_realtime add table public.decision_records;
  end if;
end $$;

update public.system_health set schema_version = '20260911145838', installed_at = now() where id = true;

commit;

