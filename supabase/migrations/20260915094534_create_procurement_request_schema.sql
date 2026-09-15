create table public.procurement_requests (
  id uuid primary key default gen_random_uuid(),
  product_id uuid,
  requested_name text not null,
  supplier_id uuid not null,
  requested_quantity bigint not null,
  delivered_quantity bigint not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  created_by_user_id uuid not null,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid not null,
  resolved_at timestamptz,
  resolved_by_user_id uuid,
  constraint procurement_requests_product_id_fkey
    foreign key (product_id)
    references public.products(id)
    on delete restrict,
  constraint procurement_requests_supplier_id_fkey
    foreign key (supplier_id)
    references public.suppliers(id)
    on delete restrict,
  constraint procurement_requests_created_by_user_id_fkey
    foreign key (created_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint procurement_requests_updated_by_user_id_fkey
    foreign key (updated_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint procurement_requests_resolved_by_user_id_fkey
    foreign key (resolved_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint procurement_requests_requested_name_trimmed_nonblank
    check (
      requested_name = pg_catalog.btrim(requested_name)
      and pg_catalog.length(requested_name) > 0
    ),
  constraint procurement_requests_requested_quantity_positive
    check (requested_quantity > 0),
  constraint procurement_requests_delivered_quantity_valid
    check (
      delivered_quantity >= 0
      and delivered_quantity <= requested_quantity
    ),
  constraint procurement_requests_status_valid
    check (status in ('active', 'partly_delivered', 'resolved')),
  constraint procurement_requests_lifecycle_consistent
    check (
      (
        status = 'active'
        and delivered_quantity = 0
        and resolved_at is null
        and resolved_by_user_id is null
      )
      or (
        status = 'partly_delivered'
        and delivered_quantity > 0
        and resolved_at is null
        and resolved_by_user_id is null
      )
      or (
        status = 'resolved'
        and resolved_at is not null
        and resolved_by_user_id is not null
      )
    )
);

create index procurement_requests_status_idx
  on public.procurement_requests (status);

create index procurement_requests_supplier_id_idx
  on public.procurement_requests (supplier_id);

create index procurement_requests_product_id_idx
  on public.procurement_requests (product_id)
  where product_id is not null;

create function public.enforce_procurement_request_lifecycle()
returns trigger
language plpgsql
volatile
set search_path = ''
as $function$
begin
  if new.requested_name is distinct from old.requested_name then
    raise exception 'Procurement request name snapshot cannot be changed'
      using errcode = 'PRQ01';
  end if;

  if old.status = 'resolved' then
    raise exception 'Resolved Procurement requests cannot be modified'
      using errcode = 'PRQ02';
  end if;

  return new;
end;
$function$;

revoke all privileges
  on function public.enforce_procurement_request_lifecycle()
  from public, anon, authenticated;

create trigger procurement_requests_enforce_lifecycle
before update on public.procurement_requests
for each row
execute function public.enforce_procurement_request_lifecycle();

alter table public.procurement_requests enable row level security;

revoke all privileges
  on table public.procurement_requests
  from public, anon, authenticated;

grant select
  on table public.procurement_requests
  to authenticated;

create policy procurement_requests_select_authorized
on public.procurement_requests
for select
to authenticated
using (
  public.current_user_is_admin()
  or public.has_permission('procurement.view')
);
