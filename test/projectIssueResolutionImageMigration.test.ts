import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20261020140000_add_project_issue_resolution_image_boundaries.sql",
), "utf8");

describe("Project Issue resolution image migration", () => {
  it("adds one immutable private attachment per resolution", () => {
    expect(migration).toContain("create table public.project_issue_resolution_attachments");
    expect(migration).toContain("unique (project_issue_resolution_id)");
    expect(migration).toContain("unique (storage_path)");
    expect(migration).toContain("on delete restrict");
    expect(migration).toContain("project_issue_resolution_attachments_reject_update_delete");
    expect(migration).toContain("alter table public.project_issue_resolution_attachments enable row level security");
    expect(migration).toContain("from public, anon, authenticated");
  });

  it("binds prepare and attach to the exact active resolver and original request", () => {
    expect(migration).toContain("actor_profile.id is distinct from current_resolution.resolved_by_user_id");
    expect(migration).toContain("current_resolution.request_id is distinct from p_request_id");
    expect(migration).toContain("definition.key = 'projects.edit'");
    expect(migration).not.toMatch(/locked_project\.status|project\.status\s+(?:=|in|not)/);
    expect(migration).toContain("'project-activity-images'");
    expect(migration).toContain("'^resolution-final/'");
  });

  it("keeps safe reads narrow and does not expose path or hash", () => {
    const list = migration.slice(
      migration.indexOf("create function public.list_project_activity_with_issue_resolution"),
      migration.indexOf("drop function public.get_project_activity_with_issue_resolution"),
    );
    expect(list).toContain("resolution_attachment.id as resolution_attachment_id");
    expect(list).toContain("resolution_attachment.alt_text as resolution_attachment_alt_text");
    expect(list).not.toContain("resolution_attachment.storage_path");
    expect(list).not.toContain("resolution_attachment.content_hash");
  });

  it("keeps all image helpers service-role only and read RPCs authenticated only", () => {
    for (const name of [
      "prepare_project_issue_resolution_image_upload",
      "attach_project_issue_resolution_image",
      "reconcile_project_issue_resolution_image_upload",
      "get_project_issue_resolution_image_access_context",
    ]) {
      expect(migration).toMatch(new RegExp(`grant execute[\\s\\S]*?${name}\\([^;]+?[\\s\\S]*?to service_role;`));
    }
    expect(migration.match(/security definer/g)).toHaveLength(6);
    expect(migration.match(/set search_path = ''/g)).toHaveLength(6);
    expect(migration.match(/\n  to authenticated;/g)).toHaveLength(2);
    expect(migration).toMatch(/grant execute\s+on function public\.list_project_activity_with_issue_resolution[\s\S]*?to authenticated;/);
    expect(migration).toMatch(/grant execute\s+on function public\.get_project_activity_with_issue_resolution[\s\S]*?to authenticated;/);
  });
});
