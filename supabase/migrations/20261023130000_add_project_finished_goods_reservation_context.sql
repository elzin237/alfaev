-- Phase 3D1: read-only Project/Finished Goods context. No mutation activation.
-- Share one demand formula across historical reads and open-Project accounting.
create function public.calculate_project_product_demand(
  p_project_id uuid default null,
  p_product_id uuid default null
)
returns table (
  project_id uuid, project_name text, product_id uuid,
  planned_requirement numeric, actual_project_consumption numeric,
  outstanding_commitment numeric
)
language sql stable security invoker set search_path = '' as $function$
  with planned as (
    select project.id as project_id, project.name as project_name,
      component.product_id,
      pg_catalog.sum(component.required_quantity::numeric) as planned_requirement
    from public.projects project
    join public.project_products parent on parent.project_id = project.id
    join public.project_product_components component on component.project_product_id = parent.id
    where (p_project_id is null or project.id = p_project_id)
      and (p_product_id is null or component.product_id = p_product_id)
    group by project.id, project.name, component.product_id
  ), consumed as (
    select movement.project_id, movement.product_id,
      pg_catalog.sum(-movement.quantity_delta::numeric) as consumed_quantity
    from public.inventory_movements movement
    where movement.project_id is not null and movement.quantity_delta < 0
      and movement.source_type in ('work_order','pcb_production_input','finished_goods_reservation_fulfillment')
      and (p_project_id is null or movement.project_id = p_project_id)
      and (p_product_id is null or movement.product_id = p_product_id)
    group by movement.project_id, movement.product_id
  )
  select planned.project_id, planned.project_name, planned.product_id,
    planned.planned_requirement, coalesce(consumed.consumed_quantity,0::numeric),
    greatest(planned.planned_requirement - coalesce(consumed.consumed_quantity,0::numeric),0::numeric)
  from planned left join consumed on consumed.project_id = planned.project_id
    and consumed.product_id = planned.product_id;
$function$;
revoke all on function public.calculate_project_product_demand(uuid,uuid)
  from public, anon, authenticated, service_role;

-- Preserve the signature, exact arithmetic and lifecycle scope of the existing
-- private commitment primitive. Closed history does NOT become open commitment.
create or replace function public.calculate_open_project_commitments(p_product_id uuid default null)
returns table (
  project_id uuid, project_name text, product_id uuid,
  planned_requirement numeric, actual_project_consumption numeric,
  outstanding_commitment numeric
)
language sql stable security invoker set search_path = '' as $function$
  select demand.* from public.calculate_project_product_demand(null,p_product_id) demand
  join public.projects project on project.id = demand.project_id
  where project.status in ('planned','in_progress','on_hold');
$function$;
revoke all on function public.calculate_open_project_commitments(uuid)
  from public, anon, authenticated, service_role;

create function public.get_project_finished_goods_reservation_context(p_project_id uuid)
returns table (
  product_id uuid,
  product_name text,
  serial_number text,
  planned_requirement numeric,
  actual_project_consumption numeric,
  outstanding_demand numeric,
  physical_quantity bigint,
  globally_reserved_quantity bigint,
  available_quantity bigint,
  project_reserved_quantity bigint,
  reservation_id uuid,
  reservation_version bigint
)
language plpgsql stable security definer set search_path = '' as $function$
begin
  if public.current_active_user_profile_id() is null or not (
    public.current_user_is_admin() or (public.has_permission('projects.view')
      and public.has_permission('inventory.finished_goods.view'))
  ) then raise exception 'Access denied' using errcode = '42501'; end if;
  if p_project_id is null then raise exception 'Project is required' using errcode = '22023'; end if;

  -- One statement/snapshot for demand, physical, all-Project aggregate and own
  -- reservation. No active-Product/open-Project filter hides retained history.
  return query
  with demanded as (
    select demand.*, product.name as product_name, product.serial_number
    from public.calculate_project_product_demand(p_project_id,null) demand
    join public.products product on product.id = demand.product_id
    where product.product_kind = 'pcb_finished_good'
      and exists (select 1 from public.pcb_cards card where card.output_product_id = product.id)
  ), reserved as (
    select state.product_id, pg_catalog.sum(state.reserved_quantity::numeric) as quantity
    from public.finished_goods_project_reservations state
    where state.reserved_quantity > 0
      and exists (select 1 from demanded where demanded.product_id = state.product_id)
    group by state.product_id
  )
  select demanded.product_id, demanded.product_name, demanded.serial_number,
    demanded.planned_requirement, demanded.actual_project_consumption, demanded.outstanding_commitment,
    coalesce(balance.quantity,0::bigint), coalesce(reserved.quantity,0::numeric)::bigint,
    (coalesce(balance.quantity,0::bigint)::numeric - coalesce(reserved.quantity,0::numeric))::bigint,
    coalesce(own.reserved_quantity,0::bigint), own.id, coalesce(own.version,0::bigint)
  from demanded
  left join public.inventory_balances balance on balance.product_id = demanded.product_id
    and balance.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid
  left join reserved on reserved.product_id = demanded.product_id
  left join public.finished_goods_project_reservations own
    on own.project_id = p_project_id and own.product_id = demanded.product_id
  order by demanded.serial_number, demanded.product_id;
end;
$function$;
revoke all on function public.get_project_finished_goods_reservation_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_project_finished_goods_reservation_context(uuid) to authenticated;
