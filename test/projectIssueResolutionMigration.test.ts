import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261020130000_add_project_issue_resolution_foundation.sql",
);
const migration = readFileSync(migrationPath, "utf8");

describe("Project Issue resolution foundation migration", () => {
  it("adds immutable General/Issue classification and an immutable resolution record", () => {
    expect(migration).toContain(
      "add column activity_kind text not null default 'general'",
    );
    expect(migration).toContain(
      "check (activity_kind in ('general', 'issue'))",
    );
    expect(migration).toContain(
      "create table public.project_issue_resolutions",
    );
    expect(migration).toContain("unique (project_activity_id)");
    expect(migration).toContain("unique (request_id)");
    expect(migration).toContain("unique (id, project_activity_id)");
    expect(migration).toContain(
      "create trigger project_issue_resolutions_reject_update_delete",
    );
    expect(migration).toContain(
      "execute function public.prevent_project_activity_history_mutation()",
    );
    expect(migration).toContain(
      "alter table public.project_issue_resolutions enable row level security",
    );
  });

  it("generalizes notifications with strict Activity, resolution, and future-shortage targets", () => {
    expect(migration).toContain(
      "add column notification_kind text not null default 'activity'",
    );
    expect(migration).toContain(
      "check (notification_kind in ('activity', 'issue_resolved', 'shortage'))",
    );
    expect(migration).toContain(
      "add constraint project_activity_alerts_target_valid",
    );
    expect(migration).toContain(
      "foreign key (project_issue_resolution_id, project_activity_id)",
    );
    expect(migration).toContain(
      "create unique index project_activity_alerts_activity_notification_key",
    );
    expect(migration).toContain(
      "create unique index project_activity_alerts_resolution_notification_key",
    );
    expect(migration).not.toMatch(/create table public\..*shortage/i);
  });

  it("keeps five-argument posting compatible and adds an explicit kind overload", () => {
    expect(migration).toContain(
      "create function public.post_project_activity(\n  p_project_id uuid,\n  p_request_id uuid,\n  p_title text,\n  p_description text,\n  p_send_alert boolean,\n  p_activity_kind text",
    );
    expect(migration).toContain(
      "create or replace function public.post_project_activity(\n  p_project_id uuid,\n  p_request_id uuid,\n  p_title text,\n  p_description text,\n  p_send_alert boolean\n)",
    );
    expect(migration).toContain("p_send_alert,\n    'general'");
    expect(migration).toContain(
      "existing_activity.activity_kind is distinct from normalized_activity_kind",
    );
    expect(migration).toContain(
      "locked_project.status not in ('planned', 'in_progress', 'on_hold')",
    );
  });

  it("implements owner-bound idempotent Issue resolution and automatic fanout", () => {
    expect(migration).toContain(
      "create function public.resolve_project_issue(",
    );
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock(");
    expect(migration).toContain("for update;");
    expect(migration).toContain("for share;");
    expect(migration).toContain(
      "existing_resolution.resolved_by_user_id is distinct from actor_profile_id",
    );
    expect(migration).toContain("using errcode = 'PIR01'");
    expect(migration).toContain("using errcode = 'PIR02'");
    expect(migration).toContain("using errcode = 'PIR03'");
    expect(migration).toContain("recipient_profile.is_admin");
    expect(migration).toContain("dashboard_definition.key = 'dashboard.view'");
    expect(migration).toContain("project_definition.key = 'projects.view'");
    const resolutionBody = migration.slice(
      migration.indexOf("create function public.resolve_project_issue("),
      migration.indexOf("create or replace function public.list_project_activity("),
    );
    expect(resolutionBody).not.toContain("projects.alerts.receive");
    expect(resolutionBody).not.toContain("projects.alerts.send");
    expect(resolutionBody).not.toMatch(/locked_project\.status\s+(?:=|not|in)/);
  });

  it("adds additive Issue-aware reads without changing legacy return shapes", () => {
    expect(migration).toContain(
      "create function public.list_project_activity_with_issue_resolution(",
    );
    expect(migration).toContain(
      "create function public.get_project_activity_with_issue_resolution(",
    );
    expect(migration).toContain(
      "create function public.list_project_notifications(",
    );
    expect(migration).toContain("resolution.description as resolution_description");
    expect(migration).toContain("resolver.full_name as resolver_full_name");
    expect(migration).not.toContain("pg_catalog.coalesce");
    expect(migration).not.toContain("resolver.email");
    expect(migration).not.toContain("attachment.storage_path");
  });

  it("hardens every browser-facing function and the trusted-only table", () => {
    expect(migration.match(/security definer/g)).toHaveLength(8);
    expect(migration.match(/set search_path = ''/g)).toHaveLength(8);
    expect(migration).toContain(
      "on table public.project_issue_resolutions\n  from public, anon, authenticated",
    );
    for (const signature of [
      "post_project_activity(uuid, uuid, text, text, boolean, text)",
      "resolve_project_issue(uuid, uuid, text)",
      "list_project_activity_with_issue_resolution(uuid, integer, timestamptz, uuid)",
      "get_project_activity_with_issue_resolution(uuid, uuid)",
      "list_project_notifications(integer, timestamptz, uuid)",
    ]) {
      expect(migration).toContain(`on function public.${signature}`);
    }
  });
});
