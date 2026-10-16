import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261016140000_add_trusted_project_activity_operations.sql",
);

const migration = readFileSync(migrationPath, "utf8");

describe("Project Activity trusted operations migration", () => {
  it("defines one atomic idempotent post boundary", () => {
    expect(migration).toContain("create function public.post_project_activity(");
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock(");
    expect(migration).toContain("pg_catalog.hashtextextended(p_request_id::text, 0)");
    expect(migration).toContain("for update;");
    expect(migration).toContain("using errcode = 'PAC01'");
    expect(migration).toContain("using errcode = 'PAC02'");
    expect(migration).toContain("using errcode = 'PAC03'");
    expect(migration).not.toMatch(/\boffset\b/i);
  });

  it("derives the actor and recipient snapshot without caller-supplied identities", () => {
    expect(migration).toContain("profile.auth_user_id = auth.uid()");
    expect(migration).toContain("'projects.edit'");
    expect(migration).toContain("'projects.alerts.send'");
    expect(migration).toContain("'projects.alerts.receive'");
    expect(migration).toContain("'dashboard.view'");
    expect(migration).toContain("'projects.view'");
    expect(migration).toContain("recipient_profile.id <> actor_profile_id");
    expect(migration).not.toMatch(/p_(?:author|sender|recipient)_user_id/i);
  });

  it("keeps AuditLog payloads narrow and excludes Activity free text", () => {
    expect(migration).toContain("'project_activity.created'");
    expect(migration).toContain("'project_activity.alert_sent'");
    expect(migration).toContain("'alert_requested', p_send_alert");
    expect(migration).toContain("'recipient_count', recipient_total");
    expect(migration).not.toMatch(/p_(?:before|after)_data/);
    expect(migration).not.toMatch(/'description'\s*,\s*normalized_description/);
    expect(migration).not.toMatch(/recipient_(?:name|email)/);
  });

  it("defines bounded deterministic timeline and same-Project by-ID reads", () => {
    expect(migration).toContain("create function public.list_project_activity(");
    expect(migration).toContain("p_limit integer default 20");
    expect(migration).toContain("p_limit < 1 or p_limit > 50");
    expect(migration).toContain(
      "(activity.created_at, activity.id) < (p_before_created_at, p_before_id)",
    );
    expect(migration).toContain(
      "order by activity.created_at desc, activity.id desc",
    );
    expect(migration).toContain("limit p_limit + 1");
    expect(migration).toContain("create function public.get_project_activity(");
    expect(migration).toContain("and activity.project_id = p_project_id");
    expect(migration).not.toMatch(/\boffset\b/i);
  });

  it("returns only narrow attachment metadata and never a Storage path", () => {
    expect(migration).toContain("attachment_id uuid");
    expect(migration).toContain("attachment_mime_type text");
    expect(migration).toContain("attachment_byte_size bigint");
    expect(migration).toContain("attachment_alt_text text");
    expect(migration).not.toContain("attachment.storage_path");
    expect(migration).not.toContain("attachment.content_hash");
    expect(migration).not.toMatch(/signed.?url|getpublicurl/i);
  });

  it("hardens all three RPC identities for authenticated execution only", () => {
    expect(migration.match(/security definer/g)).toHaveLength(3);
    expect(migration.match(/set search_path = ''/g)).toHaveLength(3);
    expect(migration.match(/from public, anon, authenticated;/g)).toHaveLength(3);
    expect(migration.match(/to authenticated;/g)).toHaveLength(3);
    expect(migration).not.toMatch(/grant\s+(?:select|insert|update|delete)/i);
    expect(migration).not.toMatch(/project_activity_attachments\s*\(/i);
  });
});
