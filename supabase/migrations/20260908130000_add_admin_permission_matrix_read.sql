create function public.get_user_permissions_admin(p_user_id uuid)
returns table (
  permission_key text,
  module text,
  label text,
  description text,
  granted boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'User is required'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.user_profiles
    where public.user_profiles.id = p_user_id
  ) then
    raise exception 'User not found'
      using errcode = 'P0002';
  end if;

  return query
  select
    permission_definition.key,
    permission_definition.module,
    permission_definition.label,
    permission_definition.description,
    exists (
      select 1
      from public.user_permissions as user_permission
      where user_permission.user_id = p_user_id
        and user_permission.permission_definition_id =
          permission_definition.id
    ) as granted
  from public.permission_definitions as permission_definition
  where permission_definition.is_delegable
  order by
    case permission_definition.module
      when 'dashboard' then 1
      when 'projects' then 2
      when 'procurement' then 3
      when 'suppliers' then 4
      when 'inventory' then 5
      when 'pcb' then 6
      when 'work_orders' then 7
      when 'archive' then 8
      else 9
    end,
    case permission_definition.key
      when 'dashboard.view' then 1
      when 'projects.view' then 2
      when 'projects.create' then 3
      when 'projects.edit' then 4
      when 'projects.archive' then 5
      when 'procurement.view' then 6
      when 'procurement.create' then 7
      when 'procurement.edit' then 8
      when 'procurement.change_status' then 9
      when 'procurement.resolve' then 10
      when 'suppliers.view' then 11
      when 'suppliers.create' then 12
      when 'suppliers.edit' then 13
      when 'suppliers.archive' then 14
      when 'inventory.view' then 15
      when 'inventory.products.create' then 16
      when 'inventory.products.edit' then 17
      when 'inventory.brands.manage' then 18
      when 'inventory.barcodes.generate' then 19
      when 'pcb.view' then 20
      when 'pcb.create' then 21
      when 'pcb.edit' then 22
      when 'pcb.produce' then 23
      when 'pcb.archive' then 24
      when 'work_orders.view' then 25
      when 'work_orders.create' then 26
      when 'work_orders.edit_draft' then 27
      when 'work_orders.finish' then 28
      when 'work_orders.delete_draft' then 29
      when 'archive.view' then 30
      else 31
    end,
    permission_definition.key;
end;
$function$;

revoke all privileges
  on function public.get_user_permissions_admin(uuid)
  from public, anon, authenticated;

grant execute
  on function public.get_user_permissions_admin(uuid)
  to authenticated;
