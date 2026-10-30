import { getInventoryReservationAccounting, type AccountingResult, type InventoryReservationAccountingRow } from "./inventoryReservationAccountingService";

export interface InventoryHeldRows {
  items: InventoryReservationAccountingRow[];
  // Each bounded page is authoritative at its own database timestamp, not one global snapshot.
  observations: string[];
}

// Match the existing Inventory catalog's fail-closed 1,000-Product boundary.
export async function getInventoryHeldRows(warehouseId:string,search:string,token:string,signal?:AbortSignal):Promise<AccountingResult<InventoryHeldRows>> {
  const items:InventoryReservationAccountingRow[]=[],observations:string[]=[],seen=new Set<string>();
  for(let offset=0;offset<1000;offset+=200){
    const result=await getInventoryReservationAccounting(warehouseId,search,token,null,200,offset,signal);
    if(!result.ok)return result;
    for(const row of result.value.items){
      if(seen.has(row.productId))return {ok:false,error:{code:"unavailable",message:"Inventory changed during accounting pagination. Refresh to retry."}};
      seen.add(row.productId);items.push(row);
    }
    observations.push(result.value.asOf);
    if(!result.value.hasMore)return {ok:true,value:{items,observations}};
  }
  return {ok:false,error:{code:"unavailable",message:"Complete commitment accounting exceeds the 1,000-Product safety limit. Narrow the search."}};
}
