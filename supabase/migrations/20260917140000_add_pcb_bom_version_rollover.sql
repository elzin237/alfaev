-- A production run is the sole authority that makes a BOM version historical.
-- Match the trusted save's card -> version lock order before inserting a run.
-- The card FK would otherwise take its row lock after the version trigger lock,
-- creating the opposite lock order against a save that already holds the card.
create or replace function public.lock_pcb_bom_version_for_production()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  perform 1
  from public.pcb_cards as card
  where card.id = new.pcb_card_id
  for update;

  perform 1
  from public.pcb_bom_versions as version
  where version.id = new.bom_version_id
  for update;

  -- The existing card and composite card/version FKs validate identity.
  return new;
end;
$function$;

revoke all privileges on function public.lock_pcb_bom_version_for_production()
  from public, anon, authenticated;

-- Keep the established RPC signature: its name predates version rollover.
create or replace function public.save_initial_pcb_bom(
  p_pcb_card_id uuid,
  p_items jsonb
)
returns table (bom_version_id uuid, version_number bigint)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  card_record record;
  version_record record;
  product_record record;
  item jsonb;
  product_text text;
  quantity_text text;
  item_product_id uuid;
  item_quantity bigint;
  product_ids uuid[] := '{}'::uuid[];
  quantities bigint[] := '{}'::bigint[];
  required_product_ids uuid[] := '{}'::uuid[];
  input_position integer;
  existing_quantity bigint;
  version_count bigint := 0;
  active_count bigint := 0;
  validated_product_count integer := 0;
  highest_version_number bigint;
  active_version_number bigint;
  next_version_number bigint;
  active_version_id uuid;
  saved_version_id uuid;
  active_version_used boolean := false;
  previous_items jsonb;
  next_items jsonb;
