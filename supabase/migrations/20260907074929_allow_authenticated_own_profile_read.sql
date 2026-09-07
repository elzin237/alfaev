grant select
  on table public.user_profiles
  to authenticated;

create policy user_profiles_select_own
on public.user_profiles
for select
to authenticated
using (public.user_profiles.auth_user_id = (select auth.uid()));
