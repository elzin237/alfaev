import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261007100000_add_query_supporting_indexes.sql",
);
const inventorySearchPath = resolve(
  process.cwd(),
  "supabase/migrations/20260914140000_add_inventory_product_search.sql",
);
const workOrderListPath = resolve(
  process.cwd(),
  "supabase/migrations/20260921120000_add_trusted_work_order_list_read.sql",
);
const dashboardPath = resolve(
  process.cwd(),
  "supabase/migrations/20261001130000_add_permission_aware_dashboard_read_model.sql",
);

describe("Task 155 query-supporting indexes", () => {
  it("adds only the six indexes aligned to existing application queries", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql.match(/create index /g)).toHaveLength(6);
    expect(sql).toContain(
      "create index products_serial_number_pattern_idx\n" +
        "  on public.products (serial_number text_pattern_ops);",
    );
    expect(sql).toContain(
      "create index work_orders_created_at_id_idx\n" +
        "  on public.work_orders (created_at desc, id desc);",
    );
    expect(sql).toContain(
      "create index work_orders_updated_at_id_idx\n" +
        "  on public.work_orders (updated_at desc, id desc);",
    );
    expect(sql).toContain(
      "create index projects_updated_at_id_idx\n" +
        "  on public.projects (updated_at desc, id desc);",
    );
    expect(sql).toContain(
      "create index procurement_requests_unresolved_updated_at_id_idx\n" +
        "  on public.procurement_requests (updated_at desc, id desc)\n" +
        "  where status in ('active', 'partly_delivered');",
    );
    expect(sql).toContain(
      "create index products_active_updated_at_id_idx\n" +
        "  on public.products (updated_at desc, id desc)\n" +
        "  where is_active;",
    );

    expect(sql).not.toMatch(
      /create\s+(?:or\s+replace\s+)?function|alter\s+table|drop\s+index|\bgrant\b|\brevoke\b|\busing\s+(?:gin|gist)\b/i,
    );
  });

  it("matches the existing Inventory, Work Order, and Dashboard predicates and orderings", () => {
    const inventorySql = readFileSync(inventorySearchPath, "utf8");
    const workOrderSql = readFileSync(workOrderListPath, "utf8");
    const dashboardSql = readFileSync(dashboardPath, "utf8");

    expect(inventorySql).toContain(
      "product.serial_number like v_prefix_pattern escape '\\'",
    );
    expect(workOrderSql).toContain(
      "order by work_order.created_at desc, work_order.id desc",
    );
    expect(dashboardSql).toContain(
      "order by work_order.updated_at desc, work_order.id desc",
    );
    expect(dashboardSql).toContain(
      "order by project_list.updated_at desc, project_list.id desc",
    );
    expect(dashboardSql).toContain(
      "where request_list.status in ('active', 'partly_delivered')",
    );
    expect(dashboardSql).toContain(
      "order by request_list.updated_at desc, request_list.id desc",
    );
    expect(dashboardSql).toContain("where product.is_active");
    expect(dashboardSql).toContain(
      "order by product_list.updated_at desc, product_list.id desc",
    );
  });
});
