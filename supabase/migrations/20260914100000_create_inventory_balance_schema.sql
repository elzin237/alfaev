create table public.inventory_balances (
  product_id uuid primary key,
  quantity bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint inventory_balances_product_id_fkey
    foreign key (product_id)
    references public.products(id)
    on delete restrict,
  constraint inventory_balances_quantity_nonnegative
    check (quantity >= 0)
);

insert into public.inventory_balances (
  product_id,
  quantity,
  updated_at
)
select product.id, 0, pg_catalog.now()
from public.products as product;

create function public.initialize_product_inventory_balance()
returns trigger
language plpgsql
volatile
set search_path = ''
as $function$
begin
  insert into public.inventory_balances (
    product_id,
    quantity,
    updated_at
  )
  values (
    new.id,
    0,
    pg_catalog.now()
  );

  return new;
end;
$function$;

revoke all privileges
  on function public.initialize_product_inventory_balance()
  from public, anon, authenticated;

create trigger products_initialize_inventory_balance
after insert on public.products
for each row
execute function public.initialize_product_inventory_balance();

alter table public.inventory_balances enable row level security;

revoke all privileges
  on table public.inventory_balances
  from public, anon, authenticated;

grant select
  on table public.inventory_balances
  to authenticated;

create policy inventory_balances_select_inventory_readers
on public.inventory_balances
for select
to authenticated
using (
  public.current_user_is_admin()
  or public.has_permission('inventory.view')
);
