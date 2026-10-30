import {useEffect,useRef,useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useAuth} from "../../../app/auth/AuthProvider";
import {isWorkOrderCommitmentReadsEnabled} from "../../../app/config/workOrderCommitmentReadsActivation";
import {getInventoryCommitmentBreakdown,inventoryCommitmentBreakdownPrefix,type CommitmentCursor} from "../services/inventoryCommitmentBreakdownService";
import {isUnifiedCommittedEnabled} from "../../../app/config/unifiedCommittedActivation";
import {getUnifiedBreakdown,type DialogRequest,type DialogPage,type DialogResult,type UnifiedCursor} from "../services/unifiedCommitmentBreakdownService";

// One bounded page at a time: never accumulate an unbounded catalog in memory.
export function useInventoryCommitmentBreakdown(request:DialogRequest,canRead:boolean){
  const auth=useAuth(),client=useQueryClient();
  const allowed=(request.metric==="unified_committed"?isUnifiedCommittedEnabled():isWorkOrderCommitmentReadsEnabled())&&canRead&&!auth.isLoading&&!auth.error&&auth.isActive&&Boolean(auth.session?.access_token&&auth.profile?.isActive&&auth.profile.authUserId===auth.session.user.id);
  const prefix=inventoryCommitmentBreakdownPrefix(auth.session?.user.id,auth.profile?.id);
  const scope=JSON.stringify([...prefix,request.productId,request.warehouseId,request.metric,request.scope,request.limit??25,canRead,request.metric==="unified_committed"?"reporting-v2":"legacy"]);
  const [paging,setPaging]=useState<{scope:string;cursor:CommitmentCursor|UnifiedCursor|null;epoch:number;notice:string}>({scope,cursor:null,epoch:0,notice:""});
  const current=paging.scope===scope?paging:{scope,cursor:null,epoch:0,notice:""};
  const lock=useRef(false);
  const query=useQuery<DialogResult>({queryKey:[...prefix,scope,current.epoch,current.cursor],queryFn:({signal})=>allowed?
    (request.metric==="unified_committed"?getUnifiedBreakdown({...request,limit:request.limit??25,cursor:current.cursor as UnifiedCursor|null},auth.session!.access_token,signal):getInventoryCommitmentBreakdown({...request,limit:request.limit??25,cursor:current.cursor as CommitmentCursor|null},auth.session!.access_token,signal)):Promise.resolve({ok:false as const,error:{code:"access_denied" as const,message:"Commitment sources unavailable"}}),
    enabled:allowed,retry:false,gcTime:0,staleTime:0,refetchOnMount:"always",refetchOnWindowFocus:"always",refetchOnReconnect:"always"});
  function restart(notice=""){setPaging(old=>({scope,cursor:null,epoch:old.epoch+1,notice}));}
  useEffect(()=>{if(!query.isFetching)lock.current=false;
    if(allowed&&!query.isFetching&&current.cursor&&query.data?.ok===false&&query.data.error.code==="stale_cursor")restart("Sources changed. Refreshed from the first page.");
  },[allowed,query.isFetching,query.data,scope,current.cursor]);
  useEffect(()=>{
    if(!allowed)return;let live=true,queued=false;
    const unsubscribe=client.getQueryCache().subscribe(event=>{
      if(event.type!=="updated"||event.action.type!=="invalidate")return;
      const k=event.query.queryKey,profile=auth.profile?.id,actor=auth.session?.user.id;
      const relevant=(k[0]==="inventory"&&((k[1]==="products"||k[1]==="commitments")&&k[2]===profile||k[1]==="balances"&&k[3]===profile))||
        ((k[0]==="work-orders"||k[0]==="projects")&&k[2]===profile)||(k[0]==="permission"&&k[1]===actor&&k[2]===profile)||
        (["unified-committed","inventory-reservation-accounting","inventory-test-commitments","work-order-material-availability","work-order-commitment-status"].includes(String(k[0]))&&k[2]===actor&&k[3]===profile&&k[1]===prefix[1]);
      if(!relevant||queued)return;queued=true;queueMicrotask(()=>{queued=false;if(live){void client.cancelQueries({queryKey:prefix});void client.invalidateQueries({queryKey:prefix,refetchType:"none"});restart("Sources refreshed after an Inventory, Work Order or access change.");}});
    });return()=>{live=false;unsubscribe();};
  },[allowed,client,scope,auth.session?.user.id,auth.profile?.id]);
  const value:DialogPage|undefined=allowed&&query.isFetchedAfterMount&&!query.isFetching&&!query.isError&&query.data?.ok?query.data.value:undefined;
  function next(){if(!value?.has_more||!value.next_cursor||query.isFetching||lock.current)return;lock.current=true;setPaging({...current,scope,cursor:value.next_cursor});}
  return{allowed,query,value,notice:current.notice,next,refresh:()=>{if(!query.isFetching)restart("Sources refreshed from the first page.");}};
}
