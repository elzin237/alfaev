insert into public.permission_definitions (
  key,
  module,
  label,
  description,
  is_delegable
)
values
  (
    'projects.alerts.send',
    'projects',
    'Send Project Activity Alerts',
    'Send alerts with otherwise authorized Project Activity updates.',
    true
  ),
  (
    'projects.alerts.receive',
    'projects',
    'Receive Project Activity Alerts',
    'Receive Project Activity alerts when all current recipient requirements are met.',
    true
  );

create table public.project_activity_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  author_user_id uuid not null,
  request_id uuid not null,
  title text not null,
  description text not null,
  created_at timestamptz not null default now(),

  constraint project_activity_updates_project_id_fkey
    foreign key (project_id)
    references public.projects(id)
    on delete restrict,
  constraint project_activity_updates_author_user_id_fkey
    foreign key (author_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint project_activity_updates_request_id_key
    unique (request_id),
  constraint project_activity_updates_title_normalized
    check (
      title = btrim(title)
      and char_length(title) between 1 and 120
    ),
  constraint project_activity_updates_description_normalized
    check (
      description = btrim(description)
      and char_length(description) between 1 and 5000
    )
);

create index project_activity_updates_project_timeline_idx
  on public.project_activity_updates (project_id, created_at desc, id desc);

create table public.project_activity_attachments (
  id uuid primary key default gen_random_uuid(),
  project_activity_id uuid not null,
  storage_path text not null,
  mime_type text not null,
  byte_size bigint not null,
  content_hash text not null,
  alt_text text,
  created_at timestamptz not null default now(),

  constraint project_activity_attachments_activity_id_fkey
    foreign key (project_activity_id)
    references public.project_activity_updates(id)
    on delete restrict,
  constraint project_activity_attachments_activity_id_key
    unique (project_activity_id),
  constraint project_activity_attachments_storage_path_key
    unique (storage_path),
  constraint project_activity_attachments_storage_path_normalized
    check (
      storage_path = btrim(storage_path)
      and char_length(storage_path) > 0
    ),
  constraint project_activity_attachments_mime_type_allowed
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint project_activity_attachments_byte_size_valid
    check (byte_size > 0 and byte_size <= 5242880),
  constraint project_activity_attachments_content_hash_normalized
    check (
      content_hash = btrim(content_hash)
      and char_length(content_hash) > 0
    ),
  constraint project_activity_attachments_alt_text_normalized
    check (
      alt_text is null
      or (
        alt_text = btrim(alt_text)
        and char_length(alt_text) between 1 and 500
      )
    )
);

create table public.project_activity_alerts (
  id uuid primary key default gen_random_uuid(),
  project_activity_id uuid not null,
  sent_by_user_id uuid not null,
  sent_at timestamptz not null default now(),

  constraint project_activity_alerts_activity_id_fkey
    foreign key (project_activity_id)
    references public.project_activity_updates(id)
    on delete restrict,
  constraint project_activity_alerts_sender_user_id_fkey
    foreign key (sent_by_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint project_activity_alerts_activity_id_key
    unique (project_activity_id)
);

create table public.project_activity_alert_recipients (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null,
  recipient_user_id uuid not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,

  constraint project_activity_alert_recipients_alert_id_fkey
    foreign key (alert_id)
    references public.project_activity_alerts(id)
    on delete restrict,
  constraint project_activity_alert_recipients_user_id_fkey
    foreign key (recipient_user_id)
    references public.user_profiles(id)
    on delete restrict,
  constraint project_activity_alert_recipients_alert_user_key
    unique (alert_id, recipient_user_id),
  constraint project_activity_alert_recipients_read_at_valid
    check (read_at is null or read_at >= created_at)
);

create index project_activity_alert_recipients_inbox_idx
  on public.project_activity_alert_recipients (
    recipient_user_id,
    created_at desc,
    id desc
  );

create index project_activity_alert_recipients_unread_inbox_idx
  on public.project_activity_alert_recipients (
    recipient_user_id,
    created_at desc,
    id desc
  )
  where read_at is null;

create function public.prevent_project_activity_history_mutation()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  raise exception 'Project Activity history is immutable'
    using errcode = '55000';

  return old;
end;
$function$;

create trigger project_activity_updates_reject_update_delete
before update or delete on public.project_activity_updates
for each row
execute function public.prevent_project_activity_history_mutation();

create trigger project_activity_attachments_reject_update_delete
before update or delete on public.project_activity_attachments
for each row
execute function public.prevent_project_activity_history_mutation();

create trigger project_activity_alerts_reject_update_delete
before update or delete on public.project_activity_alerts
for each row
execute function public.prevent_project_activity_history_mutation();

create function public.enforce_project_activity_alert_recipient_history()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    if new.read_at is not null then
      raise exception 'Project Activity alert recipient must start unread'
        using errcode = '55000';
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Project Activity alert recipient history is immutable'
      using errcode = '55000';
  end if;

  if new.id is distinct from old.id
    or new.alert_id is distinct from old.alert_id
    or new.recipient_user_id is distinct from old.recipient_user_id
    or new.created_at is distinct from old.created_at
    or old.read_at is not null
    or new.read_at is null
  then
    raise exception 'Only the initial Project Activity alert read transition is allowed'
      using errcode = '55000';
  end if;

  return new;
end;
$function$;

create trigger project_activity_alert_recipients_protect_history
before insert or update or delete on public.project_activity_alert_recipients
for each row
execute function public.enforce_project_activity_alert_recipient_history();

revoke all privileges
  on function public.prevent_project_activity_history_mutation()
  from public, anon, authenticated;

revoke all privileges
  on function public.enforce_project_activity_alert_recipient_history()
  from public, anon, authenticated;

alter table public.project_activity_updates enable row level security;
alter table public.project_activity_attachments enable row level security;
alter table public.project_activity_alerts enable row level security;
alter table public.project_activity_alert_recipients enable row level security;

revoke all privileges
  on table public.project_activity_updates
  from public, anon, authenticated;

revoke all privileges
  on table public.project_activity_attachments
  from public, anon, authenticated;

revoke all privileges
  on table public.project_activity_alerts
  from public, anon, authenticated;

revoke all privileges
  on table public.project_activity_alert_recipients
  from public, anon, authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'project-activity-images',
  'project-activity-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
);

-- Task D owns byte-signature/decoded-image validation and the server-generated path:
-- final/<project-id>/<activity-id>/<random-uuid>.<verified-extension>
-- Browser roles receive no direct object access in this foundation.
create policy project_activity_image_objects_no_direct_client_access
on storage.objects
as restrictive
for all
to anon, authenticated
using (bucket_id <> 'project-activity-images')
with check (bucket_id <> 'project-activity-images');
