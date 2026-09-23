create table public.work_order_items (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null,
  product_id uuid not null,
  quantity bigint not null,
  added_at timestamptz not null default pg_catalog.now(),
  added_by_user_id uuid not null,
  constraint work_order_items_work_order_id_fkey
    foreign key (work_order_id)
    references public.work_orders(id)
    on delete restrict,
  constraint work_order_items_product_id_fkey
    foreign key (product_id)
    references public.products(id)
    on delete restrict,
  constraint work_order_items_added_by_user_id_fkey
    foreign key (added_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint work_order_items_quantity_positive
    check (quantity > 0),
  constraint work_order_items_work_order_product_key
    unique (work_order_id, product_id)
);

-- The composite unique index begins with work_order_id, so it cannot support
-- Product-only historical lookups or Product FK maintenance efficiently.
create index work_order_items_product_id_idx
  on public.work_order_items (product_id);

create function public.enforce_work_order_item_parent_draft()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  old_work_order_id uuid;
  new_work_order_id uuid;
  locked_work_order_id uuid;
begin
  if tg_op <> 'INSERT' then
    old_work_order_id := old.work_order_id;
  end if;
  if tg_op <> 'DELETE' then
    new_work_order_id := new.work_order_id;
  end if;

  -- Lock every relevant parent in stable UUID order. Missing parents remain
  -- the responsibility of the foreign key.
  for locked_work_order_id in
    select work_order.id
    from public.work_orders as work_order
    where work_order.id in (old_work_order_id, new_work_order_id)
    order by work_order.id
    for update
  loop
    null;
  end loop;

  if exists (
    select 1
    from public.work_orders as work_order
    where work_order.id in (old_work_order_id, new_work_order_id)
      and work_order.status <> 'draft'
  ) then
    raise exception 'Finished Work Order items are immutable'
      using errcode = 'WOR04';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all privileges
  on function public.enforce_work_order_item_parent_draft()
  from public, anon, authenticated;

create trigger work_order_items_enforce_parent_draft
before insert or update or delete on public.work_order_items
for each row
execute function public.enforce_work_order_item_parent_draft();

alter table public.work_order_items enable row level security;

revoke all privileges
  on table public.work_order_items
  from public, anon, authenticated;

grant select
  on table public.work_order_items
  to authenticated;

create policy work_order_items_select_authorized
on public.work_order_items
for select
to authenticated
using (
  public.current_user_is_admin()
  or public.has_permission('work_orders.view')
);
