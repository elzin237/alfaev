import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const name = "20261031100000_add_private_project_shortage_condition_projection.sql";
const sql = readFileSync(`supabase/migrations/${name}`, "utf8");
const executable = sql.replace(/--[^\n]*/g, "");

describe("migration 183 private Project shortage condition projection", () => {
  it("is the next forward migration and preserves all 182 historical files exactly", () => {
    const files = readdirSync("supabase/migrations").filter(f =>
      /^\d{14}_.+\.sql$/.test(f) && f.slice(0, 14) <= "20261031100000").sort();
    expect(files).toHaveLength(183); expect(files[182]).toBe(name);
    for (const file of files.slice(0, 182)) {
      const path = `supabase/migrations/${file}`;
      const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
      expect(hash(readFileSync(path)), file).toBe(hash(execFileSync("git", ["show", `HEAD:${path}`])));
    }
  });
  it("adds only one stable private function, without operational wiring or mutations", () => {
    expect(executable.match(/create\s+(?:or\s+replace\s+)?function/gi)).toHaveLength(1);
    expect(executable).toMatch(/create function public\.project_shortage_condition_rows\(p_recipient_id uuid\)/);
    expect(executable).toMatch(/stable\s+security definer\s+set search_path = ''/);
    expect(executable).not.toMatch(/\b(?:insert into|update public\.|delete from|create (?:table|trigger|view)|alter |drop |grant )/i);
  });
  it("requires a current authenticated recipient and both module grants or active Admin", () => {
    expect(sql).toContain("actor uuid := public.current_active_user_profile_id()");
    expect(sql).toContain("auth.uid() is null or actor is null or p_recipient_id is distinct from actor");
    expect(sql).toContain("public.has_permission('dashboard.view')");
    expect(sql).toContain("public.has_permission('projects.view')");
    expect(sql).toContain("recipient.recipient_user_id = actor");
    expect(sql).toContain("errcode = '42501'");
    expect(sql).toMatch(/revoke all privileges on function public\.project_shortage_condition_rows\(uuid\)\s+from public, anon, authenticated, service_role/);
  });
  it("uses the exact retained source chain and deduplicates on episode identity", () => {
    for (const source of ["project_activity_alert_recipients", "project_activity_alerts", "project_shortage_events", "project_shortage_episodes"]) expect(sql).toContain(`public.${source}`);
    expect(sql).toContain("notification.notification_kind = 'shortage'");
    expect(sql).toContain("shortage_event.shortage_quantity = notification.shortage_quantity");
    expect(sql).toContain("distinct on (owned.episode_id)");
    expect(sql).toContain("(owned.event_type = 'opened') desc");
    expect(sql).not.toMatch(/calculate_open_project_commitments|reconcile_project_shortages|work_order_shortage_tracking_rows/);
  });
  it("derives lifecycle/quantity/time from the episode, never read or dismissal state", () => {
    expect(sql).toContain("case when episode.resolved_at is null then 'active'::text else 'resolved'::text end");
    expect(sql).toContain("episode.current_shortage_quantity::text");
    expect(sql).toContain("episode.opened_at, episode.resolved_at");
    expect(sql).toContain("statement_timestamp()");
    expect(executable).not.toMatch(/(?:recipient|canonical)\.(?:read_at|dismissed_at)\s+is\s+(?:not\s+)?null/i);
  });
});
