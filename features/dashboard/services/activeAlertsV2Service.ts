import { supabase } from "../../../lib/supabase/client";
import { frontendEnv } from "../../../lib/config/env";
import { isActiveAlertsV2Enabled } from "../../../app/config/activeAlertsV2Activation";
import { availabilityTimestamp } from "../../work-orders/services/workOrderAvailabilityService";

export type ProblemKind = "project_shortage" | "project_issue" | "work_order_shortage";
export type Feed = "conditions" | "history" | "updates";
export interface AlertCursor { beforeAt: string; beforeKind: ProblemKind | "informational_update"; beforeId: string }
export interface ActiveProblemCounts {
  activeProblems: string; workOrderShortages: string; projectShortages: string; projectIssues: string; unreadUpdates: string; asOf: string;
}
export interface AlertCondition {
  kind: ProblemKind | "informational_update"; id: string; status: "active" | "resolved" | "informational";
  targetType: "project" | "work_order"; targetId: string; targetLabel: string; navigationAllowed: boolean;
  notificationId: string; deliveryCreatedAt: string; readAt: string | null; openedAt: string; resolvedAt: string | null;
  dismissedAt: string | null; acknowledgedAt: string | null;
  product: { id: string; name: string; serial: string | null } | null; shortageQuantity: string | null;
  issue: { activityId: string; title: string; description: string; authorId: string; authorName: string | null;
    resolutionDescription: string | null; resolverId: string | null; resolverName: string | null } | null;
}
export interface AlertPage { items: AlertCondition[]; hasMore: boolean; nextCursor: AlertCursor | null; asOf: string }
export interface Acknowledgment { kind: ProblemKind; id: string; acknowledgedAt: string }
export type AlertErrorCode = "access_denied" | "invalid_request" | "unavailable" | "active_condition" | "not_found";
export type AlertResult<T> = { ok: true; value: T } | { ok: false; error: { code: AlertErrorCode; message: string } };
export interface AlertRequestContext { accessToken: string; backendOrigin: string }
export interface AlertPageRequest { feed: Feed; limit?: number; cursor?: AlertCursor | null; status?: "all" | "active" | "resolved" }
const kinds = ["project_shortage", "project_issue", "work_order_shortage"] as const;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).sort().join() === [...keys].sort().join();
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const stamp = (v: unknown): v is string => {
  if(typeof v!=="string"||availabilityTimestamp(v)===null||Number(v.slice(11,13))>23)return false;
  const date=new Date(`${v.slice(0,10)}T00:00:00Z`);
  return date.toISOString().slice(0,10)===v.slice(0,10);
};
const nullableStamp = (v: unknown) => v === null || stamp(v);
const decimal = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9][0-9]{0,99})$/.test(v);
const quantity = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9][0-9]{0,99})(?:\.[0-9]{1,100})?$/.test(v);
const zeroQuantity = (v:string) => /^0(?:\.0+)?$/.test(v);
const problem = (v: unknown): v is ProblemKind => kinds.includes(v as ProblemKind);
export const alertV2Failure = <T = never>(code: AlertErrorCode = "unavailable"): AlertResult<T> => ({ok:false,error:{code,message:
  code === "active_condition" ? "Active problems cannot be dismissed." : "Alerts are unavailable. Refresh or check your access."}});

