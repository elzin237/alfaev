create function public.archive_supplier(p_supplier_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  current_supplier public.suppliers%rowtype;
  changed_at timestamptz;
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('suppliers.archive')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_supplier_id is null then
    raise exception 'Supplier is required'
      using errcode = '22023';
  end if;

  select public.suppliers.*
  into current_supplier
  from public.suppliers
  where public.suppliers.id = p_supplier_id
  for update;

  if not found then
    raise exception 'Supplier not found'
      using errcode = 'P0002';
  end if;

  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('suppliers.archive')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  actor_profile_id := public.current_active_user_profile_id();

  if actor_profile_id is null then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if not current_supplier.is_active then
    raise exception 'Supplier is already archived'
      using errcode = 'SUP01';
  end if;

  changed_at := pg_catalog.clock_timestamp();

  update public.suppliers
  set is_active = false,
      archived_at = changed_at,
      archived_by_user_id = actor_profile_id,
      updated_at = changed_at,
      updated_by_user_id = actor_profile_id
  where public.suppliers.id = current_supplier.id;

  perform public.append_audit_log(
    p_action_type => 'supplier.archived',
    p_entity_type => 'supplier',
    p_summary => 'Archived Supplier ' || current_supplier.name,
    p_entity_id => current_supplier.id,
    p_before_data => pg_catalog.jsonb_build_object(
      'name', current_supplier.name,
      'is_active', true,
      'archived_at', null,
      'archived_by_user_id', null
    ),
    p_after_data => pg_catalog.jsonb_build_object(
      'name', current_supplier.name,
      'is_active', false,
      'archived_at', changed_at,
      'archived_by_user_id', actor_profile_id
    )
  );

  return current_supplier.id;
end;
$function$;

revoke all privileges
  on function public.archive_supplier(uuid)
  from public, anon, authenticated;

grant execute
  on function public.archive_supplier(uuid)
  to authenticated;
