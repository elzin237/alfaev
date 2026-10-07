-- Support case-sensitive prefix search under non-C collations without duplicating
-- the existing unique equality index on Product Serial Number.
create index products_serial_number_pattern_idx
  on public.products (serial_number text_pattern_ops);

-- Support deterministic newest-first Work Order list reads.
create index work_orders_created_at_id_idx
  on public.work_orders (created_at desc, id desc);

-- Support the Dashboard's bounded recent Work Order projection.
create index work_orders_updated_at_id_idx
  on public.work_orders (updated_at desc, id desc);

-- Support the Dashboard's bounded recent Project projection.
create index projects_updated_at_id_idx
  on public.projects (updated_at desc, id desc);

-- Support both the unresolved Procurement count and bounded recent projection.
create index procurement_requests_unresolved_updated_at_id_idx
  on public.procurement_requests (updated_at desc, id desc)
  where status in ('active', 'partly_delivered');

-- Support both the active Product count and bounded recent projection.
create index products_active_updated_at_id_idx
  on public.products (updated_at desc, id desc)
  where is_active;