begin
  if auth.uid() is null or not (
    public.current_user_is_admin()
    or public.has_permission('pcb.edit')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if p_pcb_card_id is null then
    raise exception 'PCB Card is required' using errcode = '22023';
  end if;

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

  -- Recheck after the card lock so a waiting caller cannot use stale authority.
  if not (
    public.current_user_is_admin()
    or public.has_permission('pcb.edit')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  actor_profile_id := public.current_active_user_profile_id();
  if actor_profile_id is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'PCB BOM items must be an array' using errcode = '22023';
  end if;

  -- Preserve the exact Task 090 decimal-string and legacy JSON-number input.
  for item in select entries.value from pg_catalog.jsonb_array_elements(p_items) as entries(value)
  loop
    if pg_catalog.jsonb_typeof(item) <> 'object'
      or not (item ? 'product_id')
      or not (item ? 'quantity_per_card')
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item)) <> 2
      or pg_catalog.jsonb_typeof(item -> 'product_id') <> 'string'
      or pg_catalog.jsonb_typeof(item -> 'quantity_per_card') not in ('number', 'string')
    then
      raise exception 'Invalid PCB BOM item' using errcode = '22023';
    end if;

    product_text := item ->> 'product_id';
    quantity_text := item ->> 'quantity_per_card';
    if product_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or quantity_text !~ '^[0-9]+$'
    then
      raise exception 'Invalid PCB BOM item' using errcode = '22023';
    end if;
    quantity_text := pg_catalog.ltrim(quantity_text, '0');
    if quantity_text = ''
      or pg_catalog.length(quantity_text) > 19
      or (pg_catalog.length(quantity_text) = 19 and quantity_text > '9223372036854775807')
    then
      raise exception 'Invalid PCB BOM item' using errcode = '22023';
    end if;

    item_product_id := product_text::uuid;
    item_quantity := quantity_text::bigint;
    if item_quantity <= 0 or item_product_id = card_record.output_product_id then
      raise exception 'Invalid PCB BOM item' using errcode = '22023';
    end if;
    if item_product_id = any(product_ids) then
      raise exception 'Duplicate PCB BOM Product' using errcode = '23505';
    end if;
    product_ids := pg_catalog.array_append(product_ids, item_product_id);
    quantities := pg_catalog.array_append(quantities, item_quantity);
  end loop;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'product_id', product_ids[input.position],
        'quantity_per_card', quantities[input.position]
      ) order by product_ids[input.position]
    ), '[]'::jsonb
  ) into next_items
  from pg_catalog.generate_subscripts(product_ids, 1) as input(position);

  -- Trusted saves serialize on the card. Lock every existing version in a
  -- deterministic order, including the active parent used by production.
  for version_record in
    select version.id, version.version_number, version.is_active
    from public.pcb_bom_versions as version
    where version.pcb_card_id = p_pcb_card_id
    order by version.version_number, version.id
    for update
  loop
    version_count := version_count + 1;
    highest_version_number := version_record.version_number;
    if version_record.is_active then
      active_count := active_count + 1;
      active_version_id := version_record.id;
      active_version_number := version_record.version_number;
    end if;
  end loop;

  if version_count > 0 and (
    active_count <> 1
    or active_version_number is distinct from highest_version_number
  ) then
    raise exception 'PCB BOM version state is unavailable' using errcode = 'PCB06';
  end if;

  if version_count > 0 then
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'product_id', existing.component_product_id,
          'quantity_per_card', existing.quantity_per_card
        ) order by existing.component_product_id
      ), '[]'::jsonb
    ) into previous_items
    from public.pcb_bom_items as existing
    where existing.bom_version_id = active_version_id;

    -- No-op is allowed even for a used version with archived historical inputs.
    if previous_items is not distinct from next_items then
      return query select active_version_id, active_version_number;
      return;
    end if;

    -- The locked active version serializes this check with first production.
    select exists (
      select 1
      from public.pcb_production_runs as run
      where run.bom_version_id = active_version_id
    ) into active_version_used;
  end if;

  if active_version_used then
    -- A successor INSERT creates every item anew, including unchanged ones.
    required_product_ids := product_ids;
  else
    -- Initial creation and unused-version edits retain Task 089A eligibility:
    -- unchanged archived references need no new Product validation.
    for input_position in
      select positions.position
      from pg_catalog.generate_subscripts(product_ids, 1) as positions(position)
    loop
      if version_count = 0 then
        required_product_ids := pg_catalog.array_append(
          required_product_ids, product_ids[input_position]
        );
      else
        select existing.quantity_per_card
        into existing_quantity
        from public.pcb_bom_items as existing
        where existing.bom_version_id = active_version_id
          and existing.component_product_id = product_ids[input_position];
        if not found or existing_quantity <> quantities[input_position] then
          required_product_ids := pg_catalog.array_append(
            required_product_ids, product_ids[input_position]
          );
        end if;
      end if;
    end loop;
  end if;

  -- FOR SHARE conflicts with Product archival until this transaction ends.
  -- Stable Product-ID order prevents opposite-order acquisition by savers.
  for product_record in
    select product.id, product.is_active, product.product_kind
    from public.products as product
    where product.id = any(required_product_ids)
    order by product.id
    for share
  loop
    validated_product_count := validated_product_count + 1;
    if not product_record.is_active
      or product_record.product_kind not in ('component', 'pcb_finished_good')
    then
      raise exception 'PCB BOM input Product is unavailable' using errcode = 'PCB04';
    end if;
  end loop;
  if validated_product_count <> pg_catalog.cardinality(required_product_ids) then
    raise exception 'PCB BOM input Product is unavailable' using errcode = 'PCB04';
  end if;

  if version_count = 0 then
    insert into public.pcb_bom_versions as created (
      pcb_card_id, version_number, is_active, created_by_user_id
    ) values (p_pcb_card_id, 1, true, actor_profile_id)
    returning created.id into saved_version_id;

    insert into public.pcb_bom_items (bom_version_id, component_product_id, quantity_per_card)
    select saved_version_id, product_ids[input.position], quantities[input.position]
    from pg_catalog.generate_subscripts(product_ids, 1) as input(position);

    perform public.append_audit_log(
      p_action_type => 'pcb_bom.created',
      p_entity_type => 'pcb_bom_version',
      p_entity_id => saved_version_id,
      p_summary => 'Created initial PCB BOM',
      p_after_data => pg_catalog.jsonb_build_object(
        'pcb_card_id', p_pcb_card_id,
        'bom_version_id', saved_version_id,
        'version_number', 1,
        'items', next_items
      )
    );
    return query select saved_version_id, 1::bigint;
    return;
  end if;

  if not active_version_used then
    -- Keep unchanged row IDs and archived references on an unused version.
    delete from public.pcb_bom_items as existing
    where existing.bom_version_id = active_version_id
      and not (existing.component_product_id = any(product_ids));

    update public.pcb_bom_items as existing
    set quantity_per_card = quantities[input.position]
    from pg_catalog.generate_subscripts(product_ids, 1) as input(position)
    where existing.bom_version_id = active_version_id
      and existing.component_product_id = product_ids[input.position]
      and existing.quantity_per_card <> quantities[input.position];

    insert into public.pcb_bom_items (bom_version_id, component_product_id, quantity_per_card)
    select active_version_id, product_ids[input.position], quantities[input.position]
    from pg_catalog.generate_subscripts(product_ids, 1) as input(position)
    left join public.pcb_bom_items as existing
      on existing.bom_version_id = active_version_id
      and existing.component_product_id = product_ids[input.position]
    where existing.id is null;

    perform public.append_audit_log(
      p_action_type => 'pcb_bom.updated',
      p_entity_type => 'pcb_bom_version',
      p_entity_id => active_version_id,
      p_summary => 'Updated PCB BOM',
      p_before_data => pg_catalog.jsonb_build_object(
        'pcb_card_id', p_pcb_card_id,
        'bom_version_id', active_version_id,
        'version_number', active_version_number,
        'items', previous_items
      ),
      p_after_data => pg_catalog.jsonb_build_object(
        'pcb_card_id', p_pcb_card_id,
        'bom_version_id', active_version_id,
        'version_number', active_version_number,
        'items', next_items
      )
    );
    return query select active_version_id, active_version_number;
    return;
  end if;

  if highest_version_number = 9223372036854775807 then
    raise exception 'PCB BOM version state is unavailable' using errcode = 'PCB06';
  end if;
  next_version_number := highest_version_number + 1;

  -- PCB09 allows exactly this old used-version transition, and nothing more.
  update public.pcb_bom_versions as previous
  set is_active = false
  where previous.id = active_version_id;

  insert into public.pcb_bom_versions as created (
    pcb_card_id, version_number, is_active, created_by_user_id
  ) values (p_pcb_card_id, next_version_number, true, actor_profile_id)
  returning created.id into saved_version_id;

  insert into public.pcb_bom_items (bom_version_id, component_product_id, quantity_per_card)
  select saved_version_id, product_ids[input.position], quantities[input.position]
  from pg_catalog.generate_subscripts(product_ids, 1) as input(position);

  perform public.append_audit_log(
    p_action_type => 'pcb_bom.version_created',
    p_entity_type => 'pcb_bom_version',
    p_entity_id => saved_version_id,
    p_summary => 'Created new PCB BOM version',
    p_before_data => pg_catalog.jsonb_build_object(
      'pcb_card_id', p_pcb_card_id,
      'bom_version_id', active_version_id,
      'version_number', active_version_number,
      'items', previous_items
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'pcb_card_id', p_pcb_card_id,
      'bom_version_id', saved_version_id,
      'version_number', next_version_number,
      'items', next_items
    )
  );

  return query select saved_version_id, next_version_number;
end;
$function$;

revoke all privileges on function public.save_initial_pcb_bom(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_initial_pcb_bom(uuid, jsonb)
  to authenticated;
