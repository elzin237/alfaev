alter table public.projects
  drop constraint projects_completed_at_status_consistent,
  drop constraint projects_cancelled_at_status_consistent;

alter table public.projects
  add constraint projects_completed_at_status_consistent
    check ((status = 'completed') = (completed_at is not null)),
  add constraint projects_cancelled_at_status_consistent
    check ((status = 'cancelled') = (cancelled_at is not null));
