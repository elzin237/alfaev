import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261019130000_add_project_alert_mark_read.sql",
  ),
  "utf8",
);

describe("Task F2 Project alert mark-read migration", () => {
  it("defines only the narrow mark-read RPC and ACL", () => {
    expect(migration.match(/create function public\./g)).toHaveLength(1);
    expect(migration).toContain(
      "create function public.mark_project_alert_read(\n  p_notification_id uuid\n)",
    );
    expect(migration).toContain(
      "returns table (\n  notification_id uuid,\n  read_at timestamptz\n)",
    );
    expect(migration).not.toMatch(/create\s+(?:table|index|policy)|alter\s+table/i);
    expect(migration).not.toMatch(/insert\s+into|delete\s+from/i);
  });

  it("accepts no caller-controlled identity or timestamp", () => {
    const functionStart = migration.indexOf(
      "create function public.mark_project_alert_read(",
    );
    const signature = migration.slice(
      migration.indexOf("(", functionStart) + 1,
      migration.indexOf("returns table"),
    );
    expect(signature).toContain("p_notification_id uuid");
    expect(signature).not.toMatch(/recipient|user|timestamp|actor/i);
    expect(migration).not.toMatch(/p_(?:read_at|recipient|user|project|actor)/i);
  });

  it("locks the active caller profile before the owned recipient row", () => {
    const profileLock = migration.indexOf("from public.user_profiles as profile");
    const profileShare = migration.indexOf("for share;", profileLock);
    const recipientLock = migration.indexOf(
      "from public.project_activity_alert_recipients as recipient",
      profileShare,
    );
    const recipientUpdateLock = migration.indexOf("for update;", recipientLock);
    const mutation = migration.indexOf(
      "update public.project_activity_alert_recipients as recipient",
      recipientUpdateLock,
    );

    expect(profileLock).toBeGreaterThan(-1);
    expect(profileShare).toBeGreaterThan(profileLock);
    expect(recipientLock).toBeGreaterThan(profileShare);
    expect(recipientUpdateLock).toBeGreaterThan(recipientLock);
    expect(mutation).toBeGreaterThan(recipientUpdateLock);
  });

  it("enforces current access and exact recipient ownership", () => {
    expect(migration).toContain("actor_profile_id := public.current_active_user_profile_id()");
    expect(migration).toContain("profile.auth_user_id = auth.uid()");
    expect(migration).toContain("profile.is_active");
    expect(migration).toContain("public.has_permission('dashboard.view')");
    expect(migration).toContain("public.has_permission('projects.view')");
    expect(migration).toContain("recipient.recipient_user_id = actor_profile_id");
    expect(migration).not.toContain("projects.alerts.receive");
    expect(migration).not.toMatch(/from public\.projects/i);
  });

  it("performs only the initial server-owned read transition", () => {
    expect(migration).toContain("if current_notification.read_at is null then");
    expect(migration).toContain("pg_catalog.clock_timestamp()");
    expect(migration).toContain("current_notification.created_at");
    expect(migration).toContain("and recipient.read_at is null");
    expect(migration).not.toContain("append_audit_log");
    expect(migration.match(/update public\./g)).toHaveLength(1);
  });

  it("uses safe errors and authenticated-only hardened execution", () => {
    expect(migration).toContain("using errcode = '22023'");
    expect(migration).toContain("using errcode = '42501'");
    expect(migration).toContain("using errcode = 'P0002'");
    expect(migration).toContain("language plpgsql\nvolatile\nsecurity definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("from public, anon, authenticated;");
    expect(migration).toContain("to authenticated;");
    expect(migration).not.toMatch(/execute\s+format|\bformat\s*\(/i);
  });
});
