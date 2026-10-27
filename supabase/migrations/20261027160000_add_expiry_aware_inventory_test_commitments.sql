-- TC-08: additive Inventory aggregates only; existing read/accounting contracts stay intact.
create function public.get_inventory_test_commitments(p_warehouse_id uuid,p_search text default null)
returns table (
  product_id uuid,warehouse_id uuid,quantity_scope text,
  physical_quantity text,project_commitment_quantity text,available_after_projects text,
  committed_to_tests text,available_after_projects_and_tests text,
  as_of timestamptz,next_expiry timestamptz
)
language plpgsql stable security definer set search_path = '' as $function$
declare required_permission text; read_at timestamptz;
begin
  if auth.uid() is null or public.current_active_user_profile_id() is null then
    raise exception 'Access denied' using errcode='42501'; end if;
  required_permission := public.inventory_warehouse_permission_key(p_warehouse_id,'view');
  if not (public.current_user_is_admin() or public.has_permission(required_permission))
    or (p_warehouse_id='10000000-0000-4000-8000-000000000001'::uuid and not (
      public.current_user_is_admin() or public.has_permission('inventory.customs.view')))
  then raise exception 'Access denied' using errcode='42501'; end if;
  -- One database-time observation and one read snapshot; never a client-supplied clock.
  read_at := pg_catalog.clock_timestamp();
  if p_warehouse_id='10000000-0000-4000-8000-000000000001'::uuid and exists (
    select 1 from public.search_inventory_products_by_warehouse(p_warehouse_id,p_search) listed
    where (select pg_catalog.count(*) from public.inventory_balances balance
      where balance.product_id=listed.id and balance.warehouse_id in (
        '10000000-0000-4000-8000-000000000001'::uuid,'10000000-0000-4000-8000-000000000003'::uuid)) <> 2
  ) then raise exception 'Inventory source data unavailable' using errcode='55000'; end if;
  return query
  with listed as materialized (
    select * from public.search_inventory_products_by_warehouse(p_warehouse_id,p_search)
  ), sources as (
    select balance.product_id,pg_catalog.sum(balance.quantity::numeric) quantity
    from public.inventory_balances balance join listed on listed.id=balance.product_id
    where (p_warehouse_id='10000000-0000-4000-8000-000000000001'::uuid and balance.warehouse_id in (
      '10000000-0000-4000-8000-000000000001'::uuid,'10000000-0000-4000-8000-000000000003'::uuid))
      or (p_warehouse_id<>'10000000-0000-4000-8000-000000000001'::uuid and balance.warehouse_id=p_warehouse_id)
    group by balance.product_id
  ), tests as (
    select hold.product_id,pg_catalog.sum(hold.quantity::numeric) quantity,
      pg_catalog.min(calculation.expires_at) expires_at
    from public.test_calculation_holds hold join public.test_calculations calculation on calculation.id=hold.calculation_id
    join listed on listed.id=hold.product_id
    where hold.quantity>0 and calculation.expires_at > read_at and (
      (p_warehouse_id='10000000-0000-4000-8000-000000000001'::uuid and hold.warehouse_id in (
        '10000000-0000-4000-8000-000000000001'::uuid,'10000000-0000-4000-8000-000000000003'::uuid))
      or (p_warehouse_id<>'10000000-0000-4000-8000-000000000001'::uuid and hold.warehouse_id=p_warehouse_id))
    group by hold.product_id
  ), planning as (
    -- Preserve the existing Raw planning Product/lifecycle scope, not Test-Save admission D.
    select commitment.product_id,pg_catalog.sum(commitment.outstanding_commitment) quantity
    from public.calculate_open_project_commitments() commitment join listed on listed.id=commitment.product_id
    where p_warehouse_id='10000000-0000-4000-8000-000000000001'::uuid group by commitment.product_id
  ), reservations as (
    select state.product_id,pg_catalog.sum(state.reserved_quantity::numeric) quantity
    from public.finished_goods_project_reservations state join listed on listed.id=state.product_id
    where p_warehouse_id='10000000-0000-4000-8000-000000000002'::uuid group by state.product_id
  ), quantities as (
    select listed.*,sources.quantity eligible,
      coalesce(planning.quantity,reservations.quantity,0::numeric) project_quantity,
      coalesce(tests.quantity,0::numeric) test_quantity,tests.expires_at
    from listed join sources on sources.product_id=listed.id
    left join planning on planning.product_id=listed.id
    left join reservations on reservations.product_id=listed.id
    left join tests on tests.product_id=listed.id
  )
  select quantities.id,p_warehouse_id,
    case when p_warehouse_id='10000000-0000-4000-8000-000000000001'::uuid then 'raw_customs_planning'
      when p_warehouse_id='10000000-0000-4000-8000-000000000002'::uuid then 'finished_goods_reservations'
      else 'customs_physical' end,
    quantities.quantity::text,quantities.project_quantity::text,(quantities.eligible-quantities.project_quantity)::text,
    quantities.test_quantity::text,(quantities.eligible-quantities.project_quantity-quantities.test_quantity)::text,
    read_at,quantities.expires_at
  from quantities order by quantities.serial_number,quantities.id;
end;
$function$;
revoke all on function public.get_inventory_test_commitments(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_inventory_test_commitments(uuid,text) to authenticated;
