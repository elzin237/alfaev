create table public.documentation_records (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  document_date date not null,
  amount numeric not null,
  pdf_storage_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by_user_id uuid not null references public.user_profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid not null references public.user_profiles(id) on delete restrict,
  archived_at timestamptz,
  archived_by_user_id uuid references public.user_profiles(id) on delete restrict,
  constraint documentation_name_trimmed_nonblank check (
    name = pg_catalog.btrim(name) and pg_catalog.length(name) > 0
  ),
  constraint documentation_category_allowed check (
    category in ('uvoz', 'izvoz', 'nabavka', 'troskovi')
  ),
  constraint documentation_amount_nonnegative_finite check (
    amount >= 0 and amount::text not in ('NaN', 'Infinity', '-Infinity')
  ),
  constraint documentation_pdf_path_trimmed_nonblank check (
    pdf_storage_path is null or (
      pdf_storage_path = pg_catalog.btrim(pdf_storage_path)
      and pg_catalog.length(pdf_storage_path) > 0
    )
  ),
  constraint documentation_archive_state_consistent check (
    (is_active and archived_at is null and archived_by_user_id is null)
    or (not is_active and archived_at is not null and archived_by_user_id is not null)
  )
);

create function public.enforce_documentation_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'Documentation records cannot be deleted' using errcode = 'DOC01';
  end if;
  if not old.is_active then
    raise exception 'Archived Documentation records are immutable' using errcode = 'DOC01';
  end if;
  return new;
end;
$function$;

create trigger documentation_lifecycle_immutable
before update or delete on public.documentation_records
for each row execute function public.enforce_documentation_lifecycle();

revoke all privileges on function public.enforce_documentation_lifecycle()
  from public, anon, authenticated;

alter table public.documentation_records enable row level security;
revoke all privileges on table public.documentation_records from public, anon, authenticated;
grant select on table public.documentation_records to authenticated;

create policy documentation_select_admin
on public.documentation_records for select to authenticated
using (public.current_user_is_admin());

create function public.create_documentation_record(
  p_name text, p_category text, p_document_date date, p_amount numeric
) returns uuid
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  actor_id uuid;
  record_id uuid;
  normalized_name text := pg_catalog.btrim(p_name);
  changed_at timestamptz := pg_catalog.clock_timestamp();
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  actor_id := public.current_active_user_profile_id();
  if normalized_name is null or normalized_name = '' or
    p_category is null or p_category not in ('uvoz', 'izvoz', 'nabavka', 'troskovi') or
    p_document_date is null or p_amount is null or p_amount < 0 or
    p_amount::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Invalid Documentation data' using errcode = '22023';
  end if;

  insert into public.documentation_records (
    name, category, document_date, amount, created_at, created_by_user_id,
    updated_at, updated_by_user_id
  ) values (
    normalized_name, p_category, p_document_date, p_amount,
    changed_at, actor_id, changed_at, actor_id
  ) returning id into record_id;

  perform public.append_audit_log(
    p_action_type => 'documentation.created',
    p_entity_type => 'documentation_record',
    p_summary => 'Created Documentation record',
    p_entity_id => record_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'name', normalized_name, 'category', p_category,
      'document_date', p_document_date, 'amount', p_amount,
      'is_active', true, 'pdf_storage_path', null
    )
  );
  return record_id;
end;
$function$;

create function public.update_documentation_record(
  p_record_id uuid, p_name text, p_category text,
  p_document_date date, p_amount numeric
) returns uuid
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  actor_id uuid;
  current_record public.documentation_records%rowtype;
  normalized_name text := pg_catalog.btrim(p_name);
  changed_at timestamptz;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_record_id is null or normalized_name is null or normalized_name = '' or
    p_category is null or p_category not in ('uvoz', 'izvoz', 'nabavka', 'troskovi') or
    p_document_date is null or p_amount is null or p_amount < 0 or
    p_amount::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'Invalid Documentation data' using errcode = '22023';
  end if;

  select record.* into current_record from public.documentation_records as record
  where record.id = p_record_id for update;
  if not found then raise exception 'Documentation record not found' using errcode = 'P0002'; end if;
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  actor_id := public.current_active_user_profile_id();
  if not current_record.is_active then
    raise exception 'Archived Documentation cannot be edited' using errcode = 'DOC01';
  end if;
  if (current_record.name, current_record.category, current_record.document_date, current_record.amount)
    = (normalized_name, p_category, p_document_date, p_amount) then
    return current_record.id;
  end if;

  changed_at := pg_catalog.clock_timestamp();
  update public.documentation_records set
    name = normalized_name, category = p_category, document_date = p_document_date,
    amount = p_amount, updated_at = changed_at, updated_by_user_id = actor_id
  where id = current_record.id;
  perform public.append_audit_log(
    p_action_type => 'documentation.updated',
    p_entity_type => 'documentation_record',
    p_summary => 'Updated Documentation record',
    p_entity_id => current_record.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'name', current_record.name, 'category', current_record.category,
      'document_date', current_record.document_date, 'amount', current_record.amount
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'name', normalized_name, 'category', p_category,
      'document_date', p_document_date, 'amount', p_amount
    )
  );
  return current_record.id;
end;
$function$;

