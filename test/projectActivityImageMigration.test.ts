import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261016150000_add_trusted_project_activity_image_boundaries.sql",
  ),
  "utf8",
);
const foundation = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261016130000_create_project_activity_alert_foundation.sql",
  ),
  "utf8",
);
const operations = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261016140000_add_trusted_project_activity_operations.sql",
  ),
  "utf8",
);

describe("Task D Project Activity image migration", () => {
  it("uses four narrow server-only SECURITY DEFINER helpers", () => {
    expect(migration.match(/create function public\./g)).toHaveLength(4);
    expect(migration.match(/security definer/g)).toHaveLength(4);
    expect(migration.match(/set search_path = ''/g)).toHaveLength(4);
    expect(migration.match(/to service_role;/g)).toHaveLength(4);
    expect(migration).not.toMatch(/grant execute[\s\S]*?to (?:anon|authenticated);/);
  });

  it("binds mutation to the active author, original request, and writable Project", () => {
    expect(migration).toContain(
      "actor_profile.id is distinct from current_activity.author_user_id",
    );
    expect(migration).toContain(
      "current_activity.request_id is distinct from p_request_id",
    );
    expect(migration.match(
      /current_project\.status not in \('planned', 'in_progress', 'on_hold'\)/g,
    )).toHaveLength(2);
    expect(migration).toContain("definition.key = 'projects.edit'");
  });

  it("enforces exact private path, type, size, hash, and object reference", () => {
    expect(migration).toContain("object.bucket_id = 'project-activity-images'");
    expect(migration).toContain("object.metadata->>'mimetype' = p_mime_type");
    expect(migration).toContain("p_byte_size > 5242880");
    expect(migration).toContain("p_content_hash !~ '^[0-9a-f]{64}$'");
    expect(migration).toContain("'^final/'");
    expect(migration).toContain("|| p_project_id::text");
    expect(migration).toContain("|| p_activity_id::text");
  });

  it("preserves identical retry and rejects conflicts without replacement", () => {
    expect(migration).toContain("Project Activity already has a different attachment");
    expect(migration).toContain("using errcode = 'PAC04'");
    expect(migration).not.toMatch(/update public\.project_activity_attachments/i);
    expect(migration).not.toMatch(/delete from public\.project_activity_attachments/i);
  });

  it("keeps read authorization distinct and permits historical Project states", () => {
    expect(migration).toContain("definition.key = 'projects.view'");
    const accessFunction = migration.slice(
      migration.indexOf("create function public.get_project_activity_image_access_context"),
    );
    expect(accessFunction).not.toMatch(/status not in|status in/);
  });

  it("preserves Task B direct Storage denial and Task C narrow projections", () => {
    expect(foundation).toContain(
      "create policy project_activity_image_objects_no_direct_client_access",
    );
    expect(foundation).toContain("as restrictive\nfor all\nto anon, authenticated");
    expect(operations).not.toContain("attachment.storage_path");
    expect(operations).not.toContain("attachment.content_hash");
    expect(migration).not.toContain("append_audit_log");
  });
});
