create table public.fixed_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  purchase_date date not null,
  quantity bigint not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by_user_id uuid not null references public.user_profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid not null references public.user_profiles(id) on delete restrict,
  archived_at timestamptz,
  archived_by_user_id uuid references public.user_profiles(id) on delete restrict,
  constraint fixed_assets_name_trimmed_nonblank check (
    name = pg_catalog.btrim(name) and pg_catalog.length(name) > 0
  ),
  constraint fixed_assets_category_allowed check (
    category in ('oprema', 'uredjaji', 'alati')
  ),
  constraint fixed_assets_quantity_positive check (quantity > 0),
  constraint fixed_assets_archive_state_consistent check (
    (is_active and archived_at is null and archived_by_user_id is null)
    or (not is_active and archived_at is not null and archived_by_user_id is not null)
  )
);

create function public.enforce_fixed_asset_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'Fixed Assets cannot be deleted' using errcode = 'FAS01';
  end if;
  if not old.is_active then
    raise exception 'Archived Fixed Assets are immutable' using errcode = 'FAS01';
  end if;
  return new;
end;
$function$;

create trigger fixed_assets_lifecycle_immutable
before update or delete on public.fixed_assets
for each row execute function public.enforce_fixed_asset_lifecycle();

revoke all privileges on function public.enforce_fixed_asset_lifecycle()
  from public, anon, authenticated;

alter table public.fixed_assets enable row level security;
revoke all privileges on table public.fixed_assets from public, anon, authenticated;
grant select on table public.fixed_assets to authenticated;

create policy fixed_assets_select_admin
on public.fixed_assets for select to authenticated
using (public.current_user_is_admin());

create function public.create_fixed_asset(
  p_name text, p_category text, p_purchase_date date, p_quantity bigint
) returns uuid
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  actor_id uuid;
  asset_id uuid;
  normalized_name text := pg_catalog.btrim(p_name);
  changed_at timestamptz := pg_catalog.clock_timestamp();
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if normalized_name is null or normalized_name = '' or
    p_category is null or p_category not in ('oprema', 'uredjaji', 'alati') or
    p_purchase_date is null or p_quantity is null or p_quantity <= 0 then
    raise exception 'Invalid Fixed Asset data' using errcode = '22023';
  end if;
  actor_id := public.current_active_user_profile_id();
  insert into public.fixed_assets (
    name, category, purchase_date, quantity,
    created_at, created_by_user_id, updated_at, updated_by_user_id
  ) values (
    normalized_name, p_category, p_purchase_date, p_quantity,
    changed_at, actor_id, changed_at, actor_id
  ) returning id into asset_id;
  perform public.append_audit_log(
    p_action_type => 'fixed_asset.created',
    p_entity_type => 'fixed_asset',
    p_summary => 'Created Fixed Asset',
    p_entity_id => asset_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'name', normalized_name, 'category', p_category,
      'purchase_date', p_purchase_date, 'quantity', p_quantity, 'is_active', true
    )
  );
  return asset_id;
end;
$function$;

create function public.update_fixed_asset(
  p_asset_id uuid, p_name text, p_category text,
  p_purchase_date date, p_quantity bigint
) returns uuid
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  actor_id uuid;
  current_asset public.fixed_assets%rowtype;
  normalized_name text := pg_catalog.btrim(p_name);
  changed_at timestamptz;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_asset_id is null or normalized_name is null or normalized_name = '' or
    p_category is null or p_category not in ('oprema', 'uredjaji', 'alati') or
    p_purchase_date is null or p_quantity is null or p_quantity <= 0 then
    raise exception 'Invalid Fixed Asset data' using errcode = '22023';
  end if;
  select asset.* into current_asset from public.fixed_assets as asset
  where asset.id = p_asset_id for update;
  if not found then raise exception 'Fixed Asset not found' using errcode = 'P0002'; end if;
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  actor_id := public.current_active_user_profile_id();
  if not current_asset.is_active then
    raise exception 'Archived Fixed Asset cannot be edited' using errcode = 'FAS01';
  end if;
  if (current_asset.name, current_asset.category, current_asset.purchase_date, current_asset.quantity)
    = (normalized_name, p_category, p_purchase_date, p_quantity) then
    return current_asset.id;
  end if;
  changed_at := pg_catalog.clock_timestamp();
  update public.fixed_assets set
    name = normalized_name, category = p_category,
    purchase_date = p_purchase_date, quantity = p_quantity,
    updated_at = changed_at, updated_by_user_id = actor_id
  where id = current_asset.id;
  perform public.append_audit_log(
    p_action_type => 'fixed_asset.updated',
    p_entity_type => 'fixed_asset',
    p_summary => 'Updated Fixed Asset',
    p_entity_id => current_asset.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'name', current_asset.name, 'category', current_asset.category,
      'purchase_date', current_asset.purchase_date, 'quantity', current_asset.quantity
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'name', normalized_name, 'category', p_category,
      'purchase_date', p_purchase_date, 'quantity', p_quantity
    )
  );
  return current_asset.id;
end;
$function$;

create function public.archive_fixed_asset(p_asset_id uuid)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  actor_id uuid;
  current_asset public.fixed_assets%rowtype;
  changed_at timestamptz;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_asset_id is null then
    raise exception 'Fixed Asset ID is required' using errcode = '22023';
  end if;
  select asset.* into current_asset from public.fixed_assets as asset
  where asset.id = p_asset_id for update;
  if not found then raise exception 'Fixed Asset not found' using errcode = 'P0002'; end if;
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  actor_id := public.current_active_user_profile_id();
  if not current_asset.is_active then
    raise exception 'Fixed Asset is already archived' using errcode = 'FAS01';
  end if;
  changed_at := pg_catalog.clock_timestamp();
  update public.fixed_assets set
    is_active = false, archived_at = changed_at, archived_by_user_id = actor_id,
    updated_at = changed_at, updated_by_user_id = actor_id
  where id = current_asset.id;
  perform public.append_audit_log(
    p_action_type => 'fixed_asset.archived',
    p_entity_type => 'fixed_asset',
    p_summary => 'Archived Fixed Asset',
    p_entity_id => current_asset.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'name', current_asset.name, 'category', current_asset.category,
      'purchase_date', current_asset.purchase_date,
      'quantity', current_asset.quantity, 'is_active', true
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'name', current_asset.name, 'category', current_asset.category,
      'purchase_date', current_asset.purchase_date,
      'quantity', current_asset.quantity, 'is_active', false,
      'archived_at', changed_at
    )
  );
  return current_asset.id;
end;
$function$;

revoke all privileges on function public.create_fixed_asset(text, text, date, bigint)
  from public, anon, authenticated;
revoke all privileges on function public.update_fixed_asset(uuid, text, text, date, bigint)
  from public, anon, authenticated;
revoke all privileges on function public.archive_fixed_asset(uuid)
  from public, anon, authenticated;

grant execute on function public.create_fixed_asset(text, text, date, bigint) to authenticated;
grant execute on function public.update_fixed_asset(uuid, text, text, date, bigint) to authenticated;
grant execute on function public.archive_fixed_asset(uuid) to authenticated;
