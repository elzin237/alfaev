import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationName =
  "20261005113000_remove_generic_work_order_project_requirement_block.sql";

function migration(): string {
  return readFileSync(
    resolve(process.cwd(), "supabase/migrations", migrationName),
    "utf8",
  );
}

export function registerWorkOrderProjectRequirementTests(): void {
  describe("generic Work Order Project requirements are planning/reference data", () => {
    it("replaces only the trusted Draft-save and Finish-preflight boundaries", () => {
      const sql = migration();

      expect(sql.match(
        /create or replace function public\.save_draft_work_order\(/g,
      )).toHaveLength(1);
      expect(sql.match(
        /create or replace function public\.preflight_finish_work_order\(/g,
      )).toHaveLength(1);
      expect(sql).not.toContain("WOR06");
      expect(sql).not.toContain("calculate_open_project_commitments");
      expect(sql).not.toContain("other_draft_allocation");
      expect(sql).not.toContain("outstanding_commitment");
    });

    it("preserves generic Draft authorization, optimistic locking, Product validation, and exact quantities", () => {
      const sql = migration();

      expect(sql).toContain("public.has_permission('work_orders.edit_draft')");
      expect(sql).toContain("current_work_order.updated_at is distinct from p_expected_updated_at");
      expect(sql).toContain("using errcode = 'WOR05'");
      expect(sql).toContain("Duplicate Draft material Product IDs are not allowed");
      expect(sql).toContain("quantity_text > '9223372036854775807'");
      expect(sql).toContain("product_record.product_kind not in ('component', 'pcb_finished_good')");
      expect(sql).toContain("using errcode = 'PRD05'");
      expect(sql).toContain("selected_project.status not in ('planned', 'in_progress', 'on_hold')");
    });

    it("keeps PCB production frozen and keeps physical Inventory authoritative at Finish", () => {
      const sql = migration();

      expect(sql).toContain("from public.pcb_production_work_orders as production");
      expect(sql).toContain("using errcode = 'PCB11'");
      expect(sql).toContain("public.has_permission('work_orders.finish')");
      expect(sql).toContain("for share of product");
      expect(sql).toContain("for update of balance");
      expect(sql).toContain("balance.quantity >= item.quantity");
      expect(sql).toContain("greatest(");
      expect(sql).toContain("item.quantity::numeric - balance.quantity::numeric");
    });

    it("preserves hardened function metadata and authenticated-only execution", () => {
      const sql = migration();

      expect(sql.match(/security definer/g)).toHaveLength(2);
      expect(sql.match(/set search_path = ''/g)).toHaveLength(2);
      expect(sql.match(/from public, anon, authenticated;/g)).toHaveLength(2);
      expect(sql.match(/to authenticated;/g)).toHaveLength(2);
      expect(createHash("sha256").update(sql).digest("hex")).toMatch(
        /^[0-9a-f]{64}$/,
      );
    });
  });
}
