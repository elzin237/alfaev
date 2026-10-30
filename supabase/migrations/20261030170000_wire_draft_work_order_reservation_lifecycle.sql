-- 177: operational preparation only. Private operator gate defaults OFF.
create table public.work_order_reservation_activation (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false
);
insert into public.work_order_reservation_activation(singleton,enabled) values(true,false);
alter table public.work_order_reservation_activation enable row level security;
revoke all on public.work_order_reservation_activation from public,anon,authenticated,service_role;
create function public.draft_work_order_reservations_enabled()
returns boolean language plpgsql volatile security definer set search_path='' as $f$
declare active boolean;
begin
  select a.enabled into active from public.work_order_reservation_activation a where singleton for share;
  if not found then raise exception 'Reservation activation state unavailable' using errcode='55000';end if;
  return active;
end;
$f$;
create function public.draft_reservation_request_id(action text,work_order uuid,expected timestamptz,payload jsonb)
returns uuid language sql stable security invoker set search_path='' as $f$
  select md5('draft-reservation-public:'||jsonb_build_array(auth.uid(),public.current_active_user_profile_id(),action,work_order,
    to_char(expected at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),payload)::text)::uuid;
$f$;

alter function public.create_draft_work_order() rename to create_draft_work_order_reservation_base;
alter function public.create_pcb_production_work_order(uuid,text,uuid,uuid) rename to create_pcb_production_work_order_reservation_base;
alter function public.save_draft_work_order(uuid,uuid,text,jsonb,timestamptz) rename to save_draft_work_order_reservation_base;
alter function public.save_pcb_production_supplemental_materials(uuid,jsonb,timestamptz) rename to save_pcb_production_supplemental_materials_reservation_base;
alter function public.delete_draft_work_order(uuid,timestamptz) rename to delete_draft_work_order_reservation_base;
revoke all on function public.create_draft_work_order_reservation_base(),public.create_pcb_production_work_order_reservation_base(uuid,text,uuid,uuid),
  public.save_draft_work_order_reservation_base(uuid,uuid,text,jsonb,timestamptz),public.save_pcb_production_supplemental_materials_reservation_base(uuid,jsonb,timestamptz),
  public.delete_draft_work_order_reservation_base(uuid,timestamptz) from public,anon,authenticated,service_role;

-- Keep the reviewed allocator intact. Only redirect its canonical parent calls.
do $patch$
declare definition text; name text; needle text;
begin
  definition:=pg_get_functiondef('public.stage_draft_work_order_reservations(uuid,text,uuid,timestamptz,jsonb)'::regprocedure);
  foreach name in array array['create_draft_work_order','create_pcb_production_work_order','save_draft_work_order','save_pcb_production_supplemental_materials','delete_draft_work_order'] loop
    needle:='public.'||name||'(';
    if (length(definition)-length(replace(definition,needle,'')))<>length(needle) then raise exception 'Unexpected lifecycle parent: %',name;end if;
    definition:=replace(definition,needle,'public.'||name||'_reservation_base(');
  end loop;
  execute definition;
end;
$patch$;

create function public.create_draft_work_order()
returns table(work_order_id uuid,work_order_number text)
language plpgsql volatile security definer set search_path='' as $f$
declare request uuid:=gen_random_uuid(); result jsonb;
begin
  if not public.draft_work_order_reservations_enabled() then return query select * from public.create_draft_work_order_reservation_base();return;end if;
  result:=public.stage_draft_work_order_reservations(request,'create');
  return query select r.work_order_id,r.work_order_number from public.work_order_material_reservation_receipts r where r.request_id=request;
end;
$f$;
create function public.create_pcb_production_work_order(p_pcb_card_id uuid,p_planned_quantity text,p_project_id uuid,p_creation_request_id uuid)
returns table(work_order_id uuid,work_order_number text)
language plpgsql volatile security definer set search_path='' as $f$
declare result jsonb; planned_text text:=case when p_planned_quantity~'^[0-9]+$' then ltrim(p_planned_quantity,'0') else p_planned_quantity end;
begin
  if not public.draft_work_order_reservations_enabled()
    and not exists(select 1 from public.work_order_material_reservation_receipts r where r.request_id=p_creation_request_id) then
    return query select * from public.create_pcb_production_work_order_reservation_base(p_pcb_card_id,p_planned_quantity,p_project_id,p_creation_request_id);return;end if;
  -- Preserve the canonical rejection of Project-linked new PCB Drafts (and any
  -- legacy replay behavior); never discard the caller's Project argument.
  if p_project_id is not null and not exists(select 1 from public.work_order_material_reservation_receipts r where r.request_id=p_creation_request_id) then
    return query select * from public.create_pcb_production_work_order_reservation_base(p_pcb_card_id,p_planned_quantity,p_project_id,p_creation_request_id);return;end if;
  -- A pre-activation request replay must not silently initialize its old Draft.
  if exists(select 1 from public.pcb_production_work_orders p where p.creation_request_id=p_creation_request_id)
    and not exists(select 1 from public.work_order_material_reservation_receipts r where r.request_id=p_creation_request_id) then
    return query select * from public.create_pcb_production_work_order_reservation_base(p_pcb_card_id,p_planned_quantity,p_project_id,p_creation_request_id);return;
  end if;
  result:=public.stage_draft_work_order_reservations(p_creation_request_id,'create_pcb',null,null,
    jsonb_build_object('pcb_card_id',p_pcb_card_id,'planned_quantity',planned_text)||case when p_project_id is not null then jsonb_build_object('project_id',p_project_id) else '{}'::jsonb end);
  return query select r.work_order_id,r.work_order_number from public.work_order_material_reservation_receipts r where r.request_id=p_creation_request_id;
