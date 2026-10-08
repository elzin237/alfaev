create index projects_name_search_trgm_idx
  on public.projects
  using gin (pg_catalog.lower(name) extensions.gin_trgm_ops);

create function public.search_projects(p_search text)
returns table (
  project_id uuid,
  name text,
  status text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  active_profile_id uuid;
  normalized_search text := nullif(pg_catalog.btrim(p_search), '');
  escaped_search text;
  contains_pattern text;
  prefix_pattern text;
begin
  active_profile_id := public.current_active_user_profile_id();

  if auth.uid() is null
    or active_profile_id is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('projects.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if normalized_search is null then
    return;
  end if;

  if pg_catalog.length(normalized_search) > 100 then
    raise exception 'Project search is too long'
      using errcode = '22023';
  end if;

  escaped_search := pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(
        normalized_search,
        pg_catalog.chr(92),
        pg_catalog.chr(92) || pg_catalog.chr(92)
      ),
      '%',
      pg_catalog.chr(92) || '%'
    ),
    '_',
    pg_catalog.chr(92) || '_'
  );
  contains_pattern := '%' || pg_catalog.lower(escaped_search) || '%';
  prefix_pattern := pg_catalog.lower(escaped_search) || '%';

  return query
  select
    project.id,
    project.name,
    project.status
  from public.projects as project
  where pg_catalog.lower(project.name)
    like contains_pattern escape '\'
  order by
    case
      when pg_catalog.lower(project.name)
        like prefix_pattern escape '\'
      then 0
      else 1
    end,
    pg_catalog.lower(project.name),
    project.name,
    project.id
  limit 8;
end;
$function$;

revoke all privileges
  on function public.search_projects(text)
  from public, anon, authenticated;

grant execute
  on function public.search_projects(text)
  to authenticated;
