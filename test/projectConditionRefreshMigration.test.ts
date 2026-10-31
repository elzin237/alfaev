import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const name='20261031130000_refresh_project_alert_conditions.sql';
const sql=readFileSync(`supabase/migrations/${name}`,'utf8');
const hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
describe('186 private transactional Project condition refresh',()=>{
  it('advances forward without rewriting the 185 reviewed migrations',()=>{
    const files=readdirSync('supabase/migrations').filter(f=>/^\d{14}_.+\.sql$/.test(f)&&f.slice(0,14)<='20261031130000').sort();
    expect(files).toHaveLength(186);expect(files[185]).toBe(name);
    for(const f of files.slice(0,182)){const path=`supabase/migrations/${f}`;expect(hash(readFileSync(path)),f).toBe(hash(execFileSync('git',['show',`HEAD:${path}`])));}
    const reviewed=['292217b9bbc98731bf23ceda3321a27038117bfa95cbeb46b0dccd56e19ad6a7','52d13e90ae89dc3bf3366d4ee7dab8c308fd12240ee921f453697d8522a890f5','5f0b36daa3ccac1a7ebf2fdc9e731e51a5bcaf82fe71a8f732b902211deb12f9'];
    for(let i=0;i<3;i++)expect(hash(readFileSync(`supabase/migrations/${files[182+i]}`))).toBe(reviewed[i]);
  });
  it('reuses exactly the established content-free private channel contract',()=>{
    expect(sql.match(/perform realtime\.send/g)).toHaveLength(1);
    expect(sql).toContain("payload:='{}'::jsonb,event:='invalidate'");
    expect(sql).toContain("topic:='project-alert-notifications:'||new.recipient_user_id::text,private:=true");
    expect(sql).not.toMatch(/create policy|alter policy|publication|work-order-shortages:/i);
  });
  it('keeps queue/helper privileges private and rechecks recipient access at dispatch',()=>{
    expect(sql).toContain('enable row level security');expect(sql).toContain('from public,anon,authenticated,service_role');
    expect(sql).toContain("d.key='dashboard.view'");expect(sql).toContain("d.key='projects.view'");
    expect(sql).toContain('if found and public.project_alert_refresh_recipient_eligible(new.recipient_user_id)');
    expect(sql).not.toMatch(/grant execute|grant select|grant all/i);
  });
  it('coalesces pending batches, skips no-op episode changes and preserves replay',()=>{
    expect(sql).toContain('primary key(transaction_id,recipient_user_id)');expect(sql).toContain('deferrable initially deferred');
    expect(sql).toContain('on conflict do nothing');expect(sql).toContain('delete from public.project_alert_condition_refresh_queue');
    expect(sql).toContain('old.current_shortage_quantity is distinct from new.current_shortage_quantity');
    expect(sql).toContain('after insert on public.project_issue_resolutions');
    expect(sql).toContain('after insert on public.project_condition_acknowledgments');
    expect(sql).not.toMatch(/create or replace function public\.(?:resolve_project_issue|post_project_activity|acknowledge_dashboard_problem_v2)/);
  });
  it('takes recipients from exact existing condition deliveries, not a new audience',()=>{
    expect(sql).toContain('where e.episode_id=new.id');expect(sql).toContain("where n.notification_kind='activity' and a.id=new.project_activity_id");
    expect(sql).toContain('r.recipient_user_id=new.recipient_user_id');expect(sql).toContain('e.episode_id=new.condition_id');
    expect(sql).not.toMatch(/insert into public\.(?:project_activity_alerts|project_activity_alert_recipients|project_shortage_events)/i);
  });
});
