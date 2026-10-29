-- Visibility only: retain every balance, movement, provenance record and setting.
-- Authoritative linkage, not product names, categories or structural zero rows,
-- distinguishes Calculator outputs. Customs membership is intentionally unchanged.
do $migration$
declare
  definition text;
  old_fragment text;
  new_fragment text;
begin
  definition := pg_catalog.pg_get_functiondef(
    'public.search_inventory_products_by_warehouse(uuid,text)'::regprocedure);
  old_fragment := $old$    p_warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid
    or ($old$;
  new_fragment := $new$    (p_warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid
      and not exists (
        select 1 from public.pcb_cards as raw_output
        where raw_output.output_product_id = product.id
      ))
    or ($new$;
  if (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, old_fragment, '')))
      <> pg_catalog.length(old_fragment) then
    raise exception 'Unexpected warehouse listing definition; visibility migration stopped';
  end if;
  execute pg_catalog.replace(definition, old_fragment, new_fragment);

  -- Reject a stale/deep Raw link to an output after the existing authorization
  -- checks. Other detail/destination semantics, including Customs, are unchanged.
  definition := pg_catalog.pg_get_functiondef(
    'public.get_inventory_product_by_warehouse(uuid,uuid)'::regprocedure);
  old_fragment := $old$  return query
  select
    product.id,$old$;
  new_fragment := $new$  if p_warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid
    and exists (select 1 from public.pcb_cards as raw_output
      where raw_output.output_product_id = p_product_id) then
    raise exception 'Product not found in this warehouse' using errcode = 'P0002';
  end if;

  return query
  select
    product.id,$new$;
  if (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, old_fragment, '')))
      <> pg_catalog.length(old_fragment) then
    raise exception 'Unexpected warehouse detail definition; visibility migration stopped';
  end if;
  execute pg_catalog.replace(definition, old_fragment, new_fragment);
end;
$migration$;

-- CREATE OR REPLACE retains signatures, STABLE/SECURITY DEFINER/search_path and
-- existing ACLs. Minimum configuration, health, Dashboard and Test commitment
-- reads already delegate membership to the corrected listing; no data backfill.
