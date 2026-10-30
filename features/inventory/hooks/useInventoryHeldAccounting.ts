import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { isWorkOrderCommitmentReadsEnabled } from "../../../app/config/workOrderCommitmentReadsActivation";
import { INVENTORY_WAREHOUSES } from "../inventoryWarehouses";
import { inventoryReservationAccountingPrefix } from "../services/inventoryReservationAccountingService";
import { getInventoryHeldRows } from "../services/inventoryHeldRowsService";
import { useInventoryAccountingRefresh } from "./useInventoryReservationAccounting";

export function useInventoryHeldAccounting(warehouseId:string,search:string,authorizedWarehouseIds:readonly string[],requested=true){
  const auth=useAuth();
  const allowed=isWorkOrderCommitmentReadsEnabled()&&requested&&authorizedWarehouseIds.includes(warehouseId)&&
    (warehouseId!==INVENTORY_WAREHOUSES[0]!.id||authorizedWarehouseIds.includes(INVENTORY_WAREHOUSES[2]!.id))&&
    !auth.isLoading&&!auth.error&&auth.isActive&&Boolean(auth.session?.access_token&&auth.profile?.isActive&&auth.profile.authUserId===auth.session.user.id);
  const query=useQuery({
    queryKey:[...inventoryReservationAccountingPrefix(auth.session?.user.id,auth.profile?.id),"table",warehouseId,search,[...authorizedWarehouseIds].sort(),allowed],
    queryFn:({signal})=>allowed?getInventoryHeldRows(warehouseId,search,auth.session!.access_token,signal):Promise.resolve({ok:false as const,error:{code:"access_denied" as const,message:"Commitment accounting unavailable"}}),
    enabled:allowed,retry:false,staleTime:0,refetchOnMount:"always",refetchOnWindowFocus:"always",refetchOnReconnect:"always",
  });
  useInventoryAccountingRefresh(allowed,warehouseId);
  const value=allowed&&query.isFetchedAfterMount&&!query.isFetching&&!query.isError&&query.data?.ok?query.data.value:undefined;
  return {allowed,query,rows:value?new Map(value.items.map(row=>[row.productId,row])):undefined};
}
