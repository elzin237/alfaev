import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261016130000_create_project_activity_alert_foundation.sql",
);

const migration = readFileSync(migrationPath, "utf8");

describe("Project Activity and alert foundation migration", () => {
  it("adds only the two canonical delegable Project alert permissions", () => {
    expect(migration.match(/'projects\.alerts\.send'/g)).toHaveLength(1);
    expect(migration.match(/'projects\.alerts\.receive'/g)).toHaveLength(1);
    expect(migration.match(/'projects\.alerts\.[^']+'/g)).toHaveLength(2);
    expect(migration).not.toMatch(/activity\.(view|read|post|create)/);
    expect(migration).not.toMatch(/ceo|project_manager|project manager/i);
  });

  it("defines the four private foundation tables and only justified indexes", () => {
    for (const table of [
      "project_activity_updates",
      "project_activity_attachments",
      "project_activity_alerts",
      "project_activity_alert_recipients",
    ]) {
      expect(migration).toContain(`create table public.${table} (`);
      expect(migration).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(migration).toContain(`on table public.${table}`);
    }

    expect(migration).toContain(
      "on public.project_activity_updates (project_id, created_at desc, id desc)",
    );
    expect(migration).toContain(
      "unique (project_activity_id)",
    );
    expect(migration).toContain("unique (storage_path)");
    expect(migration).toContain("unique (alert_id, recipient_user_id)");
    expect(migration).toContain("where read_at is null");
    expect(migration).not.toMatch(/\b(?:gin|gist|trgm|to_tsvector)\b/i);
  });

  it("locks history while retaining the future one-way read transition", () => {
    expect(migration).toContain(
      "create function public.prevent_project_activity_history_mutation()",
    );
    expect(migration).toContain(
      "create function public.enforce_project_activity_alert_recipient_history()",
    );
    expect(migration).toContain(
      "before update or delete on public.project_activity_updates",
    );
    expect(migration).toContain(
      "before update or delete on public.project_activity_attachments",
    );
    expect(migration).toContain(
      "before update or delete on public.project_activity_alerts",
    );
    expect(migration).toContain(
      "before insert or update or delete on public.project_activity_alert_recipients",
    );
    expect(migration).toContain("or old.read_at is not null");
    expect(migration).toContain("or new.read_at is null");
    expect(migration.match(/security invoker/g)).toHaveLength(2);
    expect(migration).not.toContain("security definer");
  });

  it("creates only a private guarded 5 MiB image bucket", () => {
    expect(migration).toContain("'project-activity-images'");
    expect(migration).toContain("false,\n  5242880");
    expect(migration).toContain(
      "array['image/jpeg', 'image/png', 'image/webp']::text[]",
    );
    expect(migration).not.toContain("image/svg+xml");
    expect(migration).toContain(
      "create policy project_activity_image_objects_no_direct_client_access",
    );
    expect(migration).toContain("as restrictive\nfor all\nto anon, authenticated");
    expect(migration).not.toMatch(/grant\s+(select|insert|update|delete|all)/i);
  });

  it("contains no premature business RPC, read model, or AuditLog write", () => {
    expect(migration).not.toContain("append_audit_log");
    expect(migration).not.toContain("insert into public.audit_logs");
    expect(migration).not.toContain("projects.edit");
    expect(migration).not.toContain("projects.view");
    expect(migration).not.toContain("dashboard.view");
    expect(migration).not.toContain("current_user_is_admin");
    expect(migration).not.toContain("has_permission(");
    expect(migration).not.toMatch(/create function public\.(post|list|send|mark|read|upload|sign)_/);
  });
});
