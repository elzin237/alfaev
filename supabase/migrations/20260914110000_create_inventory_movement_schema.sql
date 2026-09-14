create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  movement_type text not null,
  quantity_delta bigint not null,
  quantity_before bigint not null,
  quantity_after bigint not null,
  reason text,
  source_type text,
  source_id uuid,
  project_id uuid,
  actor_user_id uuid not null,
  created_at timestamptz not null default now(),
  reversal_of_movement_id uuid,
  constraint inventory_movements_product_id_fkey
    foreign key (product_id)
    references public.products(id)
    on delete restrict,
  constraint inventory_movements_actor_user_id_fkey
    foreign key (actor_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint inventory_movements_reversal_of_movement_id_fkey
    foreign key (reversal_of_movement_id)
    references public.inventory_movements(id)
    on delete restrict,
  constraint inventory_movements_movement_type_trimmed_nonblank
    check (
      movement_type = pg_catalog.btrim(movement_type)
      and pg_catalog.length(movement_type) > 0
    ),
  constraint inventory_movements_reason_trimmed_nonblank
    check (
      reason is null
      or (
        reason = pg_catalog.btrim(reason)
        and pg_catalog.length(reason) > 0
      )
    ),
  constraint inventory_movements_source_type_trimmed_nonblank
    check (
      source_type is null
      or (
        source_type = pg_catalog.btrim(source_type)
        and pg_catalog.length(source_type) > 0
      )
    ),
  constraint inventory_movements_quantity_before_nonnegative
    check (quantity_before >= 0),
  constraint inventory_movements_quantity_after_nonnegative
    check (quantity_after >= 0),
  constraint inventory_movements_quantity_arithmetic_consistent
    check (quantity_after = quantity_before + quantity_delta),
  constraint inventory_movements_reversal_not_self
    check (
      reversal_of_movement_id is null
      or reversal_of_movement_id <> id
    )
);

create function public.prevent_inventory_movement_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception 'Inventory movements are immutable'
    using errcode = '55000';

  return old;
end;
$function$;

revoke all privileges
  on function public.prevent_inventory_movement_mutation()
  from public, anon, authenticated;

create trigger inventory_movements_reject_update_delete
before update or delete
on public.inventory_movements
for each row
execute function public.prevent_inventory_movement_mutation();

alter table public.inventory_movements enable row level security;

revoke all privileges
  on table public.inventory_movements
  from public, anon, authenticated;

grant select
  on table public.inventory_movements
  to authenticated;

create policy inventory_movements_select_inventory_readers
on public.inventory_movements
for select
to authenticated
using (
  public.current_user_is_admin()
  or public.has_permission('inventory.view')
);
