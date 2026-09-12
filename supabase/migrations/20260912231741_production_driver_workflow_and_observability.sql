begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Authentication is not authorization. A driver account must be explicitly
-- linked to exactly one RoadStar driver inside its organization before it can
-- change an assignment.
create table public.driver_user_links (
  organization_id bigint not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  driver_external_id text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  unique (organization_id, driver_external_id),
  foreign key (organization_id, driver_external_id)
    references public.drivers (organization_id, external_id) on delete cascade
);

create index driver_user_links_user_idx on public.driver_user_links (user_id);
create index driver_user_links_created_by_idx on public.driver_user_links (created_by) where created_by is not null;

alter table public.driver_user_links enable row level security;

create policy "members read permitted driver links"
on public.driver_user_links for select to authenticated
using (
  user_id = (select auth.uid())
  or organization_id in (
    select organization_id
    from public.organization_members
    where user_id = (select auth.uid()) and role in ('admin', 'dispatcher')
  )
);

create policy "admins insert driver links"
on public.driver_user_links for insert to authenticated
with check (
  organization_id in (
    select organization_id
    from public.organization_members
    where user_id = (select auth.uid()) and role = 'admin'
  )
);

create policy "admins update driver links"
on public.driver_user_links for update to authenticated
using (
  organization_id in (
    select organization_id
    from public.organization_members
    where user_id = (select auth.uid()) and role = 'admin'
  )
)
with check (
  organization_id in (
    select organization_id
    from public.organization_members
    where user_id = (select auth.uid()) and role = 'admin'
  )
);

create policy "admins delete driver links"
on public.driver_user_links for delete to authenticated
using (
  organization_id in (
    select organization_id
    from public.organization_members
    where user_id = (select auth.uid()) and role = 'admin'
  )
);

revoke all on public.driver_user_links from anon, authenticated;
grant select, insert, update, delete on public.driver_user_links to authenticated;

alter table public.decision_records drop constraint if exists decision_records_kind_check;
alter table public.decision_records add constraint decision_records_kind_check
  check (kind in ('plan', 'replan', 'exception', 'backhaul', 'driver'));
alter table public.decision_records drop constraint if exists decision_records_outcome_check;
alter table public.decision_records add constraint decision_records_outcome_check
  check (outcome in ('accepted', 'rejected', 'acknowledged', 'started', 'declined'));

