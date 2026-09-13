begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.decision_records
  drop constraint if exists decision_records_kind_check;

alter table public.decision_records
  add constraint decision_records_kind_check
  check (kind in ('plan', 'replan', 'exception', 'backhaul', 'driver', 'load'));

update public.system_health
set schema_version = '20260913070240', installed_at = now()
where id = true;

commit;
