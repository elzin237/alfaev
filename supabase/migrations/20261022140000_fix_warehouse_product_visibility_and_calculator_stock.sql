-- Listing membership is distinct from structural warehouse balances.
-- Preserve Raw compatibility and all historical stock; only Calculator outputs
-- belong to the Finished Goods list. Customs membership survives depletion
-- through committed, immutable movement history. Reads never create membership.
create or replace function public.search_inventory_products_by_warehouse(
  p_warehouse_id uuid,
  p_search text default null
)
returns table (
  id uuid,
  warehouse_id uuid,
  serial_number text,
  name text,
  category text,
  brand_name text,
  product_kind text,
  is_active boolean,
  quantity bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  required_permission text;
  normalized_search text := nullif(pg_catalog.btrim(p_search), '');
  escaped_search text;
  contains_pattern text;
  prefix_pattern text;
begin
  if auth.uid() is null or public.current_active_user_profile_id() is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  required_permission := public.inventory_warehouse_permission_key(
    p_warehouse_id, 'view'
  );
  if not (
    public.current_user_is_admin()
    or public.has_permission(required_permission)
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if normalized_search is not null then
    escaped_search := pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(
          normalized_search,
          pg_catalog.chr(92),
          pg_catalog.chr(92) || pg_catalog.chr(92)
        ),
        '%', pg_catalog.chr(92) || '%'
      ),
      '_', pg_catalog.chr(92) || '_'
    );
    contains_pattern := '%' || pg_catalog.lower(escaped_search) || '%';
    prefix_pattern := escaped_search || '%';
  end if;

  return query
  select
    product.id,
    balance.warehouse_id,
    product.serial_number,
    product.name,
    product.category,
    brand.name,
    product.product_kind,
    product.is_active,
    balance.quantity
  from public.products as product
  join public.inventory_balances as balance
    on balance.product_id = product.id
    and balance.warehouse_id = p_warehouse_id
  left join public.brands as brand on brand.id = product.brand_id
  where (
    normalized_search is null
    or pg_catalog.lower(product.name) like contains_pattern escape '\'
    or pg_catalog.lower(product.category) like contains_pattern escape '\'
    or product.serial_number like prefix_pattern escape '\'
    or exists (
      select 1
      from public.product_suppliers as relationship
      where relationship.product_id = product.id
        and relationship.catalog_number is not null
        and pg_catalog.lower(relationship.catalog_number)
          like contains_pattern escape '\'
    )
  )
  and (
    p_warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid
    or (
      p_warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid
      and exists (
        select 1 from public.pcb_cards as card
        where card.output_product_id = product.id
      )
    )
    or (
      p_warehouse_id = '10000000-0000-4000-8000-000000000003'::uuid
      and (
        balance.quantity > 0
        or exists (
          select 1 from public.inventory_movements as movement
          where movement.product_id = product.id
            and movement.warehouse_id = p_warehouse_id
        )
      )
    )
  )
  order by product.serial_number, product.id;
end;
$function$;

-- Calculator output stock means Finished Goods, not legacy Raw stock.
create or replace function public.list_pcb_cards()
returns table (
  pcb_card_id uuid,
  card_name text,
  is_active boolean,
  output_product_id uuid,
  serial_number text,
  current_stock bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('pcb.view')
    )
  then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  return query
  select card.id, card.name, card.is_active, card.output_product_id,
         product.serial_number, balance.quantity
  from public.pcb_cards as card
  join public.products as product on product.id = card.output_product_id
  join public.inventory_balances as balance on balance.product_id = product.id
    and balance.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid
  order by card.is_active desc, pg_catalog.lower(card.name), card.id;
end;
$function$;

-- Only output stock changes warehouse; BOM input stock remains Raw Materials.
-- Narrow PCB detail/BOM projection for PCB readers; no general Inventory read.
create or replace function public.get_pcb_bom_editor(p_pcb_card_id uuid)
returns table (
  card_id uuid,
  card_name text,
  card_is_active boolean,
  output_product_id uuid,
  output_serial_number text,
  output_current_stock text,
  active_bom_version_id uuid,
  active_bom_version_number text,
  bom_item_id uuid,
  input_product_id uuid,
  input_product_name text,
  input_serial_number text,
  input_product_kind text,
  input_product_is_active boolean,
  input_current_stock text,
  quantity_per_card text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not (
    public.current_user_is_admin()
    or public.has_permission('pcb.view')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_pcb_card_id is null then
    raise exception 'PCB Card ID is required' using errcode = '22023';
  end if;
  perform 1 from public.pcb_cards as card where card.id = p_pcb_card_id;
  if not found then
    raise exception 'PCB Card not found' using errcode = 'P0002';
  end if;

  return query
  select card.id, card.name, card.is_active, card.output_product_id,
         output_product.serial_number, output_balance.quantity::text,
         version.id, version.version_number::text,
         item.id, input_product.id, input_product.name,
         input_product.serial_number, input_product.product_kind,
         input_product.is_active, input_balance.quantity::text,
         item.quantity_per_card::text
  from public.pcb_cards as card
  join public.products as output_product on output_product.id = card.output_product_id
  join public.inventory_balances as output_balance
    on output_balance.product_id = output_product.id
    and output_balance.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid
  left join public.pcb_bom_versions as version
    on version.pcb_card_id = card.id and version.is_active
  left join public.pcb_bom_items as item on item.bom_version_id = version.id
  left join public.products as input_product on input_product.id = item.component_product_id
  left join public.inventory_balances as input_balance
    on input_balance.product_id = input_product.id
    and input_balance.warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid
  where card.id = p_pcb_card_id
  order by input_product.serial_number nulls first, item.id;
end;
$function$;

-- CREATE OR REPLACE preserves existing authenticated-only EXECUTE ACLs.
-- No table, RLS, mutation, signature, or historical-data changes.

