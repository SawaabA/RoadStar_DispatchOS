begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Load documents: rate confirmations and bills of lading captured during
-- intake, and proof-of-delivery photos taken by drivers. Files live in a
-- private Storage bucket; each row ties one file to a load and holds what
-- extraction read from it. Loads live inside the dispatch snapshot JSON, so a
-- document refers to a snapshot load id rather than a foreign key.
--
-- Storage paths are <organization id>/<load id | intake>/<file>. Intake files
-- are staged under "intake" until a dispatcher creates the load they describe.

create table public.load_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id bigint not null references public.organizations(id) on delete cascade,
  load_external_id text not null check (load_external_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'),
  storage_path text not null unique check (char_length(storage_path) <= 512),
  purpose text not null check (purpose in ('intake', 'pod')),
  document_type text not null default 'unknown'
    check (document_type in ('rate_confirmation', 'bol', 'pod', 'lumper_receipt', 'damage_photo', 'other', 'unknown')),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending', 'complete', 'failed', 'skipped')),
  extraction jsonb check (extraction is null or pg_column_size(extraction) <= 65536),
  signature_missing boolean,
  extracted_at timestamptz,
  updated_at timestamptz not null default now()
);

create index load_documents_org_load_idx on public.load_documents (organization_id, load_external_id, uploaded_at desc);
create index load_documents_uploaded_by_idx on public.load_documents (uploaded_by) where uploaded_by is not null;

alter table public.load_documents enable row level security;

