-- Complete PCB production through the existing Inventory mutation boundary.
-- The card lock serializes this operation with BOM save/rollover; the BOM
-- version lock serializes it with first-use and direct item mutations.
create function public.produce_pcb(
  p_pcb_card_id uuid,
  p_quantity_to_produce text,
  p_project_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  actor_is_admin boolean;
  card_record record;
  active_version_record record;
  bom_item record;
  product_record record;
  balance_record record;
  produced_quantity_text text;
  produced_quantity bigint;
  required_numeric numeric;
  input_product_ids uuid[] := '{}'::uuid[];
  input_required_quantities bigint[] := '{}'::bigint[];
  involved_product_ids uuid[];
  product_count integer := 0;
  balance_count integer := 0;
  input_position integer;
  created_run_id uuid;
  applied_movement_id uuid;
begin
  if auth.uid() is null or not (
    public.current_user_is_admin() or public.has_permission('pcb.produce')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if p_pcb_card_id is null then
    raise exception 'PCB Card ID is required' using errcode = '22023';
  end if;
  if p_quantity_to_produce is null
    or p_quantity_to_produce !~ '^[0-9]+$'
  then
    raise exception 'Invalid production quantity' using errcode = '22023';
  end if;
  produced_quantity_text := pg_catalog.ltrim(p_quantity_to_produce, '0');
  if produced_quantity_text = ''
    or pg_catalog.length(produced_quantity_text) > 19
    or (
      pg_catalog.length(produced_quantity_text) = 19
      and produced_quantity_text::numeric > 9223372036854775807::numeric
    )
  then
    raise exception 'Invalid production quantity' using errcode = '22023';
  end if;
  produced_quantity := produced_quantity_text::bigint;

  select card.id, card.is_active, card.output_product_id
  into card_record
  from public.pcb_cards as card
  where card.id = p_pcb_card_id
  for update;
  if not found then
    raise exception 'PCB Card not found' using errcode = 'P0002';
  end if;
  if not card_record.is_active then
    raise exception 'PCB Card is archived' using errcode = 'PCB07';
  end if;

  -- Re-check after the primary lock. Hold the actor row (and, for a
  -- non-Admin, the explicit grant row) against concurrent access revocation.
  if auth.uid() is null or not (
    public.current_user_is_admin() or public.has_permission('pcb.produce')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  select profile.id, profile.is_admin
  into actor_profile_id, actor_is_admin
  from public.user_profiles as profile
  where profile.auth_user_id = auth.uid() and profile.is_active
  for share;
  if not found then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if not actor_is_admin then
    perform 1
    from public.user_permissions as permission
    join public.permission_definitions as definition
      on definition.id = permission.permission_definition_id
    where permission.user_id = actor_profile_id
      and definition.key = 'pcb.produce'
      and definition.is_delegable
    for share of permission;
    if not found then
      raise exception 'Access denied' using errcode = '42501';
    end if;
  end if;

  select version.id, version.version_number
  into active_version_record
  from public.pcb_bom_versions as version
  where version.pcb_card_id = card_record.id and version.is_active
  for update;
  if not found then
    raise exception 'Active PCB BOM is unavailable' using errcode = 'PCB06';
  end if;
  if exists (
    select 1
    from public.pcb_bom_versions as version
    where version.pcb_card_id = card_record.id
      and version.version_number > active_version_record.version_number
  ) then
    raise exception 'Active PCB BOM is unavailable' using errcode = 'PCB06';
  end if;

  if p_project_id is not null then
    perform 1
    from public.projects as project
    where project.id = p_project_id
      and project.status in ('planned', 'in_progress', 'on_hold')
    for share;
    if not found then
      raise exception 'Project is unavailable for PCB production'
        using errcode = 'PCB10';
    end if;
  end if;

  -- The version lock freezes this authoritative item set. Empty BOMs are
  -- valid: the output still receives the produced quantity.
  for bom_item in
    select item.component_product_id, item.quantity_per_card
    from public.pcb_bom_items as item
    where item.bom_version_id = active_version_record.id
    order by item.component_product_id
  loop
    if bom_item.component_product_id = card_record.output_product_id then
      raise exception 'PCB Card cannot consume its own output Product'
        using errcode = 'PCB05';
    end if;
    required_numeric :=
      bom_item.quantity_per_card::numeric * produced_quantity::numeric;
    if required_numeric > 9223372036854775807::numeric then
      raise exception 'PCB input requirement exceeds Inventory capacity'
        using errcode = '22023';
    end if;
    input_product_ids := pg_catalog.array_append(
      input_product_ids, bom_item.component_product_id
    );
    input_required_quantities := pg_catalog.array_append(
      input_required_quantities, required_numeric::bigint
    );
  end loop;
  involved_product_ids := pg_catalog.array_append(
    input_product_ids, card_record.output_product_id
  );

  -- Product locks conflict with archival; stable UUID order avoids BOM-order
  -- lock inversions. The FK preserves missing historical references.
  for product_record in
    select product.id, product.is_active, product.product_kind
    from public.products as product
    where product.id = any(involved_product_ids)
    order by product.id
    for share
  loop
    product_count := product_count + 1;
    if product_record.id = card_record.output_product_id then
      if product_record.product_kind <> 'pcb_finished_good' then
        raise exception 'PCB Card output Product must be a PCB finished good'
          using errcode = 'PCB01';
      end if;
      if not product_record.is_active then
        raise exception 'PCB output Product is unavailable'
          using errcode = 'PRD01';
      end if;
    elsif not product_record.is_active
      or product_record.product_kind not in ('component', 'pcb_finished_good')
    then
      raise exception 'PCB BOM input Product is unavailable'
        using errcode = 'PCB04';
    end if;
  end loop;
  if product_count <> pg_catalog.cardinality(involved_product_ids) then
    raise exception 'PCB BOM Product is unavailable' using errcode = 'PCB04';
  end if;

  -- Lock every balance in Product-ID order, then validate ALL requirements
  -- before any mutation. The central primitive re-enters locks already held.
  for balance_record in
    select balance.product_id, balance.quantity
    from public.inventory_balances as balance
    where balance.product_id = any(involved_product_ids)
    order by balance.product_id
    for update
  loop
    balance_count := balance_count + 1;
    if balance_record.product_id = card_record.output_product_id then
      if balance_record.quantity::numeric + produced_quantity::numeric
        > 9223372036854775807::numeric
      then
        raise exception 'PCB output quantity exceeds Inventory capacity'
          using errcode = '22023';
      end if;
    else
      input_position := pg_catalog.array_position(
        input_product_ids, balance_record.product_id
      );
      if input_position is null
        or balance_record.quantity < input_required_quantities[input_position]
      then
        raise exception 'Insufficient physical Inventory'
          using errcode = 'IVB02';
      end if;
    end if;
  end loop;
  if balance_count <> pg_catalog.cardinality(involved_product_ids) then
    raise exception 'Inventory balance not found' using errcode = 'IVB01';
  end if;

  insert into public.pcb_production_runs as run (
    pcb_card_id, bom_version_id, project_id, quantity_produced,
    status, produced_by_user_id, completed_at
  ) values (
    card_record.id, active_version_record.id, p_project_id,
    produced_quantity, 'completed', actor_profile_id,
    pg_catalog.clock_timestamp()
  ) returning run.id into created_run_id;

  for input_position in
    select positions.position
    from pg_catalog.generate_subscripts(input_product_ids, 1) as positions(position)
  loop
    select applied.movement_id into applied_movement_id
    from public.apply_inventory_delta(
      p_product_id => input_product_ids[input_position],
      p_quantity_delta => -input_required_quantities[input_position],
      p_movement_type => 'pcb_production_input',
      p_reason => null,
      p_source_type => 'pcb_production_input',
      p_source_id => created_run_id,
      p_project_id => p_project_id,
      p_reversal_of_movement_id => null
    ) as applied;
    if applied_movement_id is null then
      raise exception 'PCB input movement was not created' using errcode = 'IVB01';
    end if;
  end loop;

  select applied.movement_id into applied_movement_id
  from public.apply_inventory_delta(
    p_product_id => card_record.output_product_id,
    p_quantity_delta => produced_quantity,
    p_movement_type => 'pcb_production_output',
    p_reason => null,
    p_source_type => 'pcb_production_output',
    p_source_id => created_run_id,
    p_project_id => p_project_id,
    p_reversal_of_movement_id => null
  ) as applied;
  if applied_movement_id is null then
    raise exception 'PCB output movement was not created' using errcode = 'IVB01';
  end if;

  perform public.append_audit_log(
    p_action_type => 'pcb_production.completed',
    p_entity_type => 'pcb_production_run',
    p_entity_id => created_run_id,
    p_summary => 'Completed PCB production',
    p_after_data => pg_catalog.jsonb_build_object(
      'pcb_card_id', card_record.id,
      'bom_version_id', active_version_record.id,
      'quantity_produced', produced_quantity,
      'project_id', p_project_id,
      'output_product_id', card_record.output_product_id
    )
  );

  return created_run_id;
end;
$function$;

revoke all privileges on function public.produce_pcb(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.produce_pcb(uuid, text, uuid)
  to authenticated;
