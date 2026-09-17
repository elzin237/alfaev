-- Narrow PCB detail/BOM projection for PCB readers; no general Inventory read.
create function public.get_pcb_bom_editor(p_pcb_card_id uuid)
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
  left join public.pcb_bom_versions as version
    on version.pcb_card_id = card.id and version.is_active
  left join public.pcb_bom_items as item on item.bom_version_id = version.id
  left join public.products as input_product on input_product.id = item.component_product_id
  left join public.inventory_balances as input_balance
    on input_balance.product_id = input_product.id
  where card.id = p_pcb_card_id
  order by input_product.serial_number nulls first, item.id;
end;
$function$;

revoke all privileges on function public.get_pcb_bom_editor(uuid)
  from public, anon, authenticated;
grant execute on function public.get_pcb_bom_editor(uuid) to authenticated;

-- Active, eligible Product choices for authorized PCB BOM editors only.
create function public.search_pcb_bom_product_choices(
  p_pcb_card_id uuid,
  p_search text default null
)
returns table (
  product_id uuid,
  product_name text,
  serial_number text,
  product_kind text,
  current_stock text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  card_output_product_id uuid;
  search_term text := pg_catalog.btrim(coalesce(p_search, ''));
begin
  if auth.uid() is null or not (
    public.current_user_is_admin()
    or public.has_permission('pcb.edit')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_pcb_card_id is null then
    raise exception 'PCB Card ID is required' using errcode = '22023';
  end if;

  select card.output_product_id into card_output_product_id
  from public.pcb_cards as card
  where card.id = p_pcb_card_id and card.is_active;
  if not found then
    raise exception 'PCB Card is unavailable' using errcode = 'PCB07';
  end if;

  return query
  select product.id, product.name, product.serial_number,
         product.product_kind, balance.quantity::text
  from public.products as product
  join public.inventory_balances as balance on balance.product_id = product.id
  where product.is_active
    and product.product_kind in ('component', 'pcb_finished_good')
    and product.id <> card_output_product_id
    and (
      search_term = ''
      or pg_catalog.strpos(pg_catalog.lower(product.name), pg_catalog.lower(search_term)) > 0
      or pg_catalog.left(product.serial_number, pg_catalog.length(search_term)) = search_term
    )
  order by pg_catalog.lower(product.name), product.serial_number, product.id
  limit 50;
end;
$function$;

revoke all privileges on function public.search_pcb_bom_product_choices(uuid, text)
  from public, anon, authenticated;
grant execute on function public.search_pcb_bom_product_choices(uuid, text)
  to authenticated;
