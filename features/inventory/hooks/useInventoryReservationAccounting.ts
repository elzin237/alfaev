import {useEffect} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useAuth} from "../../../app/auth/AuthProvider";
import {isWorkOrderCommitmentReadsEnabled} from "../../../app/config/workOrderCommitmentReadsActivation";
import {getInventoryReservationAccounting,inventoryReservationAccountingPrefix} from "../services/inventoryReservationAccountingService";

// Read-only integration seam. No Inventory component mounts it before release.
export function useInventoryReservationAccounting(warehouseId:string,search:string,canRead:boolean,active:boolean|null=true,limit=100,offset=0){
  const auth=useAuth();
  const allowed=isWorkOrderCommitmentReadsEnabled()&&canRead&&!auth.isLoading&&!auth.error&&auth.isActive&&
    Boolean(auth.session?.access_token&&auth.profile?.isActive&&auth.profile.authUserId===auth.session.user.id);
  const prefix=inventoryReservationAccountingPrefix(auth.session?.user.id,auth.profile?.id);
  const query=useQuery({queryKey:[...prefix,warehouseId,search,active,limit,offset,canRead],
    queryFn:({signal})=>allowed?getInventoryReservationAccounting(warehouseId,search,auth.session!.access_token,active,limit,offset,signal):
      Promise.resolve({ok:false as const,error:{code:"access_denied" as const,message:"Commitment accounting unavailable"}}),
    enabled:allowed,retry:false,staleTime:0,refetchOnMount:"always",refetchOnWindowFocus:"always",refetchOnReconnect:"always"});
  useInventoryAccountingRefresh(allowed);
  const value=allowed&&query.isFetchedAfterMount&&!query.isFetching&&!query.isError&&query.data?.ok?query.data.value:undefined;
  return{allowed,query,value};
}

export function useInventoryAccountingRefresh(allowed:boolean,warehouseId?:string){
  const auth=useAuth(),client=useQueryClient();
  const prefix=inventoryReservationAccountingPrefix(auth.session?.user.id,auth.profile?.id);
  useEffect(()=>{
    if(!allowed)return;let live=true,queued=false;
    const unsubscribe=client.getQueryCache().subscribe(event=>{
      if(event.type!=="updated"||event.action.type!=="invalidate")return;
      const key=event.query.queryKey;
      const relevant=(key[0]==="inventory"&&(key[1]==="products"||key[1]==="commitments")&&key[2]===auth.profile?.id)||
        (key[0]==="inventory"&&key[1]==="balances"&&key[3]===auth.profile?.id)||
        (key[0]==="work-orders"&&key[2]===auth.profile?.id)||
        (key[0]==="projects"&&key[2]===auth.profile?.id)||
        (key[0]==="permission"&&key[1]===auth.session?.user.id&&key[2]===auth.profile?.id)||
        ((key[0]==="inventory-test-commitments"||key[0]==="work-order-material-availability")&&key[2]===auth.session?.user.id&&key[3]===auth.profile?.id);
      if(!relevant||queued)return;queued=true;queueMicrotask(()=>{queued=false;if(live)void client.invalidateQueries({queryKey:warehouseId?[...prefix,"table",warehouseId]:prefix});});
    });return()=>{live=false;unsubscribe();};
  },[allowed,client,auth.session?.user.id,auth.profile?.id,warehouseId]);
}
