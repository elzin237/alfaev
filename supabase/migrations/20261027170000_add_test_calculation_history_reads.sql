-- Saved historical results only; never return request payloads or retry receipts.
create function public.list_test_calculations(
  p_limit integer default 50,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
) returns table (
  calculation_id uuid,name text,creator_full_name text,created_at timestamptz,
  deadline_date date,deadline_timezone text,expires_at timestamptz,status text,as_of timestamptz
) language plpgsql stable security definer set search_path = '' as $$
declare read_at timestamptz := pg_catalog.clock_timestamp();
begin
  if auth.uid() is null or public.current_active_user_profile_id() is null
    or not (public.current_user_is_admin() or public.has_permission('test_calculator.view')) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100
    or (p_before_created_at is null) <> (p_before_id is null)
    or (p_before_created_at is not null and not pg_catalog.isfinite(p_before_created_at)) then
    raise exception 'Invalid history pagination' using errcode='22023';
  end if;
  return query
    select calculation.id,calculation.name,creator.full_name,calculation.created_at,
      calculation.deadline_date,calculation.deadline_timezone,calculation.expires_at,
      case when calculation.expires_at > read_at then 'active'::text else 'expired'::text end,read_at
    from public.test_calculations calculation
    join public.user_profiles creator on creator.id=calculation.created_by_user_id
    where p_before_created_at is null
      or (calculation.created_at,calculation.id) < (p_before_created_at,p_before_id)
    order by calculation.created_at desc,calculation.id desc limit p_limit;
end;
$$;

create function public.get_test_calculation(p_calculation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  read_at timestamptz := pg_catalog.clock_timestamp();
  result jsonb;
begin
  if auth.uid() is null or public.current_active_user_profile_id() is null
    or not (public.current_user_is_admin() or public.has_permission('test_calculator.view')) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  if p_calculation_id is null then
    raise exception 'Calculation identity required' using errcode='22023';
  end if;
  select pg_catalog.jsonb_build_object(
    'calculation_id',calculation.id,'name',calculation.name,'creator_full_name',creator.full_name,
    'created_at',calculation.created_at,'deadline_date',calculation.deadline_date,
    'deadline_timezone',calculation.deadline_timezone,'expires_at',calculation.expires_at,
    'status',case when calculation.expires_at > read_at then 'active' else 'expired' end,'as_of',read_at,
    'items',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'item_id',item.id,'product_id',item.product_id,'product_name_snapshot',item.product_name_snapshot,
      'serial_number_snapshot',item.serial_number_snapshot,'product_kind_snapshot',item.product_kind_snapshot,
      'required_quantity',item.required_quantity::text,'held_quantity',item.held_quantity::text,
      'missing_quantity',item.uncovered_quantity::text,
      'holds',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'warehouse_id',hold.warehouse_id,'warehouse_code',warehouse.code,'quantity',hold.quantity::text
      ) order by hold.warehouse_id)
      from public.test_calculation_holds hold
      join public.inventory_warehouses warehouse on warehouse.id=hold.warehouse_id
      where hold.item_id=item.id and hold.calculation_id=calculation.id),'[]'::jsonb)
    ) order by item.product_id,item.id)
    from public.test_calculation_items item where item.calculation_id=calculation.id),'[]'::jsonb)
  ) into result
  from public.test_calculations calculation
  join public.user_profiles creator on creator.id=calculation.created_by_user_id
  where calculation.id=p_calculation_id;
  if result is null then
    raise exception 'Calculation not found' using errcode='P0002';
  end if;
  return result;
end;
$$;

revoke all on function public.list_test_calculations(integer,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_test_calculation(uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_test_calculations(integer,timestamptz,uuid) to authenticated;
grant execute on function public.get_test_calculation(uuid) to authenticated;
