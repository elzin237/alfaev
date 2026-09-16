-- Internal authorization/lock boundary shared by all planning mutations.
create function public.current_project_planning_mutation_actor_id()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor uuid;
begin
  v_actor := public.current_active_user_profile_id();
  if v_actor is not null
    and (
      public.current_user_is_admin()
      or public.has_permission('projects.edit')
    )
  then
    return v_actor;
  end if;
  return null;
end;
$function$;

create function public.lock_open_project_for_planning(p_project_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor uuid;
  v_status text;
begin
  -- Avoid making unauthorized callers contend on the Project lock.
  if public.current_project_planning_mutation_actor_id() is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_project_id is null then
    raise exception 'Project is required' using errcode = '22023';
  end if;

  select project.status into v_status
  from public.projects as project
  where project.id = p_project_id
  for update;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  -- Permission or account state can change while waiting for the row lock.
  v_actor := public.current_project_planning_mutation_actor_id();
  if v_actor is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if v_status not in ('planned', 'in_progress', 'on_hold') then
    raise exception 'Project is closed for planning'
      using errcode = 'PPL01';
  end if;
  return v_actor;
end;
$function$;

revoke all privileges
  on function public.current_project_planning_mutation_actor_id()
  from public, anon, authenticated;
revoke all privileges
  on function public.lock_open_project_for_planning(uuid)
  from public, anon, authenticated;

create function public.create_project_product(
  p_project_id uuid,
  p_name text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor uuid;
  v_id uuid;
  v_name text := pg_catalog.btrim(p_name);
  v_now timestamptz;
begin
  v_actor := public.lock_open_project_for_planning(p_project_id);
  if v_name is null or pg_catalog.length(v_name) = 0 then
    raise exception 'Project Product name is required' using errcode = '22023';
  end if;
  v_now := pg_catalog.clock_timestamp();
  insert into public.project_products (
    project_id, name, created_at, created_by_user_id,
    updated_at, updated_by_user_id
  ) values (
    p_project_id, v_name, v_now, v_actor, v_now, v_actor
  ) returning id into v_id;

  perform public.append_audit_log(
    p_action_type => 'project_product.created',
    p_entity_type => 'project_product',
    p_summary => 'Created Project Product ' || v_name,
    p_entity_id => v_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'project_id', p_project_id, 'name', v_name
    )
  );
  return v_id;
end;
$function$;

create function public.update_project_product(
  p_project_product_id uuid,
  p_name text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor uuid;
  v_project_id uuid;
  v_current public.project_products%rowtype;
  v_name text := pg_catalog.btrim(p_name);
begin
  if public.current_project_planning_mutation_actor_id() is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_project_product_id is null then
    raise exception 'Project Product is required' using errcode = '22023';
  end if;
  select item.project_id into v_project_id
  from public.project_products as item where item.id = p_project_product_id;
  if not found then
    raise exception 'Project Product not found' using errcode = 'P0002';
  end if;
  v_actor := public.lock_open_project_for_planning(v_project_id);
  select item.* into v_current
  from public.project_products as item
  where item.id = p_project_product_id and item.project_id = v_project_id
  for update;
  if not found then
    raise exception 'Project Product not found' using errcode = 'P0002';
  end if;
  if v_name is null or pg_catalog.length(v_name) = 0 then
    raise exception 'Project Product name is required' using errcode = '22023';
  end if;
  if v_current.name = v_name then
    return v_current.id;
  end if;

  update public.project_products
  set name = v_name,
      updated_at = pg_catalog.clock_timestamp(),
      updated_by_user_id = v_actor
  where id = v_current.id;
  perform public.append_audit_log(
    p_action_type => 'project_product.updated',
    p_entity_type => 'project_product',
    p_summary => 'Updated Project Product ' || v_name,
    p_entity_id => v_current.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'project_id', v_project_id, 'name', v_current.name
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'project_id', v_project_id, 'name', v_name
    )
  );
  return v_current.id;
end;
$function$;

create function public.remove_project_product(p_project_product_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_project_id uuid;
  v_current public.project_products%rowtype;
begin
  if public.current_project_planning_mutation_actor_id() is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_project_product_id is null then
    raise exception 'Project Product is required' using errcode = '22023';
  end if;
  select item.project_id into v_project_id
  from public.project_products as item where item.id = p_project_product_id;
  if not found then
    raise exception 'Project Product not found' using errcode = 'P0002';
  end if;
  perform public.lock_open_project_for_planning(v_project_id);
  select item.* into v_current
  from public.project_products as item
  where item.id = p_project_product_id and item.project_id = v_project_id
  for update;
  if not found then
    raise exception 'Project Product not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.project_product_components as component
    where component.project_product_id = v_current.id
  ) then
    raise exception 'Remove component requirements first'
      using errcode = 'PPL03';
  end if;

  delete from public.project_products where id = v_current.id;
  perform public.append_audit_log(
    p_action_type => 'project_product.removed',
    p_entity_type => 'project_product',
    p_summary => 'Removed Project Product ' || v_current.name,
    p_entity_id => v_current.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'project_id', v_project_id, 'name', v_current.name
    )
  );
  return v_current.id;