exception when sqlstate 'WRC01' then
  raise exception 'Creation request was already used for different PCB production data' using errcode='PCB13';
end;
$f$;
create function public.save_draft_work_order(p_work_order_id uuid,p_project_id uuid,p_description text,p_items jsonb,p_expected_updated_at timestamptz)
returns table(work_order_id uuid,updated_at timestamptz)
language plpgsql volatile security definer set search_path='' as $f$
declare request uuid; payload jsonb; result jsonb; enabled boolean:=public.draft_work_order_reservations_enabled();
begin
  payload:=jsonb_build_object('project_id',p_project_id,'description',p_description,'items',p_items);
  request:=public.draft_reservation_request_id('edit',p_work_order_id,p_expected_updated_at,payload);
  -- Turning new enrollment OFF must not orphan already-tracked ownership.
  if not enabled and not exists(select 1 from public.work_order_material_reservation_states s where s.live_work_order_id=p_work_order_id)
    and not exists(select 1 from public.work_order_material_reservation_receipts r where r.request_id=request) then
    return query select * from public.save_draft_work_order_reservation_base(p_work_order_id,p_project_id,p_description,p_items,p_expected_updated_at);return;end if;
  result:=public.stage_draft_work_order_reservations(request,'edit',p_work_order_id,p_expected_updated_at,payload);
  return query select (result->>'work_order_id')::uuid,(result->>'updated_at')::timestamptz;
end;
$f$;
create function public.save_pcb_production_supplemental_materials(p_work_order_id uuid,p_items jsonb,p_expected_updated_at timestamptz)
returns table(work_order_id uuid,updated_at timestamptz)
language plpgsql volatile security definer set search_path='' as $f$
declare request uuid; payload jsonb:=jsonb_build_object('items',p_items); result jsonb; enabled boolean:=public.draft_work_order_reservations_enabled();
begin
  request:=public.draft_reservation_request_id('supplemental',p_work_order_id,p_expected_updated_at,payload);
  if not enabled and not exists(select 1 from public.work_order_material_reservation_states s where s.live_work_order_id=p_work_order_id)
    and not exists(select 1 from public.work_order_material_reservation_receipts r where r.request_id=request) then
    return query select * from public.save_pcb_production_supplemental_materials_reservation_base(p_work_order_id,p_items,p_expected_updated_at);return;end if;
  result:=public.stage_draft_work_order_reservations(request,'supplemental',p_work_order_id,p_expected_updated_at,payload);
  return query select (result->>'work_order_id')::uuid,(result->>'updated_at')::timestamptz;
end;
$f$;
create function public.delete_draft_work_order(p_work_order_id uuid,p_expected_updated_at timestamptz)
returns table(work_order_id uuid,work_order_number text)
language plpgsql volatile security definer set search_path='' as $f$
declare request uuid; result jsonb; enabled boolean:=public.draft_work_order_reservations_enabled();
begin
  request:=public.draft_reservation_request_id('delete',p_work_order_id,p_expected_updated_at,'{}');
  if not enabled and not exists(select 1 from public.work_order_material_reservation_states s where s.live_work_order_id=p_work_order_id)
    and not exists(select 1 from public.work_order_material_reservation_receipts r where r.request_id=request) then
    return query select * from public.delete_draft_work_order_reservation_base(p_work_order_id,p_expected_updated_at);return;end if;
  result:=public.stage_draft_work_order_reservations(request,'delete',p_work_order_id,p_expected_updated_at,'{}');
  return query select r.work_order_id,r.work_order_number from public.work_order_material_reservation_receipts r where r.request_id=request;
end;
$f$;
revoke all on function public.draft_work_order_reservations_enabled(),public.draft_reservation_request_id(text,uuid,timestamptz,jsonb),
  public.create_draft_work_order(),public.create_pcb_production_work_order(uuid,text,uuid,uuid),public.save_draft_work_order(uuid,uuid,text,jsonb,timestamptz),
  public.save_pcb_production_supplemental_materials(uuid,jsonb,timestamptz),public.delete_draft_work_order(uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.create_draft_work_order(),public.create_pcb_production_work_order(uuid,text,uuid,uuid),
  public.save_draft_work_order(uuid,uuid,text,jsonb,timestamptz),public.save_pcb_production_supplemental_materials(uuid,jsonb,timestamptz),
  public.delete_draft_work_order(uuid,timestamptz) to authenticated;
