begin;

-- Account creation must never grant operational access by itself. Provision
-- organization_members explicitly through an administrator-controlled flow.
drop trigger if exists roadstar_add_new_user on auth.users;
drop function if exists private.add_new_user_to_roadstar();

-- Business identifiers may repeat across independent organizations.
alter table public.drivers drop constraint if exists drivers_external_id_key;
alter table public.trucks drop constraint if exists trucks_truck_number_key;
alter table public.trailers drop constraint if exists trailers_trailer_number_key;
alter table public.loads drop constraint if exists loads_bill_number_key;

alter table public.drivers add constraint drivers_organization_external_id_key unique (organization_id, external_id);
alter table public.trucks add constraint trucks_organization_truck_number_key unique (organization_id, truck_number);
alter table public.trailers add constraint trailers_organization_trailer_number_key unique (organization_id, trailer_number);
alter table public.loads add constraint loads_organization_bill_number_key unique (organization_id, bill_number);

-- Composite candidate keys let child rows prove that every reference belongs
-- to the same organization as the child. Primary-key FKs remain in place.
alter table public.drivers add constraint drivers_organization_id_id_key unique (organization_id, id);
alter table public.trucks add constraint trucks_organization_id_id_key unique (organization_id, id);
alter table public.trailers add constraint trailers_organization_id_id_key unique (organization_id, id);
alter table public.loads add constraint loads_organization_id_id_key unique (organization_id, id);
alter table public.assignments add constraint assignments_organization_id_id_key unique (organization_id, id);
alter table public.loading_plans add constraint loading_plans_organization_id_id_key unique (organization_id, id);
alter table public.facilities add constraint facilities_organization_id_id_key unique (organization_id, id);

do $$
declare
  relation record;
begin
  for relation in
    select * from (values
      ('assignments', 'load_id', 'loads'),
      ('assignments', 'driver_id', 'drivers'),
      ('assignments', 'truck_id', 'trucks'),
      ('assignments', 'trailer_id', 'trailers'),
      ('loading_plans', 'trailer_id', 'trailers'),
      ('loading_plan_items', 'loading_plan_id', 'loading_plans'),
      ('loading_plan_items', 'load_id', 'loads'),
      ('telemetry_points', 'truck_id', 'trucks'),
      ('geofence_events', 'truck_id', 'trucks'),
      ('geofence_events', 'facility_id', 'facilities'),
      ('stops', 'load_id', 'loads'),
      ('stops', 'facility_id', 'facilities'),
      ('trips', 'assignment_id', 'assignments'),
      ('driver_clocks', 'driver_id', 'drivers'),
      ('detention_events', 'truck_id', 'trucks'),
      ('detention_events', 'facility_id', 'facilities'),
      ('detention_events', 'load_id', 'loads'),
      ('recommendations', 'load_id', 'loads'),
      ('recommendations', 'driver_id', 'drivers'),
      ('recommendations', 'truck_id', 'trucks'),
      ('recommendations', 'trailer_id', 'trailers')
    ) as references_to_secure(child_table, child_column, parent_table)
  loop
    execute format(
      'alter table public.%I add constraint %I foreign key (organization_id, %I) references public.%I (organization_id, id) not valid',
      relation.child_table,
      relation.child_table || '_organization_' || relation.child_column || '_fkey',
      relation.child_column,
      relation.parent_table
    );
    execute format(
      'alter table public.%I validate constraint %I',
      relation.child_table,
      relation.child_table || '_organization_' || relation.child_column || '_fkey'
    );
  end loop;
end $$;

-- Durable concurrency guards for the dispatch invariants enforced in the UI.
create unique index assignments_active_driver_unique
  on public.assignments (driver_id)
  where driver_id is not null and status <> 'completed';
create unique index assignments_active_truck_unique
  on public.assignments (truck_id)
  where truck_id is not null and status <> 'completed';
create unique index assignments_active_trailer_unique
  on public.assignments (trailer_id)
  where trailer_id is not null and status <> 'completed';
create unique index detention_open_truck_facility_unique
  on public.detention_events (truck_id, facility_id)
  where departed_at is null;

-- Viewers and drivers can read their organization. Only dispatch operators can
-- mutate the shared operational model.
do $$
declare
  table_name text;
  insert_policy text;
  update_policy text;
  delete_policy text;
begin
  foreach table_name in array array['drivers','trucks','trailers','loads','assignments','loading_plans','loading_plan_items','facilities','telemetry_points','geofence_events','stops','trips','driver_clocks','detention_events','recommendations','dispatch_snapshots']
  loop
    insert_policy := 'operators insert ' || replace(table_name, '_', ' ');
    update_policy := 'operators update ' || replace(table_name, '_', ' ');
    delete_policy := 'operators delete ' || replace(table_name, '_', ' ');

    execute format('drop policy if exists %I on public.%I', 'members insert ' || replace(table_name, '_', ' '), table_name);
    execute format('drop policy if exists %I on public.%I', 'members update ' || replace(table_name, '_', ' '), table_name);
    execute format('drop policy if exists %I on public.%I', 'members delete ' || replace(table_name, '_', ' '), table_name);
    execute format('drop policy if exists %I on public.%I', insert_policy, table_name);
    execute format('drop policy if exists %I on public.%I', update_policy, table_name);
    execute format('drop policy if exists %I on public.%I', delete_policy, table_name);

    execute format(
      'create policy %I on public.%I for insert to authenticated with check (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid()) and role in (''admin'', ''dispatcher'')))',
      insert_policy, table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid()) and role in (''admin'', ''dispatcher''))) with check (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid()) and role in (''admin'', ''dispatcher'')))',
      update_policy, table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (organization_id in (select organization_id from public.organization_members where user_id = (select auth.uid()) and role in (''admin'', ''dispatcher'')))',
      delete_policy, table_name
    );
  end loop;
end $$;

update public.system_health
set schema_version = '20260911054054', installed_at = now()
where id = true;

commit;
