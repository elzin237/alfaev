create function public.create_pcb_card(p_name text)
returns table (
  pcb_card_id uuid,
  product_id uuid,
  serial_number text
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  allocated_serial_number text;
  changed_at timestamptz;
  created_product_id uuid;
  created_card_id uuid;
  normalized_name text;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('pcb.create')
    )
  then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  actor_profile_id := public.current_active_user_profile_id();
  if actor_profile_id is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  normalized_name := pg_catalog.btrim(p_name);
  if normalized_name is null or pg_catalog.length(normalized_name) = 0 then
    raise exception 'PCB Card name is required' using errcode = '22023';
  end if;

  allocated_serial_number := public.allocate_product_serial_number();
  changed_at := pg_catalog.clock_timestamp();

  insert into public.products as inserted (
    serial_number, name, category, brand_id, product_kind, is_active,
    created_at, created_by_user_id, updated_at, updated_by_user_id
  ) values (
    allocated_serial_number, normalized_name, 'PCB', null, 'pcb_finished_good', true,
    changed_at, actor_profile_id, changed_at, actor_profile_id
  ) returning inserted.id into created_product_id;

  -- The existing products_initialize_inventory_balance trigger creates exactly
  -- one zero balance for this newly inserted Product in the same transaction.
  insert into public.pcb_cards as inserted (
    name, output_product_id, is_active,
    created_at, created_by_user_id, updated_at, updated_by_user_id
  ) values (
    normalized_name, created_product_id, true,
    changed_at, actor_profile_id, changed_at, actor_profile_id
  ) returning inserted.id into created_card_id;

  perform public.append_audit_log(
    p_action_type => 'product.created',
    p_entity_type => 'product',
    p_summary => 'Created Product ' || allocated_serial_number || ' - ' || normalized_name,
    p_entity_id => created_product_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'serial_number', allocated_serial_number,
      'name', normalized_name,
      'category', 'PCB',
      'brand_id', null,
      'product_kind', 'pcb_finished_good',
      'is_active', true
    )
  );

  perform public.append_audit_log(
    p_action_type => 'pcb_card.created',
    p_entity_type => 'pcb_card',
    p_summary => 'Created PCB Card ' || normalized_name,
    p_entity_id => created_card_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'pcb_card_id', created_card_id,
      'name', normalized_name,
      'output_product_id', created_product_id,
      'serial_number', allocated_serial_number,
      'is_active', true
    )
  );

  return query
  select created_card_id, created_product_id, allocated_serial_number;
end;
$function$;

revoke all privileges on function public.create_pcb_card(text)
  from public, anon, authenticated;

grant execute on function public.create_pcb_card(text)
  to authenticated;
