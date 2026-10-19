import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261019110000_add_project_alert_notification_reads.sql",
  ),
  "utf8",
);

describe("Task F1 Project alert notification reads migration", () => {
  it("defines only the bounded inbox and unread-count RPCs", () => {
    expect(migration.match(/create function public\./g)).toHaveLength(2);
    expect(migration).toContain(
      "create function public.list_project_alert_notifications(",
    );
    expect(migration).toContain(
      "create function public.get_project_alert_unread_count()",
    );
    expect(migration).not.toMatch(/create\s+table|alter\s+table|create\s+index/i);
    expect(migration).not.toContain("mark_project_alert_read");
  });

  it("derives the active caller and never accepts recipient identity", () => {
    expect(migration).toContain(
      "actor_profile_id := public.current_active_user_profile_id()",
    );
    expect(migration).toContain("auth.uid() is null");
    expect(migration).toContain("public.current_user_is_admin()");
    expect(migration).toContain("public.has_permission('dashboard.view')");
    expect(migration).toContain("public.has_permission('projects.view')");
    expect(migration).toContain(
      "recipient.recipient_user_id = actor_profile_id",
    );
    expect(migration).not.toMatch(/p_recipient_user_id/i);
    expect(migration).not.toContain("projects.alerts.receive");
  });

  it("uses the canonical narrow join and projection", () => {
    for (const join of [
      "from public.project_activity_alert_recipients as recipient",
      "join public.project_activity_alerts as alert",
      "join public.project_activity_updates as activity",
      "join public.projects as project",
      "join public.user_profiles as author",
    ]) expect(migration).toContain(join);

    const returnProjection = migration.slice(
      migration.indexOf("returns table ("),
      migration.indexOf(")\nlanguage plpgsql"),
    );
    for (const field of [
      "notification_id uuid",
      "alert_id uuid",
      "project_id uuid",
      "project_name text",
      "activity_id uuid",
      "activity_title text",
      "activity_author_full_name text",
      "created_at timestamptz",
      "read_at timestamptz",
      "has_more boolean",
    ]) expect(returnProjection).toContain(field);
    for (const protectedField of [
      "description",
      "storage_path",
      "content_hash",
      "email",
      "birthday",
      "is_admin",
      "permissions",
      "before_data",
      "after_data",
      "metadata",
    ]) expect(returnProjection).not.toContain(protectedField);
  });

  it("implements bounded deterministic keyset pagination", () => {
    expect(migration).toContain("p_limit integer default 20");
    expect(migration).toContain("p_limit < 1 or p_limit > 50");
    expect(migration).toContain(
      "(p_before_created_at is null) <> (p_before_recipient_id is null)",
    );
    expect(migration).toContain(
      "(recipient.created_at, recipient.id) <\n          (p_before_created_at, p_before_recipient_id)",
    );
    expect(migration).toContain(
      "order by recipient.created_at desc, recipient.id desc",
    );
    expect(migration).toContain("limit p_limit + 1");
    expect(migration).not.toMatch(/\boffset\b/i);
  });

  it("counts exact caller-owned unread notifications without mutation", () => {
    expect(migration).toContain("select pg_catalog.count(*)");
    expect(migration).toContain("recipient.read_at is null");
    expect(migration).not.toMatch(/\bupdate\s+public\./i);
    expect(migration).not.toMatch(/\binsert\s+into\b/i);
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
    expect(migration).not.toContain("append_audit_log");
  });

  it("hardens both stable RPCs for authenticated execution only", () => {
    expect(migration.match(/language plpgsql\nstable\nsecurity definer/g))
      .toHaveLength(2);
    expect(migration.match(/set search_path = ''/g)).toHaveLength(2);
    expect(migration.match(/from public, anon, authenticated;/g)).toHaveLength(2);
    expect(migration.match(/to authenticated;/g)).toHaveLength(2);
    expect(migration).not.toMatch(/grant\s+(?:select|insert|update|delete)/i);
    expect(migration).not.toMatch(/execute\s+format|\bformat\s*\(/i);
  });
});
