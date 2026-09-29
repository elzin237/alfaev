create function public.preflight_finish_work_order(
  p_work_order_id uuid,
  p_expected_updated_at timestamptz
)
returns table (
  work_order_id uuid,
  work_order_number text,
  project_id uuid,
  project_name text,
  customer_name_snapshot text,
  description text,
  updated_at timestamptz,
  item_count bigint,
  inventory_sufficient boolean,
  product_id uuid,
  serial_number text,
  product_name text,
  required_quantity bigint,
  available_quantity bigint,
  missing_quantity bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_is_admin boolean;
  actor_profile_id uuid;
  allocation_record record;
  balance_count bigint := 0;
  balance_record record;
  current_work_order public.work_orders%rowtype;
  inventory_sufficient_value boolean;
  item_count_value bigint;
  invalid_item_count bigint;
  product_count bigint := 0;
  product_record record;
  selected_project public.projects%rowtype;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('work_orders.finish')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_work_order_id is null then
    raise exception 'Work Order ID is required'
      using errcode = '22023';
  end if;

  if p_expected_updated_at is null then
    raise exception 'Expected Work Order update timestamp is required'
      using errcode = '22023';
  end if;

  -- Work Order is always the first domain lock. Save, delete, and future Finish
  -- use the same parent lock, so preflight cannot observe a partial Draft state.
  select work_order.*
  into current_work_order
  from public.work_orders as work_order
  where work_order.id = p_work_order_id
  for update;

  if not found then
    raise exception 'Work Order not found'
      using errcode = 'P0002';
  end if;

  -- Lock the active actor authority after the potentially blocking Work Order
  -- lock. A concurrent deactivation/Admin change or permission revocation must
  -- either win first and fail this call, or wait until this transaction ends.
  select profile.id, profile.is_admin
  into actor_profile_id, actor_is_admin
  from public.user_profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.is_active
  for share;

  if not found then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if not actor_is_admin then
    perform 1
    from public.user_permissions as permission
    join public.permission_definitions as definition
      on definition.id = permission.permission_definition_id
    where permission.user_id = actor_profile_id
      and definition.key = 'work_orders.finish'
      and definition.is_delegable
    for share of permission;

    if not found then
      raise exception 'Access denied'
        using errcode = '42501';
    end if;
  end if;

  if current_work_order.status <> 'draft' then
    raise exception 'Finished Work Orders cannot be modified'
      using errcode = 'WOR02';
  end if;

  if current_work_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'Work Order Draft has changed. Reload and try again.'
      using errcode = 'WOR05';
  end if;

  if current_work_order.work_order_number is null
    or pg_catalog.length(pg_catalog.btrim(
      current_work_order.work_order_number
    )) = 0
    or current_work_order.project_id is null
    or current_work_order.customer_name_snapshot is null
    or pg_catalog.length(pg_catalog.btrim(
      current_work_order.customer_name_snapshot
    )) = 0
    or current_work_order.description is null
    or pg_catalog.length(pg_catalog.btrim(current_work_order.description)) = 0
  then
    raise exception 'Work Order is incomplete for Finish'
      using errcode = 'WOR07';
  end if;

  -- Project row is the planning/lifecycle serialization authority. Holding an
  -- UPDATE lock prevents requirement, status, and Project-linked production
  -- changes from crossing this validation snapshot.
  select project.*
  into selected_project
  from public.projects as project
  where project.id = current_work_order.project_id
  for update;

  if not found then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  if selected_project.status not in ('planned', 'in_progress', 'on_hold') then
    raise exception 'Project is unavailable for Work Order Finish'
      using errcode = 'WOR08';
  end if;

  select
    pg_catalog.count(*),
    pg_catalog.count(*) filter (where item.quantity <= 0)
      + (
        pg_catalog.count(*)
        - pg_catalog.count(distinct item.product_id)
      )
  into item_count_value, invalid_item_count
  from public.work_order_items as item
  where item.work_order_id = current_work_order.id;

  if item_count_value = 0 then
    raise exception 'Work Order is incomplete for Finish'
      using errcode = 'WOR07';
  end if;

  if invalid_item_count <> 0 then
    raise exception 'Work Order materials are invalid for Finish'
      using errcode = '22023';
  end if;

  -- Revalidate the persisted desired state against the current Project plan.
  -- The current Draft is excluded; only other Drafts consume derived allocation.
  for allocation_record in
    select
      item.product_id,
      item.quantity,
      coalesce(commitment.outstanding_commitment, 0::numeric)
        as outstanding_commitment,
      coalesce((
        select pg_catalog.sum(other_item.quantity::numeric)
        from public.work_orders as other_work_order
        join public.work_order_items as other_item
          on other_item.work_order_id = other_work_order.id
        where other_work_order.project_id = current_work_order.project_id
          and other_work_order.status = 'draft'
          and other_work_order.id <> current_work_order.id
          and other_item.product_id = item.product_id
      ), 0::numeric) as other_draft_allocation
    from public.work_order_items as item
    left join public.calculate_open_project_commitments(item.product_id)
      as commitment
      on commitment.project_id = current_work_order.project_id
     and commitment.product_id = item.product_id
    where item.work_order_id = current_work_order.id
    order by item.product_id
  loop
    if allocation_record.quantity::numeric > greatest(
      allocation_record.outstanding_commitment
        - allocation_record.other_draft_allocation,
      0::numeric
    ) then
      raise exception 'Draft materials exceed the remaining Project requirement'
        using errcode = 'WOR06';
    end if;
  end loop;

  -- Stable Product lock order conflicts with archival while avoiding lock-order
  -- inversions. Every persisted Product is revalidated for physical consumption.
  for product_record in
    select
      product.id,
      product.is_active,
      product.product_kind
    from public.work_order_items as item
    join public.products as product
      on product.id = item.product_id
    where item.work_order_id = current_work_order.id
    order by product.id
    for share of product
  loop
    product_count := product_count + 1;
    if not product_record.is_active
      or product_record.product_kind not in (
        'component',
        'pcb_finished_good'
      )
    then
      raise exception 'Product is unavailable for Work Order'
        using errcode = 'PRD05';
    end if;
  end loop;

  if product_count <> item_count_value then
    raise exception 'Product is unavailable for Work Order'
      using errcode = 'PRD05';
  end if;

  -- Lock balances FOR UPDATE in deterministic Product-ID order. This provides
  -- one coherent stock snapshot, serializes competing physical-stock mutation,
  -- and lets future Finish reuse these locks without a SHARE-to-UPDATE upgrade.
  -- No quantity changes here and no reservation survives this transaction.
  for balance_record in
    select balance.product_id, balance.quantity
    from public.work_order_items as item
    join public.inventory_balances as balance
      on balance.product_id = item.product_id
    where item.work_order_id = current_work_order.id
    order by balance.product_id
    for update of balance
  loop
    balance_count := balance_count + 1;
  end loop;

  if balance_count <> item_count_value then
    raise exception 'Inventory balance not found'
      using errcode = 'IVB01';
  end if;

  select pg_catalog.bool_and(balance.quantity >= item.quantity)
  into inventory_sufficient_value
  from public.work_order_items as item
  join public.inventory_balances as balance
    on balance.product_id = item.product_id
  where item.work_order_id = current_work_order.id;

  return query
  select
    current_work_order.id,
    current_work_order.work_order_number,
    selected_project.id,
    selected_project.name,
    current_work_order.customer_name_snapshot,
    current_work_order.description,
    current_work_order.updated_at,
    item_count_value,
    inventory_sufficient_value,
    product.id,
    product.serial_number,
    product.name,
    item.quantity,
    balance.quantity,
    greatest(
      item.quantity::numeric - balance.quantity::numeric,
      0::numeric
    )::bigint
  from public.work_order_items as item
  join public.products as product
    on product.id = item.product_id
  join public.inventory_balances as balance
    on balance.product_id = item.product_id
  where item.work_order_id = current_work_order.id
  order by product.serial_number, product.id;
end;
$function$;

revoke all privileges
  on function public.preflight_finish_work_order(uuid, timestamptz)
  from public, anon, authenticated;

grant execute
  on function public.preflight_finish_work_order(uuid, timestamptz)
  to authenticated;
