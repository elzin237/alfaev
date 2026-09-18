-- PCB viewers need narrow historical Project and producer names without
-- broadening Project or UserProfile table reads.
create function public.list_pcb_production_history(p_pcb_card_id uuid)
returns table (
  production_run_id uuid,
  completed_at timestamptz,
  quantity_produced text,
  project_id uuid,
  project_name text,
  bom_version_id uuid,
  bom_version_number text,
  produced_by_user_id uuid,
  produced_by_full_name text
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
  select run.id, run.completed_at, run.quantity_produced::text,
         run.project_id, project.name, run.bom_version_id,
         version.version_number::text, run.produced_by_user_id,
         producer.full_name
  from public.pcb_production_runs as run
  join public.pcb_bom_versions as version on version.id = run.bom_version_id
  join public.user_profiles as producer on producer.id = run.produced_by_user_id
  left join public.projects as project on project.id = run.project_id
  where run.pcb_card_id = p_pcb_card_id
  order by run.completed_at desc, run.id desc;
end;
$function$;

revoke all privileges on function public.list_pcb_production_history(uuid)
  from public, anon, authenticated;
grant execute on function public.list_pcb_production_history(uuid)
  to authenticated;
