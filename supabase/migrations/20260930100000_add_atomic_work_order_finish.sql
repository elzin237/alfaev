-- Draft deletion participates in the same Work Order -> Project lock order as
-- Finish. The Project lock is serialization only: deletion never mutates it.
create or replace function public.delete_draft_work_order(
  p_work_order_id uuid,
  p_expected_updated_at timestamptz
)
returns table (
  work_order_id uuid,
  work_order_number text
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  before_materials jsonb;
  current_work_order public.work_orders%rowtype;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('work_orders.delete_draft')
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

  actor_profile_id := public.current_active_user_profile_id();
  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  select work_order.*
  into current_work_order
  from public.work_orders as work_order
  where work_order.id = p_work_order_id
  for update;

  if not found then
    raise exception 'Work Order not found'
      using errcode = 'P0002';
  end if;

  -- Authorization can change while the caller waits for the Work Order lock.
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('work_orders.delete_draft')
    )
    or public.current_active_user_profile_id() is distinct from actor_profile_id
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if current_work_order.status <> 'draft' then
    raise exception 'Finished Work Orders cannot be deleted'
      using errcode = 'WOR02';
  end if;

  if current_work_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'Work Order Draft has changed. Reload and try again.'
      using errcode = 'WOR05';
  end if;

  if current_work_order.project_id is not null then
    perform project.id
    from public.projects as project
    where project.id = current_work_order.project_id
    for update;

    if not found then
      raise exception 'Project not found'
        using errcode = 'P0002';
    end if;

    -- Authority and optimistic state must still be valid after waiting for the
    -- shared Project serialization boundary used by Finish.
    if auth.uid() is null
      or not (
        public.current_user_is_admin()
        or public.has_permission('work_orders.delete_draft')
      )
      or public.current_active_user_profile_id() is distinct from actor_profile_id
    then
      raise exception 'Access denied'
        using errcode = '42501';
    end if;

    if current_work_order.status <> 'draft' then
      raise exception 'Finished Work Orders cannot be deleted'
        using errcode = 'WOR02';
    end if;

    if current_work_order.updated_at is distinct from p_expected_updated_at then
      raise exception 'Work Order Draft has changed. Reload and try again.'
        using errcode = 'WOR05';
    end if;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'product_id', item.product_id,
        'quantity', item.quantity
      )
      order by item.product_id
    ),
    '[]'::jsonb
  )
  into before_materials
  from public.work_order_items as item
  where item.work_order_id = current_work_order.id;

  delete from public.work_order_items as item
  where item.work_order_id = current_work_order.id;

  delete from public.work_orders as work_order
  where work_order.id = current_work_order.id;

  perform public.append_audit_log(
    p_action_type => 'work_order.deleted',
    p_entity_type => 'work_order',
    p_summary => 'Deleted Work Order ' || current_work_order.work_order_number,
    p_entity_id => current_work_order.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'work_order_id', current_work_order.id,
      'work_order_number', current_work_order.work_order_number,
      'status', current_work_order.status,
      'project_id', current_work_order.project_id,
      'customer_name_snapshot', current_work_order.customer_name_snapshot,
      'description', current_work_order.description,
      'materials', before_materials
    ),
    p_after_data => null
  );

  return query
  select current_work_order.id, current_work_order.work_order_number;
end;
$function$;

revoke all privileges
  on function public.delete_draft_work_order(uuid, timestamptz)
  from public, anon, authenticated;

grant execute
  on function public.delete_draft_work_order(uuid, timestamptz)
  to authenticated;