end;
$function$;

create function public.create_project_product_component(
  p_project_product_id uuid,
  p_product_id uuid,
  p_required_quantity bigint
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor uuid;
  v_project_id uuid;
  v_project_product public.project_products%rowtype;
  v_product public.products%rowtype;
  v_id uuid;
  v_now timestamptz;
begin
  if public.current_project_planning_mutation_actor_id() is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_project_product_id is null or p_product_id is null
    or p_required_quantity is null or p_required_quantity <= 0
  then
    raise exception 'Valid Project Product, Product, and quantity are required'
      using errcode = '22023';
  end if;
  select item.project_id into v_project_id
  from public.project_products as item where item.id = p_project_product_id;
  if not found then
    raise exception 'Project Product not found' using errcode = 'P0002';
  end if;
  v_actor := public.lock_open_project_for_planning(v_project_id);
  select item.* into v_project_product
  from public.project_products as item
  where item.id = p_project_product_id and item.project_id = v_project_id
  for update;
  if not found then
    raise exception 'Project Product not found' using errcode = 'P0002';
  end if;
  select product.* into v_product
  from public.products as product
  where product.id = p_product_id
  for share;
  if not found or not v_product.is_active
    or v_product.product_kind not in ('component', 'pcb_finished_good')
  then
    raise exception 'Product is unavailable for planning'
      using errcode = 'PPL04';
  end if;

  v_now := pg_catalog.clock_timestamp();
  begin
    insert into public.project_product_components (
      project_product_id, product_id, required_quantity,
      created_at, created_by_user_id, updated_at, updated_by_user_id
    ) values (
      v_project_product.id, v_product.id, p_required_quantity,
      v_now, v_actor, v_now, v_actor
    ) returning id into v_id;
  exception when unique_violation then
    raise exception 'Product requirement already exists'
      using errcode = 'PPL02';
  end;
  perform public.append_audit_log(
    p_action_type => 'project_product_component.created',
    p_entity_type => 'project_product_component',
    p_summary => 'Added Project Product component requirement',
    p_entity_id => v_id,
    p_after_data => pg_catalog.jsonb_build_object(
      'project_id', v_project_id,
      'project_product_id', v_project_product.id,
      'product_id', v_product.id,
      'required_quantity', p_required_quantity
    )
  );
  return v_id;
end;
$function$;

create function public.update_project_product_component(
  p_component_id uuid,
  p_product_id uuid,
  p_required_quantity bigint
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor uuid;
  v_project_id uuid;
  v_project_product_id uuid;
  v_current public.project_product_components%rowtype;
  v_product public.products%rowtype;
begin
  if public.current_project_planning_mutation_actor_id() is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_component_id is null or p_product_id is null
    or p_required_quantity is null or p_required_quantity <= 0
  then
    raise exception 'Valid component, Product, and quantity are required'
      using errcode = '22023';
  end if;
  select item.project_product_id, parent.project_id
  into v_project_product_id, v_project_id
  from public.project_product_components as item
  join public.project_products as parent on parent.id = item.project_product_id
  where item.id = p_component_id;
  if not found then
    raise exception 'Component requirement not found' using errcode = 'P0002';
  end if;
  v_actor := public.lock_open_project_for_planning(v_project_id);
  perform 1 from public.project_products as parent
  where parent.id = v_project_product_id and parent.project_id = v_project_id
  for update;
  if not found then
    raise exception 'Component requirement not found' using errcode = 'P0002';
  end if;
  select item.* into v_current
  from public.project_product_components as item
  where item.id = p_component_id
    and item.project_product_id = v_project_product_id
  for update;
  if not found then
    raise exception 'Component requirement not found' using errcode = 'P0002';
  end if;

  if v_current.product_id = p_product_id
    and v_current.required_quantity = p_required_quantity
  then
    return v_current.id;
  end if;
  if v_current.product_id <> p_product_id then
    select product.* into v_product
    from public.products as product
    where product.id = p_product_id
    for share;
    if not found or not v_product.is_active
      or v_product.product_kind not in ('component', 'pcb_finished_good')
    then
      raise exception 'Product is unavailable for planning'
        using errcode = 'PPL04';
    end if;
  end if;

  begin
    update public.project_product_components
    set product_id = p_product_id,
        required_quantity = p_required_quantity,
        updated_at = pg_catalog.clock_timestamp(),
        updated_by_user_id = v_actor
    where id = v_current.id;
  exception when unique_violation then
    raise exception 'Product requirement already exists'
      using errcode = 'PPL02';
  end;
  perform public.append_audit_log(
    p_action_type => 'project_product_component.updated',
    p_entity_type => 'project_product_component',
    p_summary => 'Updated Project Product component requirement',
    p_entity_id => v_current.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'project_id', v_project_id,
      'project_product_id', v_project_product_id,
      'product_id', v_current.product_id,
      'required_quantity', v_current.required_quantity
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'project_id', v_project_id,
      'project_product_id', v_project_product_id,
      'product_id', p_product_id,
      'required_quantity', p_required_quantity
    )
  );
  return v_current.id;
end;
$function$;

create function public.remove_project_product_component(p_component_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_project_id uuid;
  v_project_product_id uuid;
  v_current public.project_product_components%rowtype;
begin
  if public.current_project_planning_mutation_actor_id() is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_component_id is null then
    raise exception 'Component requirement is required'
      using errcode = '22023';
  end if;
  select item.project_product_id, parent.project_id
  into v_project_product_id, v_project_id
  from public.project_product_components as item
  join public.project_products as parent on parent.id = item.project_product_id
  where item.id = p_component_id;
  if not found then
    raise exception 'Component requirement not found' using errcode = 'P0002';
  end if;
  perform public.lock_open_project_for_planning(v_project_id);
  perform 1 from public.project_products as parent
  where parent.id = v_project_product_id and parent.project_id = v_project_id
  for update;
  if not found then
    raise exception 'Component requirement not found' using errcode = 'P0002';
  end if;
  select item.* into v_current
  from public.project_product_components as item
  where item.id = p_component_id
    and item.project_product_id = v_project_product_id
  for update;
  if not found then
    raise exception 'Component requirement not found' using errcode = 'P0002';
  end if;

  delete from public.project_product_components where id = v_current.id;
  perform public.append_audit_log(
    p_action_type => 'project_product_component.removed',
    p_entity_type => 'project_product_component',
    p_summary => 'Removed Project Product component requirement',
    p_entity_id => v_current.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'project_id', v_project_id,
      'project_product_id', v_project_product_id,
      'product_id', v_current.product_id,
      'required_quantity', v_current.required_quantity
    )
  );
  return v_current.id;
end;
$function$;

create function public.search_project_component_product_choices(
  p_search text default null
)
returns table (
  product_id uuid,
  serial_number text,
  name text,
  product_kind text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_search text := nullif(pg_catalog.btrim(p_search), '');
  v_escaped text;
  v_contains text;
  v_prefix text;
begin
  if not (
    public.current_user_is_admin()
    or public.has_permission('projects.edit')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if v_search is not null then
    v_escaped := pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(
          v_search,
          pg_catalog.chr(92),
          pg_catalog.chr(92) || pg_catalog.chr(92)
        ),
        '%',
        pg_catalog.chr(92) || '%'
      ),
      '_',
      pg_catalog.chr(92) || '_'
    );
    v_contains := '%' || pg_catalog.lower(v_escaped) || '%';
    v_prefix := v_escaped || '%';
  end if;
  return query
  select product.id, product.serial_number, product.name, product.product_kind
  from public.products as product
  where product.is_active
    and product.product_kind in ('component', 'pcb_finished_good')
    and (
      v_search is null
      or pg_catalog.lower(product.name) like v_contains escape '\'
      or product.serial_number like v_prefix escape '\'
    )
  order by product.serial_number, product.id;
end;
$function$;

revoke all privileges
  on function public.create_project_product(uuid, text)
  from public, anon, authenticated;
revoke all privileges
  on function public.update_project_product(uuid, text)
  from public, anon, authenticated;
revoke all privileges
  on function public.remove_project_product(uuid)
  from public, anon, authenticated;
revoke all privileges
  on function public.create_project_product_component(uuid, uuid, bigint)
  from public, anon, authenticated;
revoke all privileges
  on function public.update_project_product_component(uuid, uuid, bigint)
  from public, anon, authenticated;
revoke all privileges
  on function public.remove_project_product_component(uuid)
  from public, anon, authenticated;
revoke all privileges
  on function public.search_project_component_product_choices(text)
  from public, anon, authenticated;

grant execute
  on function public.create_project_product(uuid, text)
  to authenticated;
grant execute
  on function public.update_project_product(uuid, text)
  to authenticated;
grant execute
  on function public.remove_project_product(uuid)
  to authenticated;
grant execute
  on function public.create_project_product_component(uuid, uuid, bigint)
  to authenticated;
grant execute
  on function public.update_project_product_component(uuid, uuid, bigint)
  to authenticated;
grant execute
  on function public.remove_project_product_component(uuid)
  to authenticated;
grant execute
  on function public.search_project_component_product_choices(text)
  to authenticated;
