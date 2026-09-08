create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by_user_id uuid not null,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid not null,
  archived_at timestamptz,
  archived_by_user_id uuid,
  constraint brands_created_by_user_id_fkey
    foreign key (created_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint brands_updated_by_user_id_fkey
    foreign key (updated_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint brands_archived_by_user_id_fkey
    foreign key (archived_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint brands_name_trimmed_nonblank
    check (
      name = pg_catalog.btrim(name)
      and pg_catalog.length(name) > 0
    ),
  constraint brands_archive_state_consistent
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

create unique index brands_name_case_insensitive_key
  on public.brands (pg_catalog.lower(name));

alter table public.brands enable row level security;

revoke all privileges
  on table public.brands
  from public, anon, authenticated;

grant select
  on table public.brands
  to authenticated;

create policy brands_select_inventory_readers
on public.brands
for select
to authenticated
using (
  public.current_user_is_admin()
  or public.has_permission('inventory.view')
);

create function public.create_brand(p_name text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  brand_id uuid;
  changed_at timestamptz;
  normalized_name text;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('inventory.brands.manage')
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

  if normalized_name is null or pg_catalog.length(normalized_name) = 0 then
    raise exception 'Brand name is required'
      using errcode = '22023';
  end if;

  changed_at := pg_catalog.clock_timestamp();

  begin
    insert into public.brands (
      name,
      is_active,
      created_at,
      created_by_user_id,
      updated_at,
      updated_by_user_id
    )
    values (
      normalized_name,
      true,
      changed_at,
      actor_profile_id,
      changed_at,
      actor_profile_id
    )
    returning id into brand_id;
  exception
    when unique_violation then
      raise exception 'Brand name already exists'
        using errcode = 'BRN02';
  end;

  perform public.append_audit_log(
    p_action_type => 'brand.created',
    p_entity_type => 'brand',
    p_summary => 'Created Brand ' || normalized_name,
    p_entity_id => brand_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'name', normalized_name,
      'is_active', true
    )
  );

  return brand_id;
end;
$function$;

create function public.update_brand(
  p_brand_id uuid,
  p_name text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  current_brand public.brands%rowtype;
  changed_at timestamptz;
  normalized_name text;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('inventory.brands.manage')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_brand_id is null then
    raise exception 'Brand is required'
      using errcode = '22023';
  end if;

  actor_profile_id := public.current_active_user_profile_id();

  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  normalized_name := pg_catalog.btrim(p_name);

  if normalized_name is null or pg_catalog.length(normalized_name) = 0 then
    raise exception 'Brand name is required'
      using errcode = '22023';
  end if;

  select public.brands.*
  into current_brand
  from public.brands
  where public.brands.id = p_brand_id
  for update;

  if not found then
    raise exception 'Brand not found'
      using errcode = 'P0002';
  end if;

  if not current_brand.is_active then
    raise exception 'Archived Brands cannot be edited'
      using errcode = 'BRN01';
  end if;

  if current_brand.name = normalized_name then
    return current_brand.id;
  end if;

  changed_at := pg_catalog.clock_timestamp();

  begin
    update public.brands
    set name = normalized_name,
        updated_at = changed_at,
        updated_by_user_id = actor_profile_id
    where public.brands.id = current_brand.id;
  exception
    when unique_violation then
      raise exception 'Brand name already exists'
        using errcode = 'BRN02';
  end;

  perform public.append_audit_log(
    p_action_type => 'brand.updated',
    p_entity_type => 'brand',
    p_summary => 'Updated Brand ' || current_brand.name || ' to ' ||
      normalized_name,
    p_entity_id => current_brand.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'name', current_brand.name
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'name', normalized_name
    )
  );

  return current_brand.id;
end;
$function$;

create function public.archive_brand(p_brand_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  current_brand public.brands%rowtype;
  changed_at timestamptz;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('inventory.brands.manage')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_brand_id is null then
    raise exception 'Brand is required'
      using errcode = '22023';
  end if;

  actor_profile_id := public.current_active_user_profile_id();

  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  select public.brands.*
  into current_brand
  from public.brands
  where public.brands.id = p_brand_id
  for update;

  if not found then
    raise exception 'Brand not found'
      using errcode = 'P0002';
  end if;

  if not current_brand.is_active then
    raise exception 'Brand is already archived'
      using errcode = 'BRN01';
  end if;

  changed_at := pg_catalog.clock_timestamp();

  update public.brands
  set is_active = false,
      updated_at = changed_at,
      updated_by_user_id = actor_profile_id,
      archived_at = changed_at,
      archived_by_user_id = actor_profile_id
  where public.brands.id = current_brand.id;

  perform public.append_audit_log(
    p_action_type => 'brand.archived',
    p_entity_type => 'brand',
    p_summary => 'Archived Brand ' || current_brand.name,
    p_entity_id => current_brand.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'name', current_brand.name,
      'is_active', true,
      'archived_at', null,
      'archived_by_user_id', null
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'name', current_brand.name,
      'is_active', false,
      'archived_at', changed_at,
      'archived_by_user_id', actor_profile_id
    )
  );

  return current_brand.id;
end;
$function$;

revoke all privileges
  on function public.create_brand(text)
  from public, anon, authenticated;

revoke all privileges
  on function public.update_brand(uuid, text)
  from public, anon, authenticated;

revoke all privileges
  on function public.archive_brand(uuid)
  from public, anon, authenticated;

grant execute
  on function public.create_brand(text)
  to authenticated;

grant execute
  on function public.update_brand(uuid, text)
  to authenticated;

grant execute
  on function public.archive_brand(uuid)
  to authenticated;
