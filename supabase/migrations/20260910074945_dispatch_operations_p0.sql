begin;

alter table public.loads add column if not exists customer text;
alter table public.loads add column if not exists origin_location extensions.geography(point, 4326);
alter table public.loads add column if not exists destination_location extensions.geography(point, 4326);
alter table public.loads add column if not exists rate_cad numeric(10,2) check (rate_cad >= 0);
alter table public.loads add column if not exists priority text not null default 'standard' check (priority in ('standard','high','critical'));

alter table public.drivers add column if not exists on_duty_hours_remaining numeric(6,2);
alter table public.drivers add column if not exists cycle_hours_remaining numeric(6,2);
alter table public.drivers add column if not exists next_available_at timestamptz;

alter table public.assignments add column if not exists status text not null default 'dispatched' check (status in ('proposed','dispatched','accepted','in_transit','completed'));
alter table public.assignments add column if not exists progress numeric(5,4) not null default 0 check (progress between 0 and 1);
alter table public.assignments add column if not exists eta timestamptz;

create table if not exists public.stops (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.organizations on delete cascade,
  load_id bigint not null references public.loads on delete cascade,
  facility_id bigint references public.facilities,
  sequence integer not null check (sequence > 0),
  stop_type text not null check (stop_type in ('pickup','delivery')),
  appointment_start timestamptz,
  appointment_end timestamptz,
  status text not null default 'planned' check (status in ('planned','arrived','working','departed','completed')),
  arrived_at timestamptz,
  departed_at timestamptz,
  unique (load_id, sequence)
);

