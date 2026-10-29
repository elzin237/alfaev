import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import { isInventoryStockHealthEnabled } from "../../../app/config/inventoryStockHealthActivation";
import { dashboardStockHealthPrefix, stockHealthPrefix } from "../stockHealthQueryKeys";
import { getInventoryStockHealth, setInventoryStockMinimum, stockHealthFailure, type InventoryStockHealth, type StockHealthStatus } from "../services/inventoryStockHealthService";

export function useInventoryStockHealth(warehouseId: string,search: string,status: StockHealthStatus|null,canRead: boolean){
  const auth=useAuth(),client=useQueryClient(),busy=useRef(false);
  const [visible,setVisible]=useState(!document.hidden);
  useEffect(()=>{const changed=()=>setVisible(!document.hidden);document.addEventListener("visibilitychange",changed);
    return ()=>document.removeEventListener("visibilitychange",changed);},[]);
  const identity=`${auth.session?.user.id}:${auth.profile?.id}:${warehouseId}`;
  const current=useRef(identity);current.current=identity;
  const allowed=isInventoryStockHealthEnabled()&&canRead&&!auth.isLoading&&!auth.error&&auth.isActive&&
    Boolean(auth.session?.access_token&&auth.profile?.isActive&&auth.profile.authUserId===auth.session.user.id);
  const prefix=stockHealthPrefix(auth.session?.user.id,auth.profile?.id);
  const dashboardPrefix=dashboardStockHealthPrefix(auth.session?.user.id,auth.profile?.id);
  const permission=useQuery({queryKey:permissionQueryKey(auth.session?.user.id,auth.profile?.id,"inventory.products.edit"),
    queryFn:()=>hasPermission("inventory.products.edit"),enabled:allowed&&!auth.isAdmin,staleTime:30_000});
  const canEdit=allowed&&(auth.isAdmin||(permission.data?.ok===true&&permission.data.value));
  const query=useQuery({queryKey:[...prefix,warehouseId,search,status],
    queryFn:({signal})=>allowed&&!document.hidden?getInventoryStockHealth(warehouseId,search,status,auth.session!.access_token,signal):Promise.resolve(stockHealthFailure<InventoryStockHealth[]>()),
    enabled:allowed&&visible,retry:false,staleTime:0,refetchOnMount:"always",refetchOnWindowFocus:"always"});
  // Stock operations already invalidate the Product list. Reuse that signal,
  // including existing production/fulfillment paths, without changing accounting.
  useEffect(()=>{
    if(!allowed)return;
    let queued=false,live=true;
    const unsubscribe=client.getQueryCache().subscribe(event=>{
      if(event.type!=="updated"||event.action.type!=="invalidate")return;
      const key=event.query.queryKey;
      if(key[0]==="inventory"&&key[1]==="products"&&key[2]===auth.profile?.id&&!queued){
        queued=true;queueMicrotask(()=>{queued=false;if(!live)return;
          void client.invalidateQueries({queryKey:prefix});void client.invalidateQueries({queryKey:dashboardPrefix});});
      }
    });
    return ()=>{live=false;unsubscribe();};
  },[allowed,client,auth.session?.user.id,auth.profile?.id]);
  const rows=allowed&&visible&&!document.hidden&&query.isFetchedAfterMount&&!query.isFetching&&!query.isError&&query.data?.ok?query.data.value:undefined;
  async function save(productId: string,minimum: string|null,version: string|null){
    if(!canEdit||busy.current)return stockHealthFailure<never>("access_denied");
    busy.current=true;const startedIdentity=identity;
    try{
      const result=await setInventoryStockMinimum(productId,warehouseId,minimum,version,auth.session!.access_token);
      // Invalidate the initiating identity only, even if the account switched.
      if(result.ok)await Promise.all([client.invalidateQueries({queryKey:prefix}),client.invalidateQueries({queryKey:dashboardPrefix})]);
      return current.current===startedIdentity?result:stockHealthFailure<never>("access_denied");
    }finally{busy.current=false;}
  }
  return {query,rows,allowed,canEdit,save};
}
