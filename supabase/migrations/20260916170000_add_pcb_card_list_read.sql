create function public.list_pcb_cards()
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
  order by card.is_active desc, pg_catalog.lower(card.name), card.id;
end;
$function$;

revoke all privileges on function public.list_pcb_cards()
  from public, anon, authenticated;
grant execute on function public.list_pcb_cards() to authenticated;
