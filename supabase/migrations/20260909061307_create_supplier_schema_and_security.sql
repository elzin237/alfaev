create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country text not null,
  contact_person_name text,
  contact_phone text,
  contact_email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by_user_id uuid not null,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid not null,
  archived_at timestamptz,
  archived_by_user_id uuid,
  constraint suppliers_created_by_user_id_fkey
    foreign key (created_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint suppliers_updated_by_user_id_fkey
    foreign key (updated_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint suppliers_archived_by_user_id_fkey
    foreign key (archived_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint suppliers_name_trimmed_nonblank
    check (
      name = pg_catalog.btrim(name)
      and pg_catalog.length(name) > 0
    ),
  constraint suppliers_country_trimmed_nonblank
    check (
      country = pg_catalog.btrim(country)
      and pg_catalog.length(country) > 0
    ),
  constraint suppliers_contact_person_normalized
    check (
      contact_person_name is null
      or (
        contact_person_name = pg_catalog.btrim(contact_person_name)
        and pg_catalog.length(contact_person_name) > 0
      )
    ),
  constraint suppliers_contact_phone_normalized
    check (
      contact_phone is null
      or (
        contact_phone = pg_catalog.btrim(contact_phone)
        and pg_catalog.length(contact_phone) > 0
      )
    ),
  constraint suppliers_contact_email_normalized
    check (
      contact_email is null
      or (
        contact_email = pg_catalog.lower(pg_catalog.btrim(contact_email))
        and pg_catalog.length(contact_email) > 0
      )
    ),
  constraint suppliers_contact_email_basic_format
    check (
      contact_email is null
      or contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  constraint suppliers_archive_state_consistent
    check (
      (
        is_active
        and archived_at is null
        and archived_by_user_id is null
      )
      or (
        not is_active
        and archived_at is not null
        and archived_by_user_id is not null
      )
    )
);

create unique index suppliers_name_case_insensitive_key
  on public.suppliers (pg_catalog.lower(name));

alter table public.suppliers enable row level security;

revoke all privileges
  on table public.suppliers
  from public, anon, authenticated;

grant select
  on table public.suppliers
  to authenticated;

create policy suppliers_select_authorized
on public.suppliers
for select
to authenticated
using (
  public.current_user_is_admin()
  or public.has_permission('suppliers.view')
);

create function public.create_supplier(
  p_name text,
  p_country text,
  p_contact_person_name text default null,
  p_contact_phone text default null,
  p_contact_email text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  supplier_id uuid;
  changed_at timestamptz;
  normalized_name text;
  normalized_country text;
  normalized_contact_person_name text;
  normalized_contact_phone text;
  normalized_contact_email text;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('suppliers.create')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  actor_profile_id := public.current_active_user_profile_id();

  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  normalized_name := pg_catalog.btrim(p_name);
  normalized_country := pg_catalog.btrim(p_country);
  normalized_contact_person_name := nullif(
    pg_catalog.btrim(p_contact_person_name),
    ''
  );
  normalized_contact_phone := nullif(
    pg_catalog.btrim(p_contact_phone),
    ''
  );
  normalized_contact_email := pg_catalog.lower(
    nullif(pg_catalog.btrim(p_contact_email), '')
  );

  if normalized_name is null or pg_catalog.length(normalized_name) = 0 then
    raise exception 'Supplier name is required'
      using errcode = '22023';
  end if;

  if normalized_country is null
    or pg_catalog.length(normalized_country) = 0
  then
    raise exception 'Supplier country is required'
      using errcode = '22023';
  end if;

  if normalized_contact_email is not null
    and normalized_contact_email !~
      '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'Supplier email is invalid'
      using errcode = 'SUP03';
  end if;

  changed_at := pg_catalog.clock_timestamp();

  begin
    insert into public.suppliers (
      name,
      country,
      contact_person_name,
      contact_phone,
      contact_email,
      is_active,
      created_at,
      created_by_user_id,
      updated_at,
      updated_by_user_id
    )
    values (
      normalized_name,
      normalized_country,
      normalized_contact_person_name,
      normalized_contact_phone,
      normalized_contact_email,
      true,
      changed_at,
      actor_profile_id,
      changed_at,
      actor_profile_id
    )
    returning id into supplier_id;
  exception
    when unique_violation then
      raise exception 'Supplier name already exists'
        using errcode = 'SUP02';
  end;

  perform public.append_audit_log(
    p_action_type => 'supplier.created',
    p_entity_type => 'supplier',
    p_summary => 'Created Supplier ' || normalized_name,
    p_entity_id => supplier_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'name', normalized_name,
      'country', normalized_country,
      'contact_person_name', normalized_contact_person_name,
      'contact_phone', normalized_contact_phone,
      'contact_email', normalized_contact_email,
      'is_active', true
    )
  );

  return supplier_id;
end;
$function$;

create function public.update_supplier(
  p_supplier_id uuid,
  p_name text,
  p_country text,
  p_contact_person_name text default null,
  p_contact_phone text default null,
  p_contact_email text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  current_supplier public.suppliers%rowtype;
  changed_at timestamptz;
  normalized_name text;
  normalized_country text;
  normalized_contact_person_name text;
  normalized_contact_phone text;
  normalized_contact_email text;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('suppliers.edit')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_supplier_id is null then
    raise exception 'Supplier is required'
      using errcode = '22023';
  end if;

  actor_profile_id := public.current_active_user_profile_id();

  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  normalized_name := pg_catalog.btrim(p_name);
  normalized_country := pg_catalog.btrim(p_country);
  normalized_contact_person_name := nullif(
    pg_catalog.btrim(p_contact_person_name),
    ''
  );
  normalized_contact_phone := nullif(
    pg_catalog.btrim(p_contact_phone),
    ''
  );
  normalized_contact_email := pg_catalog.lower(
    nullif(pg_catalog.btrim(p_contact_email), '')
  );

  if normalized_name is null or pg_catalog.length(normalized_name) = 0 then
    raise exception 'Supplier name is required'
      using errcode = '22023';
  end if;

  if normalized_country is null
    or pg_catalog.length(normalized_country) = 0
  then
    raise exception 'Supplier country is required'
      using errcode = '22023';
  end if;

  if normalized_contact_email is not null
    and normalized_contact_email !~
      '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'Supplier email is invalid'
      using errcode = 'SUP03';
  end if;

  select public.suppliers.*
  into current_supplier
  from public.suppliers
  where public.suppliers.id = p_supplier_id
  for update;

  if not found then
    raise exception 'Supplier not found'
      using errcode = 'P0002';
  end if;

  if not current_supplier.is_active then
    raise exception 'Archived Suppliers cannot be edited'
      using errcode = 'SUP01';
  end if;

  if current_supplier.name = normalized_name
    and current_supplier.country = normalized_country
    and (
      current_supplier.contact_person_name
        is not distinct from normalized_contact_person_name
    )
    and (
      current_supplier.contact_phone
        is not distinct from normalized_contact_phone
    )
    and (
      current_supplier.contact_email
        is not distinct from normalized_contact_email
    )
  then
    return current_supplier.id;
  end if;

  changed_at := pg_catalog.clock_timestamp();

  begin
    update public.suppliers
    set name = normalized_name,
        country = normalized_country,
        contact_person_name = normalized_contact_person_name,
        contact_phone = normalized_contact_phone,
        contact_email = normalized_contact_email,
        updated_at = changed_at,
        updated_by_user_id = actor_profile_id
    where public.suppliers.id = current_supplier.id;
  exception
    when unique_violation then
      raise exception 'Supplier name already exists'
        using errcode = 'SUP02';
  end;

  perform public.append_audit_log(
    p_action_type => 'supplier.updated',
    p_entity_type => 'supplier',
    p_summary => 'Updated Supplier ' || current_supplier.name,
    p_entity_id => current_supplier.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'name', current_supplier.name,
      'country', current_supplier.country,
      'contact_person_name', current_supplier.contact_person_name,
      'contact_phone', current_supplier.contact_phone,
      'contact_email', current_supplier.contact_email
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'name', normalized_name,
      'country', normalized_country,
      'contact_person_name', normalized_contact_person_name,
      'contact_phone', normalized_contact_phone,
      'contact_email', normalized_contact_email
    )
  );

  return current_supplier.id;
end;
$function$;

revoke execute
  on function public.create_supplier(text, text, text, text, text)
  from public, anon, authenticated;

revoke execute
  on function public.update_supplier(uuid, text, text, text, text, text)
  from public, anon, authenticated;

grant execute
  on function public.create_supplier(text, text, text, text, text)
  to authenticated;

grant execute
  on function public.update_supplier(uuid, text, text, text, text, text)
  to authenticated;
