-- TC-04: local Save foundation only. Deployment/operational activation must wait
-- for universal debit protection and Project reservation coexistence gates.
create function public.save_test_calculation(
  p_request_id uuid, p_name text, p_items jsonb, p_deadline_date date
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  actor uuid; original public.test_calculations%rowtype; entry jsonb; ids uuid[] := '{}'::uuid[];
  key uuid; canonical_items jsonb; payload jsonb; normalized_name text := pg_catalog.btrim(p_name);
  fg_access boolean; all_access boolean; ordinary boolean; required_permissions text[];
  expiry timestamptz; saved_at timestamptz; calculation_key uuid := gen_random_uuid(); item_key uuid;
  results jsonb; receipt jsonb; allocation jsonb;
begin
  actor := public.current_active_user_profile_id();
  if actor is null or not (public.current_user_is_admin() or (
    public.has_permission('test_calculator.view') and public.has_permission('test_calculator.manage')
  )) then raise exception 'Access denied' using errcode = '42501'; end if;
  -- A fixed transaction snapshot could miss another Save's newly committed holds
  -- even after acquiring the Product lock. Never admit from such a stale snapshot.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Save requires READ COMMITTED isolation' using errcode = '25000'; end if;
  if p_request_id is null then raise exception 'Request UUID required' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
  if public.current_active_user_profile_id() is distinct from actor or not (public.current_user_is_admin() or (
    public.has_permission('test_calculator.view') and public.has_permission('test_calculator.manage')
  )) then raise exception 'Access denied' using errcode = '42501'; end if;
  select calculation.* into original from public.test_calculations calculation where calculation.request_id = p_request_id;
  -- Ownership is checked before parsing/comparing another actor's submitted payload.
  if found and (original.created_by_user_id <> actor
    or original.submitted_payload->>'auth_user_id' is distinct from auth.uid()::text)
  then raise exception 'Access denied' using errcode = '42501'; end if;
  if normalized_name is null or pg_catalog.length(normalized_name) = 0
    or p_deadline_date is null or not pg_catalog.isfinite(p_deadline_date)
  then raise exception 'Name and finite deadline date required' using errcode = '22023'; end if;
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception 'Items must be an array' using errcode = '22023'; end if;
  if pg_catalog.jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Select 1 to 100 Products' using errcode = '22023'; end if;
  for entry in select element.value from pg_catalog.jsonb_array_elements(p_items) element loop
    if pg_catalog.jsonb_typeof(entry) <> 'object' then raise exception 'Invalid item' using errcode = '22023'; end if;
    if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(entry)) <> 2
      or not (entry ? 'product_id' and entry ? 'quantity')
      or pg_catalog.jsonb_typeof(entry->'product_id') <> 'string' or pg_catalog.jsonb_typeof(entry->'quantity') <> 'string'
      or (entry->>'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or pg_catalog.length(entry->>'quantity') > 19 or (entry->>'quantity') !~ '^[1-9][0-9]*$'
    then raise exception 'Invalid item' using errcode = '22023'; end if;
    if (entry->>'quantity')::numeric > 9223372036854775807::numeric then
      raise exception 'Quantity exceeds bigint range' using errcode = '22023'; end if;
    key := (entry->>'product_id')::uuid;
    if key = any(ids) then raise exception 'Duplicate Product' using errcode = '22023'; end if;
    ids := pg_catalog.array_append(ids,key);
  end loop;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('product_id',(item.value->>'product_id')::uuid,
    'quantity',((item.value->>'quantity')::bigint)::text) order by (item.value->>'product_id')::uuid)
    into canonical_items from pg_catalog.jsonb_array_elements(p_items) item;
  payload := pg_catalog.jsonb_build_object('auth_user_id',auth.uid(),'name',normalized_name,
    'items',canonical_items,'deadline_date',p_deadline_date::text,'deadline_timezone','Europe/Sarajevo');
  if original.id is not null and original.submitted_payload is distinct from payload then
    raise exception 'Request payload differs from original Save' using errcode = 'TCS01'; end if;

  -- Never take Project locks after Product/balance locks. A Product UPDATE lock
  -- serializes Saves with existing Product SHARE/UPDATE -> balance debit/reserve paths.
  if original.id is null then
    perform product.id from public.products product where product.id = any(ids) order by product.id for update;
    perform balance.product_id from public.inventory_balances balance where balance.product_id = any(ids)
      order by balance.product_id,balance.warehouse_id for update;
  end if;
  -- Hold current actor/grants through commit, and recheck after all blocking waits.
  perform profile.id from public.user_profiles profile where profile.id = actor and profile.auth_user_id = auth.uid()
    and profile.is_active for share;
  ordinary := exists(select 1 from public.products product where product.id = any(ids) and product.product_kind = 'component');
  required_permissions := array['test_calculator.view','test_calculator.manage','inventory.finished_goods.view'];
  if ordinary then required_permissions := required_permissions || array['inventory.raw_materials.view','inventory.customs.view']; end if;
  if not public.current_user_is_admin() then
    perform permission.user_id from public.user_permissions permission join public.permission_definitions definition
      on definition.id = permission.permission_definition_id
      where permission.user_id = actor and definition.key = any(required_permissions)
      order by definition.key for share of permission,definition;
  end if;
  fg_access := public.current_user_is_admin() or public.has_permission('inventory.finished_goods.view');
  all_access := fg_access and (public.current_user_is_admin() or (
    public.has_permission('inventory.raw_materials.view') and public.has_permission('inventory.customs.view')));
  if public.current_active_user_profile_id() is distinct from actor or not (public.current_user_is_admin() or (
    public.has_permission('test_calculator.view') and public.has_permission('test_calculator.manage')
  )) or not fg_access or (ordinary and not all_access)
  then raise exception 'Access denied' using errcode = '42501'; end if;
  if original.id is not null then
    -- Current authority is mandatory; expiry/archive never renews or recalculates a receipt.
    return original.save_receipt;
  end if;
  expiry := ((p_deadline_date + 1)::timestamp at time zone 'Europe/Sarajevo');
  saved_at := pg_catalog.clock_timestamp();
  if expiry <= saved_at then raise exception 'Deadline has expired' using errcode = 'TCS02'; end if;
  if exists(select 1 from pg_catalog.unnest(ids) requested(id) left join public.products product on product.id = requested.id
    where product.id is null or not product.is_active or not (public.is_calculator_finished_product(product.id)
      or (product.product_kind = 'component' and all_access)))
  then raise exception 'Access denied' using errcode = '42501'; end if;
  if exists(select 1 from public.products product where product.id = any(ids) and (
    select pg_catalog.count(*) from public.inventory_balances balance where balance.product_id = product.id
      and (not public.is_calculator_finished_product(product.id) or balance.warehouse_id = '10000000-0000-4000-8000-000000000002'::uuid)
  ) <> case when public.is_calculator_finished_product(product.id) then 1 else 3 end)
  then raise exception 'Test source data unavailable' using errcode = '55000'; end if;

  -- Fresh VOLATILE-command snapshot after lock waits, with one fresh database time.
  -- Do not reuse the earlier STABLE preview or its statement-start expiry time.
  with requested as (
    select (item.value->>'product_id')::uuid id,(item.value->>'quantity')::numeric required
    from pg_catalog.jsonb_array_elements(canonical_items) item
  ), identities as (
    select requested.*,product.name,product.serial_number,product.product_kind,
      public.is_calculator_finished_product(product.id) finished
    from requested join public.products product on product.id = requested.id
  ), active_tests as (
    select hold.product_id,hold.warehouse_id,pg_catalog.sum(hold.quantity::numeric) quantity
    from public.test_calculation_holds hold join public.test_calculations calculation on calculation.id = hold.calculation_id
    where hold.product_id = any(ids) and calculation.expires_at > saved_at group by hold.product_id,hold.warehouse_id
  ), projects as (
    select state.product_id,pg_catalog.sum(state.reserved_quantity::numeric) quantity
    from public.finished_goods_project_reservations state where state.product_id = any(ids) group by state.product_id
  ), free as (
    select identity.*,balance.warehouse_id,warehouse.code,public.production_warehouse_priority(balance.warehouse_id) priority,
      greatest(balance.quantity::numeric - coalesce(active_tests.quantity,0::numeric) - case when warehouse.code = 'finished_goods'
        then coalesce(projects.quantity,0::numeric) else 0::numeric end,0::numeric) quantity
    from identities identity join public.inventory_balances balance on balance.product_id = identity.id
    join public.inventory_warehouses warehouse on warehouse.id = balance.warehouse_id
    left join active_tests on active_tests.product_id = identity.id and active_tests.warehouse_id = balance.warehouse_id
    left join projects on projects.product_id = identity.id where not identity.finished or warehouse.code = 'finished_goods'
  ), demand as (
    select identity.id,case when identity.finished then 0::numeric else coalesce((
      select pg_catalog.sum(commitment.outstanding_commitment) from public.calculate_open_project_commitments(identity.id) commitment
    ),0::numeric) end quantity from identities identity
  ), totals as (
    select free.id,greatest(pg_catalog.sum(free.quantity)-demand.quantity,0::numeric) capacity
    from free join demand on demand.id = free.id group by free.id,demand.quantity
  ), ordered as (
    select free.*,least(free.required,totals.capacity) held,
      coalesce(pg_catalog.sum(free.quantity) over(partition by free.id order by free.priority
        rows between unbounded preceding and 1 preceding),0::numeric) preceding_quantity
    from free join totals on totals.id = free.id
  ), items as (
    select ordered.id,ordered.name,ordered.serial_number,ordered.product_kind,ordered.required,ordered.held,
      pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('warehouse_id',ordered.warehouse_id,'quantity',
        least(ordered.quantity,greatest(ordered.held-ordered.preceding_quantity,0::numeric))::text) order by ordered.priority) warehouses
    from ordered group by ordered.id,ordered.name,ordered.serial_number,ordered.product_kind,ordered.required,ordered.held
  )
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('product_id',items.id,'name',items.name,
    'serial_number',items.serial_number,'product_kind',items.product_kind,'required_quantity',items.required::text,
    'held_quantity',items.held::text,'uncovered_quantity',(items.required-items.held)::text,'warehouses',items.warehouses) order by items.id)
    into results from items;
  if results is null or pg_catalog.jsonb_array_length(results) <> pg_catalog.cardinality(ids) then
    raise exception 'Incomplete Test result' using errcode = '55000'; end if;
  if expiry <= pg_catalog.clock_timestamp() then raise exception 'Deadline has expired' using errcode = 'TCS02'; end if;
  receipt := pg_catalog.jsonb_build_object('calculation_id',calculation_key,'request_id',p_request_id,
    'name',normalized_name,'deadline_date',p_deadline_date::text,'deadline_timezone','Europe/Sarajevo',
    'expires_at',expiry,'created_at',saved_at,'items',results);
  insert into public.test_calculations(id,name,created_by_user_id,created_at,deadline_date,expires_at,
    request_id,submitted_payload,save_receipt)
    values(calculation_key,normalized_name,actor,saved_at,p_deadline_date,expiry,p_request_id,payload,receipt);
  for entry in select item.value from pg_catalog.jsonb_array_elements(results) item loop
    item_key := gen_random_uuid();
    insert into public.test_calculation_items(id,calculation_id,product_id,product_name_snapshot,serial_number_snapshot,
      product_kind_snapshot,required_quantity,held_quantity,uncovered_quantity,created_at)
      values(item_key,calculation_key,(entry->>'product_id')::uuid,entry->>'name',entry->>'serial_number',entry->>'product_kind',
        (entry->>'required_quantity')::bigint,(entry->>'held_quantity')::bigint,(entry->>'uncovered_quantity')::bigint,saved_at);
    for allocation in select warehouse.value from pg_catalog.jsonb_array_elements(entry->'warehouses') warehouse loop
      if (allocation->>'quantity')::bigint > 0 then
        insert into public.test_calculation_holds(item_id,calculation_id,product_id,warehouse_id,quantity,created_at)
          values(item_key,calculation_key,(entry->>'product_id')::uuid,(allocation->>'warehouse_id')::uuid,
            (allocation->>'quantity')::bigint,saved_at);
      end if;
    end loop;
  end loop;
  -- These private foundation checks are SECURITY INVOKER. Drain only their
  -- deferred events while still inside the trusted boundary, not later under
  -- an authenticated caller that intentionally has no private-table SELECT.
  set constraints public.test_calculation_items_hold_total, public.test_calculation_holds_item_total immediate;
  set constraints public.test_calculation_items_hold_total, public.test_calculation_holds_item_total deferred;
  perform public.append_audit_log(p_action_type=>'test_calculator.saved',p_entity_type=>'test_calculation',
    p_entity_id=>calculation_key,p_summary=>'Saved immutable Test Calculation',
    p_after_data=>pg_catalog.jsonb_build_object('calculation_id',calculation_key,'request_id',p_request_id,'expires_at',expiry));
  if expiry <= pg_catalog.clock_timestamp() then raise exception 'Deadline has expired' using errcode = 'TCS02'; end if;
  return receipt;
end;
$function$;
revoke all on function public.save_test_calculation(uuid,text,jsonb,date) from public, anon, authenticated, service_role;
grant execute on function public.save_test_calculation(uuid,text,jsonb,date) to authenticated;
