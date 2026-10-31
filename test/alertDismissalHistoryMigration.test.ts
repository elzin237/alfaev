import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const name="20261031120000_protect_active_project_alerts_and_add_history.sql";
const sql=readFileSync(`supabase/migrations/${name}`,"utf8");
const hash=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
describe('185 protected Project dismissal and retained History',()=>{
  it('preserves all historical migrations and advances to 185',()=>{
    const files=readdirSync('supabase/migrations').filter(f=>/^\d{14}_.+\.sql$/.test(f)&&f.slice(0,14)<='20261031120000').sort();
    expect(files).toHaveLength(185);expect(files[184]).toBe(name);
    for(const f of files.slice(0,182)){const p=`supabase/migrations/${f}`;expect(hash(readFileSync(p)),f).toBe(hash(execFileSync('git',['show',`HEAD:${p}`])));}
    expect(hash(readFileSync(`supabase/migrations/${files[182]}`))).toBe('292217b9bbc98731bf23ceda3321a27038117bfa95cbeb46b0dccd56e19ad6a7');
    expect(hash(readFileSync(`supabase/migrations/${files[183]}`))).toBe('52d13e90ae89dc3bf3366d4ee7dab8c308fd12240ee921f453697d8522a890f5');
  });
  it('uses private FK-backed recipient/condition identities with immutable acknowledgment history',()=>{
    expect(sql).toContain('primary key(recipient_user_id,condition_kind,condition_id)');
    expect(sql).toContain('references public.project_shortage_episodes(id)');expect(sql).toContain('references public.project_activity_updates(id)');
    expect(sql).toContain('enable row level security');expect(sql).toContain('from public,anon,authenticated,service_role');
    expect(sql).toContain('before update or delete');expect(sql).toContain('before truncate');
  });
  it('guards the legacy Project route under source-first locking and post-wait authorization',()=>{
    expect(sql).toContain('create or replace function public.dismiss_project_alert_notification(p_notification_id uuid)');
    expect(sql.indexOf('where s.id=identity for update')).toBeLessThan(sql.indexOf('where r.id=p_notification_id and r.recipient_user_id=actor for update'));
    expect(sql).toContain("raise exception 'Active conditions cannot be dismissed' using errcode='55000'");
    expect(sql).toContain('public.current_active_user_profile_id() is distinct from actor');
    expect(sql).not.toMatch(/create or replace function public\.(?:update_dashboard_notification|mark_project_alert_read|mark_dashboard_notification_read|work_order_shortage_tracking_rows)/);
  });
  it('preserves private projections, bounded History and condition deduplication',()=>{
    expect(sql).toContain('distinct on (a.id)');expect(sql).toContain('distinct on (o.episode_id)');
    expect(sql).toContain("n.notification_kind='issue_resolved' and n.project_issue_resolution_id=resolution.id");
    expect(sql).toContain('p_limit not between 1 and 50');expect(sql).toContain("'next_cursor'");expect(sql).toContain("'acknowledged_at'");
    expect(sql).toContain('p_recipient is distinct from actor');expect(sql).toContain('on conflict do nothing');
  });
  it('has no backfill, stock changes, activation or notification fanout',()=>{
    const topLevel=sql.replace(/as \$fn\$[\s\S]*?\$fn\$;/g,'').replace(/--[^\n]*/g,'');
    expect(topLevel).not.toMatch(/\b(?:insert into|update public\.|delete from)\b/i);
    expect(sql).not.toMatch(/(?:update|insert into|delete from) public\.(?:inventory|work_orders|project_shortage_episodes|project_issue_resolutions|project_activity_alerts)\b/i);
    expect(sql).not.toContain('realtime.send');
  });
});
