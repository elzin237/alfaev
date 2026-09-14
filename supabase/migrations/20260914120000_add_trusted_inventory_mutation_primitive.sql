create function public.apply_inventory_delta(
  p_product_id uuid,
  p_quantity_delta bigint,
  p_movement_type text,
  p_reason text default null,
  p_source_type text default null,
  p_source_id uuid default null,
  p_project_id uuid default null,
  p_reversal_of_movement_id uuid default null
)
returns table (
  movement_id uuid,
  quantity_before bigint,
  quantity_after bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  changed_at timestamptz;
  created_movement_id uuid;
  current_quantity bigint;
  normalized_movement_type text;
  normalized_reason text;
  normalized_source_type text;
  resulting_quantity bigint;
begin
  if p_product_id is null then
    raise exception 'Product is required'
      using errcode = '22023';
  end if;

  if p_quantity_delta is null then
    raise exception 'Quantity delta is required'
      using errcode = '22023';
  end if;

  normalized_movement_type := pg_catalog.btrim(p_movement_type);

  if normalized_movement_type is null
    or pg_catalog.length(normalized_movement_type) = 0
  then
    raise exception 'Movement type is required'
      using errcode = '22023';
  end if;

  normalized_reason := nullif(pg_catalog.btrim(p_reason), '');
  normalized_source_type := nullif(
    pg_catalog.btrim(p_source_type),
    ''
  );

  actor_profile_id := public.current_active_user_profile_id();

  if actor_profile_id is null then
    raise exception 'An active authenticated user is required'
      using errcode = '42501';
  end if;

  perform profile.id
  from public.user_profiles as profile
  where profile.id = actor_profile_id
    and profile.auth_user_id = auth.uid()
    and profile.is_active
  for share;

  if not found then
    raise exception 'An active authenticated user is required'
      using errcode = '42501';
  end if;

  select balance.quantity
  into current_quantity
  from public.inventory_balances as balance
  where balance.product_id = p_product_id
  for update;

  if not found then
    raise exception 'Inventory balance not found'
      using errcode = 'IVB01';
  end if;

  resulting_quantity := current_quantity + p_quantity_delta;

  if resulting_quantity < 0 then
    raise exception 'Inventory quantity cannot be negative'
      using errcode = 'IVB02';
  end if;

  changed_at := pg_catalog.clock_timestamp();

  update public.inventory_balances as balance
  set quantity = resulting_quantity,
      updated_at = changed_at
  where balance.product_id = p_product_id;

  insert into public.inventory_movements as inserted (
    product_id,
    movement_type,
    quantity_delta,
    quantity_before,
    quantity_after,
    reason,
    source_type,
    source_id,
    project_id,
    actor_user_id,
    created_at,
    reversal_of_movement_id
  )
  values (
    p_product_id,
    normalized_movement_type,
    p_quantity_delta,
    current_quantity,
    resulting_quantity,
    normalized_reason,
    normalized_source_type,
    p_source_id,
    p_project_id,
    actor_profile_id,
    changed_at,
    p_reversal_of_movement_id
  )
  returning inserted.id into created_movement_id;

  return query
  select created_movement_id, current_quantity, resulting_quantity;
end;
$function$;

revoke all privileges
  on function public.apply_inventory_delta(
    uuid,
    bigint,
    text,
    text,
    text,
    uuid,
    uuid,
    uuid
  )
  from public, anon, authenticated;
