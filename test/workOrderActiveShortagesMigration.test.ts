import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {expect,it} from "vitest";
const dir="supabase/migrations/",name="20261029110000_track_active_work_order_shortages.sql",sql=readFileSync(dir+name,"utf8");
it("is forward migration 166 and preserves deployed 165",()=>{
 expect(readdirSync(dir).filter(f=>/^\d{14}_/.test(f)).sort()[165]).toBe(name);
 expect(createHash("sha256").update(readFileSync(dir+"20261029100000_add_bounded_work_order_shortage_initialization.sql")).digest("hex"))
  .toBe("9c07fbd01a398363ded3fbec8d9cdcf76bc49e86828528859c70e41404c63412");
});
it("keeps acknowledgements and projection private and authorizes recipient-owned reads",()=>{
 expect(sql).toContain("enable row level security");expect(sql).toContain("where r.recipient_user_id=p_actor");
 expect(sql).toContain("public.require_dashboard_notification_actor()");expect(sql).toContain("public.has_permission('work_orders.view')");
 expect(sql).not.toMatch(/grant\s+(select|insert|update|delete)/i);
});
it("uses one episode per recipient, separates counts, and protects active dismissal after locking",()=>{
 expect(sql).toContain("distinct on (o.episode_id)");expect(sql).toContain("'active_work_order_shortages'");
 expect(sql).toContain("'unread_project_notifications'");expect(sql).toContain("coalesce(r.read_at,s.resolved_at)");
 expect(sql.indexOf("where s.id=episode for update")).toBeLessThan(sql.indexOf("Active shortages cannot be dismissed"));
 expect(sql).toContain("old.dismissed_at>=s.resolved_at");
});
it("reuses private payload-free invalidation without stock or event rewrites",()=>{
 expect(sql).toContain("realtime.send('{}'::jsonb,'invalidate'");expect(sql).toContain("work_order_shortage_tracking_select_own");
 expect(sql).not.toMatch(/update public\.(inventory_|work_orders|work_order_material_shortage_events)|delete from|truncate/i);
});
