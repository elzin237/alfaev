-- LS-01: advisory warehouse metadata only. No stock, demand or alert writes.
create table public.inventory_stock_minimums (
  product_id uuid not null references public.products(id) on delete restrict,
  warehouse_id uuid not null references public.inventory_warehouses(id) on delete restrict,
  minimum_quantity bigint,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by_user_id uuid not null references public.user_profiles(id) on delete restrict,
  updated_by_user_id uuid not null references public.user_profiles(id) on delete restrict,
  primary key (product_id, warehouse_id),
  constraint inventory_stock_minimums_positive check (minimum_quantity is null or minimum_quantity > 0)
);
create index inventory_stock_minimums_warehouse_idx
  on public.inventory_stock_minimums(warehouse_id, product_id);
alter table public.inventory_stock_minimums enable row level security;
revoke all on table public.inventory_stock_minimums from public, anon, authenticated, service_role;

create function public.set_inventory_stock_minimum(
  p_product_id uuid, p_warehouse_id uuid,
  p_minimum_quantity text, p_expected_version text
)
returns table (
  product_id uuid, warehouse_id uuid, minimum_quantity text, version text,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql volatile security definer set search_path = '' as $function$
declare
  actor uuid; actor_admin boolean; required_permission text;
  normalized_minimum text; minimum_value bigint; expected_value bigint;
  product_active boolean; current_setting_row public.inventory_stock_minimums%rowtype;
  has_setting boolean; changed_at timestamptz;
begin
  actor := public.current_active_user_profile_id();
  if auth.uid() is null or actor is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  required_permission := public.inventory_warehouse_permission_key(p_warehouse_id, 'view');
  if not (public.current_user_is_admin() or (
    public.has_permission('inventory.products.edit') and public.has_permission(required_permission)
  )) then raise exception 'Access denied' using errcode = '42501'; end if;
  if p_product_id is null then raise exception 'Product is required' using errcode = '22023'; end if;

  -- Validate text BEFORE casting: neither JSON numbers nor floating point are authority.
  if p_minimum_quantity is not null then
    if pg_catalog.length(p_minimum_quantity) > 128 or p_minimum_quantity !~ '^[0-9]+$' then
      raise exception 'Minimum must be a positive bigint decimal string' using errcode = '22023'; end if;
    normalized_minimum := pg_catalog.ltrim(p_minimum_quantity, '0');
    if normalized_minimum = '' or pg_catalog.length(normalized_minimum) > 19
      or normalized_minimum::numeric > 9223372036854775807::numeric then
      raise exception 'Minimum must be a positive bigint decimal string' using errcode = '22023'; end if;
    minimum_value := normalized_minimum::bigint;
  end if;
  if p_expected_version is not null then
    if p_expected_version !~ '^[1-9][0-9]*$' or pg_catalog.length(p_expected_version) > 19 then
      raise exception 'Invalid expected version' using errcode = '22023'; end if;
    if p_expected_version::numeric > 9223372036854775807::numeric then
      raise exception 'Invalid expected version' using errcode = '22023'; end if;
    expected_value := p_expected_version::bigint;
  end if;

  -- Parent-row serialization also protects the first INSERT (no missing-row race)
  -- and follows existing Product-first warehouse mutation/lifecycle lock order.
  select product.is_active into product_active from public.products product
    where product.id = p_product_id for update;
  if not found then raise exception 'Product not found' using errcode = 'P0002'; end if;
  if not product_active then raise exception 'Archived Products cannot be configured' using errcode = 'PRD01'; end if;

  -- Revalidate and lock actor/grants AFTER any Product lock wait.
  select profile.is_admin into actor_admin from public.user_profiles profile
    where profile.id = actor and profile.auth_user_id = auth.uid() and profile.is_active for share;
  if not found then raise exception 'Access denied' using errcode = '42501'; end if;
  if not actor_admin then
    perform grant_row.user_id from public.user_permissions grant_row
      join public.permission_definitions definition on definition.id = grant_row.permission_definition_id
      where grant_row.user_id = actor and definition.is_delegable
        and definition.key in ('inventory.products.edit', required_permission)
      order by definition.key for share of grant_row, definition;
    if not (public.has_permission('inventory.products.edit') and public.has_permission(required_permission)) then
      raise exception 'Access denied' using errcode = '42501'; end if;
  end if;
  if not exists (select 1 from public.search_inventory_products_by_warehouse(p_warehouse_id, null) listed
    where listed.id = p_product_id) then
    raise exception 'Product is not listed in this warehouse' using errcode = 'P0002'; end if;

  select setting.* into current_setting_row from public.inventory_stock_minimums setting
    where setting.product_id = p_product_id and setting.warehouse_id = p_warehouse_id for update;
  has_setting := found;
  if (not has_setting and expected_value is not null)
    or (has_setting and expected_value is distinct from current_setting_row.version) then
    raise exception 'Stock minimum version conflict' using errcode = 'ISM01'; end if;
  if has_setting and current_setting_row.version = 9223372036854775807 then
    raise exception 'Stock minimum version exhausted' using errcode = '22003'; end if;
  changed_at := pg_catalog.clock_timestamp();
  if has_setting then
    update public.inventory_stock_minimums setting set minimum_quantity = minimum_value,
      version = setting.version + 1, updated_at = changed_at, updated_by_user_id = actor
      where setting.product_id = p_product_id and setting.warehouse_id = p_warehouse_id;
  else
    insert into public.inventory_stock_minimums(product_id, warehouse_id, minimum_quantity, version,
      created_at, updated_at, created_by_user_id, updated_by_user_id)
      values(p_product_id, p_warehouse_id, minimum_value, 1, changed_at, changed_at, actor, actor);
  end if;
  return query select setting.product_id, setting.warehouse_id, setting.minimum_quantity::text,
    setting.version::text, setting.created_at, setting.updated_at from public.inventory_stock_minimums setting
    where setting.product_id = p_product_id and setting.warehouse_id = p_warehouse_id;
end;
$function$;
revoke all on function public.set_inventory_stock_minimum(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.set_inventory_stock_minimum(uuid,uuid,text,text) to authenticated;