-- This privileged implementation stays in the unexposed private schema. It
-- bypasses snapshot RLS only after checking auth.uid(), membership role, the
-- explicit driver link, ownership of the assignment, and the transition.
create or replace function private.apply_driver_assignment_transition(
  p_assignment_id text,
  p_action text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_organization_id bigint;
  v_driver_external_id text;
  v_state jsonb;
  v_assignment jsonb;
  v_load_id text;
  v_truck_id text;
  v_trailer_id text;
  v_current_status text;
  v_revision bigint;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  select link.organization_id, link.driver_external_id
  into v_organization_id, v_driver_external_id
  from public.driver_user_links as link
  join public.organization_members as member
    on member.organization_id = link.organization_id
   and member.user_id = link.user_id
   and member.role = 'driver'
  where link.user_id = v_user_id;

  if v_organization_id is null then
    raise exception using errcode = '42501', message = 'No active RoadStar driver profile is linked to this account.';
  end if;

  if p_action not in ('accepted', 'in_transit', 'declined') then
    raise exception using errcode = '22023', message = 'Unsupported driver assignment action.';
  end if;

  select snapshot.state, snapshot.revision
  into v_state, v_revision
  from public.dispatch_snapshots as snapshot
  where snapshot.organization_id = v_organization_id
  for update;

  if v_state is null then
    raise exception using errcode = 'P0002', message = 'RoadStar workspace is not initialized.';
  end if;

  select item
  into v_assignment
  from jsonb_array_elements(coalesce(v_state -> 'assignments', '[]'::jsonb)) as item
  where item ->> 'id' = p_assignment_id
    and item ->> 'driverId' = v_driver_external_id;

  if v_assignment is null then
    raise exception using errcode = '42501', message = 'Assignment is not available to this driver.';
  end if;

  v_current_status := v_assignment ->> 'status';
  if (p_action = 'accepted' and v_current_status not in ('proposed', 'dispatched'))
     or (p_action = 'in_transit' and v_current_status <> 'accepted')
     or (p_action = 'declined' and v_current_status not in ('proposed', 'dispatched')) then
    raise exception using errcode = '23514', message = 'Assignment action is not valid from its current status.';
  end if;

  v_load_id := v_assignment ->> 'loadId';
  v_truck_id := v_assignment ->> 'truckId';
  v_trailer_id := v_assignment ->> 'trailerId';

  if p_action = 'declined' then
    v_state := jsonb_set(
      v_state,
      '{assignments}',
      coalesce((
        select jsonb_agg(item order by ordinal)
        from jsonb_array_elements(v_state -> 'assignments') with ordinality as entry(item, ordinal)
        where item ->> 'id' <> p_assignment_id
      ), '[]'::jsonb)
    );
    v_state := jsonb_set(v_state, '{loads}', (
      select jsonb_agg(
        case when item ->> 'id' = v_load_id then jsonb_set(item, '{status}', '"unassigned"'::jsonb) else item end
        order by ordinal
      )
      from jsonb_array_elements(v_state -> 'loads') with ordinality as entry(item, ordinal)
    ));
    v_state := jsonb_set(v_state, '{drivers}', (
      select jsonb_agg(
        case when item ->> 'id' = v_driver_external_id then jsonb_set(item, '{status}', '"available"'::jsonb) else item end
        order by ordinal
      )
      from jsonb_array_elements(v_state -> 'drivers') with ordinality as entry(item, ordinal)
    ));
    v_state := jsonb_set(v_state, '{trucks}', (
      select jsonb_agg(
        case when item ->> 'id' = v_truck_id then jsonb_set(item, '{status}', '"available"'::jsonb) else item end
        order by ordinal
      )
      from jsonb_array_elements(v_state -> 'trucks') with ordinality as entry(item, ordinal)
    ));
    v_state := jsonb_set(v_state, '{trailers}', (
      select jsonb_agg(
        case when item ->> 'id' = v_trailer_id then jsonb_set(item, '{status}', '"available"'::jsonb) else item end
        order by ordinal
      )
      from jsonb_array_elements(v_state -> 'trailers') with ordinality as entry(item, ordinal)
    ));
  else
    v_state := jsonb_set(v_state, '{assignments}', (
      select jsonb_agg(
        case when item ->> 'id' = p_assignment_id then
          case when p_action = 'accepted'
            then jsonb_set(jsonb_set(item, '{status}', to_jsonb(p_action)), '{acceptedAt}', to_jsonb(v_now::text), true)
            else jsonb_set(item, '{status}', to_jsonb(p_action))
          end
        else item end
        order by ordinal
      )
      from jsonb_array_elements(v_state -> 'assignments') with ordinality as entry(item, ordinal)
    ));
    v_state := jsonb_set(v_state, '{loads}', (
      select jsonb_agg(
        case when item ->> 'id' = v_load_id
          then jsonb_set(item, '{status}', to_jsonb(case when p_action = 'in_transit' then 'in_transit' else 'assigned' end))
          else item end
        order by ordinal
      )
      from jsonb_array_elements(v_state -> 'loads') with ordinality as entry(item, ordinal)
    ));
  end if;

  update public.dispatch_snapshots
  set state = v_state,
      revision = revision + 1,
      updated_by = v_user_id,
      updated_at = v_now
  where organization_id = v_organization_id
  returning revision into v_revision;

  insert into public.decision_records (
    organization_id, external_id, kind, outcome, summary, context, decided_by, created_at
  ) values (
    v_organization_id,
    'driver:' || p_assignment_id || ':' || v_revision::text,
    'driver',
    case p_action when 'in_transit' then 'started' else p_action end,
    case p_action
      when 'accepted' then 'Driver accepted assignment ' || p_assignment_id
      when 'in_transit' then 'Driver started assignment ' || p_assignment_id
      else 'Driver declined assignment ' || p_assignment_id
    end,
    jsonb_build_object('assignment_id', p_assignment_id, 'driver_id', v_driver_external_id, 'previous_status', v_current_status),
    v_user_id,
    v_now
  );

  return jsonb_build_object('state', v_state, 'revision', v_revision);
end;
$$;

revoke all on function private.apply_driver_assignment_transition(text, text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.apply_driver_assignment_transition(text, text) to authenticated;

create or replace function public.transition_driver_assignment(
  p_assignment_id text,
  p_action text
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.apply_driver_assignment_transition(p_assignment_id, p_action);
$$;

revoke all on function public.transition_driver_assignment(text, text) from public, anon;
grant execute on function public.transition_driver_assignment(text, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'driver_user_links'
  ) then
    alter publication supabase_realtime add table public.driver_user_links;
  end if;
end $$;

update public.system_health
set schema_version = '20260912231741', installed_at = now()
where id = true;

commit;
