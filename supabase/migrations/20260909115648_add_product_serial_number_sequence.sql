create sequence public.product_serial_number_seq
as bigint
increment by 1
minvalue 1
maxvalue 9999999
start with 1
no cycle
cache 1;

revoke all privileges
  on sequence public.product_serial_number_seq
  from public, anon, authenticated;

create function public.allocate_product_serial_number()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  allocated_value bigint;
begin
  allocated_value := pg_catalog.nextval(
    'public.product_serial_number_seq'::pg_catalog.regclass
  );

  return pg_catalog.lpad(allocated_value::text, 7, '0');
end;
$function$;

revoke all privileges
  on function public.allocate_product_serial_number()
  from public, anon, authenticated;
