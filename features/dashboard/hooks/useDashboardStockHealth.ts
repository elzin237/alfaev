import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "../../../app/auth/AuthProvider";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { hasPermission } from "../../../app/auth/permissionService";
import { isInventoryStockHealthEnabled } from "../../../app/config/inventoryStockHealthActivation";
import { INVENTORY_WAREHOUSES } from "../../inventory/inventoryWarehouses";
import { dashboardStockHealthPrefix } from "../../inventory/stockHealthQueryKeys";
import { dashboardHealthFailure, getDashboardStockHealth } from "../services/dashboardStockHealthService";

export function useDashboardStockHealth(){
  const auth=useAuth(),client=useQueryClient(),[visible,setVisible]=useState(!document.hidden);
  const identity=isInventoryStockHealthEnabled()&&!auth.error&&!auth.isLoading&&auth.isActive&&
    Boolean(auth.session?.access_token&&auth.profile?.isActive&&auth.profile.authUserId===auth.session.user.id);
  const keys=["dashboard.view",...INVENTORY_WAREHOUSES.map(w=>w.viewPermission)] as const;
  const permissions=useQueries({queries:keys.map(key=>({queryKey:permissionQueryKey(auth.session?.user.id,auth.profile?.id,key),
    queryFn:()=>hasPermission(key),enabled:identity&&!auth.isAdmin,staleTime:30_000}))});
  const pending=identity&&!auth.isAdmin&&permissions.some(q=>q.isPending);
  const permissionError=identity&&!auth.isAdmin&&permissions.some(q=>q.isError||q.data?.ok===false);
  const dashboardPermission=permissions[0]?.data;
  const dashboardAccess=identity&&(auth.isAdmin||(dashboardPermission?.ok===true&&dashboardPermission.value));
  const warehouseIds=INVENTORY_WAREHOUSES.filter((_,i)=>{const result=permissions[i+1]?.data;return auth.isAdmin||(result?.ok===true&&result.value);}).map(w=>w.id);
  const allowed=Boolean(dashboardAccess&&!pending&&!permissionError&&warehouseIds.length);
  const prefix=dashboardStockHealthPrefix(auth.session?.user.id,auth.profile?.id);
  const query=useQuery({queryKey:[...prefix,warehouseIds.join(","),10],
    queryFn:({signal})=>allowed&&!document.hidden?getDashboardStockHealth(auth.session!.access_token,signal):Promise.resolve(dashboardHealthFailure(true)),
    enabled:allowed&&visible,retry:false,staleTime:0,refetchOnMount:"always",refetchOnWindowFocus:"always",refetchOnReconnect:"always"});
  useEffect(()=>{const changed=()=>setVisible(!document.hidden);document.addEventListener("visibilitychange",changed);return()=>document.removeEventListener("visibilitychange",changed);},[]);
  useEffect(()=>{
    if(!allowed)return;let queued=false,live=true;
    const unsubscribe=client.getQueryCache().subscribe(event=>{
      if(event.type!=="updated"||event.action.type!=="invalidate")return;
      const key=event.query.queryKey;
      if(key[0]==="inventory"&&key[1]==="products"&&key[2]===auth.profile?.id&&!queued){queued=true;queueMicrotask(()=>{
        queued=false;if(live)void client.invalidateQueries({queryKey:prefix});});}
    });return()=>{live=false;unsubscribe();};
  },[allowed,client,auth.session?.user.id,auth.profile?.id]);
  const value=query.data?.ok?query.data.value:undefined;
  const scopeMatches=value?.warehouses.every(w=>warehouseIds.includes(w.warehouseId));
  const data=allowed&&visible&&!document.hidden&&query.isFetchedAfterMount&&!query.isFetching&&!query.isError&&scopeMatches?value:undefined;
  const denied=(!identity&&!auth.isLoading)||(!pending&&!permissionError&&!allowed)||
    (query.data?.ok===false&&query.data.error.code==="access_denied")||(data&&data.warehouses.length===0);
  const status=auth.isLoading?"loading":denied?"denied":permissionError||query.isError||query.data?.ok===false||value&&!scopeMatches?"error":data?"ready":"loading";
  return {query,data,status} as const;
}
