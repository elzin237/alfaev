import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261019160000_add_project_alert_dismissal.sql",
);

describe("Project alert dismissal D1 migration", () => {
  const migration = readFileSync(migrationPath, "utf8");

  it("adds only the nullable dismissal timestamp and its validity constraint", () => {
    const foundationSql = migration.slice(
      0,
      migration.indexOf("drop index public.project_activity_alert_recipients_inbox_idx"),
    );
    expect(migration).toContain(
      "add column dismissed_at timestamptz;",
    );
    expect(migration).toContain(
      "check (dismissed_at is null or dismissed_at >= created_at);",
    );
    expect(migration).not.toMatch(/dismissed_at\s+timestamptz\s+not null/i);
    expect(migration).not.toMatch(/dismissed_at\s+timestamptz[^;]*default/i);
    expect(foundationSql).not.toMatch(/update\s+public\.project_activity_alert_recipients/i);
  });

  it("extends the existing invoker trigger with independent one-way transitions", () => {
    expect(migration).toContain(
      "create or replace function public.enforce_project_activity_alert_recipient_history()",
    );
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      "old.read_at is null and new.read_at is not null",
    );
    expect(migration).toContain(
      "old.dismissed_at is null and new.dismissed_at is not null",
    );
    expect(migration).toContain(
      "or not (read_transition or dismissal_transition)",
    );
    expect(migration).toContain("using errcode = '55000'");
    expect(migration).toContain(
      "from public, anon, authenticated;",
    );
    expect(migration).not.toMatch(/create\s+policy/i);
  });

  it("replaces only the inbox/count reads and adds the narrow dismiss RPC", () => {
    const dismissFunction = migration.slice(
      migration.indexOf("create function public.dismiss_project_alert_notification("),
      migration.indexOf(
        "revoke all privileges\n  on function public.list_project_alert_notifications",
      ),
    );
    expect(migration).toContain(
      "create or replace function public.list_project_alert_notifications(",
    );
    expect(migration).toContain(
      "create or replace function public.get_project_alert_unread_count()",
    );
    expect(migration).toContain(
      "create function public.dismiss_project_alert_notification(\n  p_notification_id uuid\n)",
    );
    expect(migration.match(/security definer/g)).toHaveLength(3);
    expect(migration.match(/stable\nsecurity definer/g)).toHaveLength(2);
    expect(migration.match(/volatile\nsecurity definer/g)).toHaveLength(1);
    expect(migration.match(/set search_path = ''/g)).toHaveLength(4);
    expect(migration).toContain(
      "where recipient.id = p_notification_id\n    and recipient.recipient_user_id = actor_profile_id\n  for update;",
    );
    expect(migration).toContain("for share;");
    expect(migration).toContain("using errcode = '22023'");
    expect(migration).toContain("using errcode = '42501'");
    expect(migration).toContain("using errcode = 'P0002'");
    expect(dismissFunction).not.toMatch(/p_(?:actor|user|recipient|project|dismissed_at)/i);
    expect(dismissFunction).not.toMatch(/execute\s+format|\bformat\s*\(/i);
  });

  it("filters before pagination/counting and replaces only the two existing indexes", () => {
    const listStart = migration.indexOf(
      "create or replace function public.list_project_alert_notifications(",
    );
    const countStart = migration.indexOf(
      "create or replace function public.get_project_alert_unread_count()",
    );
    const dismissStart = migration.indexOf(
      "create function public.dismiss_project_alert_notification(",
    );
    const listSql = migration.slice(listStart, countStart);
    const countSql = migration.slice(countStart, dismissStart);

    expect(listSql.indexOf("and recipient.dismissed_at is null"))
      .toBeLessThan(listSql.indexOf("order by recipient.created_at desc"));
    expect(listSql.indexOf("and recipient.dismissed_at is null"))
      .toBeLessThan(listSql.indexOf("limit p_limit + 1"));
    expect(listSql).not.toMatch(/\boffset\b/i);
    expect(countSql).toContain(
      "and recipient.read_at is null\n    and recipient.dismissed_at is null;",
    );

    expect(migration.match(/drop index public\.project_activity_alert_recipients_/g))
      .toHaveLength(2);
    expect(migration.match(/create index project_activity_alert_recipients_/g))
      .toHaveLength(2);
    expect(migration).toContain("where dismissed_at is null;");
    expect(migration).toContain(
      "where read_at is null\n    and dismissed_at is null;",
    );
  });

  it("grants only the three intended browser-facing RPC identities", () => {
    for (const identity of [
      "public.list_project_alert_notifications(integer, timestamptz, uuid)",
      "public.get_project_alert_unread_count()",
      "public.dismiss_project_alert_notification(uuid)",
    ]) {
      expect(migration).toContain(
        `revoke all privileges\n  on function ${identity}\n  from public, anon, authenticated;`,
      );
      expect(migration).toContain(
        `grant execute\n  on function ${identity}\n  to authenticated;`,
      );
    }
  });
});