create table if not exists public.trips (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.organizations on delete cascade,
  assignment_id bigint not null unique references public.assignments on delete cascade,
  status text not null default 'planned' check (status in ('planned','en_route_pickup','at_pickup','en_route_delivery','at_delivery','completed','cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  planned_distance_km numeric(10,2) check (planned_distance_km >= 0),
  actual_distance_km numeric(10,2) not null default 0 check (actual_distance_km >= 0),
  route_geometry jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.driver_clocks (
  driver_id bigint primary key references public.drivers on delete cascade,
  organization_id bigint not null references public.organizations on delete cascade,
  driving_minutes_remaining integer not null check (driving_minutes_remaining between 0 and 780),
  on_duty_minutes_remaining integer not null check (on_duty_minutes_remaining between 0 and 840),
  elapsed_minutes_remaining integer not null check (elapsed_minutes_remaining between 0 and 960),
  cycle_minutes_remaining integer not null check (cycle_minutes_remaining >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.detention_events (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.organizations on delete cascade,
  truck_id bigint not null references public.trucks,
  facility_id bigint not null references public.facilities,
  load_id bigint references public.loads,
  arrived_at timestamptz not null,
  departed_at timestamptz,
  free_minutes integer not null default 120 check (free_minutes >= 0),
  rate_cad_per_hour numeric(10,2) not null default 0 check (rate_cad_per_hour >= 0),
  billable_minutes integer not null default 0 check (billable_minutes >= 0),
  estimated_charge_cad numeric(10,2) not null default 0 check (estimated_charge_cad >= 0),
  created_at timestamptz not null default now(),
  check (departed_at is null or departed_at >= arrived_at)
);

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id bigint not null references public.organizations on delete cascade,
  load_id bigint not null references public.loads on delete cascade,
  driver_id bigint references public.drivers,
  truck_id bigint references public.trucks,
  trailer_id bigint references public.trailers,
  status text not null default 'recommended' check (status in ('recommended','accepted','rejected','superseded','infeasible')),
  score numeric(6,2),
  feasible boolean not null,
  deadhead_km numeric(10,2),
  projected_hos_margin_minutes integer,
  reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.dispatch_snapshots (
  organization_id bigint primary key references public.organizations on delete cascade,
  state jsonb not null,
  updated_by uuid references auth.users,
  updated_at timestamptz not null default now()
);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.add_new_user_to_roadstar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organization_members (organization_id, user_id, role)
  select id, new.id, 'dispatcher'
  from public.organizations
  where slug = 'roadstar'
  on conflict (organization_id, user_id) do nothing;
  return new;
end;
$$;

revoke all on function private.add_new_user_to_roadstar() from public, anon, authenticated;
insert into public.organization_members (organization_id, user_id, role)
select organization.id, account.id, 'dispatcher'
from public.organizations organization
cross join auth.users account
where organization.slug = 'roadstar'
on conflict (organization_id, user_id) do nothing;
drop trigger if exists roadstar_add_new_user on auth.users;
create trigger roadstar_add_new_user
  after insert on auth.users
  for each row execute function private.add_new_user_to_roadstar();

create index if not exists loads_origin_location_gix on public.loads using gist (origin_location);
create index if not exists loads_destination_location_gix on public.loads using gist (destination_location);
create index if not exists stops_organization_idx on public.stops (organization_id);
create index if not exists stops_load_idx on public.stops (load_id);
create index if not exists stops_facility_idx on public.stops (facility_id);
create index if not exists trips_organization_idx on public.trips (organization_id);
create index if not exists driver_clocks_organization_idx on public.driver_clocks (organization_id);
create index if not exists detention_organization_idx on public.detention_events (organization_id);
create index if not exists detention_truck_arrival_idx on public.detention_events (truck_id, arrived_at desc);
create index if not exists detention_facility_idx on public.detention_events (facility_id);
create index if not exists detention_load_idx on public.detention_events (load_id);
create index if not exists recommendations_organization_idx on public.recommendations (organization_id);
create index if not exists recommendations_load_idx on public.recommendations (load_id, created_at desc);
create index if not exists recommendations_driver_idx on public.recommendations (driver_id);
create index if not exists recommendations_truck_idx on public.recommendations (truck_id);
create index if not exists recommendations_trailer_idx on public.recommendations (trailer_id);

alter table public.stops enable row level security;
alter table public.trips enable row level security;
alter table public.driver_clocks enable row level security;
alter table public.detention_events enable row level security;
alter table public.recommendations enable row level security;
alter table public.dispatch_snapshots enable row level security;

do $$
declare
  table_name text;
  select_policy text;
  insert_policy text;
  update_policy text;
  delete_policy text;
begin
  foreach table_name in array array['drivers','trucks','trailers','loads','assignments','loading_plans','loading_plan_items','facilities','telemetry_points','geofence_events','stops','trips','driver_clocks','detention_events','recommendations','dispatch_snapshots']
  loop
    select_policy := 'members select ' || replace(table_name, '_', ' ');
    insert_policy := 'members insert ' || replace(table_name, '_', ' ');
    update_policy := 'members update ' || replace(table_name, '_', ' ');
    delete_policy := 'members delete ' || replace(table_name, '_', ' ');
    execute format('drop policy if exists %I on public.%I', 'members manage ' || replace(table_name, '_', ' '), table_name);
    execute format('drop policy if exists %I on public.%I', 'members can read ' || replace(table_name, '_', ' '), table_name);
    execute format('drop policy if exists %I on public.%I', select_policy, table_name);
    execute format('drop policy if exists %I on public.%I', insert_policy, table_name);
    execute format('drop policy if exists %I on public.%I', update_policy, table_name);
    execute format('drop policy if exists %I on public.%I', delete_policy, table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid())))',
      select_policy, table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid())))',
      insert_policy, table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid()))) with check (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid())))',
      update_policy, table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid())))',
      delete_policy, table_name
    );
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
  end loop;
end $$;

grant select, insert, update, delete on public.drivers, public.trucks, public.trailers, public.loads,
  public.assignments, public.loading_plans, public.loading_plan_items, public.facilities,
  public.telemetry_points, public.geofence_events, public.stops, public.trips,
  public.driver_clocks, public.detention_events, public.recommendations, public.dispatch_snapshots to authenticated;
grant usage, select on all sequences in schema public to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['assignments','trips','telemetry_points','geofence_events','detention_events','dispatch_snapshots']
  loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=table_name) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;

update public.system_health set schema_version='20260910074945', installed_at=now() where id=true;

commit;
