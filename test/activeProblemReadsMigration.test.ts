import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const name = "20261031110000_add_versioned_active_problem_reads.sql";
const sql = readFileSync(`supabase/migrations/${name}`, "utf8");
const executable = sql.replace(/--[^\n]*/g, "");
const digest = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

describe("184 additive versioned Active Problems reads", () => {
  it("preserves the 182 committed migrations and reviewed private migration 183", () => {
    const files = readdirSync("supabase/migrations").filter(f => /^\d{14}_.+\.sql$/.test(f) && f.slice(0,14) <= "20261031110000").sort();
    expect(files).toHaveLength(184); expect(files[183]).toBe(name);
    for (const file of files.slice(0,182)) {
      const path = `supabase/migrations/${file}`;
      expect(digest(readFileSync(path)), file).toBe(digest(execFileSync("git", ["show", `HEAD:${path}`])));
    }
    expect(digest(readFileSync(`supabase/migrations/${files[182]}`))).toBe("292217b9bbc98731bf23ceda3321a27038117bfa95cbeb46b0dccd56e19ad6a7");
  });
  it("adds only stable controlled reads, with no mutation, trigger, activation or replacement", () => {
    expect(executable.match(/create function/g)).toHaveLength(7);
    expect(executable.match(/stable security definer set search_path=''/g)).toHaveLength(7);
    expect(executable).not.toMatch(/\b(?:insert into|update public\.|delete from|create (?:table|trigger|view)|alter |drop |or replace)\b/i);
    expect(sql).toContain("from public,anon,authenticated,service_role");
    expect(sql).toContain("to authenticated");
  });
  it("uses delivered issue openings and authoritative resolution, not read state or resolution audience", () => {
    const issue = sql.split("create function public.dashboard_problem_condition_rows_v2")[0]!;
    expect(issue).toContain("n.notification_kind='activity'"); expect(issue).toContain("a.activity_kind='issue'");
    expect(issue).toContain("resolution.project_activity_id=a.id"); expect(issue).toContain("r.recipient_user_id=actor");
    expect(issue).toContain("p_recipient_id is distinct from actor");
    expect(issue).not.toMatch(/(?:read_at|dismissed_at) is (?:not )?null/);
  });
  it("derives exact counts and inbox from the same module-scoped condition projection", () => {
    expect(sql).toContain("public.project_shortage_condition_rows(actor)");
    expect(sql).toContain("public.work_order_shortage_tracking_rows(actor)");
    expect(sql).toContain("public.has_permission('projects.view')"); expect(sql).toContain("public.has_permission('work_orders.view')");
    expect(sql.match(/from public.dashboard_problem_condition_rows_v2\(actor\)/g)).toHaveLength(2);
    expect(sql).toContain("c.item->>'condition_status'='active'"); expect(sql).toContain("'active_problems',count(*)::text");
    expect(sql).toContain("a.activity_kind='general'"); expect(sql).toContain("r.dismissed_at is null");
  });
  it("bounds both public lists and returns explicit observation time and stable continuation", () => {
    expect(sql).toContain("p_limit not between 1 and 50"); expect(sql).toContain("num_nonnulls(p_before_created_at,p_before_kind,p_before_id)");
    expect(sql).toContain("'next_cursor'"); expect(sql).toContain("'has_more'"); expect(sql).toContain("'as_of',statement_timestamp()");
    expect(sql).toContain("'contract_version',2");
  });
});
