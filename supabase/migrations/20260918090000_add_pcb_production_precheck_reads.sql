-- Narrow, read-only production inputs for actors with pcb.produce.
create function public.get_pcb_production_precheck(p_pcb_card_id uuid)
returns table (
  card_id uuid,
  card_name text,
  output_product_id uuid,
  output_serial_number text,
  output_product_is_active boolean,
  active_bom_version_id uuid,
  active_bom_version_number text,
  input_product_id uuid,
  input_product_name text,
  input_serial_number text,
  input_product_is_active boolean,
  quantity_per_card text,
  available_quantity text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_version_id uuid;
  current_version_number bigint;
begin
  if auth.uid() is null or not (
    public.current_user_is_admin() or public.has_permission('pcb.produce')
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
  perform 1 from public.pcb_cards as card
    where card.id = p_pcb_card_id and card.is_active;
  if not found then
    raise exception 'PCB Card is archived' using errcode = 'PCB07';
  end if;

  select version.id, version.version_number
    into current_version_id, current_version_number
  from public.pcb_bom_versions as version
  where version.pcb_card_id = p_pcb_card_id and version.is_active;
  if not found or exists (
    select 1 from public.pcb_bom_versions as version
    where version.pcb_card_id = p_pcb_card_id
      and version.version_number > current_version_number
  ) then
    raise exception 'Active PCB BOM is unavailable' using errcode = 'PCB06';
  end if;

  return query
  select card.id, card.name, output_product.id, output_product.serial_number,
         output_product.is_active, version.id, version.version_number::text,
         input_product.id, input_product.name, input_product.serial_number,
         input_product.is_active, item.quantity_per_card::text,
         input_balance.quantity::text
  from public.pcb_cards as card
  join public.products as output_product on output_product.id = card.output_product_id
  join public.pcb_bom_versions as version on version.id = current_version_id
  left join public.pcb_bom_items as item on item.bom_version_id = version.id
  left join public.products as input_product on input_product.id = item.component_product_id
  left join public.inventory_balances as input_balance
    on input_balance.product_id = input_product.id
  where card.id = p_pcb_card_id
  order by input_product.serial_number nulls first, item.id;
end;
$function$;

revoke all privileges on function public.get_pcb_production_precheck(uuid)
  from public, anon, authenticated;
grant execute on function public.get_pcb_production_precheck(uuid)
  to authenticated;

-- Project selector data only; this does not grant general Project reads.
create function public.list_pcb_production_project_choices()
returns table (project_id uuid, name text, status text)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not (
    public.current_user_is_admin() or public.has_permission('pcb.produce')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  return query
  select project.id, project.name, project.status
  from public.projects as project
  where project.status in ('planned', 'in_progress', 'on_hold')
  order by pg_catalog.lower(project.name), project.id;
end;
$function$;

revoke all privileges on function public.list_pcb_production_project_choices()
  from public, anon, authenticated;
grant execute on function public.list_pcb_production_project_choices()
  to authenticated;
