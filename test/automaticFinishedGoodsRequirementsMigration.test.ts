import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
const sql=readFileSync("supabase/migrations/20261026110000_auto_reserve_finished_goods_project_requirements.sql","utf8");
describe("149 atomic requirement boundary",()=>{
  it("does not mutate physical accounting, stock-arrival triggers or shortage formulas",()=>{
    expect(sql).not.toMatch(/(?:update|insert into|delete from) public\.(?:inventory_balances|inventory_movements|inventory_source_lots|inventory_source_allocations|project_shortage_episodes)\b/i);
    expect(sql).not.toContain("create or replace function public.calculate_open_project_commitments");
    expect(sql).not.toMatch(/create trigger .*on public.inventory_balances/i);
  });
  it("keeps receipts immutable/private and checks actor before payload replay",()=>{
    expect(sql).toContain("enable row level security");expect(sql).toContain("before update or delete");
    expect(sql.indexOf("if receipt.actor_user_id<>actor")).toBeLessThan(sql.indexOf("receipt.payload is distinct from intent"));
    expect(sql).toContain("return receipt.result");expect(sql).toContain("expected_quantity");
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended(p_request_id::text,0))");
  });
  it("retains demand guard, trims before edits and uses actual canonical demand afterward",()=>{
    expect(sql).not.toMatch(/disable trigger|drop trigger|alter.*FGR06/i);
    expect(sql.indexOf("if reserved::numeric>demand")).toBeLessThan(sql.indexOf("component_key:=public.create_project_requirement_private"));
    expect(sql).toContain("public.calculate_project_product_demand(p_project_id,key)");
    expect(sql).toContain("extra:=least(greatest(demand-reserved,0),greatest(physical::numeric-global_reserved,0))");
  });
  it("identifies Calculator outputs by kind and Card linkage, not names",()=>{
    expect(sql).toContain("p.product_kind = 'pcb_finished_good'");expect(sql).toContain("c.output_product_id = p.id");
    expect(sql).toContain("Use the request-aware requirement operation");
    expect(sql).toContain("inventory.finished_goods.reserve");
    expect(sql.match(/grant execute[^;]+;/g)?.every(grant=>grant.endsWith("to authenticated;"))).toBe(true);
  });
});
