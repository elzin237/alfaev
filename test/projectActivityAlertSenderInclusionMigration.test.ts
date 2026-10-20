import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const historicalPath = resolve(
  process.cwd(),
  "supabase/migrations/20261016140000_add_trusted_project_activity_operations.sql",
);
const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261019140000_include_project_activity_alert_sender.sql",
);
const historical = readFileSync(historicalPath, "utf8");
const migration = readFileSync(migrationPath, "utf8");

describe("Project Activity alert eligible-sender migration", () => {
  it("preserves the exact function identity and return projection", () => {
    expect(migration).toContain(`create or replace function public.post_project_activity(
  p_project_id uuid,
  p_request_id uuid,
  p_title text,
  p_description text,
  p_send_alert boolean
)`);
    expect(migration).toContain(`returns table (
  activity_id uuid,
  project_id uuid,
  request_id uuid,
  title text,
  description text,
  created_at timestamptz,
  author_user_id uuid,
  alert_sent boolean,
  alert_id uuid,
  recipient_count bigint
)`);
    expect(migration.match(/post_project_activity\s*\(/g)).toHaveLength(3);
  });

  it("removes only sender exclusion while retaining every eligibility boundary", () => {
    expect(historical).toContain("recipient_profile.id <> actor_profile_id");
    expect(migration).not.toContain("recipient_profile.id <> actor_profile_id");
    expect(migration).toContain("where recipient_profile.is_active");
    expect(migration).toContain("receive_definition.key = 'projects.alerts.receive'");
    expect(migration).toContain("receive_definition.is_delegable");
    expect(migration).toContain("recipient_profile.is_admin");
    expect(migration).toContain("dashboard_definition.key = 'dashboard.view'");
    expect(migration).toContain("project_definition.key = 'projects.view'");
    expect(migration).toContain("order by recipient_profile.id");
    expect(migration).toContain("for share of recipient_profile");
    expect(migration).toContain("using errcode = 'PAC03'");
  });

  it("preserves idempotency, locking, audits, and the narrow result", () => {
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock(");
    expect(migration).toContain("using errcode = 'PAC01'");
    expect(migration).toContain("for update;");
    expect(migration).toContain("'project_activity.created'");
    expect(migration).toContain("'project_activity.alert_sent'");
    expect(migration).toContain("'recipient_count', recipient_total");
    expect(migration).not.toMatch(/recipient_(?:name|email)/);
  });

  it("retains the hardened function metadata and browser ACL boundary", () => {
    expect(migration).toContain("language plpgsql\nvolatile\nsecurity definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(`revoke all privileges
  on function public.post_project_activity(uuid, uuid, text, text, boolean)
  from public, anon, authenticated;`);
    expect(migration).toContain(`grant execute
  on function public.post_project_activity(uuid, uuid, text, text, boolean)
  to authenticated;`);
    expect(migration).not.toMatch(/\bexecute\s+format\b|\bexecute\s+[^;]+using\b/i);
  });

  it("adds no schema, index, permission, overload, or data rewrite", () => {
    expect(migration).not.toMatch(/\bcreate\s+table\b/i);
    expect(migration).not.toMatch(/\bcreate\s+(?:unique\s+)?index\b/i);
    expect(migration).not.toMatch(
      /(?:insert\s+into|update|delete\s+from)\s+public\.permission_definitions/i,
    );
    expect(migration).not.toMatch(/\balter\s+table\b|\binsert\s+into\s+public\.(?!project_activity)/i);
    expect(migration).not.toMatch(/\bupdate\s+public\.(?!project_activity_alert_recipients)/i);
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
  });

  it("leaves historical migration 124 byte-for-byte frozen", () => {
    expect(createHash("sha256").update(historical).digest("hex")).toBe(
      "7b2e362322a5fd1e38a58439387544dbcf3107a6450cfe0b6fdfd8bcb2e3bd1a",
    );
  });
});