-- The caller's role in an organization, or null when they are not a member.
create or replace function private.load_document_member_role(p_organization_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select member.role
  from public.organization_members as member
  where member.organization_id = p_organization_id
    and member.user_id = (select auth.uid());
$$;

-- True when the caller is the linked driver on an assignment for this load.
-- Any assignment status counts, because proof of delivery is usually captured
-- after the trip is completed.
create or replace function private.is_assigned_driver_for_load(p_organization_id bigint, p_load_external_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_driver_external_id text;
begin
  select link.driver_external_id
  into v_driver_external_id
  from public.driver_user_links as link
  join public.organization_members as member
    on member.organization_id = link.organization_id
   and member.user_id = link.user_id
   and member.role = 'driver'
  where link.organization_id = p_organization_id
    and link.user_id = (select auth.uid());

  if v_driver_external_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.dispatch_snapshots as snapshot,
         jsonb_array_elements(coalesce(snapshot.state -> 'assignments', '[]'::jsonb)) as item
    where snapshot.organization_id = p_organization_id
      and item ->> 'loadId' = p_load_external_id
      and item ->> 'driverId' = v_driver_external_id
  );
end;
$$;

-- Splits <organization id>/<load id | intake>/<file>. Any other shape yields
-- no row, so a malformed path is denied instead of raising inside an RLS check.
create or replace function private.parse_load_document_path(p_name text)
returns table (organization_id bigint, segment text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  if coalesce(array_length(v_parts, 1), 0) <> 3
     or v_parts[1] !~ '^[0-9]{1,18}$'
     or v_parts[2] !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'
     or v_parts[3] !~ '^[A-Za-z0-9_-]{1,80}\.(jpg|jpeg|png|webp|pdf)$' then
    return;
  end if;
  organization_id := v_parts[1]::bigint;
  segment := v_parts[2];
  return next;
end;
$$;

create or replace function private.can_write_load_document(p_organization_id bigint, p_segment text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce(private.load_document_member_role(p_organization_id), '');
begin
  if v_role in ('admin', 'dispatcher') then
    return true;
  end if;
  -- Drivers attach proof of delivery to their own loads, and never see intake.
  return v_role = 'driver'
     and p_segment <> 'intake'
     and private.is_assigned_driver_for_load(p_organization_id, p_segment);
end;
$$;

-- Rate confirmations carry pricing, so drivers read only proof-of-delivery
-- files: ones they uploaded or ones on loads they are assigned to.
create or replace function private.can_read_load_document(p_organization_id bigint, p_segment text, p_owner text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := coalesce(private.load_document_member_role(p_organization_id), '');
begin
  if v_role in ('admin', 'dispatcher', 'viewer') then
    return true;
  end if;
  return v_role = 'driver'
     and p_segment <> 'intake'
     and (p_owner = (select auth.uid())::text or private.is_assigned_driver_for_load(p_organization_id, p_segment));
end;
$$;

create policy "members read permitted load documents"
on public.load_documents for select to authenticated
using (
  private.can_read_load_document(
    organization_id,
    case when purpose = 'intake' then 'intake' else load_external_id end,
    uploaded_by::text
  )
);

create policy "operators delete load documents"
on public.load_documents for delete to authenticated
using (coalesce(private.load_document_member_role(organization_id), '') in ('admin', 'dispatcher'));

-- Rows are created and updated only through the functions below.
revoke all on public.load_documents from anon, authenticated;
grant select, delete on public.load_documents to authenticated;

create or replace function private.attach_load_document(
  p_storage_path text,
  p_load_external_id text,
  p_purpose text
) returns public.load_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_organization_id bigint;
  v_segment text;
  v_metadata jsonb;
  v_row public.load_documents;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_purpose is null or p_purpose not in ('intake', 'pod') then
    raise exception using errcode = '22023', message = 'Unsupported document purpose.';
  end if;
  if p_load_external_id is null or p_load_external_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$' then
    raise exception using errcode = '22023', message = 'Invalid load id.';
  end if;

  select path.organization_id, path.segment
  into v_organization_id, v_segment
  from private.parse_load_document_path(p_storage_path) as path;

  if v_organization_id is null then
    raise exception using errcode = '22023', message = 'Invalid document path.';
  end if;

  -- A proof of delivery is stored under its own load. Intake files are staged
  -- under "intake" and attached once the load they describe exists.
  if (p_purpose = 'pod' and v_segment <> p_load_external_id)
     or (p_purpose = 'intake' and v_segment <> 'intake') then
    raise exception using errcode = '22023', message = 'Document path does not match its purpose and load.';
  end if;

  if p_purpose = 'intake' then
    if coalesce(private.load_document_member_role(v_organization_id), '') not in ('admin', 'dispatcher') then
      raise exception using errcode = '42501', message = 'Only dispatchers can attach intake documents.';
    end if;
  elsif not private.can_write_load_document(v_organization_id, p_load_external_id) then
    raise exception using errcode = '42501', message = 'You cannot attach documents to this load.';
  end if;

  -- Size and type come from what Storage recorded for the uploaded object, not
  -- from anything the client reports.
  select object.metadata
  into v_metadata
  from storage.objects as object
  where object.bucket_id = 'load-documents'
    and object.name = p_storage_path;

  if v_metadata is null then
    raise exception using errcode = 'P0002', message = 'Upload the file before attaching it.';
  end if;

  insert into public.load_documents (
    organization_id, load_external_id, storage_path, purpose, document_type, content_type, byte_size, uploaded_by
  ) values (
    v_organization_id,
    p_load_external_id,
    p_storage_path,
    p_purpose,
    case p_purpose when 'pod' then 'pod' else 'unknown' end,
    v_metadata ->> 'mimetype',
    (v_metadata ->> 'size')::bigint,
    v_user_id
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function private.record_load_document_extraction(
  p_document_id uuid,
  p_status text,
  p_document_type text,
  p_extraction jsonb,
  p_signature_missing boolean
) returns public.load_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_document public.load_documents;
  v_role text;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_status is null or p_status not in ('complete', 'failed', 'skipped') then
    raise exception using errcode = '22023', message = 'Unsupported extraction status.';
  end if;
  if p_document_type is not null
     and p_document_type not in ('rate_confirmation', 'bol', 'pod', 'lumper_receipt', 'damage_photo', 'other', 'unknown') then
    raise exception using errcode = '22023', message = 'Unsupported document type.';
  end if;

  select *
  into v_document
  from public.load_documents as document
  where document.id = p_document_id
  for update;

  if v_document.id is null then
    raise exception using errcode = 'P0002', message = 'Document not found.';
  end if;

  v_role := coalesce(private.load_document_member_role(v_document.organization_id), '');
  if not (v_role in ('admin', 'dispatcher') or (v_role = 'driver' and v_document.uploaded_by = v_user_id)) then
    raise exception using errcode = '42501', message = 'You cannot update this document.';
  end if;

  update public.load_documents as document
  set extraction_status = p_status,
      document_type = coalesce(p_document_type, document.document_type),
      extraction = p_extraction,
      signature_missing = p_signature_missing,
      extracted_at = now(),
      updated_at = now()
  where document.id = p_document_id
  returning * into v_document;

  return v_document;
end;
$$;

create or replace function public.attach_load_document(
  p_storage_path text,
  p_load_external_id text,
  p_purpose text
) returns public.load_documents
language sql
security invoker
set search_path = ''
as $$
  select * from private.attach_load_document(p_storage_path, p_load_external_id, p_purpose);
$$;

create or replace function public.record_load_document_extraction(
  p_document_id uuid,
  p_status text,
  p_document_type text,
  p_extraction jsonb,
  p_signature_missing boolean
) returns public.load_documents
language sql
security invoker
set search_path = ''
as $$
  select * from private.record_load_document_extraction(p_document_id, p_status, p_document_type, p_extraction, p_signature_missing);
$$;

grant usage on schema private to authenticated;
revoke all on function private.load_document_member_role(bigint) from public, anon;
revoke all on function private.is_assigned_driver_for_load(bigint, text) from public, anon;
revoke all on function private.parse_load_document_path(text) from public, anon;
revoke all on function private.can_write_load_document(bigint, text) from public, anon;
revoke all on function private.can_read_load_document(bigint, text, text) from public, anon;
revoke all on function private.attach_load_document(text, text, text) from public, anon;
revoke all on function private.record_load_document_extraction(uuid, text, text, jsonb, boolean) from public, anon;
revoke all on function public.attach_load_document(text, text, text) from public, anon;
revoke all on function public.record_load_document_extraction(uuid, text, text, jsonb, boolean) from public, anon;
grant execute on function private.load_document_member_role(bigint) to authenticated;
grant execute on function private.is_assigned_driver_for_load(bigint, text) to authenticated;
grant execute on function private.parse_load_document_path(text) to authenticated;
grant execute on function private.can_write_load_document(bigint, text) to authenticated;
grant execute on function private.can_read_load_document(bigint, text, text) to authenticated;
grant execute on function private.attach_load_document(text, text, text) to authenticated;
grant execute on function private.record_load_document_extraction(uuid, text, text, jsonb, boolean) to authenticated;
grant execute on function public.attach_load_document(text, text, text) to authenticated;
grant execute on function public.record_load_document_extraction(uuid, text, text, jsonb, boolean) to authenticated;

-- Private bucket. The limits match the table constraints, so a file Storage
-- accepts can always be attached.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('load-documents', 'load-documents', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "roadstar upload load documents" on storage.objects;
drop policy if exists "roadstar read load documents" on storage.objects;
drop policy if exists "roadstar operators delete load documents" on storage.objects;

create policy "roadstar upload load documents"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'load-documents'
  and exists (
    select 1
    from private.parse_load_document_path(name) as path
    where private.can_write_load_document(path.organization_id, path.segment)
  )
);

create policy "roadstar read load documents"
on storage.objects for select to authenticated
using (
  bucket_id = 'load-documents'
  and exists (
    select 1
    from private.parse_load_document_path(name) as path
    where private.can_read_load_document(path.organization_id, path.segment, owner_id)
  )
);

-- Uploads are immutable: there is no update policy. Operators may delete.
create policy "roadstar operators delete load documents"
on storage.objects for delete to authenticated
using (
  bucket_id = 'load-documents'
  and exists (
    select 1
    from private.parse_load_document_path(name) as path
    where coalesce(private.load_document_member_role(path.organization_id), '') in ('admin', 'dispatcher')
  )
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'load_documents'
  ) then
    alter publication supabase_realtime add table public.load_documents;
  end if;
end;
$$;

update public.system_health
set schema_version = '20260913082708', installed_at = now()
where id = true;

commit;
