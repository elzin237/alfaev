-- PCB viewers need creator names and production-use state without broadening
-- UserProfile or production-run table reads.
create function public.list_pcb_bom_versions(p_pcb_card_id uuid)
returns table (
  bom_version_id uuid,
  version_number text,
  is_active boolean,
  created_at timestamptz,
  created_by_user_id uuid,
  created_by_full_name text,
  production_used boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not (
    public.current_user_is_admin()
    or public.has_permission('pcb.view')
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if p_pcb_card_id is null then
    raise exception 'PCB Card ID is required' using errcode = '22023';
  end if;

  perform 1
  from public.pcb_cards as card
  where card.id = p_pcb_card_id;
  if not found then
    raise exception 'PCB Card not found' using errcode = 'P0002';
  end if;

  return query
  select version.id, version.version_number::text, version.is_active,
         version.created_at, version.created_by_user_id, creator.full_name,
         exists (
           select 1
           from public.pcb_production_runs as run
           where run.bom_version_id = version.id
         )
  from public.pcb_bom_versions as version
  join public.user_profiles as creator on creator.id = version.created_by_user_id
  where version.pcb_card_id = p_pcb_card_id
  order by version.version_number desc, version.id desc;
end;
$function$;

revoke all privileges on function public.list_pcb_bom_versions(uuid)
  from public, anon, authenticated;
grant execute on function public.list_pcb_bom_versions(uuid)
  to authenticated;
