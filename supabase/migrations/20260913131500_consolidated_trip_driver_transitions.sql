begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A trip can now carry more than one load: the assignment keeps its primary
-- loadId and lists consolidated freight in addedLoadIds. The driver workflow
-- has to move every load on the trip, not only the first one, or a
-- consolidated load would stay "assigned" while the truck is rolling and would
-- stay "assigned" forever after a decline.
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
  v_load_ids text[];
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

  -- Primary load first, then any consolidated freight riding with it.
  v_load_ids := array[v_assignment ->> 'loadId'] || coalesce((
    select array_agg(added #>> '{}')
    from jsonb_array_elements(coalesce(v_assignment -> 'addedLoadIds', '[]'::jsonb)) as added
  ), '{}'::text[]);
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
        case when item ->> 'id' = any(v_load_ids) then jsonb_set(item, '{status}', '"unassigned"'::jsonb) else item end
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
        case when item ->> 'id' = any(v_load_ids)
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
    jsonb_build_object(
      'assignment_id', p_assignment_id,
      'driver_id', v_driver_external_id,
      'previous_status', v_current_status,
      'load_ids', to_jsonb(v_load_ids)
    ),
    v_user_id,
    v_now
  );

  return jsonb_build_object('state', v_state, 'revision', v_revision);
end;
$$;

revoke all on function private.apply_driver_assignment_transition(text, text) from public, anon;
grant execute on function private.apply_driver_assignment_transition(text, text) to authenticated;

update public.system_health
set schema_version = '20260913131500', installed_at = now()
where id = true;

commit;
