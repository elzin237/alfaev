import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration129Path = resolve(
  process.cwd(),
  "supabase/migrations/20261019150000_auto_include_admin_project_alert_recipients.sql",
);
const migration131Path = resolve(
  process.cwd(),
  "supabase/migrations/20261020100000_bind_project_activity_request_to_original_author.sql",
);
const migration129 = readFileSync(migration129Path, "utf8");
const migration131 = readFileSync(migration131Path, "utf8");

const ownershipBlock = `    -- A request UUID is owned by the original Activity author. Lock and re-resolve
    -- the current actor before comparing payload data so another author cannot use
    -- PAC01 as an oracle for the original submission.
    select profile.id, profile.is_admin
    into actor_profile_id, actor_is_admin
    from public.user_profiles as profile
    where profile.auth_user_id = auth.uid()
      and profile.is_active
    for share;

    if not found then
      raise exception 'Access denied'
        using errcode = '42501';
    end if;

    if not actor_is_admin
      and not exists (
        select 1
        from public.user_permissions as permission
        join public.permission_definitions as definition
          on definition.id = permission.permission_definition_id
        where permission.user_id = actor_profile_id
          and definition.key = 'projects.edit'
          and definition.is_delegable
      )
    then
      raise exception 'Access denied'
        using errcode = '42501';
    end if;

    if p_send_alert
      and not actor_is_admin
      and not exists (
        select 1
        from public.user_permissions as permission
        join public.permission_definitions as definition
          on definition.id = permission.permission_definition_id
        where permission.user_id = actor_profile_id
          and definition.key = 'projects.alerts.send'
          and definition.is_delegable
      )
    then
      raise exception 'Access denied'
        using errcode = '42501';
    end if;

    if existing_activity.author_user_id is distinct from actor_profile_id then
      raise exception 'Access denied'
        using errcode = '42501';
    end if;

`;

describe("Project Activity original-author idempotency migration", () => {
  it("changes only the existing-request replay authorization", () => {
    expect(migration131).toContain(ownershipBlock);
    expect(migration131.replace(ownershipBlock, "")).toBe(migration129);
  });

  it("checks the locked active actor and posting permissions before payload comparison", () => {
    const existingBranch = migration131.indexOf("  if found then\n");
    const actorLock = migration131.indexOf(
      "    select profile.id, profile.is_admin\n",
      existingBranch,
    );
    const authorCheck = migration131.indexOf(
      "    if existing_activity.author_user_id is distinct from actor_profile_id then",
      actorLock,
    );
    const payloadCheck = migration131.indexOf(
      "    if existing_activity.project_id is distinct from p_project_id",
      authorCheck,
    );

    expect(existingBranch).toBeGreaterThan(-1);
    expect(actorLock).toBeGreaterThan(existingBranch);
    expect(authorCheck).toBeGreaterThan(actorLock);
    expect(payloadCheck).toBeGreaterThan(authorCheck);
    expect(migration131.slice(actorLock, authorCheck)).toContain("for share;");
    expect(migration131.slice(actorLock, authorCheck))
      .toContain("definition.key = 'projects.edit'");
    expect(migration131.slice(actorLock, authorCheck))
      .toContain("definition.key = 'projects.alerts.send'");
    expect(migration131.slice(authorCheck, payloadCheck))
      .toContain("using errcode = '42501'");
  });

  it("preserves the exact function identity, projection, metadata, and ACL", () => {
    expect(migration131).toContain(`create or replace function public.post_project_activity(
  p_project_id uuid,
  p_request_id uuid,
  p_title text,
  p_description text,
  p_send_alert boolean
)`);
    expect(migration131).toContain(`returns table (
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
    expect(migration131).toContain("language plpgsql\nvolatile\nsecurity definer");
    expect(migration131).toContain("set search_path = ''");
    expect(migration131).toContain(`revoke all privileges
  on function public.post_project_activity(uuid, uuid, text, text, boolean)
  from public, anon, authenticated;`);
    expect(migration131).toContain(`grant execute
  on function public.post_project_activity(uuid, uuid, text, text, boolean)
  to authenticated;`);
  });

  it("adds no schema, history rewrite, RLS, or new trusted function", () => {
    expect(migration131.match(/create or replace function/g)).toHaveLength(1);
    expect(migration131).not.toMatch(/\bcreate\s+table\b/i);
    expect(migration131).not.toMatch(/\bcreate\s+(?:unique\s+)?index\b/i);
    expect(migration131).not.toMatch(/\balter\s+table\b/i);
    expect(migration131).not.toMatch(/\bcreate\s+policy\b/i);
    expect(migration131).not.toMatch(/\bdelete\s+from\b/i);
    expect(migration131).not.toMatch(/\bupdate\s+public\./i);
  });

  it("leaves the reviewed migration 129 byte-for-byte unchanged", () => {
    expect(createHash("sha256").update(migration129).digest("hex")).toBe(
      "8493e5ea6562a88fee78bfeed037a898118173b5978667a3da659e01834be87a",
    );
  });
});