-- Finish reuses the Task 117 validation function in the same transaction so its
-- Work Order, actor, Project, Product, and InventoryBalance locks remain held
-- through every stock, lifecycle, PDF-metadata, and audit mutation below.
create function public.finish_work_order(
  p_work_order_id uuid,
  p_expected_updated_at timestamptz,
  p_pdf_storage_reference text,
  p_pdf_content_hash text default null
)
returns table (
  work_order_id uuid,
  work_order_number text,
  finished_at timestamptz,
  project_id uuid,
  project_completed boolean,
  work_order_pdf_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  applied_movement_id uuid;
  created_pdf_id uuid;
  current_project public.projects%rowtype;
  finish_timestamp timestamptz;
  inventory_sufficient_value boolean := true;
  material_record record;
  movement_ids uuid[] := '{}'::uuid[];
  project_completed_value boolean := false;
  trusted_project_id uuid;
  trusted_work_order_number text;
  validated_item_count bigint := 0;
  validation_record record;
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

  if p_pdf_storage_reference is null
    or not (
      p_pdf_storage_reference ~ (
        '^final/'
        || p_work_order_id::text
        || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]pdf$'
      )
    )
  then
    raise exception 'Valid final Work Order PDF reference is required'
      using errcode = '22023';
  end if;

  if p_pdf_content_hash is not null
    and p_pdf_content_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Work Order PDF content hash is invalid'
      using errcode = '22023';
  end if;

  -- Task 117 is called exactly once. Its blocking-lock authorization continuity
  -- check and all domain validation remain authoritative for this transaction.
  for validation_record in
    select preflight.*
    from public.preflight_finish_work_order(
      p_work_order_id,
      p_expected_updated_at
    ) as preflight
  loop
    validated_item_count := validated_item_count + 1;
    trusted_work_order_number := validation_record.work_order_number;
    trusted_project_id := validation_record.project_id;
    inventory_sufficient_value :=
      inventory_sufficient_value
      and validation_record.inventory_sufficient;
  end loop;

  if validated_item_count = 0 then
    raise exception 'Work Order is incomplete for Finish'
      using errcode = 'WOR07';
  end if;

  if not inventory_sufficient_value then
    raise exception 'Insufficient physical Inventory'
      using errcode = 'IVB02';
  end if;

  actor_profile_id := public.current_active_user_profile_id();
  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  -- Task 117 already holds this Project FOR UPDATE. Read its authoritative
  -- before-state for the optional automatic completion audit.
  select project.*
  into current_project
  from public.projects as project
  where project.id = trusted_project_id;

  if not found then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  -- Storage validation follows all domain/balance locks. KEY SHARE prevents the
  -- prepared candidate metadata row from being deleted while it is linked.
  perform 1
  from storage.objects as object
  where object.bucket_id = 'work-order-pdfs'
    and object.name = p_pdf_storage_reference
    and object.metadata->>'mimetype' = 'application/pdf'
  for key share;

  if not found then
    raise exception 'Valid final Work Order PDF object is required'
      using errcode = '22023';
  end if;

  perform 1
  from public.work_order_pdfs as pdf
  where pdf.work_order_id = p_work_order_id
    or pdf.storage_reference = p_pdf_storage_reference
  for key share;

  if found then
    raise exception 'Work Order PDF is already linked'
      using errcode = '22023';
  end if;

  -- Apply in Product-ID order. Every balance is already locked by Task 117;
  -- apply_inventory_delta re-enters that lock, updates the balance, and creates
  -- exactly one immutable movement for this Work Order material.
  for material_record in
    select item.product_id, item.quantity
    from public.work_order_items as item
    where item.work_order_id = p_work_order_id
    order by item.product_id
  loop
    select applied.movement_id
    into applied_movement_id
    from public.apply_inventory_delta(
      p_product_id => material_record.product_id,
      p_quantity_delta => -material_record.quantity,
      p_movement_type => 'work_order',
      p_reason => null,
      p_source_type => 'work_order',
      p_source_id => p_work_order_id,
      p_project_id => trusted_project_id,
      p_reversal_of_movement_id => null
    ) as applied;

    if applied_movement_id is null then
      raise exception 'Work Order Inventory movement was not created'
        using errcode = 'IVB01';
    end if;

    movement_ids := pg_catalog.array_append(
      movement_ids,
      applied_movement_id
    );
  end loop;

  if pg_catalog.cardinality(movement_ids) <> validated_item_count then
    raise exception 'Work Order Inventory movements are incomplete'
      using errcode = 'IVB01';
  end if;

  finish_timestamp := pg_catalog.clock_timestamp();

  update public.work_orders as work_order
  set status = 'finished',
      finished_at = finish_timestamp,
      finished_by_user_id = actor_profile_id,
      updated_at = finish_timestamp,
      updated_by_user_id = actor_profile_id
  where work_order.id = p_work_order_id;

  insert into public.work_order_pdfs as inserted (
    work_order_id,
    storage_reference,
    generated_at,
    generated_by_user_id,
    document_version,
    content_hash
  )
  values (
    p_work_order_id,
    p_pdf_storage_reference,
    finish_timestamp,
    actor_profile_id,
    1,
    p_pdf_content_hash
  )
  returning inserted.id into created_pdf_id;

  perform public.append_audit_log(
    p_action_type => 'work_order.finished',
    p_entity_type => 'work_order',
    p_summary => 'Finished Work Order ' || trusted_work_order_number,
    p_entity_id => p_work_order_id,
    p_before_data => pg_catalog.jsonb_build_object(
      'status', 'draft',
      'project_id', trusted_project_id,
      'updated_at', p_expected_updated_at
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'status', 'finished',
      'project_id', trusted_project_id,
      'finished_at', finish_timestamp,
      'finished_by_user_id', actor_profile_id,
      'work_order_pdf_id', created_pdf_id,
      'storage_reference', p_pdf_storage_reference,
      'inventory_movement_ids', pg_catalog.to_jsonb(movement_ids)
    )
  );

  -- The Project row remains locked from Task 117, serializing this decision with
  -- same-Project Finish, Draft allocation, planning, and lifecycle mutations.
  select not exists (
    select 1
    from public.work_orders as other_work_order
    where other_work_order.project_id = trusted_project_id
      and other_work_order.status = 'draft'
  )
  into project_completed_value;

  if project_completed_value then
    update public.projects as project
    set status = 'completed',
        completed_at = finish_timestamp,
        cancelled_at = null,
        updated_at = finish_timestamp,
        updated_by_user_id = actor_profile_id
    where project.id = trusted_project_id;

    perform public.append_audit_log(
      p_action_type => 'project.completed',
      p_entity_type => 'project',
      p_summary => 'Completed Project ' || current_project.name,
      p_entity_id => trusted_project_id,
      p_before_data => pg_catalog.jsonb_build_object(
        'name', current_project.name,
        'customer_name', current_project.customer_name,
        'status', current_project.status,
        'start_date', current_project.start_date,
        'delivery_date', current_project.delivery_date,
        'completed_at', current_project.completed_at,
        'cancelled_at', current_project.cancelled_at
      ),
      p_after_data => pg_catalog.jsonb_build_object(
        'name', current_project.name,
        'customer_name', current_project.customer_name,
        'status', 'completed',
        'start_date', current_project.start_date,
        'delivery_date', current_project.delivery_date,
        'completed_at', finish_timestamp,
        'cancelled_at', null,
        'completed_by_work_order_id', p_work_order_id
      )
    );
  end if;

  return query
  select
    p_work_order_id,
    trusted_work_order_number,
    finish_timestamp,
    trusted_project_id,
    project_completed_value,
    created_pdf_id;
end;
$function$;

revoke all privileges
  on function public.finish_work_order(uuid, timestamptz, text, text)
  from public, anon, authenticated;

grant execute
  on function public.finish_work_order(uuid, timestamptz, text, text)
  to authenticated;
