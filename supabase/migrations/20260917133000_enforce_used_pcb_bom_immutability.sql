-- PCB production history is the sole authority for whether a BOM version is used.
-- The parent row lock serializes first production with direct BOM item writes.
create function public.lock_pcb_bom_version_for_production()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  perform 1
  from public.pcb_bom_versions as version
  where version.id = new.bom_version_id
  for update;

  -- The existing composite FK supplies the missing/mismatched version error.
  return new;
end;
$function$;

revoke all privileges on function public.lock_pcb_bom_version_for_production()
  from public, anon, authenticated;

create trigger pcb_production_runs_00_lock_bom_version
before insert on public.pcb_production_runs
for each row
execute function public.lock_pcb_bom_version_for_production();

create function public.enforce_used_pcb_bom_version_immutability()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  -- Match the production-INSERT and item-mutation parent lock explicitly.
  -- This is a row lock, not an UPDATE: it does not recurse into this trigger.
  perform 1
  from public.pcb_bom_versions as version
  where version.id = old.id
  for update;

  if exists (
    select 1
    from public.pcb_production_runs as run
    where run.bom_version_id = old.id
  ) then
    if tg_op = 'DELETE' then
      raise exception 'Used PCB BOM version is immutable'
        using errcode = 'PCB09';
    end if;
    if not (
      old.is_active = true
      and new.is_active = false
      and new.id is not distinct from old.id
      and new.pcb_card_id is not distinct from old.pcb_card_id
      and new.version_number is not distinct from old.version_number
      and new.created_at is not distinct from old.created_at
      and new.created_by_user_id is not distinct from old.created_by_user_id
    ) then
      raise exception 'Used PCB BOM version is immutable'
        using errcode = 'PCB09';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all privileges on function public.enforce_used_pcb_bom_version_immutability()
  from public, anon, authenticated;

-- The name sorts before the existing card-identity UPDATE trigger, so a used
-- version consistently reports PCB09 even for an attempted card reparent.
create trigger pcb_bom_versions_00_enforce_used_immutability
before update or delete on public.pcb_bom_versions
for each row
execute function public.enforce_used_pcb_bom_version_immutability();

create function public.enforce_used_pcb_bom_item_immutability()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  old_version_id uuid;
  new_version_id uuid;
  locked_version_id uuid;
begin
  if tg_op <> 'INSERT' then
    old_version_id := old.bom_version_id;
  end if;
  if tg_op <> 'DELETE' then
    new_version_id := new.bom_version_id;
  end if;

  -- Lock both parents in stable UUID order for cross-version moves. A missing
  -- parent remains the responsibility of the existing FK.
  for locked_version_id in
    select version.id
    from public.pcb_bom_versions as version
    where version.id in (old_version_id, new_version_id)
    order by version.id
    for update
  loop
    null;
  end loop;

  if exists (
    select 1
    from public.pcb_production_runs as run
    where run.bom_version_id in (old_version_id, new_version_id)
  ) then
    raise exception 'Used PCB BOM items are immutable'
      using errcode = 'PCB09';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all privileges on function public.enforce_used_pcb_bom_item_immutability()
  from public, anon, authenticated;

-- This name sorts before pcb_bom_items_enforce_product, so the history check
-- executes before product eligibility checks on INSERT/UPDATE.
create trigger pcb_bom_items_00_enforce_used_immutability
before insert or update or delete on public.pcb_bom_items
for each row
execute function public.enforce_used_pcb_bom_item_immutability();
