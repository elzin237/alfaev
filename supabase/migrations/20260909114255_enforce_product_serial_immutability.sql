create or replace function public.enforce_product_lifecycle_immutability()
returns trigger
language plpgsql
volatile
set search_path = ''
as $function$
begin
  if not old.is_active then
    raise exception 'Archived Products cannot be modified'
      using errcode = 'PRD01';
  end if;

  if new.product_kind is distinct from old.product_kind then
    raise exception 'Product kind cannot be changed'
      using errcode = 'PRD02';
  end if;

  if new.serial_number is distinct from old.serial_number then
    raise exception 'Product Serial Number cannot be changed'
      using errcode = 'PRD03';
  end if;

  return new;
end;
$function$;

revoke all privileges
  on function public.enforce_product_lifecycle_immutability()
  from public, anon, authenticated;
