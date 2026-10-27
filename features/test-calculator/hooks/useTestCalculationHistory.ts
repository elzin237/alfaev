import { useInfiniteQuery,useQuery } from "@tanstack/react-query";
import { useEffect,useRef } from "react";
import { useAuth } from "../../../app/auth/AuthProvider";
import { testCalculationHistoryPrefix } from "../services/testCalculationRecoveryStore";
import { testUuid } from "../services/testCalculationSaveService";
import { listTestCalculations,getTestCalculation,historyTimestampMicros,type TestHistoryCursor,type TestHistoryResult,type TestHistoryPage,type TestHistoryHeader } from "../services/testCalculationHistoryService";

// One-shot refresh from the server's remaining lifetime, never client-clock status.
function useExpiryRefresh(rows:TestHistoryHeader[],scope:string,observed:Map<string,number>,fetching:boolean,refresh:()=>unknown){
  useEffect(()=>{
    if(fetching)return;
    let delay=Infinity;
    for(const row of rows){const received=observed.get(`${scope}:${row.asOf}`);if(row.status!=="active"||received===undefined)continue;
      const expiry=historyTimestampMicros(row.expiresAt),asOf=historyTimestampMicros(row.asOf);if(expiry===null||asOf===null)continue;
      const millis=(expiry-asOf+999n)/1000n;
      const bounded=Number(millis>2147483000n?2147483000n:millis);
      delay=Math.min(delay,Math.max(1,bounded-(performance.now()-received)));
    }
    if(!Number.isFinite(delay))return;const timer=setTimeout(()=>{void refresh();},delay);
    return()=>clearTimeout(timer);
  },[rows,scope,observed,fetching,refresh]);
}

function useHistoryAccess(enabled:boolean){
  const {session,profile,isActive,isLoading,error}=useAuth();
  const allowed=enabled&&!isLoading&&!error&&isActive&&Boolean(session?.access_token&&profile?.isActive&&profile.authUserId===session.user.id&&testUuid(session.user.id)&&testUuid(profile.id));
  const identity=allowed?{authUserId:session!.user.id,profileId:profile!.id}:null;
  const prefix=identity?testCalculationHistoryPrefix(identity):["test-calculation-history","disabled",session?.user.id,profile?.id] as const;
  return {allowed,isLoading,token:session?.access_token,prefix,scope:JSON.stringify(prefix)};
}
const denied=<T>():TestHistoryResult<T>=>({ok:false,error:{code:"access_denied",message:"Your Test Calculator history access could not be verified."}});
export function useTestCalculationHistory(enabledAfterActivation=false,pageSize=20){
  const access=useHistoryAccess(enabledAfterActivation);
  const observed=useRef(new Map<string,number>());
  const query=useInfiniteQuery({
    queryKey:[...access.prefix,"list",pageSize],initialPageParam:null as TestHistoryCursor|null,
    queryFn:async({pageParam,signal})=>{const result=access.allowed?await listTestCalculations(pageSize,pageParam,access.token!,signal):denied<TestHistoryPage>();
      if(result.ok)for(const row of result.value.rows)observed.current.set(`${access.scope}:${row.asOf}`,performance.now());return result;},
    getNextPageParam:last=>last.ok?last.value.nextCursor??undefined:undefined,
    enabled:access.allowed,retry:false,staleTime:0,
  });
  useExpiryRefresh(access.allowed?query.data?.pages.flatMap(page=>page.ok?page.value.rows:[])??[]:[],access.scope,observed.current,query.isFetching||query.isError||Boolean(query.data?.pages.some(page=>!page.ok)),query.refetch);
  return {...access,query:{...query,data:access.allowed?query.data:undefined}};
}
export function useTestCalculationDetail(calculationId:string|null,enabledAfterActivation=false){
  const access=useHistoryAccess(enabledAfterActivation),enabled=access.allowed&&testUuid(calculationId);
  const observed=useRef(new Map<string,number>());
  const query=useQuery({queryKey:[...access.prefix,"detail",calculationId],
    queryFn:async({signal})=>{const result=enabled?await getTestCalculation(calculationId!,access.token!,signal):denied<never>();
      if(result.ok)observed.current.set(`${access.scope}:${result.value.asOf}`,performance.now());return result;},
    enabled,retry:false,staleTime:0,
  });
  useExpiryRefresh(enabled&&query.data?.ok?[query.data.value]:[],access.scope,observed.current,query.isFetching||query.isError,query.refetch);
  return {...access,query:{...query,data:enabled?query.data:undefined}};
}