export function parseActiveProblemCounts(data: unknown): AlertResult<ActiveProblemCounts> {
  if (!record(data) || !exact(data,["contract_version","as_of","active_problems","active_work_order_shortages","active_project_shortages","unresolved_project_issues","unread_updates"]) ||
    data.contract_version !== 2 || !stamp(data.as_of) || ![data.active_problems,data.active_work_order_shortages,data.active_project_shortages,data.unresolved_project_issues,data.unread_updates].every(decimal)) return alertV2Failure();
  const a=data.active_problems as string,w=data.active_work_order_shortages as string,p=data.active_project_shortages as string,i=data.unresolved_project_issues as string;
  if (BigInt(a) !== BigInt(w)+BigInt(p)+BigInt(i)) return alertV2Failure();
  return {ok:true,value:{activeProblems:a,workOrderShortages:w,projectShortages:p,projectIssues:i,unreadUpdates:data.unread_updates as string,asOf:data.as_of}};
}
const common = ["condition_kind","condition_id","target_type","notification_id","delivery_created_at","read_at","navigation_allowed"];
const lifecycle = ["condition_status","opened_at","resolved_at"];
const project = ["project_id","project_name"];
const material = ["product_id","product_name","shortage_quantity"];
const issue = ["activity_id","title","description","author_user_id"];
function parseItem(v: unknown, feed: Feed): AlertCondition | null {
  if (!record(v) || !uuid(v.condition_id) || !uuid(v.notification_id) || !stamp(v.delivery_created_at) || !nullableStamp(v.read_at) || typeof v.navigation_allowed !== "boolean") return null;
  const isUpdate = feed === "updates", isHistory = feed === "history", kind = v.condition_kind;
  if (isUpdate ? kind !== "informational_update" : !problem(kind)) return null;
  const isWO=kind === "work_order_shortage", isIssue=kind === "project_issue";
  const keys=[...common,...(isUpdate?[]:lifecycle),...(isHistory?["acknowledged_at"]:[])];
  if (isWO) keys.push(...material,"work_order_id","work_order_number",...(isHistory?[]:["notification_kind","event_id","episode_id","shortage_event_type","created_at","episode_status"]));
  else {
    keys.push(...project,...(isUpdate?[...issue,"created_at"]:isIssue?[...issue,"author_full_name","resolution_description","resolved_by_user_id","resolver_full_name","dismissed_at"]:[...material,"product_serial_number","dismissed_at"]));
  }
  if (!exact(v,keys) || v.target_type !== (isWO ? "work_order" : "project") || !uuid(isWO?v.work_order_id:v.project_id) || !text(isWO?v.work_order_number:v.project_name)) return null;
  const status=isUpdate?"informational":v.condition_status;
  if (!isUpdate && (status !== "active" && status !== "resolved" || !stamp(v.opened_at) || !nullableStamp(v.resolved_at) || (status === "active") !== (v.resolved_at === null))) return null;
  if (isHistory && (status !== "resolved" || !nullableStamp(v.acknowledged_at))) return null;
  if (!isWO && !isUpdate && !nullableStamp(v.dismissed_at)) return null;
  if (isWO) {
    if (!/^RN-\d{4}-\d{4}$/.test(v.work_order_number as string)) return null;
    if(status==='resolved'&&v.read_at===null)return null;
    if (!isHistory && (v.notification_kind !== "work_order_shortage" || !uuid(v.event_id) || v.episode_id !== v.condition_id ||
      v.episode_status !== status || v.shortage_event_type !== (status === "active" ? "opened" : "resolved") || !stamp(v.created_at) || v.created_at !== v.delivery_created_at)) return null;
  }
  if (!isUpdate && !isIssue && (!uuid(v.product_id) || !text(v.product_name) || !(isWO?decimal(v.shortage_quantity):quantity(v.shortage_quantity)) ||
    (status === "active" ? zeroQuantity(v.shortage_quantity as string) : !zeroQuantity(v.shortage_quantity as string)) || (!isWO && !text(v.product_serial_number)))) return null;
  if (isIssue || isUpdate) {
    if (!uuid(v.activity_id) || v.activity_id !== v.condition_id || !text(v.title) || !text(v.description) || !uuid(v.author_user_id)) return null;
    if (isUpdate ? !stamp(v.created_at) : !text(v.author_full_name)) return null;
    if (isIssue && (status === "active" ? [v.resolution_description,v.resolved_by_user_id,v.resolver_full_name].some(x=>x!==null) : !text(v.resolution_description)||!uuid(v.resolved_by_user_id)||!text(v.resolver_full_name))) return null;
  }
  const opened=(isUpdate?v.created_at:v.opened_at) as string,resolved=isUpdate?null:v.resolved_at as string|null;
  // Issue resolution uses transaction time, which can precede Activity creation
  // in a long transaction. Never replace authoritative state with clock inference.
  if (!isIssue && resolved && availabilityTimestamp(resolved)! < availabilityTimestamp(opened)!) return null;
  return {kind:kind as AlertCondition["kind"],id:v.condition_id,status:status as AlertCondition["status"],targetType:isWO?"work_order":"project",
    targetId:(isWO?v.work_order_id:v.project_id) as string,targetLabel:(isWO?v.work_order_number:v.project_name) as string,navigationAllowed:v.navigation_allowed,
    notificationId:v.notification_id,deliveryCreatedAt:v.delivery_created_at,readAt:v.read_at as string|null,openedAt:opened,resolvedAt:resolved,
    dismissedAt:(!isWO&&!isUpdate?v.dismissed_at:null) as string|null,acknowledgedAt:(isHistory?v.acknowledged_at:null) as string|null,
    product:!isUpdate&&!isIssue?{id:v.product_id as string,name:v.product_name as string,serial:isWO?null:v.product_serial_number as string}:null,
    shortageQuantity:!isUpdate&&!isIssue?v.shortage_quantity as string:null,
    issue:isIssue||isUpdate?{activityId:v.activity_id as string,title:v.title as string,description:v.description as string,authorId:v.author_user_id as string,
      authorName:isUpdate?null:v.author_full_name as string,resolutionDescription:isUpdate?null:v.resolution_description as string|null,
      resolverId:isUpdate?null:v.resolved_by_user_id as string|null,resolverName:isUpdate?null:v.resolver_full_name as string|null}:null};
}
function validCursor(v: AlertCursor, feed: Feed): boolean {
  return record(v) && exact(v,["beforeAt","beforeKind","beforeId"]) && stamp(v.beforeAt) && uuid(v.beforeId) &&
    (feed === "updates" ? v.beforeKind === "informational_update" : problem(v.beforeKind));
}
function validRequest(r: AlertPageRequest): boolean {
  return ["conditions","history","updates"].includes(r.feed) && Number.isSafeInteger(r.limit??20) && (r.limit??20)>=1 && (r.limit??20)<=50 &&
    (r.cursor == null || validCursor(r.cursor,r.feed)) && (r.status === undefined || r.feed === "conditions" && ["all","active","resolved"].includes(r.status));
}
function compare(a: AlertCursor,b: AlertCursor) {
  const t=availabilityTimestamp(a.beforeAt)!-availabilityTimestamp(b.beforeAt)!;
  return t===0n ? a.beforeKind===b.beforeKind ? a.beforeId.toLowerCase().localeCompare(b.beforeId.toLowerCase()) : a.beforeKind.localeCompare(b.beforeKind) : t>0n?1:-1;
}
export function parseAlertPage(data: unknown,r: AlertPageRequest): AlertResult<AlertPage> {
  if (!validRequest(r) || !record(data) || !exact(data,["contract_version","as_of","items","has_more","next_cursor"]) || data.contract_version!==2 || !stamp(data.as_of) ||
    !Array.isArray(data.items) || data.items.length>(r.limit??20) || typeof data.has_more!=="boolean") return alertV2Failure();
  const items:AlertCondition[]=[],seen=new Set<string>();let prior=r.cursor??null;
  for (const raw of data.items) {
    const item=parseItem(raw,r.feed);if(!item || r.feed==='conditions' && r.status && r.status!=='all' && item.status!==r.status) return alertV2Failure();
    const key=`${item.kind}:${item.id.toLowerCase()}`,position={beforeAt:r.feed==='history'?item.resolvedAt!:item.deliveryCreatedAt,beforeKind:item.kind,beforeId:item.id};
    if(seen.has(key)||prior&&compare(position,prior)>=0)return alertV2Failure();seen.add(key);items.push(item);prior=position;
  }
  let nextCursor:AlertCursor|null=null;
  if(data.has_more){
    const c=data.next_cursor,at=r.feed==='history'?'before_resolved_at':'before_created_at';
    if(!record(c)||!exact(c,[at,'before_kind','before_id'])||items.length!==(r.limit??20))return alertV2Failure();
    nextCursor={beforeAt:c[at] as string,beforeKind:c.before_kind as AlertCursor['beforeKind'],beforeId:c.before_id as string};
    if(!validCursor(nextCursor,r.feed)||!prior||compare(nextCursor,prior)!==0)return alertV2Failure();
  }else if(data.next_cursor!==null)return alertV2Failure();
  return {ok:true,value:{items,hasMore:data.has_more,nextCursor,asOf:data.as_of}};
}
export function parseAcknowledgment(data:unknown,kind:ProblemKind,id:string):AlertResult<Acknowledgment>{
  if(!record(data)||!exact(data,['condition_kind','condition_id','acknowledged_at'])||!problem(kind)||!uuid(id)||data.condition_kind!==kind||!uuid(data.condition_id)||data.condition_id.toLowerCase()!==id.toLowerCase()||!stamp(data.acknowledged_at))return alertV2Failure();
  return {ok:true,value:{kind,id:data.condition_id.toLowerCase(),acknowledgedAt:data.acknowledged_at}};
}
async function request<T>(rpc:string,args:Record<string,unknown>,context:AlertRequestContext,parse:(v:unknown)=>AlertResult<T>,signal?:AbortSignal):Promise<AlertResult<T>>{
  if(!isActiveAlertsV2Enabled()||!context.accessToken||context.backendOrigin!==new URL(frontendEnv.supabaseUrl).origin||signal?.aborted)return alertV2Failure('access_denied');
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,15000);signal?.addEventListener('abort',abort,{once:true});
  try{
    const {data,error}=await supabase.rpc(rpc,args).setHeader('Authorization',`Bearer ${context.accessToken}`).abortSignal(controller.signal);
    if(controller.signal.aborted||context.backendOrigin!==new URL(frontendEnv.supabaseUrl).origin||!isActiveAlertsV2Enabled())return alertV2Failure('access_denied');
    if(error)return alertV2Failure(error.code==='42501'?'access_denied':error.code==='55000'?'active_condition':error.code==='P0002'?'not_found':error.code==='22023'?'invalid_request':'unavailable');
    return parse(data);
  }catch{return alertV2Failure();}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export const getActiveProblemCountsV2=(c:AlertRequestContext,s?:AbortSignal)=>request('get_dashboard_active_problem_counts_v2',{},c,parseActiveProblemCounts,s);
