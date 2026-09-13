begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.cargo_items
  add column if not exists max_stack_weight_lbs numeric(10,2) check (max_stack_weight_lbs >= 0),
  add column if not exists floor_bearing_psf numeric(10,2) check (floor_bearing_psf > 0),
  add column if not exists fragile boolean not null default false,
  add column if not exists priority boolean not null default false,
  add column if not exists delivery_stop integer check (delivery_stop > 0);

-- loading_plans is part of the original RoadStar schema and is referenced by
-- loading_plan_items. Upgrade it in place so existing plans and FKs survive.
alter table public.loading_plans
  add column if not exists external_id text,
  add column if not exists version integer,
  add column if not exists name text,
  add column if not exists objective text,
  add column if not exists manifest jsonb,
  add column if not exists plan jsonb,
  add column if not exists created_by uuid references auth.users(id) on delete set null;

update public.loading_plans
set external_id = coalesce(external_id, id::text),
    version = coalesce(version, 1),
    name = coalesce(name, 'Imported legacy plan ' || left(id::text, 8)),
    objective = coalesce(objective, 'unload'),
    manifest = coalesce(manifest, '[]'::jsonb),
    plan = coalesce(plan, jsonb_build_object(
      'items', '[]'::jsonb,
      'unplanned', '[]'::jsonb,
      'totalWeight', total_weight_lbs,
      'usedFloorArea', 0,
      'warnings', warnings,
      'engine', solver
    ));

alter table public.loading_plans
  alter column trailer_id drop not null,
  alter column solver set default 'roadstar-web',
  alter column external_id set not null,
  alter column version set not null,
  alter column name set not null,
  alter column objective set not null,
  alter column manifest set not null,
  alter column plan set not null,
  add constraint loading_plans_version_check check (version > 0),
  add constraint loading_plans_objective_check check (objective in ('space','balance','unload','damage')),
  add constraint loading_plans_manifest_check check (jsonb_typeof(manifest) = 'array'),
  add constraint loading_plans_plan_check check (jsonb_typeof(plan) = 'object'),
  add constraint loading_plans_external_version_key unique (organization_id, external_id, version);

create table public.external_record_links (
  id uuid primary key default gen_random_uuid(),
  organization_id bigint not null references public.organizations(id) on delete cascade,
  provider text not null,
  entity_type text not null check (entity_type in ('load','customer','stop','driver','truck','trailer','assignment')),
  external_id text not null,
  internal_id text not null,
  external_updated_at timestamptz,
  synchronized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, provider, entity_type, external_id),
  unique (organization_id, provider, entity_type, internal_id)
);

create table public.integration_sync_events (
  id uuid primary key default gen_random_uuid(),
  organization_id bigint not null references public.organizations(id) on delete cascade,
  provider text not null,
  direction text not null check (direction in ('inbound','outbound')),
  entity_type text not null,
  external_id text,
  status text not null check (status in ('received','applied','ignored','conflict','failed','sent')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  summary text not null,
  error_code text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now()
);

create table public.integration_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id bigint not null references public.organizations(id) on delete cascade,
  provider text not null,
  event_type text not null,
  idempotency_key text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','dead_letter')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, idempotency_key)
);

create index loading_plans_org_created_idx on public.loading_plans (organization_id, created_at desc);
create index external_record_links_internal_idx on public.external_record_links (organization_id, entity_type, internal_id);
create index integration_sync_events_org_occurred_idx on public.integration_sync_events (organization_id, occurred_at desc);
create index integration_sync_events_failures_idx on public.integration_sync_events (organization_id, provider, occurred_at desc) where status in ('conflict','failed');
create index integration_outbox_pending_idx on public.integration_outbox (next_attempt_at, created_at) where status in ('pending','failed');
create index integration_outbox_org_idx on public.integration_outbox (organization_id, created_at desc);

alter table public.external_record_links enable row level security;
alter table public.integration_sync_events enable row level security;
alter table public.integration_outbox enable row level security;

-- Existing loading_plans RLS policies from the P0 migrations continue to apply.
create policy "members select external record links" on public.external_record_links for select to authenticated
  using (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid())));
create policy "operators insert external record links" on public.external_record_links for insert to authenticated
  with check (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid()) and role in ('admin','dispatcher')));
create policy "operators update external record links" on public.external_record_links for update to authenticated
  using (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid()) and role in ('admin','dispatcher')))
  with check (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid()) and role in ('admin','dispatcher')));
create policy "operators delete external record links" on public.external_record_links for delete to authenticated
  using (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid()) and role in ('admin','dispatcher')));
create policy "members select integration sync events" on public.integration_sync_events for select to authenticated
  using (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid())));
create policy "operators insert integration sync events" on public.integration_sync_events for insert to authenticated
  with check (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid()) and role in ('admin','dispatcher')));

revoke all on public.loading_plans, public.external_record_links, public.integration_sync_events, public.integration_outbox from anon, authenticated;
grant select, insert, update, delete on public.loading_plans, public.external_record_links to authenticated;
grant select, insert on public.integration_sync_events to authenticated;

create or replace function public.save_loading_plan(
  p_organization_id bigint,
  p_external_id text,
  p_name text,
  p_objective text,
  p_manifest jsonb,
  p_plan jsonb
) returns table (plan_id uuid, plan_version integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_version integer;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = (select auth.uid())
      and member.role in ('admin','dispatcher')
  ) then
    raise exception using errcode = '42501', message = 'Only organization dispatchers and administrators can save loading plans.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_external_id, 0));
  select coalesce(max(existing.version), 0) + 1 into next_version
  from public.loading_plans existing
  where existing.organization_id = p_organization_id and existing.external_id = p_external_id;

  return query
  insert into public.loading_plans (organization_id, external_id, version, name, objective, manifest, plan, created_by)
  values (p_organization_id, p_external_id, next_version, p_name, p_objective, p_manifest, p_plan, (select auth.uid()))
  returning loading_plans.id, loading_plans.version;
end;
$$;

revoke all on function public.save_loading_plan(bigint, text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.save_loading_plan(bigint, text, text, text, jsonb, jsonb) to authenticated;

create or replace function public.approve_loading_plan(p_plan_id uuid) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_organization_id bigint;
  target_external_id text;
begin
  select plan.organization_id, plan.external_id into target_organization_id, target_external_id
  from public.loading_plans plan where plan.id = p_plan_id for update;
  if target_organization_id is null or not exists (
    select 1 from public.organization_members member
    where member.organization_id = target_organization_id
      and member.user_id = (select auth.uid())
      and member.role in ('admin','dispatcher')
  ) then
    raise exception using errcode = '42501', message = 'Only organization dispatchers and administrators can approve loading plans.';
  end if;

  update public.loading_plans set status = 'superseded'
  where organization_id = target_organization_id and external_id = target_external_id and status = 'approved' and id <> p_plan_id;
  update public.loading_plans set status = 'approved' where id = p_plan_id;
  return true;
end;
$$;

revoke all on function public.approve_loading_plan(uuid) from public, anon;
grant execute on function public.approve_loading_plan(uuid) to authenticated;

update public.system_health set schema_version = '20260913090218', installed_at = now() where id = true;

commit;
