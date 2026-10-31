import { useEffect, useRef } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { isActiveAlertsV2Enabled } from "../../../app/config/activeAlertsV2Activation";
import { useProjectAlertAccess } from "./useProjectAlerts";
import { activeAlertBackend, activeAlertScopeId, activeAlertV2Prefix, invalidateActiveAlertV2Queries, removeActiveAlertV2Queries, type ActiveAlertScope } from "../activeAlertsV2QueryKeys";
import { acknowledgeProblemV2, alertV2Failure, getActiveProblemCountsV2, listActiveAlertPageV2, updateAlertReceiptV2, type AlertCondition, type AlertCursor, type AlertResult, type Feed, type ProblemKind } from "../services/activeAlertsV2Service";

export class ActiveAlertV2RequestError extends Error {
  constructor(readonly code:string) { super("Alerts are unavailable. Refresh or check your access."); }
}
function value<T>(result:AlertResult<T>):T { if(!result.ok)throw new ActiveAlertV2RequestError(result.error.code);return result.value; }
export function useActiveAlertV2Access() {
  const auth=useAuth(),access=useProjectAlertAccess(true),client=useQueryClient();
  const allowed=isActiveAlertsV2Enabled()&&!auth.isLoading&&!auth.error&&auth.isActive&&!access.permissionsPending&&access.canRead&&
    Boolean(auth.session?.access_token&&auth.profile?.isActive&&auth.profile.authUserId===auth.session.user.id&&access.profileId===auth.profile.id);
  const scope:ActiveAlertScope|null=allowed?{backendOrigin:activeAlertBackend(),authUserId:auth.session!.user.id,profileId:auth.profile!.id,permissions:access.scope}:null;
  const id=activeAlertScopeId(scope),live=useRef(id),previous=useRef<ActiveAlertScope|null>(null);live.current=id;
  useEffect(()=>{
    live.current=id;
    if(previous.current&&activeAlertScopeId(previous.current)!==id)removeActiveAlertV2Queries(client,previous.current);
    previous.current=scope;
    return()=>{live.current='inactive';};
  },[client,id]);
  return {allowed,scope,id,live,context:{accessToken:auth.session?.access_token??"",backendOrigin:activeAlertBackend()},access};
}
const refresh={retry:false as const,staleTime:0,gcTime:0,refetchOnMount:"always" as const,refetchOnWindowFocus:"always" as const,refetchOnReconnect:"always" as const};
export function useActiveProblemsCountV2() {
  const a=useActiveAlertV2Access(),client=useQueryClient();
  const query=useQuery({queryKey:[...(a.scope?activeAlertV2Prefix(a.scope):["dashboard","active-alerts-v2","disabled"]),"counts"],
    // A shared query can retain the options of an observer that navigated away.
    // Its lifetime is the query's AbortSignal, not that component's live ref.
    // Identity changes cancel/remove the old scope in useActiveAlertV2Access.
    queryFn:async({signal})=>{if(!a.allowed)throw new ActiveAlertV2RequestError('access_denied');signal.throwIfAborted();
      const result=await getActiveProblemCountsV2(a.context,signal);
      signal.throwIfAborted();return value(result);},enabled:a.allowed,...refresh});
  const denied=query.error instanceof ActiveAlertV2RequestError&&query.error.code==='access_denied';
  useEffect(()=>{if(denied&&a.scope)removeActiveAlertV2Queries(client,a.scope);},[denied,client,a.id]);
  // Both badges observe this exact identity-scoped cache entry. Navigation and
  // background refreshes must not erase its last verified count. A denial or
  // scope change still hides/removes it; an initial error never invents zero.
  return {...a,query,value:a.allowed&&!denied?query.data:undefined};
}
export function useActiveAlertFeedV2(feed:Feed,open:boolean,status:"all"|"active"|"resolved"="all") {
  const a=useActiveAlertV2Access(),client=useQueryClient(),enabled=a.allowed&&open&&(feed!=='updates'||a.access.canReadProjects);
  const query=useInfiniteQuery({queryKey:[...(a.scope?activeAlertV2Prefix(a.scope):["dashboard","active-alerts-v2","disabled"]),feed,...(feed==='conditions'?[status]:[])],
    queryFn:async({pageParam,signal})=>{if(!enabled||a.live.current!==a.id)throw new ActiveAlertV2RequestError('access_denied');
      const result=await listActiveAlertPageV2({feed,cursor:pageParam,...(feed==='conditions'?{status}:{})},a.context,signal);
      if(signal.aborted||a.live.current!==a.id)throw new ActiveAlertV2RequestError('access_denied');return value(result);},
    initialPageParam:null as AlertCursor|null,getNextPageParam:last=>last.nextCursor??undefined,enabled,...refresh});
  const denied=query.error instanceof ActiveAlertV2RequestError&&query.error.code==='access_denied';
  useEffect(()=>{if(denied&&a.scope)removeActiveAlertV2Queries(client,a.scope);},[denied,client,a.id]);
  const seen=new Set<string>();
  // Retain already verified pages during a bounded continuation (and its retry).
  // A full refresh still hides stale rows until the authoritative read completes.
  const items=enabled&&!denied&&query.isFetchedAfterMount&&(!query.isFetching||query.isFetchingNextPage)&&(!query.isError||query.isFetchNextPageError)?
    (query.data?.pages.flatMap(p=>p.items)??[]).filter(i=>{const k=`${i.kind}:${i.id.toLowerCase()}`;if(seen.has(k))return false;seen.add(k);return i.targetType==='project'?a.access.canReadProjects:a.access.canReadWorkOrders;}):[];
  return {...a,query,items};
}
export const useActiveConditionInboxV2=(open:boolean)=>useActiveAlertFeedV2('conditions',open,'active');
export const useAlertsHistoryV2=(open:boolean)=>useActiveAlertFeedV2('history',open);
export function useUnreadUpdatesV2(open=false) {
  const count=useActiveProblemsCountV2(),feed=useActiveAlertFeedV2('updates',open);
  return {...feed,unreadCount:feed.access.canReadProjects?count.value?.unreadUpdates:undefined,countQuery:count.query};
}
export function useAcknowledgeProblemV2() {
  const a=useActiveAlertV2Access(),client=useQueryClient(),lock=useRef(false);
  const mutation=useMutation({mutationKey:[...(a.scope?activeAlertV2Prefix(a.scope):['dashboard','active-alerts-v2','disabled']),'acknowledge'],gcTime:0,
    mutationFn:async(r:{kind:ProblemKind;id:string;scope:ActiveAlertScope;scopeId:string})=>{
    if(!a.allowed||a.live.current!==r.scopeId)return alertV2Failure('access_denied');
    const result=await acknowledgeProblemV2(r.kind,r.id,a.context);
    if(a.live.current!==r.scopeId){removeActiveAlertV2Queries(client,r.scope);return alertV2Failure('access_denied');}
    if(result.ok)await invalidateActiveAlertV2Queries(client,r.scope);
    else if(result.error.code==='access_denied')removeActiveAlertV2Queries(client,r.scope);
    return result;
  },retry:false});
  async function acknowledge(kind:ProblemKind,id:string){
    if(!a.allowed||!a.scope||lock.current)return alertV2Failure('access_denied');lock.current=true;
    try{return await mutation.mutateAsync({kind,id,scope:a.scope,scopeId:a.id});}finally{lock.current=false;}
  }
  return {...a,acknowledge,isPending:mutation.isPending};
}

