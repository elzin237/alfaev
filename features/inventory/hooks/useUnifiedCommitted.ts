import {useEffect} from "react";
import {useQuery,useQueryClient,type QueryClient} from "@tanstack/react-query";
import {useAuth} from "../../../app/auth/AuthProvider";
import {isUnifiedCommittedEnabled} from "../../../app/config/unifiedCommittedActivation";
import {INVENTORY_WAREHOUSES} from "../inventoryWarehouses";
import {getUnifiedCommitted,unifiedCommittedPrefix} from "../services/unifiedCommittedService";
import {boundedCommittedRead} from "../services/boundedCommittedReads";
const subscriptions=new WeakMap<QueryClient,Map<string,{users:number;stop:()=>void}>>();
function observeRefresh(client:QueryClient,prefix:ReturnType<typeof unifiedCommittedPrefix>){
  let scopes=subscriptions.get(client);if(!scopes){scopes=new Map();subscriptions.set(client,scopes);}
  const id=JSON.stringify(prefix),existing=scopes.get(id);
  if(existing){existing.users++;return()=>{if(--existing.users===0){existing.stop();scopes.delete(id);}};}
  let live=true,queued=false;
  const unsubscribe=client.getQueryCache().subscribe(event=>{
    if(event.type!=="updated"||event.action.type!=="invalidate")return;
    const k=event.query.queryKey,actor=prefix[2],profile=prefix[3];
    const relevant=(k[0]==="inventory"&&((k[1]==="products"||k[1]==="commitments")&&k[2]===profile||k[1]==="balances"&&k[3]===profile))||
      ((k[0]==="work-orders"||k[0]==="projects")&&k[2]===profile)||(k[0]==="permission"&&k[1]===actor&&k[2]===profile)||
      (["inventory-reservation-accounting","work-order-commitment-status"].includes(String(k[0]))&&k[1]===prefix[1]&&k[2]===actor&&k[3]===profile);
    if(!relevant||queued)return;queued=true;queueMicrotask(()=>{queued=false;if(live)void client.invalidateQueries({queryKey:prefix});});
  });
  const entry={users:1,stop:()=>{live=false;unsubscribe();}};scopes.set(id,entry);
  return()=>{if(--entry.users===0){entry.stop();scopes.delete(id);}};
}
export function useUnifiedCommitted(productId:string,warehouseId:string,authorizedWarehouseIds:readonly string[]){
  const auth=useAuth(),client=useQueryClient();
  const allowed=isUnifiedCommittedEnabled()&&!auth.isLoading&&!auth.error&&auth.isActive&&Boolean(auth.session?.access_token&&auth.profile?.isActive&&auth.profile.authUserId===auth.session.user.id)&&
    (auth.isAdmin||authorizedWarehouseIds.includes(warehouseId)&&(warehouseId!==INVENTORY_WAREHOUSES[0]!.id||authorizedWarehouseIds.includes(INVENTORY_WAREHOUSES[2]!.id)));
  const prefix=unifiedCommittedPrefix(auth.session?.user.id,auth.profile?.id);
  const query=useQuery({queryKey:[...prefix,"reporting-v2",productId,warehouseId,[...authorizedWarehouseIds].sort(),auth.isAdmin,allowed],
    queryFn:({signal})=>allowed?boundedCommittedRead(()=>getUnifiedCommitted(productId,warehouseId,auth.session!.access_token,signal),signal):Promise.resolve({ok:false as const,error:{code:"access_denied" as const,message:"Unified commitments unavailable"}}),enabled:allowed,retry:false,
    staleTime:0,refetchOnMount:"always",refetchOnWindowFocus:"always",refetchOnReconnect:"always"});
  useEffect(()=>{
    if(allowed)return observeRefresh(client,prefix);
  },[allowed,client,auth.session?.user.id,auth.profile?.id]);
  const value=allowed&&query.isFetchedAfterMount&&!query.isFetching&&!query.isError&&query.data?.ok?query.data.value:undefined;
  return{allowed,query,value,identityScope:JSON.stringify([...prefix,auth.isAdmin,allowed,[...authorizedWarehouseIds].sort()])};
}
