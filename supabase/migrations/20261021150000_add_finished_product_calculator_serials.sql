do $block$
begin
  if exists (
    select 1
    from public.pcb_cards as card
    group by pg_catalog.lower(card.name)
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'Finished Product Calculator names must be unique'
      using errcode = 'PCB14';
  end if;
end;
$block$;

alter table public.products
  drop constraint products_serial_number_format,
  add constraint products_serial_number_format
    check (serial_number ~ '^([0-9]{3}|[0-9]{7})$');

create unique index pcb_cards_name_ci_key
  on public.pcb_cards (pg_catalog.lower(name));

drop function public.create_pcb_card(text);

create function public.create_pcb_card(
  p_name text,
  p_serial_number text
)
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
  changed_at timestamptz;
  created_product_id uuid;
  created_card_id uuid;
  normalized_name text;
  violated_constraint text;
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
    raise exception 'Finished Product Calculator Name/Code is required'
      using errcode = '22023';
  end if;

  if p_serial_number is null
    or not (p_serial_number ~ '^[0-9]{3}$')
  then
    raise exception 'Enter an exact three-digit Serial Number'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.pcb_cards as card
    where pg_catalog.lower(card.name) = pg_catalog.lower(normalized_name)
  ) then
    raise exception 'A Finished Product Calculator with this Name/Code already exists'
      using errcode = 'PCB14';
  end if;

  if exists (
    select 1
    from public.products as product
    where product.serial_number = p_serial_number
  ) then
    raise exception 'A Product with this Serial Number already exists'
      using errcode = 'PRD06';
  end if;

  changed_at := pg_catalog.clock_timestamp();

  begin
    insert into public.products as inserted (
      serial_number, name, category, brand_id, product_kind, is_active,
      created_at, created_by_user_id, updated_at, updated_by_user_id
    ) values (
      p_serial_number, normalized_name, 'PCB', null, 'pcb_finished_good', true,
      changed_at, actor_profile_id, changed_at, actor_profile_id
    ) returning inserted.id into created_product_id;

    -- The Product trigger creates one zero balance for each canonical warehouse
    -- in this same transaction.
    insert into public.pcb_cards as inserted (
      name, output_product_id, is_active,
      created_at, created_by_user_id, updated_at, updated_by_user_id
    ) values (
      normalized_name, created_product_id, true,
      changed_at, actor_profile_id, changed_at, actor_profile_id
    ) returning inserted.id into created_card_id;
  exception
    when unique_violation then
      get stacked diagnostics violated_constraint = CONSTRAINT_NAME;
      if violated_constraint = 'products_serial_number_key' then
        raise exception 'A Product with this Serial Number already exists'
          using errcode = 'PRD06';
      elsif violated_constraint = 'pcb_cards_name_ci_key' then
        raise exception 'A Finished Product Calculator with this Name/Code already exists'
          using errcode = 'PCB14';
      end if;
      raise;
  end;

  perform public.append_audit_log(
    p_action_type => 'product.created',
    p_entity_type => 'product',
    p_summary => 'Created Product ' || p_serial_number || ' - ' || normalized_name,
    p_entity_id => created_product_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'serial_number', p_serial_number,
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
    p_summary => 'Created Finished Product Calculator ' || normalized_name,
    p_entity_id => created_card_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'pcb_card_id', created_card_id,
      'name', normalized_name,
      'output_product_id', created_product_id,
      'serial_number', p_serial_number,
      'is_active', true
    )
  );

  return query
  select created_card_id, created_product_id, p_serial_number;
end;
$function$;

revoke all privileges
  on function public.create_pcb_card(text, text)
  from public, anon, authenticated;

grant execute
  on function public.create_pcb_card(text, text)
  to authenticated;

create or replace function public.resolve_work_order_product_barcode(
  p_work_order_id uuid,
  p_serial_number text
)
returns table (
  product_id uuid,
  serial_number text,
  name text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_work_order_status text;
  resolved_product public.products%rowtype;
begin
  if auth.uid() is null
    or public.current_active_user_profile_id() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('work_orders.edit_draft')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_work_order_id is null then
    raise exception 'Work Order ID is required'
      using errcode = '22023';
  end if;

  if p_serial_number is null
    or not (p_serial_number ~ '^([0-9]{3}|[0-9]{7})$')
  then
    raise exception 'Enter a 3- or 7-digit Serial Number'
      using errcode = '22023';
  end if;

  select work_order.status
  into current_work_order_status
  from public.work_orders as work_order
  where work_order.id = p_work_order_id;

  if not found then
    raise exception 'Work Order not found'
      using errcode = 'P0002';
  end if;

  if current_work_order_status <> 'draft' then
    raise exception 'Finished Work Orders cannot be modified'
      using errcode = 'WOR02';
  end if;

  select product.*
  into resolved_product
  from public.products as product
  where product.serial_number = p_serial_number;

  if not found then
    raise exception 'Product not found'
      using errcode = 'P0002';
  end if;

  if not resolved_product.is_active
    or resolved_product.product_kind not in ('component', 'pcb_finished_good')
  then
    raise exception 'Product is unavailable for Work Order'
      using errcode = 'PRD05';
  end if;

  return query
  select
    resolved_product.id,
    resolved_product.serial_number,
    resolved_product.name;
end;
$function$;

update public.permission_definitions
set
  label = case key
    when 'pcb.view' then 'View Finished Product Calculator'
    when 'pcb.create' then 'Create Finished Product Calculator/BOM'
    when 'pcb.edit' then 'Edit Finished Product Calculator/BOM'
    when 'pcb.produce' then 'Produce Finished Products'
    when 'pcb.archive' then 'Delete/Archive Finished Product Definitions'
  end,
  description = case key
    when 'pcb.view' then 'View Finished Product Calculator definitions.'
    when 'pcb.create' then 'Create Finished Product Calculator definitions and BOMs.'
    when 'pcb.edit' then 'Edit Finished Product Calculator definitions and BOMs where business rules allow.'
    when 'pcb.produce' then 'Run authorized finished-product production.'
    when 'pcb.archive' then 'Delete or archive Finished Product Calculator definitions where business rules allow.'
  end
where key in ('pcb.view', 'pcb.create', 'pcb.edit', 'pcb.produce', 'pcb.archive');