export function listActiveAlertPageV2(r:AlertPageRequest,c:AlertRequestContext,s?:AbortSignal):Promise<AlertResult<AlertPage>>{
  if(!validRequest(r))return Promise.resolve(alertV2Failure('invalid_request'));
  const history=r.feed==='history',rpc=history?'list_dashboard_alert_history_v2':r.feed==='updates'?'list_dashboard_informational_updates_v2':'list_dashboard_problem_conditions_v2';
  const args:Record<string,unknown>={p_limit:r.limit??20,[history?'p_before_resolved_at':'p_before_created_at']:r.cursor?.beforeAt??null,p_before_kind:r.cursor?.beforeKind??null,p_before_id:r.cursor?.beforeId??null};
  if(r.feed==='conditions')args.p_status=r.status??'all';
  return request(rpc,args,c,v=>parseAlertPage(v,r),s);
}
export function acknowledgeProblemV2(kind:ProblemKind,id:string,c:AlertRequestContext,s?:AbortSignal):Promise<AlertResult<Acknowledgment>>{
  if(!problem(kind)||!uuid(id))return Promise.resolve(alertV2Failure('invalid_request'));
  return request('acknowledge_dashboard_problem_v2',{p_condition_kind:kind,p_condition_id:id},c,v=>parseAcknowledgment(v,kind,id),s);
}
export const listProblemConditionsV2=(c:AlertRequestContext,options:Omit<AlertPageRequest,'feed'>={},s?:AbortSignal)=>listActiveAlertPageV2({...options,feed:'conditions'},c,s);
export const listInformationalUpdatesV2=(c:AlertRequestContext,options:Omit<AlertPageRequest,'feed'|'status'>={},s?:AbortSignal)=>listActiveAlertPageV2({...options,feed:'updates'},c,s);
export const listAlertHistoryV2=(c:AlertRequestContext,options:Omit<AlertPageRequest,'feed'|'status'>={},s?:AbortSignal)=>listActiveAlertPageV2({...options,feed:'history'},c,s);
/** Existing owner-only receipt operations, with the same captured v2 actor boundary. */
export function updateAlertReceiptV2(action: "read" | "dismiss_update", item: AlertCondition, context: AlertRequestContext): Promise<AlertResult<{notificationId:string;at:string}>> {
  if (!uuid(item.notificationId) || action === "dismiss_update" && item.kind !== "informational_update") return Promise.resolve(alertV2Failure("active_condition"));
  const field = action === "read" ? "read_at" : "dismissed_at";
  return request(action === "read" ? "mark_dashboard_notification_read" : "dismiss_dashboard_notification", {p_notification_id:item.notificationId}, context, data => {
    if (!Array.isArray(data) || data.length !== 1 || !record(data[0]) || !exact(data[0],["notification_id",field]) || data[0].notification_id !== item.notificationId || !stamp(data[0][field])) return alertV2Failure();
    return {ok:true,value:{notificationId:item.notificationId,at:data[0][field] as string}};
  });
}
export function activeAlertDestination(item:AlertCondition):string|null {
  if(!item.navigationAllowed)return null;
  return item.targetType==='work_order'?`/work-orders/${item.targetId}`:`/projects/${item.targetId}${item.issue?`#activity-${item.issue.activityId}`:''}`;
}
