\set ON_ERROR_STOP on
create table public.test_results (name text, passed boolean, detail text);
grant insert on public.test_results to anon, authenticated;

create function public.expect_ok(p_name text, p_sql text) returns void language plpgsql as $$
begin
  execute p_sql;
  insert into public.test_results values (p_name, true, null);
exception when others then
  insert into public.test_results values (p_name, false, sqlstate || ' ' || sqlerrm);
end $$;

create function public.expect_denied(p_name text, p_sql text) returns void language plpgsql as $$
begin
  execute p_sql;
  insert into public.test_results values (p_name, false, 'statement was allowed');
exception when others then
  insert into public.test_results values (p_name, true, sqlstate);
end $$;

create function public.expect_value(p_name text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  insert into public.test_results values (p_name, v is not distinct from p_expected, 'got ' || coalesce(v, 'null') || ', expected ' || p_expected);
exception when others then
  insert into public.test_results values (p_name, false, sqlstate || ' ' || sqlerrm);
end $$;

create function public.expect_error(p_name text, p_sql text, p_sqlstate text) returns void language plpgsql as $$
begin
  execute p_sql;
  insert into public.test_results values (p_name, false, 'statement was allowed');
exception when others then
  insert into public.test_results values (p_name, sqlstate = p_sqlstate, 'got ' || sqlstate || ', expected ' || p_sqlstate);
end $$;

grant execute on function public.expect_ok(text, text), public.expect_denied(text, text), public.expect_error(text, text, text), public.expect_value(text, text, text) to anon, authenticated;

-- Fixtures: Organization A (1) and B (2).
insert into public.organizations (id, name, slug) values (1, 'RoadStar A', 'a'), (2, 'RoadStar B', 'b');
insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a'), -- dispatcher A
  ('00000000-0000-0000-0000-00000000000b'), -- driver A, linked to D-113
  ('00000000-0000-0000-0000-00000000000c'), -- driver A2, linked to D-077
  ('00000000-0000-0000-0000-00000000000d'), -- viewer A
  ('00000000-0000-0000-0000-00000000000e'), -- dispatcher B
  ('00000000-0000-0000-0000-00000000000f'); -- signed in, no membership
insert into public.organization_members values
  (1, '00000000-0000-0000-0000-00000000000a', 'dispatcher'),
  (1, '00000000-0000-0000-0000-00000000000b', 'driver'),
  (1, '00000000-0000-0000-0000-00000000000c', 'driver'),
  (1, '00000000-0000-0000-0000-00000000000d', 'viewer'),
  (2, '00000000-0000-0000-0000-00000000000e', 'dispatcher');
insert into public.driver_user_links values
  (1, '00000000-0000-0000-0000-00000000000b', 'D-113'),
  (1, '00000000-0000-0000-0000-00000000000c', 'D-077');
insert into public.dispatch_snapshots values
  (1, '{"assignments":[{"id":"A-1","loadId":"L-4521","driverId":"D-113","status":"completed"},{"id":"A-2","loadId":"L-4528","driverId":"D-077","status":"accepted"}]}', 3),
  (2, '{"assignments":[]}', 0);

-- ── Driver A ──────────────────────────────────────────────────────────────
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select public.expect_ok('driver uploads a POD to a load they drove, even after completion',
  $q$insert into storage.objects (bucket_id, name, owner_id, metadata) values ('load-documents', '1/L-4521/pod-a.jpg', auth.uid()::text, '{"mimetype":"image/jpeg","size":2048}')$q$);
select public.expect_error('driver cannot upload to a load assigned to another driver',
  $q$insert into storage.objects (bucket_id, name, owner_id, metadata) values ('load-documents', '1/L-4528/pod-x.jpg', auth.uid()::text, '{"mimetype":"image/jpeg","size":2048}')$q$, '42501');
select public.expect_error('driver cannot upload into intake',
  $q$insert into storage.objects (bucket_id, name, owner_id, metadata) values ('load-documents', '1/intake/rate.pdf', auth.uid()::text, '{"mimetype":"application/pdf","size":4096}')$q$, '42501');
select public.expect_error('driver cannot upload into another organization',
  $q$insert into storage.objects (bucket_id, name, owner_id, metadata) values ('load-documents', '2/L-4521/pod-b.jpg', auth.uid()::text, '{"mimetype":"image/jpeg","size":2048}')$q$, '42501');
select public.expect_error('malformed path is denied: extra folder',
  $q$insert into storage.objects (bucket_id, name, owner_id, metadata) values ('load-documents', '1/L-4521/nested/pod.jpg', auth.uid()::text, '{"mimetype":"image/jpeg","size":2048}')$q$, '42501');
select public.expect_error('malformed path is denied: non-numeric organization',
  $q$insert into storage.objects (bucket_id, name, owner_id, metadata) values ('load-documents', 'one/L-4521/pod.jpg', auth.uid()::text, '{"mimetype":"image/jpeg","size":2048}')$q$, '42501');
select public.expect_error('malformed path is denied: dot segment',
  $q$insert into storage.objects (bucket_id, name, owner_id, metadata) values ('load-documents', '1/../pod.jpg', auth.uid()::text, '{"mimetype":"image/jpeg","size":2048}')$q$, '42501');
select public.expect_error('malformed path is denied: disallowed extension',
  $q$insert into storage.objects (bucket_id, name, owner_id, metadata) values ('load-documents', '1/L-4521/pod.exe', auth.uid()::text, '{"mimetype":"image/jpeg","size":2048}')$q$, '42501');
commit;

begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select public.expect_ok('driver attaches their uploaded POD to its load',
  $q$select public.attach_load_document('1/L-4521/pod-a.jpg', 'L-4521', 'pod')$q$);
select public.expect_error('driver cannot attach a POD whose path names a different load',
  $q$select public.attach_load_document('1/L-4521/pod-a.jpg', 'L-4528', 'pod')$q$, '22023');
select public.expect_error('driver cannot attach intake documents',
  $q$select public.attach_load_document('1/intake/rate.pdf', 'L-9000', 'intake')$q$, '42501');
select public.expect_error('attaching a file that was never uploaded fails',
  $q$select public.attach_load_document('1/L-4521/missing.jpg', 'L-4521', 'pod')$q$, 'P0002');
select public.expect_error('direct insert into load_documents is refused',
  $q$insert into public.load_documents (organization_id, load_external_id, storage_path, purpose, content_type, byte_size) values (1, 'L-4521', '1/L-4521/forged.jpg', 'pod', 'image/jpeg', 10)$q$, '42501');
commit;

-- Size and type were taken from storage metadata, not supplied by the driver.
select public.expect_value('attached POD records storage metadata and uploader',
  $q$select content_type || ',' || byte_size || ',' || document_type || ',' || uploaded_by from public.load_documents where storage_path = '1/L-4521/pod-a.jpg'$q$,
  'image/jpeg,2048,pod,00000000-0000-0000-0000-00000000000b');

-- ── Dispatcher A ──────────────────────────────────────────────────────────
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select public.expect_ok('dispatcher stages a rate confirmation in intake',
  $q$insert into storage.objects (bucket_id, name, owner_id, metadata) values ('load-documents', '1/intake/rate-1.pdf', auth.uid()::text, '{"mimetype":"application/pdf","size":8192}')$q$);
commit;
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select public.expect_ok('dispatcher attaches the intake document to the load it created',
  $q$select public.attach_load_document('1/intake/rate-1.pdf', 'L-9000', 'intake')$q$);
select public.expect_error('intake documents must be staged under intake',
  $q$select public.attach_load_document('1/L-4521/pod-a.jpg', 'L-4521', 'intake')$q$, '22023');
select public.expect_value('dispatcher sees every document in the organization',
  $q$select count(*) from public.load_documents$q$, '2');
commit;

-- A rate confirmation attached to a load a driver is already assigned to must
-- stay hidden from that driver: it carries pricing.
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select public.expect_ok('dispatcher stages a rate confirmation for an assigned load',
  $q$insert into storage.objects (bucket_id, name, owner_id, metadata) values ('load-documents', '1/intake/rate-2.pdf', auth.uid()::text, '{"mimetype":"application/pdf","size":8192}')$q$);
commit;
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select public.expect_ok('dispatcher attaches it to the load driver A is assigned to',
  $q$select public.attach_load_document('1/intake/rate-2.pdf', 'L-4521', 'intake')$q$);
commit;

-- ── Visibility ────────────────────────────────────────────────────────────
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select public.expect_value('driver sees their POD but not the rate confirmation on their own load',
  $q$select count(*) || ':' || min(purpose) from public.load_documents$q$, '1:pod');
select public.expect_value('driver can read their POD file but not the intake file',
  $q$select count(*) from storage.objects where bucket_id = 'load-documents'$q$, '1');
commit;

begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
select public.expect_value('another driver in the same organization sees nothing',
  $q$select count(*) from public.load_documents$q$, '0');
select public.expect_value('another driver cannot read the POD file',
  $q$select count(*) from storage.objects where bucket_id = 'load-documents'$q$, '0');
commit;

begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
select public.expect_value('viewer reads every document', $q$select count(*) from public.load_documents$q$, '3');
select public.expect_error('viewer cannot upload',
  $q$insert into storage.objects (bucket_id, name, owner_id, metadata) values ('load-documents', '1/L-4521/viewer.jpg', auth.uid()::text, '{"mimetype":"image/jpeg","size":2048}')$q$, '42501');
commit;

begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
select public.expect_value('dispatcher in another organization sees nothing',
  $q$select count(*) from public.load_documents$q$, '0');
select public.expect_value('dispatcher in another organization reads no files',
  $q$select count(*) from storage.objects where bucket_id = 'load-documents'$q$, '0');
commit;

begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000f', true);
set local role authenticated;
select public.expect_value('signed-in user with no membership sees nothing',
  $q$select count(*) from public.load_documents$q$, '0');
commit;

begin;
set local role anon;
select public.expect_error('anonymous callers cannot read documents', $q$select count(*) from public.load_documents$q$, '42501');
select public.expect_error('anonymous callers cannot attach documents', $q$select public.attach_load_document('1/L-4521/pod-a.jpg', 'L-4521', 'pod')$q$, '42501');
commit;

-- ── Extraction updates ────────────────────────────────────────────────────
create table public.fixture_ids as select id from public.load_documents where purpose = 'pod';
grant select on public.fixture_ids to authenticated;
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
select public.expect_error('a driver cannot record extraction on another driver''s POD',
  $q$select public.record_load_document_extraction((select id from public.fixture_ids), 'complete', 'pod', '{}', false)$q$, '42501');
commit;
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select public.expect_ok('the uploading driver records extraction on their POD',
  $q$select public.record_load_document_extraction((select id from public.load_documents where purpose = 'pod'), 'complete', 'pod', '{"consignee":"Northern Foods"}', true)$q$);
select public.expect_error('an unsupported extraction status is refused',
  $q$select public.record_load_document_extraction((select id from public.load_documents where purpose = 'pod'), 'approved', null, null, null)$q$, '22023');
select public.expect_error('direct update of a document is refused',
  $q$update public.load_documents set signature_missing = false$q$, '42501');
commit;
select public.expect_value('extraction is stored with the signature flag',
  $q$select extraction_status || ',' || signature_missing || ',' || (extraction ->> 'consignee') from public.load_documents where purpose = 'pod'$q$,
  'complete,true,Northern Foods');

-- ── Deletion ──────────────────────────────────────────────────────────────
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
select public.expect_value('a driver deletes nothing', $q$with gone as (delete from public.load_documents returning 1) select count(*) from gone$q$, '0');
commit;
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
set local role authenticated;
select public.expect_value('another organization''s dispatcher deletes no files', $q$with gone as (delete from storage.objects where bucket_id = 'load-documents' returning 1) select count(*) from gone$q$, '0');
commit;

-- ── Schema facts ──────────────────────────────────────────────────────────
select public.expect_value('bucket is private with the documented limits',
  $q$select public || ',' || file_size_limit || ',' || array_length(allowed_mime_types, 1) from storage.buckets where id = 'load-documents'$q$, 'false,10485760,4');
select public.expect_value('load_documents is published for realtime',
  $q$select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'load_documents'$q$, '1');
select public.expect_value('schema version is recorded',
  $q$select schema_version from public.system_health$q$, '20260913082708');

select case when passed then 'PASS' else 'FAIL' end as result, name, detail from public.test_results order by passed, name;
select count(*) filter (where passed) || ' passed, ' || count(*) filter (where not passed) || ' failed' as summary from public.test_results;
