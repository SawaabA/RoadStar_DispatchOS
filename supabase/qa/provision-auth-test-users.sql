-- QA fixture only. Run manually in the Supabase SQL Editor after creating the
-- five confirmed Auth users. This file intentionally contains no passwords.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  missing_emails text;
begin
  select string_agg(expected.email, ', ' order by expected.email)
  into missing_emails
  from (
    values
      ('dispatcher-a@roadstar.test'),
      ('dispatcher-a2@roadstar.test'),
      ('driver-a@roadstar.test'),
      ('viewer-a@roadstar.test'),
      ('dispatcher-b@roadstar.test')
  ) as expected(email)
  where not exists (
    select 1 from auth.users account where lower(account.email) = expected.email
  );

  if missing_emails is not null then
    raise exception 'Create these confirmed Auth users first: %', missing_emails;
  end if;
end $$;

insert into public.organizations (name, slug)
values ('RoadStar QA Organization B', 'roadstar-qa-b')
on conflict (slug) do update set name = excluded.name;

insert into public.organization_members (organization_id, user_id, role)
select organization.id, account.id, fixture.role
from public.organizations organization
cross join (
  values
    ('dispatcher-a@roadstar.test', 'dispatcher'),
    ('dispatcher-a2@roadstar.test', 'dispatcher'),
    ('driver-a@roadstar.test', 'driver'),
    ('viewer-a@roadstar.test', 'viewer')
) as fixture(email, role)
join auth.users account on lower(account.email) = fixture.email
where organization.slug = 'roadstar'
on conflict (organization_id, user_id) do update set role = excluded.role;

insert into public.organization_members (organization_id, user_id, role)
select organization.id, account.id, 'dispatcher'
from public.organizations organization
join auth.users account on lower(account.email) = 'dispatcher-b@roadstar.test'
where organization.slug = 'roadstar-qa-b'
on conflict (organization_id, user_id) do update set role = excluded.role;

-- The app's current cloud source of truth is the JSON snapshot. Materialize the
-- linked QA driver in the normalized table because driver_user_links correctly
-- has a tenant-safe foreign key to public.drivers.
insert into public.drivers (
  organization_id,
  external_id,
  name,
  status,
  duty_status,
  remaining_hours,
  on_duty_hours_remaining,
  cycle_hours_remaining,
  current_location
)
select
  organization.id,
  driver.value ->> 'id',
  driver.value ->> 'name',
  (driver.value ->> 'status')::public.asset_status,
  (driver.value ->> 'dutyStatus')::public.duty_status,
  (driver.value ->> 'drivingHoursRemaining')::numeric,
  (driver.value ->> 'onDutyHoursRemaining')::numeric,
  (driver.value ->> 'cycleHoursRemaining')::numeric,
  extensions.st_setsrid(
    extensions.st_makepoint(
      (driver.value #>> '{point,lng}')::double precision,
      (driver.value #>> '{point,lat}')::double precision
    ),
    4326
  )::extensions.geography
from public.organizations organization
join public.dispatch_snapshots snapshot on snapshot.organization_id = organization.id
cross join lateral jsonb_array_elements(snapshot.state -> 'drivers') as driver(value)
where organization.slug = 'roadstar'
  and driver.value ->> 'id' = 'D-131'
on conflict (organization_id, external_id) do update
set name = excluded.name,
    status = excluded.status,
    duty_status = excluded.duty_status,
    remaining_hours = excluded.remaining_hours,
    on_duty_hours_remaining = excluded.on_duty_hours_remaining,
    cycle_hours_remaining = excluded.cycle_hours_remaining,
    current_location = excluded.current_location;

-- A new organization does not have a dispatch snapshot until an operator opens
-- the app for the first time. Seed only the normalized driver link dependency in
-- that case; the app will initialize the complete demo snapshot on first login.
insert into public.drivers (
  organization_id,
  external_id,
  name,
  status,
  duty_status,
  remaining_hours,
  on_duty_hours_remaining,
  cycle_hours_remaining,
  current_location
)
select
  organization.id,
  'D-131',
  'Sofia Nguyen',
  'assigned'::public.asset_status,
  'driving'::public.duty_status,
  7.4,
  8.0,
  41.3,
  extensions.st_setsrid(
    extensions.st_makepoint(-80.3144, 43.3616),
    4326
  )::extensions.geography
from public.organizations organization
where organization.slug = 'roadstar'
on conflict (organization_id, external_id) do nothing;

insert into public.driver_user_links (
  organization_id, user_id, driver_external_id, created_by
)
select organization.id, driver_account.id, 'D-131', dispatcher_account.id
from public.organizations organization
join public.drivers driver
  on driver.organization_id = organization.id and driver.external_id = 'D-131'
join auth.users driver_account on lower(driver_account.email) = 'driver-a@roadstar.test'
join auth.users dispatcher_account on lower(dispatcher_account.email) = 'dispatcher-a@roadstar.test'
where organization.slug = 'roadstar'
on conflict (organization_id, user_id) do update
set driver_external_id = excluded.driver_external_id,
    created_by = excluded.created_by,
    updated_at = now();

do $$
begin
  if not exists (
    select 1
    from public.organizations organization
    join public.drivers driver on driver.organization_id = organization.id
    where organization.slug = 'roadstar' and driver.external_id = 'D-131'
  ) then
    raise exception 'Unable to provision Driver D-131 in Organization A.';
  end if;
end $$;

commit;

select organization.slug, member.role, account.email,
       link.driver_external_id
from public.organization_members member
join public.organizations organization on organization.id = member.organization_id
join auth.users account on account.id = member.user_id
left join public.driver_user_links link
  on link.organization_id = member.organization_id and link.user_id = member.user_id
where lower(account.email) in (
  'dispatcher-a@roadstar.test', 'dispatcher-a2@roadstar.test',
  'driver-a@roadstar.test', 'viewer-a@roadstar.test',
  'dispatcher-b@roadstar.test'
)
order by organization.slug, member.role, account.email;