create function public.archive_documentation_record(p_record_id uuid)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  actor_id uuid;
  current_record public.documentation_records%rowtype;
  changed_at timestamptz;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_record_id is null then raise exception 'Documentation record is required' using errcode = '22023'; end if;
  select record.* into current_record from public.documentation_records as record
  where record.id = p_record_id for update;
  if not found then raise exception 'Documentation record not found' using errcode = 'P0002'; end if;
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  actor_id := public.current_active_user_profile_id();
  if not current_record.is_active then
    raise exception 'Documentation record is already archived' using errcode = 'DOC01';
  end if;

  changed_at := pg_catalog.clock_timestamp();
  update public.documentation_records set
    is_active = false, archived_at = changed_at, archived_by_user_id = actor_id,
    updated_at = changed_at, updated_by_user_id = actor_id
  where id = current_record.id;
  perform public.append_audit_log(
    p_action_type => 'documentation.archived',
    p_entity_type => 'documentation_record',
    p_summary => 'Archived Documentation record',
    p_entity_id => current_record.id,
    p_before_data => pg_catalog.jsonb_build_object('is_active', true, 'pdf_storage_path', current_record.pdf_storage_path),
    p_after_data => pg_catalog.jsonb_build_object(
      'is_active', false, 'archived_at', changed_at,
      'archived_by_user_id', actor_id, 'pdf_storage_path', current_record.pdf_storage_path
    )
  );
  return current_record.id;
end;
$function$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentation-pdfs', 'documentation-pdfs', false, 10485760, array['application/pdf']::text[]);

-- Restrictive policy keeps this bucket closed even if another permissive
-- Storage policy is introduced later. Only the server-side service role handles bytes.
create policy documentation_pdf_objects_no_direct_client_access
on storage.objects as restrictive for all to anon, authenticated
using (bucket_id <> 'documentation-pdfs')
with check (bucket_id <> 'documentation-pdfs');

create function public.set_documentation_pdf_reference_admin(
  p_record_id uuid, p_expected_path text, p_new_path text,
  p_actor_auth_user_id uuid
) returns uuid
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  actor_id uuid;
  current_record public.documentation_records%rowtype;
  action_name text;
  changed_at timestamptz;
begin
  -- Only the Edge service role can execute this operation. The actor UUID comes
  -- from its verified JWT, never from a browser RPC argument.
  if p_actor_auth_user_id is null or not exists (
    select 1 from public.user_profiles as profile
    where profile.auth_user_id = p_actor_auth_user_id
      and profile.is_active and profile.is_admin
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_record_id is null then raise exception 'Documentation record is required' using errcode = '22023'; end if;
  select record.* into current_record from public.documentation_records as record
  where record.id = p_record_id for update;
  if not found then raise exception 'Documentation record not found' using errcode = 'P0002'; end if;
  select profile.id into actor_id from public.user_profiles as profile
  where profile.auth_user_id = p_actor_auth_user_id
    and profile.is_active and profile.is_admin;
  if actor_id is null then raise exception 'Access denied' using errcode = '42501'; end if;
  if not current_record.is_active then
    raise exception 'Archived Documentation cannot change PDF' using errcode = 'DOC01';
  end if;
  if current_record.pdf_storage_path is distinct from p_expected_path then
    raise exception 'Documentation PDF changed concurrently' using errcode = 'DOC04';
  end if;
  if p_new_path is not null then
    if p_new_path !~ ('^' || current_record.id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$') or
      not exists (
        select 1 from storage.objects as object
        where object.bucket_id = 'documentation-pdfs'
          and object.name = p_new_path
          and object.metadata->>'mimetype' = 'application/pdf'
      ) then
      raise exception 'Validated private PDF object is required' using errcode = 'DOC02';
    end if;
    if exists (
      select 1 from public.documentation_records as record
      where record.pdf_storage_path = p_new_path and record.id <> p_record_id
    ) then
      raise exception 'PDF object is already referenced' using errcode = 'DOC02';
    end if;
  elsif current_record.pdf_storage_path is null then
    raise exception 'No PDF is attached' using errcode = 'DOC03';
  end if;
  if p_new_path is not distinct from current_record.pdf_storage_path then
    raise exception 'PDF reference is unchanged' using errcode = 'DOC04';
  end if;

  action_name := case
    when p_new_path is null then 'documentation.pdf_removed'
    when current_record.pdf_storage_path is null then 'documentation.pdf_attached'
    else 'documentation.pdf_replaced'
  end;
  changed_at := pg_catalog.clock_timestamp();
  update public.documentation_records set pdf_storage_path = p_new_path,
    updated_at = changed_at, updated_by_user_id = actor_id
  where id = current_record.id;
  insert into public.audit_logs (
    actor_user_id, action_type, entity_type, entity_id,
    summary, before_data, after_data
  ) values (
    actor_id, action_name, 'documentation_record', current_record.id,
    case
      when p_new_path is null then 'Removed Documentation PDF'
      when current_record.pdf_storage_path is null then 'Attached Documentation PDF'
      else 'Replaced Documentation PDF'
    end,
    pg_catalog.jsonb_build_object('pdf_storage_path', current_record.pdf_storage_path),
    pg_catalog.jsonb_build_object('pdf_storage_path', p_new_path)
  );
  return current_record.id;
end;
$function$;

revoke all privileges on function public.create_documentation_record(text, text, date, numeric)
  from public, anon, authenticated;
revoke all privileges on function public.update_documentation_record(uuid, text, text, date, numeric)
  from public, anon, authenticated;
revoke all privileges on function public.archive_documentation_record(uuid)
  from public, anon, authenticated;
revoke all privileges on function public.set_documentation_pdf_reference_admin(uuid, text, text, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.create_documentation_record(text, text, date, numeric) to authenticated;
grant execute on function public.update_documentation_record(uuid, text, text, date, numeric) to authenticated;
grant execute on function public.archive_documentation_record(uuid) to authenticated;
grant execute on function public.set_documentation_pdf_reference_admin(uuid, text, text, uuid) to service_role;