export function useAlertReceiptV2() {
  const a=useActiveAlertV2Access(),client=useQueryClient(),lock=useRef(false);
  const mutation=useMutation({mutationKey:[...(a.scope?activeAlertV2Prefix(a.scope):['dashboard','active-alerts-v2','disabled']),'receipt'],gcTime:0,retry:false,
    mutationFn:async(r:{action:'read'|'dismiss_update';item:AlertCondition;scope:ActiveAlertScope;scopeId:string})=>{
      if(!a.allowed||a.live.current!==r.scopeId)return alertV2Failure('access_denied');
      const result=await updateAlertReceiptV2(r.action,r.item,a.context);
      if(a.live.current!==r.scopeId){removeActiveAlertV2Queries(client,r.scope);return alertV2Failure('access_denied');}
      if(result.ok)await invalidateActiveAlertV2Queries(client,r.scope);
      else if(result.error.code==='access_denied')removeActiveAlertV2Queries(client,r.scope);
      return result;
    }});
  async function update(action:'read'|'dismiss_update',item:AlertCondition){
    if(!a.allowed||!a.scope||lock.current)return alertV2Failure('access_denied');
    lock.current=true;
    try{return await mutation.mutateAsync({action,item,scope:a.scope,scopeId:a.id});}finally{lock.current=false;}
  }
  return {...a,update,isPending:mutation.isPending};
}
