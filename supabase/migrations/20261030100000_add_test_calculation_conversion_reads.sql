-- Additive, bounded provenance projection. Existing history/detail contracts stay unchanged.
create function public.get_test_calculation_conversions(
  p_calculation_ids uuid[], p_include_commitments boolean default false
) returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  observed_at timestamptz := pg_catalog.clock_timestamp();
  destination_allowed boolean;
  result jsonb;
begin
  if auth.uid() is null or public.current_active_user_profile_id() is null
    or not (public.current_user_is_admin() or public.has_permission('test_calculator.view')) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  if p_calculation_ids is null or p_include_commitments is null
    or pg_catalog.cardinality(p_calculation_ids) not between 1 and 100
    or pg_catalog.array_ndims(p_calculation_ids) <> 1
    or exists(select 1 from pg_catalog.unnest(p_calculation_ids) selected(id) where selected.id is null)
    or (select pg_catalog.count(distinct selected.id) from pg_catalog.unnest(p_calculation_ids) selected(id)) <> pg_catalog.cardinality(p_calculation_ids)
    or (p_include_commitments and pg_catalog.cardinality(p_calculation_ids) <> 1) then
    raise exception 'Invalid bounded calculation selection' using errcode='22023';
  end if;
  if (select pg_catalog.count(*) from public.test_calculations calculation where calculation.id=any(p_calculation_ids)) <> pg_catalog.cardinality(p_calculation_ids) then
    raise exception 'Calculation unavailable' using errcode='P0002';
  end if;
  destination_allowed := public.current_user_is_admin() or public.has_permission('pcb.view');
  with selected_items as materialized (
    select item.id,item.calculation_id,item.product_id from public.test_calculation_items item where item.calculation_id=any(p_calculation_ids)
  ), effective as materialized (
    select hold.* from public.active_test_holds_at(observed_at,
      coalesce((select pg_catalog.array_agg(distinct item.product_id) from selected_items item),'{}'::uuid[])) hold
    where hold.calculation_id=any(p_calculation_ids)
  )
  select pg_catalog.jsonb_build_object('as_of',observed_at,'next_expiry',(select pg_catalog.min(hold.expires_at) from effective hold),
    'rows',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'calculation_id',calculation.id,'imported',imported.id is not null,
      'can_navigate',imported.id is not null and destination_allowed and card.id is not null and output.id is not null,
      'destination',case when imported.id is not null and destination_allowed and card.id is not null and output.id is not null
        then pg_catalog.jsonb_build_object('calculator_id',imported.pcb_card_id,'product_id',imported.output_product_id,
          'serial_number',imported.output_serial_number,'imported_at',imported.imported_at) else null end,
      'items',case when p_include_commitments then coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'item_id',item.id,'product_id',item.product_id,
        'effective_quantity',coalesce((select pg_catalog.sum(hold.quantity) from effective hold where hold.item_id=item.id),0::numeric)::text,
        'warehouses',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('warehouse_id',hold.warehouse_id,'quantity',hold.quantity::text)
          order by hold.warehouse_id) from effective hold where hold.item_id=item.id),'[]'::jsonb)
      ) order by item.id) from selected_items item where item.calculation_id=calculation.id),'[]'::jsonb) else '[]'::jsonb end
    ) order by calculation.id)
    from public.test_calculations calculation
    left join public.test_calculation_imports imported on imported.calculation_id=calculation.id
    left join public.pcb_cards card on card.id=imported.pcb_card_id and card.output_product_id=imported.output_product_id
    left join public.products output on output.id=imported.output_product_id
    where calculation.id=any(p_calculation_ids))) into result;
  return result;
end;
$function$;
revoke all on function public.get_test_calculation_conversions(uuid[],boolean) from public,anon,authenticated,service_role;
grant execute on function public.get_test_calculation_conversions(uuid[],boolean) to authenticated;
