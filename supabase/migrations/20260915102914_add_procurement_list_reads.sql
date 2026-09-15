create extension if not exists pg_trgm with schema extensions;

create index procurement_requests_requested_name_search_trgm_idx
  on public.procurement_requests
  using gin (pg_catalog.lower(requested_name) extensions.gin_trgm_ops);

create function public.search_procurement_requests(
  p_search text default null,
  p_status text default null,
  p_supplier_id uuid default null
)
returns table (
  request_id uuid,
  product_id uuid,
  product_serial_number text,
  requested_name text,
  supplier_id uuid,
  supplier_name text,
  requested_quantity bigint,
  delivered_quantity bigint,
  status text,
  created_at timestamptz,
  created_by_user_id uuid,
  created_by_full_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_search text := nullif(pg_catalog.btrim(p_search), '');
  v_escaped_search text;
  v_contains_pattern text;
  v_prefix_pattern text;
begin
  if not (
    public.current_user_is_admin()
    or public.has_permission('procurement.view')
  ) then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_status is not null
    and p_status not in ('active', 'partly_delivered', 'resolved')
  then
    raise exception 'Invalid Procurement status'
      using errcode = '22023';
  end if;

  if v_search is not null then
    v_escaped_search := pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(
          v_search,
          pg_catalog.chr(92),
          pg_catalog.chr(92) || pg_catalog.chr(92)
        ),
        '%',
        pg_catalog.chr(92) || '%'
      ),
      '_',
      pg_catalog.chr(92) || '_'
    );
    v_contains_pattern := '%' || pg_catalog.lower(v_escaped_search) || '%';
    v_prefix_pattern := v_escaped_search || '%';
  end if;

  return query
  select
    request.id,
    request.product_id,
    product.serial_number,
    request.requested_name,
    request.supplier_id,
    supplier.name,
    request.requested_quantity,
    request.delivered_quantity,
    request.status,
    request.created_at,
    request.created_by_user_id,
    creator.full_name
  from public.procurement_requests as request
  left join public.products as product
    on product.id = request.product_id
  join public.suppliers as supplier
    on supplier.id = request.supplier_id
  join public.user_profiles as creator
    on creator.id = request.created_by_user_id
  where
    (p_status is null or request.status = p_status)
    and (p_supplier_id is null or request.supplier_id = p_supplier_id)
    and (
      v_search is null
      or pg_catalog.lower(request.requested_name)
        like v_contains_pattern escape '\'
      or product.serial_number like v_prefix_pattern escape '\'
    )
  order by
    case request.status
      when 'active' then 1
      when 'partly_delivered' then 2
      when 'resolved' then 3
    end,
    request.created_at desc,
    request.id;
end;
$function$;

create function public.list_procurement_supplier_options()
returns table (
  supplier_id uuid,
  supplier_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not (
    public.current_user_is_admin()
    or public.has_permission('procurement.view')
  ) then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  return query
  select supplier.id, supplier.name
  from public.procurement_requests as request
  join public.suppliers as supplier
    on supplier.id = request.supplier_id
  group by supplier.id, supplier.name
  order by
    pg_catalog.lower(supplier.name),
    supplier.name,
    supplier.id;
end;
$function$;

revoke all privileges
  on function public.search_procurement_requests(text, text, uuid)
  from public, anon, authenticated;
revoke all privileges
  on function public.list_procurement_supplier_options()
  from public, anon, authenticated;

grant execute
  on function public.search_procurement_requests(text, text, uuid)
  to authenticated;
grant execute
  on function public.list_procurement_supplier_options()
  to authenticated;
