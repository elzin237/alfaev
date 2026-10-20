import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration128Path = resolve(
  process.cwd(),
  "supabase/migrations/20261019140000_include_project_activity_alert_sender.sql",
);
const migration129Path = resolve(
  process.cwd(),
  "supabase/migrations/20261019150000_auto_include_admin_project_alert_recipients.sql",
);
const migration128 = readFileSync(migration128Path, "utf8");
const migration129 = readFileSync(migration129Path, "utf8");

describe("Project Activity automatic Admin recipient migration", () => {
  it("preserves the exact function identity, projection, and hardened metadata", () => {
    expect(migration129).toContain(`create or replace function public.post_project_activity(
  p_project_id uuid,
  p_request_id uuid,
  p_title text,
  p_description text,
  p_send_alert boolean
)`);
    expect(migration129).toContain(`returns table (
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
    expect(migration129.match(/post_project_activity\s*\(/g)).toHaveLength(3);
    expect(migration129).toContain("language plpgsql\nvolatile\nsecurity definer");
    expect(migration129).toContain("set search_path = ''");
  });

  it("automatically includes active Admins and retains every non-admin boundary", () => {
    expect(migration128).toContain(`where recipient_profile.is_active
        and exists (`);
    expect(migration129).toContain(`where recipient_profile.is_active
        and (
          recipient_profile.is_admin
          or (
            exists (`);
    expect(migration129).toContain("receive_definition.key = 'projects.alerts.receive'");
    expect(migration129).toContain("dashboard_definition.key = 'dashboard.view'");
    expect(migration129).toContain("project_definition.key = 'projects.view'");
    expect(migration129).toContain("receive_definition.is_delegable");
    expect(migration129).toContain("dashboard_definition.is_delegable");
    expect(migration129).toContain("project_definition.is_delegable");
    expect(migration129).not.toContain("recipient_profile.id <> actor_profile_id");
    expect(migration129).toContain("order by recipient_profile.id");
    expect(migration129).toContain("for share of recipient_profile");
  });

  it("preserves authorization, idempotency, locking, PAC03, and narrow audits", () => {
    expect(migration129).toContain("public.has_permission('projects.edit')");
    expect(migration129).toContain("public.has_permission('projects.alerts.send')");
    expect(migration129).toContain("pg_catalog.pg_advisory_xact_lock(");
    expect(migration129).toContain("using errcode = 'PAC01'");
    expect(migration129).toContain("for update;");
    expect(migration129).toContain("using errcode = 'PAC03'");
    expect(migration129).toContain("'project_activity.created'");
    expect(migration129).toContain("'project_activity.alert_sent'");
    expect(migration129).toContain("'recipient_count', recipient_total");
    expect(migration129).not.toMatch(/recipient_(?:name|email)/);
  });

  it("reasserts authenticated-only execution without adding schema or rewriting history", () => {
    expect(migration129).toContain(`revoke all privileges
  on function public.post_project_activity(uuid, uuid, text, text, boolean)
  from public, anon, authenticated;`);
    expect(migration129).toContain(`grant execute
  on function public.post_project_activity(uuid, uuid, text, text, boolean)
  to authenticated;`);
    expect(migration129).not.toMatch(/\bcreate\s+table\b/i);
    expect(migration129).not.toMatch(/\bcreate\s+(?:unique\s+)?index\b/i);
    expect(migration129).not.toMatch(/\balter\s+table\b/i);
    expect(migration129).not.toMatch(/\bdelete\s+from\b/i);
    expect(migration129).not.toMatch(/\bupdate\s+public\./i);
    expect(migration129).not.toMatch(
      /insert\s+into\s+public\.(?!project_activity_updates|project_activity_alerts|project_activity_alert_recipients)/i,
    );
  });

  it("leaves the reviewed migration 128 byte-for-byte unchanged", () => {
    expect(createHash("sha256").update(migration128).digest("hex")).toBe(
      "cc5aeaa69df99567dbec90e93671ef65e37b5dd85855bba7a309fa7cb553e9ee",
    );
  });
});
