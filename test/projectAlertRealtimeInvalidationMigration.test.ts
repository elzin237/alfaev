import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261020110000_add_project_alert_realtime_invalidation.sql",
);
const migration = readFileSync(migrationPath, "utf8");

describe("Project alert private Realtime invalidation migration", () => {
  it("fails closed on the required platform function, RLS, and policy baseline", () => {
    expect(migration).toContain(
      "'realtime.send(jsonb,text,text,boolean)'",
    );
    expect(migration).toContain(
      "array['payload', 'event', 'topic', 'private']::text[]",
    );
    expect(migration).toContain("relation.relrowsecurity");
    expect(migration).toContain(
      "if messages_rls_enabled is distinct from true then",
    );
    expect(migration).toContain("from pg_catalog.pg_policies as policy");
    expect(migration).toContain(
      "raise exception 'Unexpected Realtime messages policies: %'",
    );
    expect(migration).not.toMatch(
      /alter\s+table\s+realtime\.messages\s+enable\s+row\s+level\s+security/i,
    );
  });

  it("creates one trigger-only hardened helper with a content-free private payload", () => {
    expect(migration).toContain(
      "create function public.broadcast_project_alert_notification_invalidation()",
    );
    expect(migration).toContain(
      "returns trigger\nlanguage plpgsql\nvolatile\nsecurity definer\nset search_path = ''",
    );
    expect(migration).toContain("perform realtime.send(");
    expect(migration).toContain("payload := '{}'::jsonb");
    expect(migration).toContain("event := 'invalidate'");
    expect(migration).toContain(
      "topic := 'project-alert-notifications:'\n        || new.recipient_user_id::text",
    );
    expect(migration).toContain("private := true");
    expect(migration).not.toContain("realtime.broadcast_changes");
    expect(migration).toContain(
      "from public, anon, authenticated, service_role;",
    );
    expect(migration).not.toMatch(/grant\s+execute/i);
  });

  it("signals only inserts and initial read or dismissal transitions", () => {
    expect(migration).toContain(
      "after insert or update of read_at, dismissed_at",
    );
    expect(migration).toContain(
      "on public.project_activity_alert_recipients\nfor each row",
    );
    expect(migration).toContain("if tg_op = 'INSERT'");
    expect(migration).toContain(
      "old.read_at is null and new.read_at is not null",
    );
    expect(migration).toContain(
      "old.dismissed_at is null\n          and new.dismissed_at is not null",
    );
    expect(migration).not.toMatch(/after[^;]*delete/i);
    expect(migration).not.toMatch(
      /(?:insert|update|delete)\s+(?:into|from)?\s*public\.project_activity_alert_recipients/i,
    );
  });

  it("authorizes only an active owner's exact broadcast topic with current access", () => {
    expect(migration).toContain(
      "create policy project_alert_notification_invalidation_select_own",
    );
    expect(migration).toContain(
      "on realtime.messages\nfor select\nto authenticated",
    );
    expect(migration).toContain(
      "realtime.messages.extension = 'broadcast'",
    );
    expect(migration).toContain("(select realtime.topic()) =");
    expect(migration).toContain(
      "'project-alert-notifications:'\n      || public.current_active_user_profile_id()::text",
    );
    expect(migration).toContain(
      "public.current_active_user_profile_id() is not null",
    );
    expect(migration).toContain("public.current_user_is_admin()");
    expect(migration).toContain("public.has_permission('dashboard.view')");
    expect(migration).toContain("public.has_permission('projects.view')");
    expect(migration).not.toMatch(/for\s+insert/i);
    expect(migration).not.toMatch(/to\s+(?:anon|public)\b/i);
  });

  it("adds no publication, table grant, browser data path, or notification RPC change", () => {
    expect(migration).not.toMatch(/supabase_realtime|alter\s+publication/i);
    expect(migration).not.toMatch(/grant\s+(?:select|insert|update|delete)/i);
    expect(migration).not.toMatch(/create\s+(?:table|index)/i);
    expect(migration).not.toMatch(/create\s+or\s+replace\s+function/i);
    expect(migration).not.toMatch(
      /(?:list_project_alert_notifications|get_project_alert_unread_count|mark_project_alert_read|dismiss_project_alert_notification)\s*\(/i,
    );
    for (const protectedField of [
      "notification_id",
      "project_id",
      "activity_id",
      "full_name",
      "activity_title",
      "storage_path",
      "signed_url",
    ]) {
      expect(migration).not.toContain(protectedField);
    }
  });
});
