create table public.pcb_bom_versions (
  id uuid primary key default gen_random_uuid(),
  pcb_card_id uuid not null,
  version_number bigint not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by_user_id uuid not null,
  constraint pcb_bom_versions_pcb_card_id_fkey
    foreign key (pcb_card_id) references public.pcb_cards(id) on delete restrict,
  constraint pcb_bom_versions_created_by_user_id_fkey
    foreign key (created_by_user_id) references public.user_profiles(id) on delete restrict,
  constraint pcb_bom_versions_version_number_positive
    check (version_number > 0),
  constraint pcb_bom_versions_card_version_key
    unique (pcb_card_id, version_number)
);

create unique index pcb_bom_versions_one_active_per_card
  on public.pcb_bom_versions (pcb_card_id)
  where is_active;

-- A version belongs permanently to its card. Otherwise a later reparent could
-- make an existing input become that card's own output without touching the item.
create function public.enforce_pcb_bom_version_card_identity()
returns trigger
language plpgsql
volatile
set search_path = ''
as $function$
begin
  if new.pcb_card_id is distinct from old.pcb_card_id then
    raise exception 'PCB BOM version card cannot be changed'
      using errcode = 'PCB03';
  end if;
  return new;
end;
$function$;

revoke all privileges on function public.enforce_pcb_bom_version_card_identity()
  from public, anon, authenticated;

create trigger pcb_bom_versions_enforce_card_identity
before update on public.pcb_bom_versions
for each row
execute function public.enforce_pcb_bom_version_card_identity();

create table public.pcb_bom_items (
  id uuid primary key default gen_random_uuid(),
  bom_version_id uuid not null,
  component_product_id uuid not null,
  quantity_per_card bigint not null,
  constraint pcb_bom_items_bom_version_id_fkey
    foreign key (bom_version_id) references public.pcb_bom_versions(id) on delete restrict,
  constraint pcb_bom_items_component_product_id_fkey
    foreign key (component_product_id) references public.products(id) on delete restrict,
  constraint pcb_bom_items_quantity_positive
    check (quantity_per_card > 0),
  constraint pcb_bom_items_version_product_key
    unique (bom_version_id, component_product_id)
);

create index pcb_bom_items_component_product_id_idx
  on public.pcb_bom_items (component_product_id);

create function public.enforce_pcb_bom_item_product()
returns trigger
language plpgsql
volatile
set search_path = ''
as $function$
declare
  output_product_id uuid;
  input_kind text;
  input_active boolean;
begin
  select card.output_product_id
  into output_product_id
  from public.pcb_bom_versions as version
  join public.pcb_cards as card on card.id = version.pcb_card_id
  where version.id = new.bom_version_id;

  -- The foreign key supplies the standard missing-version error.
  if output_product_id is null then
    return new;
  end if;

  select product.product_kind, product.is_active
  into input_kind, input_active
  from public.products as product
  where product.id = new.component_product_id
  for share;

  -- The foreign key supplies the standard missing-Product error.
  if not found then
    return new;
  end if;

  if not input_active or input_kind not in ('component', 'pcb_finished_good') then
    raise exception 'PCB BOM input Product is unavailable'
      using errcode = 'PCB04';
  end if;

  if new.component_product_id = output_product_id then
    raise exception 'PCB Card cannot consume its own output Product'
      using errcode = 'PCB05';
  end if;

  return new;
end;
$function$;

revoke all privileges on function public.enforce_pcb_bom_item_product()
  from public, anon, authenticated;

create trigger pcb_bom_items_enforce_product
before insert or update on public.pcb_bom_items
for each row
execute function public.enforce_pcb_bom_item_product();

alter table public.pcb_bom_versions enable row level security;
alter table public.pcb_bom_items enable row level security;

revoke all privileges on table public.pcb_bom_versions
  from public, anon, authenticated;
revoke all privileges on table public.pcb_bom_items
  from public, anon, authenticated;

grant select on table public.pcb_bom_versions to authenticated;
grant select on table public.pcb_bom_items to authenticated;

create policy pcb_bom_versions_select_pcb_readers
on public.pcb_bom_versions
for select to authenticated
using (
  public.current_user_is_admin()
  or public.has_permission('pcb.view')
);

create policy pcb_bom_items_select_pcb_readers
on public.pcb_bom_items
for select to authenticated
using (
  public.current_user_is_admin()
  or public.has_permission('pcb.view')
);
