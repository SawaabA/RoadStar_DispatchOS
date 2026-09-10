begin;

create table if not exists public.system_health (
  id boolean primary key default true check (id),
  schema_version text not null,
  installed_at timestamptz not null default now()
);

insert into public.system_health (id, schema_version)
values (true, '20260910073204')
on conflict (id) do update set schema_version = excluded.schema_version;

create table if not exists public.organizations (
  id bigint generated always as identity primary key,
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id bigint not null references public.organizations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'dispatcher' check (role in ('admin', 'dispatcher', 'driver', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

insert into public.organizations (name, slug)
values ('RoadStar', 'roadstar')
on conflict (slug) do nothing;

alter table public.drivers add column if not exists organization_id bigint;
alter table public.trucks add column if not exists organization_id bigint;
alter table public.trailers add column if not exists organization_id bigint;
alter table public.loads add column if not exists organization_id bigint;
alter table public.assignments add column if not exists organization_id bigint;
alter table public.loading_plans add column if not exists organization_id bigint;
alter table public.loading_plan_items add column if not exists organization_id bigint;
alter table public.facilities add column if not exists organization_id bigint;
alter table public.telemetry_points add column if not exists organization_id bigint;
alter table public.geofence_events add column if not exists organization_id bigint;

update public.drivers set organization_id = (select id from public.organizations where slug = 'roadstar') where organization_id is null;
update public.trucks set organization_id = (select id from public.organizations where slug = 'roadstar') where organization_id is null;
update public.trailers set organization_id = (select id from public.organizations where slug = 'roadstar') where organization_id is null;
update public.loads set organization_id = (select id from public.organizations where slug = 'roadstar') where organization_id is null;
update public.assignments set organization_id = (select id from public.organizations where slug = 'roadstar') where organization_id is null;
update public.loading_plans set organization_id = (select id from public.organizations where slug = 'roadstar') where organization_id is null;
update public.loading_plan_items set organization_id = (select id from public.organizations where slug = 'roadstar') where organization_id is null;
update public.facilities set organization_id = (select id from public.organizations where slug = 'roadstar') where organization_id is null;
update public.telemetry_points set organization_id = (select id from public.organizations where slug = 'roadstar') where organization_id is null;
update public.geofence_events set organization_id = (select id from public.organizations where slug = 'roadstar') where organization_id is null;

alter table public.drivers alter column organization_id set not null;
alter table public.trucks alter column organization_id set not null;
alter table public.trailers alter column organization_id set not null;
alter table public.loads alter column organization_id set not null;
alter table public.assignments alter column organization_id set not null;
alter table public.loading_plans alter column organization_id set not null;
alter table public.loading_plan_items alter column organization_id set not null;
alter table public.facilities alter column organization_id set not null;
alter table public.telemetry_points alter column organization_id set not null;
alter table public.geofence_events alter column organization_id set not null;

do $$
declare table_name text;
begin
  foreach table_name in array array['drivers','trucks','trailers','loads','assignments','loading_plans','loading_plan_items','facilities','telemetry_points','geofence_events']
  loop
    if not exists (
      select 1 from pg_constraint
      where conname = table_name || '_organization_id_fkey'
        and conrelid = ('public.' || table_name)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (organization_id) references public.organizations(id) on delete cascade',
        table_name, table_name || '_organization_id_fkey'
      );
    end if;
  end loop;
end $$;

create index if not exists organization_members_user_idx on public.organization_members (user_id);
create index if not exists drivers_organization_idx on public.drivers (organization_id);
create index if not exists trucks_organization_idx on public.trucks (organization_id);
create index if not exists trailers_organization_idx on public.trailers (organization_id);
create index if not exists loads_organization_idx on public.loads (organization_id);
create index if not exists assignments_organization_idx on public.assignments (organization_id);
create index if not exists assignments_driver_idx on public.assignments (driver_id);
create index if not exists assignments_truck_idx on public.assignments (truck_id);
create index if not exists assignments_trailer_idx on public.assignments (trailer_id);
create index if not exists loading_plans_organization_idx on public.loading_plans (organization_id);
create index if not exists loading_plans_trailer_idx on public.loading_plans (trailer_id);
create index if not exists loading_plan_items_organization_idx on public.loading_plan_items (organization_id);
create index if not exists loading_plan_items_plan_idx on public.loading_plan_items (loading_plan_id);
create index if not exists loading_plan_items_load_idx on public.loading_plan_items (load_id);
create index if not exists facilities_organization_idx on public.facilities (organization_id);
create index if not exists telemetry_organization_idx on public.telemetry_points (organization_id);
create index if not exists geofence_organization_idx on public.geofence_events (organization_id);
create index if not exists geofence_facility_idx on public.geofence_events (facility_id);

alter table public.system_health enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

drop policy if exists "authenticated users can read drivers" on public.drivers;
drop policy if exists "authenticated users can read trucks" on public.trucks;
drop policy if exists "authenticated users can read trailers" on public.trailers;
drop policy if exists "authenticated users can read loads" on public.loads;
drop policy if exists "authenticated users can read assignments" on public.assignments;
drop policy if exists "authenticated users can read loading plans" on public.loading_plans;
drop policy if exists "authenticated users can read loading plan items" on public.loading_plan_items;
drop policy if exists "authenticated users can read facilities" on public.facilities;
drop policy if exists "authenticated users can read telemetry" on public.telemetry_points;
drop policy if exists "authenticated users can read geofence events" on public.geofence_events;

drop policy if exists "public can read system health" on public.system_health;
create policy "public can read system health" on public.system_health for select to anon, authenticated using (true);

drop policy if exists "members can read their membership" on public.organization_members;
create policy "members can read their membership" on public.organization_members
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "members can read their organizations" on public.organizations;
create policy "members can read their organizations" on public.organizations for select to authenticated using (
  id in (select organization_id from public.organization_members where user_id = (select auth.uid()))
);

do $$
declare table_name text;
begin
  foreach table_name in array array['drivers','trucks','trailers','loads','assignments','loading_plans','loading_plan_items','facilities','telemetry_points','geofence_events']
  loop
    execute format('drop policy if exists %I on public.%I', 'members can read ' || replace(table_name, '_', ' '), table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid())))',
      'members can read ' || replace(table_name, '_', ' '), table_name
    );
  end loop;
end $$;

grant usage on schema public to anon, authenticated;
grant select on public.system_health to anon, authenticated;
grant select on public.organizations, public.organization_members, public.drivers, public.trucks,
  public.trailers, public.loads, public.assignments, public.loading_plans,
  public.loading_plan_items, public.facilities, public.telemetry_points,
  public.geofence_events to authenticated;

commit;
