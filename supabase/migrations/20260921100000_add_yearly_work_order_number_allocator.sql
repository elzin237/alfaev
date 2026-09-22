create table public.work_order_number_counters (
  business_year integer primary key,
  last_value integer not null,
  constraint work_order_number_counters_business_year_valid
    check (business_year between 1 and 9999),
  constraint work_order_number_counters_last_value_valid
    check (last_value between 1 and 9999)
);

alter table public.work_order_number_counters enable row level security;

revoke all privileges
  on table public.work_order_number_counters
  from public, anon, authenticated;

create function public.allocate_work_order_number_for_year(
  p_business_year integer
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  allocated_value integer;
begin
  if p_business_year is null
    or p_business_year < 1
    or p_business_year > 9999
  then
    raise exception 'Invalid Work Order business year'
      using errcode = '22023';
  end if;

  insert into public.work_order_number_counters as counter (
    business_year,
    last_value
  )
  values (
    p_business_year,
    1
  )
  on conflict (business_year) do update
  set last_value = counter.last_value + 1
  where counter.last_value < 9999
  returning counter.last_value
  into allocated_value;

  if allocated_value is null then
    raise exception 'Work Order number sequence exhausted for year %',
      p_business_year
      using errcode = 'WOR03';
  end if;

  return 'RN-'
    || pg_catalog.lpad(p_business_year::text, 4, '0')
    || '-'
    || pg_catalog.lpad(allocated_value::text, 4, '0');
end;
$function$;

revoke all privileges
  on function public.allocate_work_order_number_for_year(integer)
  from public, anon, authenticated;

create function public.allocate_work_order_number()
returns text
language sql
volatile
security definer
set search_path = ''
as $function$
  select public.allocate_work_order_number_for_year(
    pg_catalog.date_part(
      'year',
      pg_catalog.timezone(
        'Europe/Sarajevo',
        pg_catalog.clock_timestamp()
      )
    )::integer
  );
$function$;

revoke all privileges
  on function public.allocate_work_order_number()
  from public, anon, authenticated;
