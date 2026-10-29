import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";

const directory = "supabase/migrations/";
const file = "20261028140000_add_work_order_material_shortage_episodes.sql";
const sql = readFileSync(directory + file, "utf8");

it("preserves migrations 1–162 byte for byte", () => {
  const files = readdirSync(directory).filter(f => /^\d{14}_.+\.sql$/.test(f)).sort();
  expect(files[162]).toBe(file);
  const hash = createHash("sha256");
  for (const name of files.slice(0, 162)) hash.update(name + "\0").update(readFileSync(directory + name));
  expect(hash.digest("hex")).toBe("d3c4f00457f8eb876046a17ab2dc1f87d833ec4454c0597da7c11fd04ad2497b");
});

it("keeps episodes, events, delivery intents and queue private", () => {
  for (const table of ["episodes", "events", "notification_outbox", "reconciliation_queue"])
    expect(sql).toContain(`alter table public.work_order_material_shortage_${table} enable row level security`);
  expect(sql).toContain("from public, anon, authenticated, service_role");
  expect(sql).not.toMatch(/grant\s+(select|insert|update|delete|execute)/i);
  expect(sql).not.toMatch(/on delete cascade|references public\.work_orders\(|references public\.products\(/i);
  expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?function\s+public\.(?:finish|delete_draft|save_draft|create_draft)/i);
});

it("coalesces queue entries and only queues notification opening and resolution", () => {
  expect(sql).toContain("primary key (transaction_id, product_id)");
  expect(sql).toContain("unique (episode_id, revision)");
  expect(sql).toContain("unique (episode_id, event_type)");
  expect(sql.match(/on conflict do nothing/g)?.length).toBeGreaterThanOrEqual(2);
  expect(sql.match(/insert into public.work_order_material_shortage_notification_outbox/g)).toHaveLength(2);
  expect(sql).toContain("if event_kind = 'resolved' then");
  expect(sql).toContain("if active_episode.id is null and missing_now > 0 then");
});

it("uses production eligibility and lazy expiry without physical accounting writes", () => {
  expect(sql).toContain("public.get_production_free_warehouse_quantity_at(");
  expect(sql).toContain("public.is_calculator_finished_product(p_product_id)");
  expect(sql).toContain("observed_at := pg_catalog.clock_timestamp()");
  expect(sql).toContain("transaction_isolation') <> 'read committed'");
  expect(sql).toContain("missing_quantity::numeric = greatest(");
  expect(sql).not.toMatch(/calculate_open_project_commitments|project_shortage_episodes|project_activity_alerts/);
  expect(sql).not.toMatch(/insert into public.inventory_movements|update public.inventory_balances|insert into public.inventory_balances/i);
  expect(sql).not.toMatch(/pg_cron|create extension|reconcile.*on deployment/i);
});

it("queues Draft lifecycle, material, stock, hold and FG reservation changes", () => {
  for (const name of ["work_order_items", "work_orders", "inventory_balances",
    "test_calculation_holds", "finished_goods_project_reservations", "pcb_cards"])
    expect(sql).toContain(`on public.${name}`);
  expect(sql).toContain("deferrable initially deferred");
  expect(sql).toContain("pg_advisory_xact_lock");
  expect(sql).toContain("'work-order-material-shortage:' || p_product_id::text");
  expect(sql).not.toContain("'project-shortage-reconciliation:'");
  expect(sql).toContain("order by queue.product_id");
  expect(sql).toContain("where episode.work_order_id = old.id and episode.resolved_at is null");
  expect(sql).toContain("after update of status, updated_at or delete on public.work_orders");
});
