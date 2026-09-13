begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.save_dispatch_snapshot(
  p_organization_id bigint,
  p_state jsonb,
  p_expected_revision bigint
) returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_revision bigint;
begin
  if (select auth.uid()) is null or not exists (
    select 1
    from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = (select auth.uid())
      and member.role in ('admin', 'dispatcher')
  ) then
    raise exception using
      errcode = '42501',
      message = 'Only organization dispatchers and administrators can save the RoadStar workspace.';
  end if;

  update public.dispatch_snapshots
  set state = p_state,
      revision = revision + 1,
      updated_by = (select auth.uid()),
      updated_at = now()
  where organization_id = p_organization_id
    and revision = p_expected_revision
  returning revision into next_revision;

  if next_revision is null then
    -- P0001 is deliberately non-retryable. 40001 means a database serialization
    -- failure and causes infrastructure clients to retry this expected app-level
    -- compare-and-swap conflict instead of returning it promptly.
    raise exception using
      errcode = 'P0001',
      message = 'RoadStar workspace changed in another session. Reload before saving.';
  end if;

  return next_revision;
end;
$$;

revoke all on function public.save_dispatch_snapshot(bigint, jsonb, bigint) from public, anon;
grant execute on function public.save_dispatch_snapshot(bigint, jsonb, bigint) to authenticated;

update public.system_health
set schema_version = '20260913055147', installed_at = now()
where id = true;

commit;
