insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'work-order-pdfs',
  'work-order-pdfs',
  false,
  10485760,
  array['application/pdf']::text[]
);

create table public.work_order_pdfs (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null,
  storage_reference text not null,
  generated_at timestamptz not null,
  generated_by_user_id uuid not null,
  document_version integer not null default 1,
  content_hash text,
  constraint work_order_pdfs_work_order_id_key
    unique (work_order_id),
  constraint work_order_pdfs_storage_reference_key
    unique (storage_reference),
  constraint work_order_pdfs_work_order_id_fkey
    foreign key (work_order_id)
    references public.work_orders(id)
    on delete restrict,
  constraint work_order_pdfs_generated_by_user_id_fkey
    foreign key (generated_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint work_order_pdfs_document_version_one
    check (document_version = 1),
  constraint work_order_pdfs_content_hash_sha256
    check (
      content_hash is null
      or content_hash ~ '^[0-9a-f]{64}$'
    ),
  constraint work_order_pdfs_final_reference_for_work_order
    check (
      storage_reference ~ (
        '^final/'
        || work_order_id::text
        || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]pdf$'
      )
    )
);

create function public.validate_work_order_pdf_insert()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  perform 1
  from public.work_orders as work_order
  where work_order.id = new.work_order_id
    and work_order.status = 'finished'
  for key share;

  if not found then
    raise exception 'Finished Work Order is required for PDF'
      using errcode = '22023';
  end if;

  perform 1
  from storage.objects as object
  where object.bucket_id = 'work-order-pdfs'
    and object.name = new.storage_reference
    and object.metadata->>'mimetype' = 'application/pdf'
  for key share;

  if not found then
    raise exception 'Valid final Work Order PDF object is required'
      using errcode = '22023';
  end if;

  return new;
end;
$function$;

create trigger work_order_pdfs_validate_insert
before insert on public.work_order_pdfs
for each row
execute function public.validate_work_order_pdf_insert();

create function public.enforce_work_order_pdf_immutability()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  raise exception 'Work Order PDF is immutable'
    using errcode = 'WOR09';
end;
$function$;

create trigger work_order_pdfs_immutable
before update or delete on public.work_order_pdfs
for each row
execute function public.enforce_work_order_pdf_immutability();

revoke all privileges
  on function public.validate_work_order_pdf_insert()
  from public, anon, authenticated;

revoke all privileges
  on function public.enforce_work_order_pdf_immutability()
  from public, anon, authenticated;

alter table public.work_order_pdfs enable row level security;

revoke all privileges
  on table public.work_order_pdfs
  from public, anon, authenticated;

grant select
  on table public.work_order_pdfs
  to authenticated;

create policy work_order_pdfs_select_authorized_finished
on public.work_order_pdfs
for select
to authenticated
using (
  (
    public.current_user_is_admin()
    or public.has_permission('work_orders.view')
  )
  and exists (
    select 1
    from public.work_orders as work_order
    where work_order.id = work_order_pdfs.work_order_id
      and work_order.status = 'finished'
  )
);

create function public.can_read_work_order_pdf_object(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    auth.uid() is not null
    and (
      public.current_user_is_admin()
      or public.has_permission('work_orders.view')
    )
    and exists (
      select 1
      from public.work_order_pdfs as pdf
      join public.work_orders as work_order
        on work_order.id = pdf.work_order_id
      where pdf.storage_reference = p_object_name
        and work_order.status = 'finished'
    );
$function$;

revoke all privileges
  on function public.can_read_work_order_pdf_object(text)
  from public, anon, authenticated;

grant execute
  on function public.can_read_work_order_pdf_object(text)
  to authenticated;

-- A permissive policy grants the narrow intended read. The companion restrictive
-- policy ensures a later broad permissive Storage policy cannot expose any other
-- object in this bucket.
create policy work_order_pdf_objects_select_referenced
on storage.objects
for select
to authenticated
using (
  bucket_id = 'work-order-pdfs'
  and public.can_read_work_order_pdf_object(name)
);

create policy work_order_pdf_objects_select_guard_authenticated
on storage.objects
as restrictive
for select
to authenticated
using (
  bucket_id <> 'work-order-pdfs'
  or public.can_read_work_order_pdf_object(name)
);

create policy work_order_pdf_objects_select_guard_anon
on storage.objects
as restrictive
for select
to anon
using (bucket_id <> 'work-order-pdfs');

-- Browser writes remain blocked even if a future unrelated permissive Storage
-- policy is added. The service role remains the only byte-management authority.
create policy work_order_pdf_objects_insert_guard
on storage.objects
as restrictive
for insert
to anon, authenticated
with check (bucket_id <> 'work-order-pdfs');

create policy work_order_pdf_objects_update_guard
on storage.objects
as restrictive
for update
to anon, authenticated
using (bucket_id <> 'work-order-pdfs')
with check (bucket_id <> 'work-order-pdfs');

create policy work_order_pdf_objects_delete_guard
on storage.objects
as restrictive
for delete
to anon, authenticated
using (bucket_id <> 'work-order-pdfs');
