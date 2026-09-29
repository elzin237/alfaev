-- The canonical PDF renderer receives one narrow, trusted, deterministic
-- projection. Task 117 remains the authority for Finish eligibility and locks.
create function public.get_work_order_pdf_snapshot(
  p_work_order_id uuid,
  p_expected_updated_at timestamptz
)
returns table (
  work_order_id uuid,
  work_order_number text,
  project_name text,
  customer_name_snapshot text,
  description text,
  work_order_created_at timestamptz,
  snapshot_updated_at timestamptz,
  material_position text,
  product_id uuid,
  serial_number text,
  product_name text,
  quantity text
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  return query
  with trusted_preflight as materialized (
    select preflight.*
    from public.preflight_finish_work_order(
      p_work_order_id,
      p_expected_updated_at
    ) as preflight
  )
  select
    preflight.work_order_id,
    preflight.work_order_number,
    preflight.project_name,
    preflight.customer_name_snapshot,
    preflight.description,
    work_order.created_at,
    preflight.updated_at,
    pg_catalog.row_number() over (
      order by item.added_at, item.id
    )::text,
    preflight.product_id,
    preflight.serial_number,
    preflight.product_name,
    preflight.required_quantity::text
  from trusted_preflight as preflight
  join public.work_orders as work_order
    on work_order.id = preflight.work_order_id
  join public.work_order_items as item
    on item.work_order_id = preflight.work_order_id
   and item.product_id = preflight.product_id
  order by item.added_at, item.id;
end;
$function$;

revoke all privileges
  on function public.get_work_order_pdf_snapshot(uuid, timestamptz)
  from public, anon, authenticated;

grant execute
  on function public.get_work_order_pdf_snapshot(uuid, timestamptz)
  to authenticated;
