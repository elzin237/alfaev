import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20261021100000_add_project_shortage_alert_episodes.sql",
), "utf8");

describe("automatic Project shortage alert migration", () => {
  it("creates one active episode per Project/Product and immutable event history", () => {
    expect(migration).toContain("create table public.project_shortage_episodes");
    expect(migration).toContain("create table public.project_shortage_events");
    expect(migration).toContain("where resolved_at is null");
    expect(migration).toContain("event_type in ('opened', 'increased', 'decreased', 'resolved')");
    expect(migration).toContain("project_shortage_events_reject_update_delete");
  });

  it("reuses the canonical commitment calculation and global physical balance", () => {
    expect(migration).toContain("public.calculate_open_project_commitments(current_product_id)");
    expect(migration).toContain("balance.quantity::numeric");
    expect(migration).not.toMatch(/project\.status in \('planned', 'in_progress', 'on_hold'\)/);
    expect(migration).not.toContain("product.is_active");
  });

  it("deduplicates a transaction batch and locks Products in stable UUID order", () => {
    expect(migration).toContain("create table public.project_shortage_reconciliation_queue");
    expect(migration).toContain("order by candidate.product_id");
    expect(migration).toMatch(/from public\.products as product[\s\S]*?for update/);
    expect(migration).toContain("deferrable initially deferred");
  });

  it("covers physical quantity, component, and Project status mutations", () => {
    expect(migration).toContain("inventory_balances_queue_shortage_reconciliation");
    expect(migration).toContain("project_components_queue_shortage_reconciliation");
    expect(migration).toContain("projects_queue_shortage_reconciliation");
    expect(migration).toContain("update of project_product_id, product_id, required_quantity");
  });

  it("stores senderless opening/resolution notifications and canonical recipients", () => {
    expect(migration).toContain("alter column sent_by_user_id drop not null");
    expect(migration).toContain("shortage_event_type in ('opened', 'resolved')");
    expect(migration).toContain("and definition.key = 'dashboard.view'");
    expect(migration).toContain("and definition.key = 'projects.view'");
    expect(migration).not.toContain("projects.alerts.receive");
    expect(migration).not.toContain("projects.alerts.send");
  });

  it("extends the trusted notification read with exact shortage event and Product context", () => {
    expect(migration).toContain(
      "drop function public.list_project_notifications(integer, timestamptz, uuid)",
    );
    expect(migration).toContain("product_serial_number text");
    expect(migration).toContain("product_name text");
    expect(migration).toContain("shortage_event_type text");
    expect(migration).toContain("shortage_quantity text");
    expect(migration).toContain("is_baseline_detection boolean");
    expect(migration).toContain(
      "shortage_event.shortage_quantity::text as shortage_quantity",
    );
    expect(migration).toContain(
      "left join public.project_shortage_events as shortage_event",
    );
    expect(migration).toContain(
      "left join public.project_shortage_episodes as shortage_episode",
    );
    expect(migration).toContain("left join public.products as product");
    expect(migration).not.toContain("recipient.recipient_user_id as");
  });

  it("preserves notification authorization, pagination, metadata, and ACLs", () => {
    expect(migration).toContain("actor_profile_id := public.current_active_user_profile_id()");
    expect(migration).toContain("public.has_permission('dashboard.view')");
    expect(migration).toContain("public.has_permission('projects.view')");
    expect(migration).toContain("recipient.recipient_user_id = actor_profile_id");
    expect(migration).toContain("recipient.dismissed_at is null");
    expect(migration).toContain(
      "(recipient.created_at, recipient.id) <\n          (p_before_created_at, p_before_recipient_id)",
    );
    expect(migration).toContain("order by recipient.created_at desc, recipient.id desc");
    expect(migration).toContain("limit p_limit + 1");
    expect(migration).toContain("stable\nsecurity definer\nset search_path = ''");
    expect(migration).toContain(
      "on function public.list_project_notifications(integer, timestamptz, uuid)\n  to authenticated",
    );
    expect(migration).toContain(
      "create or replace function public.get_project_alert_unread_count()",
    );
    expect(migration).toContain(
      "project.id = coalesce(activity.project_id, alert.project_id)",
    );
    expect(migration).toContain(
      "on function public.get_project_alert_unread_count()\n  to authenticated",
    );
  });

  it("keeps trusted helpers private and runs an idempotent baseline initializer", () => {
    expect(migration.match(/security definer/g)).toHaveLength(6);
    expect(migration.match(/set search_path = ''/g)).toHaveLength(7);
    expect(migration).toContain("select public.initialize_project_shortage_alerts();");
    expect(migration).toContain("'project-shortage-baseline-v1'");
    expect(migration).toContain("'existing shortage detected at enablement'");
    expect(migration).toContain("from public, anon, authenticated, service_role");
  });
});
