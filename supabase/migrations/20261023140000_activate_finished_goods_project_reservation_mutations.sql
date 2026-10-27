-- Phase 3D3B activation preparation ONLY. Apply only after independent review
-- and separate deployment authorization. No reservations or Inventory are changed.
-- The wrappers retain active-profile, four-permission/Admin, lifecycle, locking,
-- original-author idempotency, version, demand and stock checks in migrations 143–146.
grant execute on function public.reserve_finished_goods_for_project(uuid,uuid,bigint,bigint,uuid) to authenticated;
grant execute on function public.release_finished_goods_project_reservation(uuid,uuid,bigint,bigint,uuid) to authenticated;
grant execute on function public.fulfill_finished_goods_project_reservation(uuid,uuid,uuid,bigint,bigint,uuid) to authenticated;

-- Fail closed: positive wrapper privileges AND negative helper/table privileges.
-- No definition, security property, RLS policy or other ACL is changed here.
do $validation$
declare
  signature text;
  function_id oid;
  role_name text;
begin
  foreach signature in array array[
    'public.reserve_finished_goods_for_project(uuid,uuid,bigint,bigint,uuid)',
    'public.release_finished_goods_project_reservation(uuid,uuid,bigint,bigint,uuid)',
    'public.fulfill_finished_goods_project_reservation(uuid,uuid,uuid,bigint,bigint,uuid)'
  ] loop
    function_id := signature::pg_catalog.regprocedure::oid;
    if not pg_catalog.has_function_privilege('authenticated',function_id,'EXECUTE')
      or not exists (select 1 from pg_catalog.pg_proc routine where routine.oid = function_id
        and routine.prosecdef and routine.provolatile = 'v'
        and routine.proconfig = array['search_path=""']::text[])
      or exists (select 1 from pg_catalog.pg_proc routine,
        lateral pg_catalog.aclexplode(coalesce(routine.proacl,pg_catalog.acldefault('f',routine.proowner))) acl
        where routine.oid = function_id and acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
      or pg_catalog.has_function_privilege('anon',function_id,'EXECUTE')
      or pg_catalog.has_function_privilege('service_role',function_id,'EXECUTE')
    then raise exception 'Unexpected Finished Goods mutation wrapper security'; end if;
  end loop;
  foreach signature in array array[
    'public.change_finished_goods_project_reservation',
    'public.calculate_project_product_demand',
    'public.calculate_open_project_commitments',
    'public.protect_finished_goods_reserved_stock',
    'public.protect_finished_goods_reservation_demand',
    'public.protect_finished_goods_reservation_project_lifecycle',
    'public.validate_finished_goods_fulfillment_link',
    'public.apply_inventory_delta_in_warehouse'
  ] loop
    function_id := signature::pg_catalog.regproc::oid;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if pg_catalog.has_function_privilege(role_name,function_id,'EXECUTE') then
        raise exception 'Private Finished Goods helper became executable';
      end if;
    end loop;
    if exists (select 1 from pg_catalog.pg_proc routine,
      lateral pg_catalog.aclexplode(coalesce(routine.proacl,pg_catalog.acldefault('f',routine.proowner))) acl
      where routine.oid = function_id and acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
    then raise exception 'Private Finished Goods helper has PUBLIC EXECUTE'; end if;
  end loop;
  foreach signature in array array[
    'public.finished_goods_project_reservations','public.finished_goods_project_reservation_events'
  ] loop
    if not exists (select 1 from pg_catalog.pg_class relation
      where relation.oid = signature::pg_catalog.regclass and relation.relrowsecurity)
    then raise exception 'Finished Goods reservation RLS is required'; end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if pg_catalog.has_table_privilege(role_name,signature,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'Direct Finished Goods reservation table access is forbidden';
      end if;
    end loop;
  end loop;
end;
$validation$;
