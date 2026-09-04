create table public.permission_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  module text not null,
  label text not null,
  description text not null,
  is_delegable boolean not null,
  created_at timestamptz not null default now(),

  constraint permission_definitions_key_key unique (key),
  constraint permission_definitions_key_not_blank
    check (length(btrim(key)) > 0),
  constraint permission_definitions_module_not_blank
    check (length(btrim(module)) > 0),
  constraint permission_definitions_label_not_blank
    check (length(btrim(label)) > 0),
  constraint permission_definitions_description_not_blank
    check (length(btrim(description)) > 0)
);

insert into public.permission_definitions (
  key,
  module,
  label,
  description,
  is_delegable
)
values
  (
    'dashboard.view',
    'dashboard',
    'View Dashboard',
    'View the Dashboard.',
    true
  ),
  (
    'projects.view',
    'projects',
    'View Projects',
    'View Projects.',
    true
  ),
  (
    'projects.create',
    'projects',
    'Create Projects',
    'Create Projects.',
    true
  ),
  (
    'projects.edit',
    'projects',
    'Edit Projects',
    'Edit Projects.',
    true
  ),
  (
    'projects.archive',
    'projects',
    'Delete/Archive Projects',
    'Delete or archive Projects where business rules allow.',
    true
  ),
  (
    'procurement.view',
    'procurement',
    'View Nabavka',
    'View Nabavka requests.',
    true
  ),
  (
    'procurement.create',
    'procurement',
    'Create Nabavka Request',
    'Create Nabavka requests.',
    true
  ),
  (
    'procurement.edit',
    'procurement',
    'Edit Nabavka Request',
    'Edit Nabavka requests.',
    true
  ),
  (
    'procurement.change_status',
    'procurement',
    'Change Nabavka Status',
    'Change the status of Nabavka requests.',
    true
  ),
  (
    'procurement.resolve',
    'procurement',
    'Resolve/Remove Nabavka Request',
    'Resolve or remove Nabavka requests where business rules allow.',
    true
  ),
  (
    'suppliers.view',
    'suppliers',
    'View Suppliers',
    'View Suppliers.',
    true
  ),
  (
    'suppliers.create',
    'suppliers',
    'Create Suppliers',
    'Create Suppliers.',
    true
  ),
  (
    'suppliers.edit',
    'suppliers',
    'Edit Suppliers',
    'Edit Suppliers.',
    true
  ),
  (
    'suppliers.archive',
    'suppliers',
    'Delete/Archive Suppliers',
    'Delete or archive Suppliers where business rules allow.',
    true
  ),
  (
    'inventory.view',
    'inventory',
    'View Inventory',
    'View Inventory.',
    true
  ),
  (
    'inventory.products.create',
    'inventory',
    'Add Products/Components',
    'Add Products and Components.',
    true
  ),
  (
    'inventory.products.edit',
    'inventory',
    'Edit Product/Component Data',
    'Edit Product and Component data.',
    true
  ),
  (
    'inventory.brands.manage',
    'inventory',
    'Manage Brands',
    'Create and maintain Brands.',
    true
  ),
  (
    'inventory.barcodes.generate',
    'inventory',
    'Generate/Download Barcodes',
    'Generate and download Product barcodes.',
    true
  ),
  (
    'pcb.view',
    'pcb',
    'View PCB Cards',
    'View PCB Cards.',
    true
  ),
  (
    'pcb.create',
    'pcb',
    'Create PCB Card/BOM',
    'Create PCB Cards and BOMs.',
    true
  ),
  (
    'pcb.edit',
    'pcb',
    'Edit PCB Card/BOM',
    'Edit PCB Cards and BOMs where business rules allow.',
    true
  ),
  (
    'pcb.produce',
    'pcb',
    'Produce PCB Cards',
    'Run authorized PCB production.',
    true
  ),
  (
    'pcb.archive',
    'pcb',
    'Delete/Archive PCB Definitions',
    'Delete or archive PCB definitions where business rules allow.',
    true
  ),
  (
    'work_orders.view',
    'work_orders',
    'View Work Orders',
    'View Work Orders.',
    true
  ),
  (
    'work_orders.create',
    'work_orders',
    'Create Work Orders',
    'Create Work Order drafts.',
    true
  ),
  (
    'work_orders.edit_draft',
    'work_orders',
    'Edit Draft Work Orders',
    'Edit Draft Work Orders.',
    true
  ),
  (
    'work_orders.finish',
    'work_orders',
    'Finish Work Orders',
    'Finish Work Orders through the trusted finalization workflow.',
    true
  ),
  (
    'work_orders.delete_draft',
    'work_orders',
    'Delete Draft Work Orders',
    'Delete Draft Work Orders.',
    true
  ),
  (
    'archive.view',
    'archive',
    'View Archive',
    'View the read-only Archive.',
    true
  );

create table public.user_permissions (
  user_id uuid not null,
  permission_definition_id uuid not null,
  granted_at timestamptz not null default now(),
  granted_by_user_id uuid not null,

  constraint user_permissions_pkey
    primary key (user_id, permission_definition_id),
  constraint user_permissions_user_id_fkey
    foreign key (user_id)
    references public.user_profiles (id)
    on delete restrict,
  constraint user_permissions_permission_definition_id_fkey
    foreign key (permission_definition_id)
    references public.permission_definitions (id)
    on delete restrict,
  constraint user_permissions_granted_by_user_id_fkey
    foreign key (granted_by_user_id)
    references public.user_profiles (id)
    on delete restrict
);

create index user_permissions_permission_definition_id_idx
  on public.user_permissions (permission_definition_id);

create function public.enforce_delegable_permission_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from public.permission_definitions
    where public.permission_definitions.id = new.permission_definition_id
      and public.permission_definitions.is_delegable
  ) then
    raise exception 'User permissions require a delegable permission definition'
      using
        errcode = '23514',
        constraint = 'user_permissions_permission_must_be_delegable';
  end if;

  return new;
end;
$function$;

create function public.prevent_granted_permission_from_becoming_non_delegable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.is_delegable
    and not new.is_delegable
    and exists (
      select 1
      from public.user_permissions
      where public.user_permissions.permission_definition_id = new.id
    )
  then
    raise exception 'A granted permission cannot become non-delegable'
      using
        errcode = '23514',
        constraint = 'permission_definitions_granted_permission_must_be_delegable';
  end if;

  return new;
end;
$function$;

create trigger user_permissions_require_delegable_permission
before insert or update of permission_definition_id
on public.user_permissions
for each row
execute function public.enforce_delegable_permission_grant();

create trigger permission_definitions_preserve_grant_delegability
before update of is_delegable
on public.permission_definitions
for each row
execute function public.prevent_granted_permission_from_becoming_non_delegable();

alter table public.permission_definitions enable row level security;
alter table public.user_permissions enable row level security;

revoke all privileges
  on table public.permission_definitions
  from public, anon, authenticated;
revoke all privileges
  on table public.user_permissions
  from public, anon, authenticated;

revoke all privileges
  on function public.enforce_delegable_permission_grant()
  from public, anon, authenticated;
revoke all privileges
  on function public.prevent_granted_permission_from_becoming_non_delegable()
  from public, anon, authenticated;

do $migration$
begin
  if (select count(*) from public.permission_definitions) <> 30 then
    raise exception 'Canonical permission definition seed is incomplete';
  end if;

  if exists (
    select 1
    from public.permission_definitions
    where not public.permission_definitions.is_delegable
  ) then
    raise exception 'Canonical permission definitions must be delegable';
  end if;
end;
$migration$;
