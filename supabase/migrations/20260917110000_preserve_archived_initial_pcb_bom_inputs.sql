-- Preserve unchanged historical BOM inputs after their Products are archived.
-- New inputs and changed quantities still require an active eligible Product.
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
  changed_product_ids uuid[] := '{}'::uuid[];
  input_position integer;
  existing_quantity bigint;
  version_count integer := 0;
  validated_product_count integer := 0;
  saved_version_id uuid;
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

  for item in select entries.value from pg_catalog.jsonb_array_elements(p_items) as entries(value)
  loop
    if pg_catalog.jsonb_typeof(item) <> 'object'
      or not (item ? 'product_id')
      or not (item ? 'quantity_per_card')
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item)) <> 2
      or pg_catalog.jsonb_typeof(item -> 'product_id') <> 'string'
      or pg_catalog.jsonb_typeof(item -> 'quantity_per_card') <> 'number'
    then
      raise exception 'Invalid PCB BOM item' using errcode = '22023';
    end if;

    product_text := item ->> 'product_id';
    quantity_text := item ->> 'quantity_per_card';
    if product_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or quantity_text !~ '^[0-9]+$'
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

  for version_record in
    select version.id, version.version_number, version.is_active
    from public.pcb_bom_versions as version
    where version.pcb_card_id = p_pcb_card_id
    order by version.version_number
    for update
  loop
    version_count := version_count + 1;
    if version_count <> 1 or version_record.version_number <> 1 or not version_record.is_active then
      raise exception 'PCB BOM version state is unavailable' using errcode = 'PCB06';
    end if;
    saved_version_id := version_record.id;
  end loop;

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
    where existing.bom_version_id = saved_version_id;

    -- An identical set is a true no-op, including archived historical inputs.
    if previous_items is not distinct from next_items then
      return query select saved_version_id, 1::bigint;
      return;
    end if;
  end if;

  -- Compare with the persisted version before requiring active Products.
  -- The FK protects unchanged references; only additions/quantity changes
  -- require fresh eligibility checks and Product row locks.
  for input_position in
    select positions.position
    from pg_catalog.generate_subscripts(product_ids, 1) as positions(position)
  loop
    if version_count = 0 then
      changed_product_ids := pg_catalog.array_append(changed_product_ids, product_ids[input_position]);
    else
      select existing.quantity_per_card
      into existing_quantity
      from public.pcb_bom_items as existing
      where existing.bom_version_id = saved_version_id
        and existing.component_product_id = product_ids[input_position];
      if not found or existing_quantity <> quantities[input_position] then
        changed_product_ids := pg_catalog.array_append(changed_product_ids, product_ids[input_position]);
      end if;
    end if;
  end loop;

  -- FOR SHARE conflicts with Product archive updates until this transaction ends.
  -- Stable Product ID order avoids opposite-order lock acquisition by savers.
  for product_record in
    select product.id, product.is_active, product.product_kind
    from public.products as product
    where product.id = any(changed_product_ids)
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
  if validated_product_count <> pg_catalog.cardinality(changed_product_ids) then
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
  else
    -- Retain unchanged rows and IDs, including archived Product references.
    -- DELETE permits removal of archived inputs without firing the eligibility
    -- trigger; UPDATE/INSERT fire it only for changed/new active inputs.
    delete from public.pcb_bom_items as existing
    where existing.bom_version_id = saved_version_id
      and not (existing.component_product_id = any(product_ids));

    update public.pcb_bom_items as existing
    set quantity_per_card = quantities[input.position]
    from pg_catalog.generate_subscripts(product_ids, 1) as input(position)
    where existing.bom_version_id = saved_version_id
      and existing.component_product_id = product_ids[input.position]
      and existing.quantity_per_card <> quantities[input.position];

    insert into public.pcb_bom_items (bom_version_id, component_product_id, quantity_per_card)
    select saved_version_id, product_ids[input.position], quantities[input.position]
    from pg_catalog.generate_subscripts(product_ids, 1) as input(position)
    left join public.pcb_bom_items as existing
      on existing.bom_version_id = saved_version_id
      and existing.component_product_id = product_ids[input.position]
    where existing.id is null;

    perform public.append_audit_log(
      p_action_type => 'pcb_bom.updated',
      p_entity_type => 'pcb_bom_version',
      p_entity_id => saved_version_id,
      p_summary => 'Updated initial PCB BOM',
      p_before_data => pg_catalog.jsonb_build_object(
        'pcb_card_id', p_pcb_card_id,
        'bom_version_id', saved_version_id,
        'version_number', 1,
        'items', previous_items
      ),
      p_after_data => pg_catalog.jsonb_build_object(
        'pcb_card_id', p_pcb_card_id,
        'bom_version_id', saved_version_id,
        'version_number', 1,
        'items', next_items
      )
    );
  end if;

  return query select saved_version_id, 1::bigint;
end;
$function$;

revoke all privileges on function public.save_initial_pcb_bom(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_initial_pcb_bom(uuid, jsonb)
  to authenticated;
