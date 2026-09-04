create table public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  full_name text not null,
  email text not null,
  birthday date not null,
  is_admin boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by_user_id uuid,
  last_login_at timestamptz,
  deactivated_at timestamptz,
  deactivated_by_user_id uuid,

  constraint user_profiles_auth_user_id_key unique (auth_user_id),
  constraint user_profiles_email_key unique (email),
  constraint user_profiles_full_name_not_blank
    check (length(btrim(full_name)) > 0),
  constraint user_profiles_email_not_blank
    check (length(btrim(email)) > 0),
  constraint user_profiles_auth_user_id_fkey
    foreign key (auth_user_id)
    references auth.users (id)
    on delete restrict,
  constraint user_profiles_created_by_user_id_fkey
    foreign key (created_by_user_id)
    references public.user_profiles (id)
    on delete restrict,
  constraint user_profiles_deactivated_by_user_id_fkey
    foreign key (deactivated_by_user_id)
    references public.user_profiles (id)
    on delete restrict
);

alter table public.user_profiles enable row level security;

revoke all privileges on table public.user_profiles from public, anon, authenticated;
