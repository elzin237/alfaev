import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({enabled:true,rpc:vi.fn()}));
vi.mock('../../../app/config/activeAlertsV2Activation',()=>({isActiveAlertsV2Enabled:()=>mocks.enabled}));
vi.mock('../../../lib/supabase/client',()=>({supabase:{rpc:mocks.rpc}}));
import { frontendEnv } from '../../../lib/config/env';
import { acknowledgeProblemV2,activeAlertDestination,getActiveProblemCountsV2,listActiveAlertPageV2,parseAcknowledgment,parseActiveProblemCounts,parseAlertPage,updateAlertReceiptV2,type AlertCondition,type Feed } from './activeAlertsV2Service';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const time='2026-10-31T10:00:00.123456+00:00',resolved='2026-10-31T11:00:00+00:00';
const context={accessToken:'captured-test-token',backendOrigin:new URL(frontendEnv.supabaseUrl).origin};
function row(kind='project_shortage',feed:Feed='conditions',status='active'){
  const base:any={condition_kind:kind,condition_id:id(1),target_type:kind==='work_order_shortage'?'work_order':'project',notification_id:id(2),delivery_created_at:time,read_at:null,navigation_allowed:true};
  if(feed!=='updates')Object.assign(base,{condition_status:status,opened_at:time,resolved_at:status==='resolved'?resolved:null});
  if(feed==='history')base.acknowledged_at=null;
  if(kind==='work_order_shortage'){
    Object.assign(base,{product_id:id(3),product_name:'Exact component',shortage_quantity:status==='active'?'9007199254740993':'0',work_order_id:id(4),work_order_number:'RN-2026-0041'});
    if(status==='resolved')base.read_at=resolved;
    if(feed!=='history')Object.assign(base,{notification_kind:'work_order_shortage',event_id:id(5),episode_id:id(1),shortage_event_type:status==='active'?'opened':'resolved',created_at:time,episode_status:status});
  }else{
    Object.assign(base,{project_id:id(4),project_name:'Authorized Project'});
    if(kind==='project_shortage')Object.assign(base,{product_id:id(3),product_name:'Exact component',product_serial_number:'0000006',shortage_quantity:status==='active'?'9007199254740993':'0',dismissed_at:null});
    else{
      Object.assign(base,{activity_id:id(1),title:'Original issue',description:'Original description',author_user_id:id(6)});
      if(feed==='updates')base.created_at=time;
      else Object.assign(base,{author_full_name:'Author',resolution_description:status==='resolved'?'Fixed':null,resolved_by_user_id:status==='resolved'?id(7):null,resolver_full_name:status==='resolved'?'Resolver':null,dismissed_at:null});
    }
  }return base;
}
const page=(items:any[]=[],overrides={})=>({contract_version:2,as_of:resolved,items,has_more:false,next_cursor:null,...overrides});
const counts=()=>({contract_version:2,as_of:time,active_problems:'9007199254740996',active_work_order_shortages:'9007199254740993',active_project_shortages:'2',unresolved_project_issues:'1',unread_updates:'99'});
beforeEach(()=>{mocks.enabled=true;mocks.rpc.mockReset();mocks.rpc.mockImplementation(()=>({setHeader:()=>({abortSignal:()=>Promise.resolve({data:counts(),error:null})})}));});
function parsedCondition(kind='project_shortage',feed:Feed='conditions'):AlertCondition {
  const result=parseAlertPage(page([row(kind,feed)]),{feed});
  if(!result.ok||!result.value.items[0])throw new Error('Invalid test fixture');return result.value.items[0];
}
describe('scoped existing read and informational-dismiss receipts',()=>{
  it.each(['project_shortage','project_issue','work_order_shortage'])('reads %s without changing its authoritative condition state',async kind=>{
    const item=parsedCondition(kind),header=vi.fn(()=>({abortSignal:()=>Promise.resolve({data:[{notification_id:item.notificationId,read_at:resolved}],error:null})}));mocks.rpc.mockReturnValue({setHeader:header});
    expect(await updateAlertReceiptV2('read',item,context)).toEqual({ok:true,value:{notificationId:item.notificationId,at:resolved}});
    expect(mocks.rpc).toHaveBeenCalledWith('mark_dashboard_notification_read',{p_notification_id:item.notificationId});expect(header).toHaveBeenCalledWith('Authorization',`Bearer ${context.accessToken}`);
    expect(item.status).toBe('active');expect(item.readAt).toBeNull();
  });
  it('dismisses only informational updates through the existing owner-only operation',async()=>{
    const item=parsedCondition('informational_update','updates');mocks.rpc.mockReturnValue({setHeader:()=>({abortSignal:()=>Promise.resolve({data:[{notification_id:item.notificationId,dismissed_at:resolved}],error:null})})});
    expect((await updateAlertReceiptV2('dismiss_update',item,context)).ok).toBe(true);expect(mocks.rpc).toHaveBeenCalledWith('dismiss_dashboard_notification',{p_notification_id:item.notificationId});
    mocks.rpc.mockClear();expect((await updateAlertReceiptV2('dismiss_update',parsedCondition(),context)).ok).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([null,[],[{notification_id:id(99),read_at:resolved}],[{notification_id:id(2),read_at:'invalid'}],[{notification_id:id(2),read_at:resolved,condition_status:'resolved'}]])('rejects malformed/mismatched receipt %j',async data=>{
    mocks.rpc.mockReturnValue({setHeader:()=>({abortSignal:()=>Promise.resolve({data,error:null})})});expect((await updateAlertReceiptV2('read',parsedCondition(),context)).ok).toBe(false);
  });
  it('blocks both receipt actions when gated OFF or the backend scope differs',async()=>{
    mocks.enabled=false;await updateAlertReceiptV2('read',parsedCondition(),context);await updateAlertReceiptV2('dismiss_update',parsedCondition('informational_update','updates'),context);
    mocks.enabled=true;await updateAlertReceiptV2('read',parsedCondition(),{...context,backendOrigin:'https://other.invalid'});expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
describe('strict authoritative Active Alerts v2 contracts',()=>{
  it('preserves exact large count strings and keeps unread updates out of the sum',()=>{
    expect(parseActiveProblemCounts(counts())).toMatchObject({ok:true,value:{activeProblems:'9007199254740996',unreadUpdates:'99'}});
    expect(parseActiveProblemCounts({...counts(),active_problems:'9007199254741095'}).ok).toBe(false);
  });
  it.each(Object.keys(counts()))('rejects missing count field %s',key=>{const data:any=counts();delete data[key];expect(parseActiveProblemCounts(data).ok).toBe(false);});
  it.each([1,'-1','1.1','01','NaN','9'.repeat(101)])('rejects unsafe count %s',n=>expect(parseActiveProblemCounts({...counts(),unread_updates:n}).ok).toBe(false));
  it.each(['project_shortage','project_issue','work_order_shortage'])('parses active and resolved %s independently of reading',kind=>{
    const active=row(kind);active.read_at=resolved;
    expect(parseAlertPage(page([active]),{feed:'conditions'})).toMatchObject({ok:true,value:{items:[{status:'active',readAt:resolved}]}});
    expect(parseAlertPage(page([row(kind,'history','resolved')]),{feed:'history'})).toMatchObject({ok:true,value:{items:[{status:'resolved',acknowledgedAt:null}]}});
  });
  it('parses general updates without inventing a condition or creator name',()=>{
    expect(parseAlertPage(page([row('informational_update','updates')]),{feed:'updates'})).toMatchObject({ok:true,value:{items:[{kind:'informational_update',status:'informational',issue:{authorName:null}}]}});
  });
  it.each(['project_shortage','project_issue','work_order_shortage'])('rejects missing and extra fields on %s',kind=>{
    const valid=row(kind);for(const key of Object.keys(valid)){const bad={...valid};delete bad[key];expect(parseAlertPage(page([bad]),{feed:'conditions'}).ok,key).toBe(false);}
    expect(parseAlertPage(page([{...valid,private_recipient:id(99)}]),{feed:'conditions'}).ok).toBe(false);
  });
  it('rejects contradictory lifecycle and forged navigation types',()=>{
    for(const patch of [{resolved_at:resolved},{shortage_quantity:'0'},{condition_status:'read'},{navigation_allowed:'true'},{product_id:'invalid'}])expect(parseAlertPage(page([{...row(),...patch}]),{feed:'conditions'}).ok).toBe(false);
    expect(parseAlertPage(page([{...row(),navigation_allowed:false}]),{feed:'conditions'})).toMatchObject({ok:true,value:{items:[{navigationAllowed:false}]}});
    expect(parseAlertPage(page([row('project_issue')]),{feed:'history'}).ok).toBe(false);
  });
  it('rejects malformed dates but retains authoritative Issue resolution transaction timestamps',()=>{
    expect(parseActiveProblemCounts({...counts(),as_of:'2026-02-30T00:00:00Z'}).ok).toBe(false);
    const issue=row('project_issue','history','resolved');issue.resolved_at='2026-10-31T09:59:00Z';
    expect(parseAlertPage(page([issue]),{feed:'history'}).ok).toBe(true);
  });
  it('checks bounded sorted pagination and exact microsecond continuation',()=>{
    const first=row(),second={...row(),condition_id:id(8),notification_id:id(9),delivery_created_at:'2026-10-31T10:00:00.123455+00:00'};
    const next={before_created_at:first.delivery_created_at,before_kind:first.condition_kind,before_id:first.condition_id};
    expect(parseAlertPage(page([first],{has_more:true,next_cursor:next}),{feed:'conditions',limit:1}).ok).toBe(true);
    expect(parseAlertPage(page([second]),{feed:'conditions',cursor:{beforeAt:time,beforeKind:'project_shortage',beforeId:id(1)}}).ok).toBe(true);
    expect(parseAlertPage(page([second,first]),{feed:'conditions'}).ok).toBe(false);
    expect(parseAlertPage(page([first,first]),{feed:'conditions'}).ok).toBe(false);
    expect(parseAlertPage(page([first],{has_more:true,next_cursor:{...next,before_id:id(99)}}),{feed:'conditions',limit:1}).ok).toBe(false);
    expect(parseAlertPage(page([first]),{feed:'conditions',limit:0}).ok).toBe(false);
  });
  it.each(['history','updates'] as Feed[])('validates %s cursor shape and exact last identity',feed=>{
    const item=feed==='history'?row('project_issue','history','resolved'):row('informational_update','updates');
    const cursor={[feed==='history'?'before_resolved_at':'before_created_at']:feed==='history'?resolved:time,before_kind:item.condition_kind,before_id:item.condition_id};
    expect(parseAlertPage(page([item],{has_more:true,next_cursor:cursor}),{feed,limit:1}).ok).toBe(true);
    expect(parseAlertPage(page([item],{has_more:true,next_cursor:{...cursor,before_id:id(99)}}),{feed,limit:1}).ok).toBe(false);
  });
  it('strictly binds acknowledgment receipts to the requested condition',()=>{
    const receipt={condition_kind:'project_issue',condition_id:id(1),acknowledged_at:resolved};
    expect(parseAcknowledgment(receipt,'project_issue',id(1)).ok).toBe(true);
    expect(parseAcknowledgment(receipt,'project_shortage',id(1)).ok).toBe(false);
    expect(parseAcknowledgment({...receipt,extra:true},'project_issue',id(1)).ok).toBe(false);
  });
  it('preserves scaled Project numeric strings exactly and honors navigation eligibility',()=>{
    const parsed=parseAlertPage(page([{...row(),shortage_quantity:'9007199254740993.000000'}]),{feed:'conditions'});
    expect(parsed).toMatchObject({ok:true,value:{items:[{shortageQuantity:'9007199254740993.000000'}]}});
    if(parsed.ok){expect(activeAlertDestination(parsed.value.items[0]!)).toBe(`/projects/${id(4)}`);expect(activeAlertDestination({...parsed.value.items[0]!,navigationAllowed:false})).toBeNull();}
  });
  it('dispatches acknowledgment only for its original condition and rejects unsafe receipts',async()=>{
    mocks.rpc.mockReturnValue({setHeader:()=>({abortSignal:()=>Promise.resolve({data:{condition_kind:'project_issue',condition_id:id(1),acknowledged_at:resolved},error:null})})});
    expect((await acknowledgeProblemV2('project_issue',id(1),context)).ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith('acknowledge_dashboard_problem_v2',{p_condition_kind:'project_issue',p_condition_id:id(1)});
    expect((await acknowledgeProblemV2('project_issue',id(99),context)).ok).toBe(false);
  });
  it('blocks every RPC when OFF, including explicit mutation calls',async()=>{
    mocks.enabled=false;await getActiveProblemCountsV2(context);for(const feed of ['conditions','history','updates'] as Feed[])await listActiveAlertPageV2({feed},context);await acknowledgeProblemV2('project_issue',id(1),context);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['conditions','history','updates'] as Feed[])('sends the exact bounded %s RPC arguments with captured authorization',async feed=>{
    const setHeader=vi.fn(()=>({abortSignal:vi.fn().mockResolvedValue({data:page(),error:null})}));mocks.rpc.mockReturnValue({setHeader});
    expect((await listActiveAlertPageV2({feed},context)).ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith(feed==='history'?'list_dashboard_alert_history_v2':feed==='updates'?'list_dashboard_informational_updates_v2':'list_dashboard_problem_conditions_v2',{
      p_limit:20,[feed==='history'?'p_before_resolved_at':'p_before_created_at']:null,p_before_kind:null,p_before_id:null,...(feed==='conditions'?{p_status:'all'}:{})});
    expect(setHeader).toHaveBeenCalledWith('Authorization','Bearer captured-test-token');
  });
  it.each([['42501','access_denied'],['55000','active_condition'],['P0002','not_found'],['22023','invalid_request'],['unknown','unavailable']])('maps %s without exposing backend details',async(code,expected)=>{
    mocks.rpc.mockReturnValue({setHeader:()=>({abortSignal:()=>Promise.resolve({data:null,error:{code,message:'PRIVATE SQL'}})})});
    expect(await acknowledgeProblemV2('project_issue',id(1),context)).toMatchObject({ok:false,error:{code:expected}});
  });
  it('rejects empty credentials, backend mismatch, abortion and invalid requests before dispatch',async()=>{
    await getActiveProblemCountsV2({...context,accessToken:''});await getActiveProblemCountsV2({...context,backendOrigin:'https://other.invalid'});
    const c=new AbortController();c.abort();await getActiveProblemCountsV2(context,c.signal);await listActiveAlertPageV2({feed:'conditions',limit:51},context);await acknowledgeProblemV2('project_issue','bad',context);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects a late response after the configured backend changes',async()=>{
    let finish!:(v:any)=>void;mocks.rpc.mockReturnValue({setHeader:()=>({abortSignal:()=>new Promise(resolve=>{finish=resolve;})})});
    const previous=frontendEnv.supabaseUrl,pending=getActiveProblemCountsV2(context);
    try{(frontendEnv as {supabaseUrl:string}).supabaseUrl='https://other-backend.invalid';finish({data:counts(),error:null});expect(await pending).toMatchObject({ok:false,error:{code:'access_denied'}});}
    finally{(frontendEnv as {supabaseUrl:string}).supabaseUrl=previous;}
  });
});
