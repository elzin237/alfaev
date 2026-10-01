drop function public.list_audit_log_page(integer, timestamptz, uuid);

create function public.list_audit_log_page(
  p_limit integer default 50,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_created_from timestamptz default null,
  p_created_before timestamptz default null,
  p_actor_user_id uuid default null,
  p_entity_type text default null,
  p_action_type text default null,
  p_search_text text default null
)
returns table (
  audit_log_id uuid,
  actor_user_id uuid,
  actor_full_name text,
  action_type text,
  entity_type text,
  entity_id uuid,
  summary text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  normalized_entity_type text := nullif(
    pg_catalog.btrim(p_entity_type),
    ''
  );
  normalized_action_type text := nullif(
    pg_catalog.btrim(p_action_type),
    ''
  );
  normalized_search_text text := nullif(
    pg_catalog.btrim(p_search_text),
    ''
  );
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('archive.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Page size must be between 1 and 100'
      using errcode = '22023';
  end if;

  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Archive cursor must include both created_at and id'
      using errcode = '22023';
  end if;

  if p_created_from is not null
    and p_created_before is not null
    and p_created_from >= p_created_before
  then
    raise exception 'Archive date range is invalid'
      using errcode = '22023';
  end if;

  if normalized_search_text is not null
    and pg_catalog.length(normalized_search_text) > 200
  then
    raise exception 'Archive search text cannot exceed 200 characters'
      using errcode = '22023';
  end if;

  return query
  select
    audit.id as audit_log_id,
    audit.actor_user_id,
    actor.full_name as actor_full_name,
    audit.action_type,
    audit.entity_type,
    audit.entity_id,
    audit.summary,
    audit.created_at
  from public.audit_logs as audit
  join public.user_profiles as actor
    on actor.id = audit.actor_user_id
  where (p_created_from is null or audit.created_at >= p_created_from)
    and (p_created_before is null or audit.created_at < p_created_before)
    and (p_actor_user_id is null or audit.actor_user_id = p_actor_user_id)
    and (
      normalized_entity_type is null
      or audit.entity_type = normalized_entity_type
    )
    and (
      normalized_action_type is null
      or audit.action_type = normalized_action_type
    )
    and (
      normalized_search_text is null
      or pg_catalog.strpos(
        pg_catalog.lower(audit.summary),
        pg_catalog.lower(normalized_search_text)
      ) > 0
      or pg_catalog.strpos(
        pg_catalog.lower(actor.full_name),
        pg_catalog.lower(normalized_search_text)
      ) > 0
      or pg_catalog.strpos(
        pg_catalog.lower(audit.action_type),
        pg_catalog.lower(normalized_search_text)
      ) > 0
      or pg_catalog.strpos(
        pg_catalog.lower(audit.entity_type),
        pg_catalog.lower(normalized_search_text)
      ) > 0
      or pg_catalog.strpos(
        pg_catalog.lower(audit.entity_id::text),
        pg_catalog.lower(normalized_search_text)
      ) > 0
    )
    and (
      p_before_created_at is null
      or (audit.created_at, audit.id) < (p_before_created_at, p_before_id)
    )
  order by audit.created_at desc, audit.id desc
  limit p_limit;
end;
$function$;

revoke all privileges
  on function public.list_audit_log_page(
    integer,
    timestamptz,
    uuid,
    timestamptz,
    timestamptz,
    uuid,
    text,
    text,
    text
  )
  from public, anon, authenticated;

grant execute
  on function public.list_audit_log_page(
    integer,
    timestamptz,
    uuid,
    timestamptz,
    timestamptz,
    uuid,
    text,
    text,
    text
  )
  to authenticated;

create function public.get_audit_log_filter_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
    or not (
      public.current_user_is_admin()
      or public.has_permission('archive.view')
    )
  then
    raise exception 'Access denied'
      using errcode = '42501';
  end if;

  return pg_catalog.jsonb_build_object(
    'actors',
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'user_id', actor_option.user_id,
            'full_name', actor_option.full_name
          )
          order by
            pg_catalog.lower(actor_option.full_name),
            actor_option.full_name,
            actor_option.user_id
        )
        from (
          select
            actor.id as user_id,
            actor.full_name
          from public.user_profiles as actor
          where exists (
            select 1
            from public.audit_logs as audit
            where audit.actor_user_id = actor.id
          )
        ) as actor_option
      ),
      '[]'::jsonb
    ),
    'entity_types',
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          entity_option.entity_type
          order by entity_option.entity_type
        )
        from (
          select distinct audit.entity_type
          from public.audit_logs as audit
        ) as entity_option
      ),
      '[]'::jsonb
    ),
    'action_types',
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          action_option.action_type
          order by action_option.action_type
        )
        from (
          select distinct audit.action_type
          from public.audit_logs as audit
        ) as action_option
      ),
      '[]'::jsonb
    )
  );
end;
$function$;

revoke all privileges
  on function public.get_audit_log_filter_options()
  from public, anon, authenticated;

grant execute
  on function public.get_audit_log_filter_options()
  to authenticated;
