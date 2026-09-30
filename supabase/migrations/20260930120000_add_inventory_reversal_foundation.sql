-- Task 127 adds only reusable Inventory reversal data integrity. The future
-- trusted Work Order correction operation must authorize its caller and append
-- its correction AuditLog event atomically with apply_inventory_delta(...).

alter table public.inventory_movements
  add constraint inventory_movements_reversal_context_consistent
  check (
    (
      reversal_of_movement_id is null
      and source_type is distinct from 'correction_reversal'
    )
    or (
      reversal_of_movement_id is not null
      and source_type = 'correction_reversal'
      and reason is not null
    )
  );

create function public.validate_inventory_movement_reversal_product()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  original_product_id uuid;
begin
  if new.reversal_of_movement_id is null then
    return new;
  end if;

  select original.product_id
  into original_product_id
  from public.inventory_movements as original
  where original.id = new.reversal_of_movement_id;

  -- The existing self-FK remains authoritative for a missing reference.
  if found and original_product_id is distinct from new.product_id then
    raise exception 'Reversal movement Product must match original movement Product'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all privileges
  on function public.validate_inventory_movement_reversal_product()
  from public, anon, authenticated;

create trigger inventory_movements_validate_reversal_product
before insert
on public.inventory_movements
for each row
execute function public.validate_inventory_movement_reversal_product();

comment on constraint inventory_movements_reversal_context_consistent
  on public.inventory_movements is
  'Explicit correction/reversal movements require a referenced immutable movement and a nonblank normalized reason.';

comment on function public.validate_inventory_movement_reversal_product() is
  'Internal trigger foundation requiring a reversal movement to reference an InventoryMovement for the same Product; exposes no correction workflow.';
