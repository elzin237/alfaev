create index inventory_movements_product_created_id_idx
  on public.inventory_movements (product_id, created_at desc, id desc);

create function public.get_inventory_movements_for_product(
  p_product_id uuid
)
returns table (
  movement_id uuid,
  created_at timestamptz,
  movement_type text,
  quantity_delta bigint,
  quantity_before bigint,
  quantity_after bigint,
  reason text,
  source_type text,
  source_id uuid,
  project_id uuid,
  reversal_of_movement_id uuid,
  actor_user_id uuid,
  actor_full_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not (
    public.current_user_is_admin()
    or public.has_permission('inventory.view')
  ) then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_product_id is null then
    raise exception 'Product is required'
      using errcode = '22023';
  end if;

  return query
  select
    movement.id,
    movement.created_at,
    movement.movement_type,
    movement.quantity_delta,
    movement.quantity_before,
    movement.quantity_after,
    movement.reason,
    movement.source_type,
    movement.source_id,
    movement.project_id,
    movement.reversal_of_movement_id,
    movement.actor_user_id,
    actor.full_name
  from public.inventory_movements as movement
  join public.user_profiles as actor
    on actor.id = movement.actor_user_id
  where movement.product_id = p_product_id
  order by movement.created_at desc, movement.id desc;
end;
$function$;

revoke all privileges
  on function public.get_inventory_movements_for_product(uuid)
  from public, anon, authenticated;

grant execute
  on function public.get_inventory_movements_for_product(uuid)
  to authenticated;
