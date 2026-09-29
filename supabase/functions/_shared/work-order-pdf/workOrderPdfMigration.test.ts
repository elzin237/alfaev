import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260929140000_add_work_order_pdf_snapshot_read.sql",
);

describe("Task 119 trusted Work Order PDF snapshot SQL", () => {
  it("reuses Finish preflight and exposes only deterministic renderer fields", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain(
      "create function public.get_work_order_pdf_snapshot(\n" +
        "  p_work_order_id uuid,\n" +
        "  p_expected_updated_at timestamptz",
    );
    expect(sql).toContain("public.preflight_finish_work_order(");
    expect(sql).toContain("language plpgsql\nvolatile\nsecurity definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("order by item.added_at, item.id");
    expect(sql).toContain("preflight.required_quantity::text");
    expect(sql).toContain(
      "grant execute\n  on function public.get_work_order_pdf_snapshot(uuid, timestamptz)\n  to authenticated",
    );
    expect(sql).not.toMatch(
      /inventory_movements|apply_inventory_delta|audit_logs|storage\.|work_order_pdfs/,
    );
    expect(sql).not.toMatch(
      /email|permissions|finished_by_user_id|created_by_user_id/,
    );
  });
});
