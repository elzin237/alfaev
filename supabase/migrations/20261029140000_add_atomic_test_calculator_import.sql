-- Phase 3 local backend only. Calling this RPC is explicit import confirmation;
-- no automatic invocation, frontend activation, backfill or standalone release API.
create function public.import_test_calculation(
  p_request_id uuid,p_calculation_id uuid,p_serial_number text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  actor uuid := public.current_active_user_profile_id();
  original public.test_calculation_imports%rowtype;
  source public.test_calculations%rowtype;
  required_permissions text[] := array['test_calculator.view','test_calculator.manage','pcb.view','pcb.create','pcb.edit'];
  ids uuid[]; bom_items jsonb; payload jsonb; ordinary boolean;
  destination record; initial_bom record; imported_at timestamptz;
  import_key uuid := gen_random_uuid(); allocations jsonb; totals jsonb; receipt jsonb;
begin
  if auth.uid() is null or actor is null or not (public.current_user_is_admin() or not exists (
    select 1 from pg_catalog.unnest(required_permissions) permission(key) where not public.has_permission(permission.key)
  )) then raise exception 'Access denied' using errcode='42501'; end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Import requires READ COMMITTED isolation' using errcode='25000'; end if;
  if p_request_id is null or p_calculation_id is null or p_serial_number is null
    or p_serial_number !~ '^[0-9]{3}$' then
    raise exception 'Request, calculation and exact three-digit Serial Number required' using errcode='22023'; end if;
  payload := pg_catalog.jsonb_build_object('auth_user_id',auth.uid(),'calculation_id',p_calculation_id,
    'serial_number',p_serial_number,'confirmed',true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('test-import-request:'||p_request_id::text,0));
  if public.current_active_user_profile_id() is distinct from actor or not (public.current_user_is_admin() or not exists (
    select 1 from pg_catalog.unnest(required_permissions) permission(key) where not public.has_permission(permission.key)
  )) then raise exception 'Access denied' using errcode='42501'; end if;
  select imported.* into original from public.test_calculation_imports imported where imported.request_id=p_request_id;
  -- Ownership precedes payload comparison or any private receipt disclosure.
  if original.id is not null and (original.imported_by_user_id<>actor or original.auth_user_id<>auth.uid()) then
    raise exception 'Access denied' using errcode='42501'; end if;
  if original.id is not null and original.submitted_payload is distinct from payload then
    raise exception 'Request payload differs from original import' using errcode='TCI01'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('test-import-source:'||p_calculation_id::text,0));
  if public.current_active_user_profile_id() is distinct from actor or not (public.current_user_is_admin() or not exists (
    select 1 from pg_catalog.unnest(required_permissions) permission(key) where not public.has_permission(permission.key)
  )) then raise exception 'Access denied' using errcode='42501'; end if;
  select calculation.* into source from public.test_calculations calculation where calculation.id=p_calculation_id;
  if not found then raise exception 'Test Calculation not found' using errcode='P0002'; end if;
  if original.id is null and exists(select 1 from public.test_calculation_imports imported where imported.calculation_id=source.id) then
    raise exception 'Test Calculation has already been imported' using errcode='TCI02'; end if;
  select pg_catalog.array_agg(item.product_id order by item.product_id),
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('product_id',item.product_id,
      'quantity_per_card',item.required_quantity::text) order by item.product_id)
    into ids,bom_items from public.test_calculation_items item where item.calculation_id=source.id;
  if coalesce(pg_catalog.cardinality(ids),0) not between 1 and 100 then
    raise exception 'Saved Test component definition unavailable' using errcode='TCI03'; end if;
  -- Existing Save/production/FG paths acquire Products before balances; never
  -- acquire Project or Work Order row locks from import/reconciliation.
  if original.id is null then
    perform product.id from public.products product where product.id=any(ids) order by product.id for update;
    perform balance.product_id from public.inventory_balances balance where balance.product_id=any(ids)
      order by balance.product_id,balance.warehouse_id for update;
  end if;
  ordinary := exists(select 1 from public.test_calculation_items item where item.calculation_id=source.id
    and item.product_kind_snapshot='component');
  required_permissions := required_permissions || array['inventory.finished_goods.view'];
  if ordinary then required_permissions := required_permissions || array['inventory.raw_materials.view','inventory.customs.view']; end if;
  -- Hold profile and effective delegated grants through commit; recheck after waits.
  perform profile.id from public.user_profiles profile where profile.id=actor
    and profile.auth_user_id=auth.uid() and profile.is_active for share;
  if not public.current_user_is_admin() then
    perform permission.user_id from public.user_permissions permission
      join public.permission_definitions definition on definition.id=permission.permission_definition_id
      where permission.user_id=actor and definition.key=any(required_permissions)
      order by definition.key for share of permission,definition;
  end if;
  if public.current_active_user_profile_id() is distinct from actor or not (public.current_user_is_admin() or not exists (
    select 1 from pg_catalog.unnest(required_permissions) permission(key) where not public.has_permission(permission.key)
  )) then raise exception 'Access denied' using errcode='42501'; end if;
  if original.id is not null then return original.import_receipt; end if;
  if exists(select 1 from public.test_calculation_items item left join public.products product on product.id=item.product_id
    where item.calculation_id=source.id and (product.id is null or not product.is_active
      or product.product_kind<>item.product_kind_snapshot
      or not (product.product_kind='component' or public.is_calculator_finished_product(product.id)))) then
    raise exception 'Saved Test component Product is unavailable for a new BOM' using errcode='TCI03'; end if;
  if exists(select 1 from public.products product where product.id=any(ids) and (
    select pg_catalog.count(*) from public.inventory_balances balance where balance.product_id=product.id
      and (not public.is_calculator_finished_product(product.id)
        or balance.warehouse_id='10000000-0000-4000-8000-000000000002'::uuid)
    ) <> case when public.is_calculator_finished_product(product.id) then 1 else 3 end) then
    raise exception 'Test Inventory source data unavailable' using errcode='55000'; end if;
  -- Existing trusted operations retain serial/name constraints, Product defaults,
  -- zero-balance initialization, eligibility and normal creation/BOM audit events.
  select * into strict destination from public.create_pcb_card(source.name,p_serial_number);
  select * into strict initial_bom from public.save_initial_pcb_bom(destination.pcb_card_id,bom_items);
  if initial_bom.version_number<>1 then raise exception 'Initial BOM version unavailable' using errcode='55000'; end if;
  -- Observe expiry AFTER every potentially blocking Product/balance/unique-name/
  -- serial/BOM wait. Expiry is allowed: it simply contributes no release records.
  imported_at := pg_catalog.clock_timestamp();
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id',hold.item_id,'product_id',hold.product_id,
    'warehouse_id',hold.warehouse_id,'quantity',hold.quantity::text) order by hold.product_id,hold.warehouse_id),'[]'::jsonb)
    into allocations from public.active_test_holds_at(imported_at,ids) hold where hold.calculation_id=source.id;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('product_id',released.product_id,
    'quantity',released.quantity::text) order by released.product_id),'[]'::jsonb) into totals from (
      select (allocation.value->>'product_id')::uuid product_id,
        pg_catalog.sum((allocation.value->>'quantity')::numeric) quantity
      from pg_catalog.jsonb_array_elements(allocations) allocation group by (allocation.value->>'product_id')::uuid
    ) released;
  -- Totals are per Product, NEVER a sum across unlike Product units.
  receipt := pg_catalog.jsonb_build_object('import_id',import_key,'calculation_id',source.id,'name',source.name,
    'pcb_card_id',destination.pcb_card_id,'output_product_id',destination.product_id,
    'initial_bom_version_id',initial_bom.bom_version_id,'initial_bom_version_number','1',
    'serial_number',p_serial_number,'imported_at',imported_at,'release_allocations',allocations,'release_totals',totals);
  insert into public.test_calculation_imports(id,calculation_id,pcb_card_id,output_product_id,initial_bom_version_id,
    imported_by_user_id,auth_user_id,imported_at,request_id,output_serial_number,submitted_payload,import_receipt)
    values(import_key,source.id,destination.pcb_card_id,destination.product_id,initial_bom.bom_version_id,
      actor,auth.uid(),imported_at,p_request_id,p_serial_number,payload,receipt);
  insert into public.test_calculation_import_releases(import_id,calculation_id,item_id,product_id,warehouse_id,quantity)
    select import_key,source.id,(allocation.value->>'item_id')::uuid,(allocation.value->>'product_id')::uuid,
      (allocation.value->>'warehouse_id')::uuid,(allocation.value->>'quantity')::bigint
    from pg_catalog.jsonb_array_elements(allocations) allocation;
  perform public.append_audit_log(p_action_type=>'test_calculator.imported',p_entity_type=>'test_calculation',
    p_entity_id=>source.id,p_summary=>'Imported saved Test Calculation into Product Calculator',
    p_after_data=>pg_catalog.jsonb_build_object('import_id',import_key,'calculation_id',source.id,
      'pcb_card_id',destination.pcb_card_id,'output_product_id',destination.product_id,'initial_bom_version_id',initial_bom.bom_version_id));
  -- Never let private invoker-only checks escape to authenticated COMMIT context.
  -- Existing coalesced queue performs real Product-specific shortage reconciliation.
  set constraints public.test_calculation_imports_consistent,public.test_calculation_import_releases_consistent,
    public.work_order_material_shortage_queue_process immediate;
  set constraints public.test_calculation_imports_consistent,public.test_calculation_import_releases_consistent,
    public.work_order_material_shortage_queue_process deferred;
  return receipt;
end;
$function$;
revoke all on function public.import_test_calculation(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.import_test_calculation(uuid,uuid,text) to authenticated;
