create function public.manual_adjust_inventory(
  p_product_id uuid,
  p_adjustment_type text,
  p_quantity bigint,
  p_reason text
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
  applied_movement_id uuid;
  applied_quantity_after bigint;
  applied_quantity_before bigint;
  current_product public.products%rowtype;
  current_quantity bigint;
  quantity_delta bigint;
  normalized_adjustment_type text;
  normalized_reason text;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_product_id is null or p_quantity is null then
    raise exception 'Product and quantity are required'
      using errcode = 'MIA01';
  end if;

  normalized_adjustment_type := pg_catalog.lower(
    pg_catalog.btrim(p_adjustment_type)
  );
  normalized_reason := pg_catalog.btrim(p_reason);

  if normalized_adjustment_type is null
    or normalized_adjustment_type not in ('add', 'remove', 'correction')
  then
    raise exception 'Invalid adjustment type'
      using errcode = 'MIA01';
  end if;

  if normalized_reason is null
    or pg_catalog.length(normalized_reason) = 0
  then
    raise exception 'Reason is required'
      using errcode = 'MIA01';
  end if;

  if normalized_adjustment_type in ('add', 'remove') and p_quantity <= 0 then
    raise exception 'Add and Remove quantity must be greater than zero'
      using errcode = 'MIA01';
  end if;

  if normalized_adjustment_type = 'correction' and p_quantity < 0 then
    raise exception 'Correction target cannot be negative'
      using errcode = 'MIA01';
  end if;

  select product.*
  into current_product
  from public.products as product
  where product.id = p_product_id
  for update;

  if not found then
    raise exception 'Product not found'
      using errcode = 'P0002';
  end if;

  select profile.id
  into actor_profile_id
  from public.user_profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.is_active
    and profile.is_admin
  for share;

  if not found then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if not current_product.is_active then
    raise exception 'Product is unavailable for Inventory adjustment'
      using errcode = 'PRD01';
  end if;

  case normalized_adjustment_type
    when 'add' then
      quantity_delta := p_quantity;
    when 'remove' then
      quantity_delta := -p_quantity;
    when 'correction' then
      select balance.quantity
      into current_quantity
      from public.inventory_balances as balance
      where balance.product_id = current_product.id
      for update;

      if not found then
        raise exception 'Inventory balance not found'
          using errcode = 'IVB01';
      end if;

      quantity_delta := p_quantity - current_quantity;

      if quantity_delta = 0 then
        raise exception 'Correction target already equals current stock'
          using errcode = 'MIA02';
      end if;
  end case;

  select applied.movement_id,
         applied.quantity_before,
         applied.quantity_after
  into applied_movement_id,
       applied_quantity_before,
       applied_quantity_after
  from public.apply_inventory_delta(
    p_product_id => current_product.id,
    p_quantity_delta => quantity_delta,
    p_movement_type => 'manual_' || normalized_adjustment_type,
    p_reason => normalized_reason,
    p_source_type => 'manual_adjustment',
    p_source_id => null,
    p_project_id => null,
    p_reversal_of_movement_id => null
  ) as applied;

  if applied_movement_id is null then
    raise exception 'Inventory adjustment failed'
      using errcode = 'IVB01';
  end if;

  perform public.append_audit_log(
    p_action_type => 'inventory.manual_adjusted',
    p_entity_type => 'product_inventory',
    p_summary => 'Manual Inventory ' || normalized_adjustment_type ||
      ' for Product ' || current_product.serial_number,
    p_entity_id => current_product.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'product_id', current_product.id,
      'quantity', applied_quantity_before
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'product_id', current_product.id,
      'adjustment_type', normalized_adjustment_type,
      'entered_quantity', p_quantity,
      'movement_type', 'manual_' || normalized_adjustment_type,
      'movement_id', applied_movement_id,
      'quantity_before', applied_quantity_before,
      'quantity_delta', quantity_delta,
      'quantity_after', applied_quantity_after,
      'reason', normalized_reason
    )
  );

  return query
  select applied_movement_id,
         applied_quantity_before,
         applied_quantity_after;
end;
$function$;

revoke all privileges
  on function public.manual_adjust_inventory(uuid, text, bigint, text)
  from public, anon, authenticated;

grant execute
  on function public.manual_adjust_inventory(uuid, text, bigint, text)
  to authenticated;
