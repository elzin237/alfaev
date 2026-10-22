-- Demand changes through Project-linked consumption in every warehouse, even
-- though only Raw Materials plus Customs contribute eligible physical stock.
create or replace function public.queue_project_shortage_reconciliation()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  affected_product_id uuid;
begin
  if tg_table_name = 'inventory_balances' then
    if tg_op <> 'DELETE'
      and new.warehouse_id in (
        '10000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000003'::uuid
      )
    then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), new.product_id)
      on conflict do nothing;
    end if;
    if tg_op <> 'INSERT'
      and old.warehouse_id in (
        '10000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000003'::uuid
      )
    then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), old.product_id)
      on conflict do nothing;
    end if;
  elsif tg_table_name = 'inventory_movements' then
    if tg_op = 'INSERT'
      and new.project_id is not null
      and new.quantity_delta < 0
      and new.source_type in ('work_order', 'pcb_production_input')
    then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), new.product_id)
      on conflict do nothing;
    end if;
  elsif tg_table_name = 'project_product_components' then
    if tg_op <> 'DELETE' then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), new.product_id)
      on conflict do nothing;
    end if;
    if tg_op <> 'INSERT' then
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), old.product_id)
      on conflict do nothing;
    end if;
  elsif tg_table_name = 'projects'
    and new.status is distinct from old.status
  then
    for affected_product_id in
      select distinct component.product_id
      from public.project_products as project_product
      join public.project_product_components as component
        on component.project_product_id = project_product.id
      where project_product.project_id = new.id
      order by component.product_id
    loop
      insert into public.project_shortage_reconciliation_queue (
        transaction_id, product_id
      ) values (pg_catalog.txid_current(), affected_product_id)
      on conflict do nothing;
    end loop;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all privileges
  on function public.queue_project_shortage_reconciliation()
  from public, anon, authenticated, service_role;

create trigger inventory_movements_queue_project_shortage_reconciliation
after insert on public.inventory_movements
for each row
when (
  new.project_id is not null
  and new.quantity_delta < 0
  and new.source_type in ('work_order', 'pcb_production_input')
)
execute function public.queue_project_shortage_reconciliation();
