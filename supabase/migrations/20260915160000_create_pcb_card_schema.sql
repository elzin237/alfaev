create table public.pcb_cards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  output_product_id uuid not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by_user_id uuid not null,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid not null,
  archived_at timestamptz,
  archived_by_user_id uuid,
  constraint pcb_cards_output_product_id_key
    unique (output_product_id),
  constraint pcb_cards_output_product_id_fkey
    foreign key (output_product_id)
    references public.products(id)
    on delete restrict,
  constraint pcb_cards_created_by_user_id_fkey
    foreign key (created_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint pcb_cards_updated_by_user_id_fkey
    foreign key (updated_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint pcb_cards_archived_by_user_id_fkey
    foreign key (archived_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint pcb_cards_name_trimmed_nonblank
    check (
      name = pg_catalog.btrim(name)
      and pg_catalog.length(name) > 0
    ),
  constraint pcb_cards_archive_state_consistent
    check (
      (
        is_active
        and archived_at is null
        and archived_by_user_id is null
      )
      or (
        not is_active
        and archived_at is not null
        and archived_by_user_id is not null
      )
    )
);

create function public.enforce_pcb_card_output_product()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  output_product_kind text;
begin
  if tg_op = 'UPDATE'
     and new.output_product_id is distinct from old.output_product_id then
    raise exception 'PCB Card output Product cannot be changed'
      using errcode = 'PCB02';
  end if;

  select product.product_kind
  into output_product_kind
  from public.products as product
  where product.id = new.output_product_id
  for key share;

  if not found then
    return new;
  end if;

  if output_product_kind <> 'pcb_finished_good' then
    raise exception 'PCB Card output Product must be a PCB finished good'
      using errcode = 'PCB01';
  end if;

  return new;
end;
$function$;

revoke all privileges
  on function public.enforce_pcb_card_output_product()
  from public, anon, authenticated;

create trigger pcb_cards_enforce_output_product
before insert or update on public.pcb_cards
for each row
execute function public.enforce_pcb_card_output_product();

alter table public.pcb_cards enable row level security;

revoke all privileges
  on table public.pcb_cards
  from public, anon, authenticated;

grant select
  on table public.pcb_cards
  to authenticated;

create policy pcb_cards_select_pcb_readers
on public.pcb_cards
for select
to authenticated
using (
  public.current_user_is_admin()
  or public.has_permission('pcb.view')
);
