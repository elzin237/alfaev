import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql=readFileSync("supabase/migrations/20261026100000_correct_finished_goods_input_sourcing_and_inventory_reads.sql","utf8");
describe("Finished Goods sourcing and warehouse aggregate",()=>{
  it("replaces only the shared precheck/allocator and adds one narrow trusted read",()=>{
    expect(sql.match(/create (?:or replace )?function public\.[a-z_]+/g)).toEqual([
      "create or replace function public.get_production_eligible_quantity",
      "create or replace function public.get_work_order_warehouse_source_allocation_plan",
      "create function public.get_finished_goods_inventory_commitments"]);
    expect(sql).not.toMatch(/\b(insert into|update public\.|delete from|create trigger|alter table|disable trigger)\b/i);
  });
  it("filters Calculator inputs in every FIFO phase and retains reservation caps/locks",()=>{
    expect(sql).toContain("product.product_kind = 'pcb_finished_good'");
    expect(sql).toContain("card.output_product_id = p_product_id");
    expect(sql.match(/not finished_input or lot.warehouse_id/g)).toHaveLength(3);
    expect(sql).toContain("order by public.production_warehouse_priority(lot.warehouse_id), lot.received_at, lot.id for update");
    expect(sql).toContain("greatest(coalesce(available_fg,0::numeric) - prefix.before_in_warehouse,0::numeric)");
    expect(sql).toContain("for share");expect(sql).toContain("for update");
  });
  it("grants only active FG warehouse view and returns no Project identities",()=>{
    const read=sql.slice(sql.indexOf("create function public.get_finished_goods_inventory_commitments"));
    expect(read).toContain("language plpgsql stable security definer set search_path = ''");
    expect(read).toContain("public.current_active_user_profile_id() is null");
    expect(read).toContain("public.has_permission('inventory.finished_goods.view')");
    expect(read).not.toMatch(/projects.view|project_id|reservation_id|user_id|product.is_active|balance.quantity > 0/);
    expect(read).toContain("where state.reserved_quantity > 0 group by state.product_id");
    expect(read).toContain("coalesce(balance.quantity,0::bigint)::numeric - coalesce(reserved.quantity,0::numeric)");
    expect(read).toContain("from public, anon, authenticated, service_role");
    expect(read.match(/grant execute[^;]+;/g)).toEqual(["grant execute on function public.get_finished_goods_inventory_commitments() to authenticated;"]);
  });
});
