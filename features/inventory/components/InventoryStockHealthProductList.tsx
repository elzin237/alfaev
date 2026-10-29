import { useState, type ComponentProps } from "react";
import { isInventoryStockHealthEnabled } from "../../../app/config/inventoryStockHealthActivation";
import InventoryTestProductList from "./InventoryTestProductList";
import { useInventoryStockHealth } from "../hooks/useInventoryStockHealth";
import { stockHealthStatuses, type StockHealthStatus } from "../services/inventoryStockHealthService";

type Props=ComponentProps<typeof InventoryTestProductList>;
function ActivatedList(props:Props){
  const [status,setStatus]=useState<StockHealthStatus|null>(null);
  const {query,rows,allowed}=useInventoryStockHealth(props.warehouseId,props.search,status,props.authorizedWarehouseIds.includes(props.warehouseId));
  const mapped=rows?new Map(rows.map(row=>[row.productId,row])):undefined;
  const products=status&&mapped?props.products.filter(p=>mapped.has(p.id)):props.products;
  const missing=rows&&status===null&&props.products.some(p=>!mapped?.has(p.id));
  return <div className="space-y-3">
    <label className="inline-flex items-center gap-3 text-sm font-medium">Stock Health
      <select className="rounded-lg border border-zinc-300 bg-white px-3 py-2" value={status??"ALL"} onChange={event=>setStatus(event.target.value==="ALL"?null:event.target.value as StockHealthStatus)}>
        <option value="ALL">All</option>{stockHealthStatuses.map(s=><option key={s} value={s}>{{HEALTHY:"Healthy",LOW_STOCK:"Low Stock",OUT_OF_STOCK:"Out of Stock",NOT_CONFIGURED:"Not Configured"}[s]}</option>)}
      </select>
    </label>
    {allowed&&<button type="button" className="ml-3 text-sm underline" disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh stock health</button>}
    {(!rows||missing)&&<div role={query.isFetching?"status":"alert"} className="text-sm text-zinc-700">
      {query.isFetching?"Loading stock health…":query.data?.ok===false?query.data.error.message:"Stock health is unavailable. Physical Inventory remains unchanged; missing minimums are not assumed to be zero."}
    </div>}
    {status&&!rows?<p>Filtered results require a successful health read. Select All to view physical Inventory.</p>:products.length===0?
      <p role="status">No Products match this stock health filter.</p>:
      <InventoryTestProductList {...props} products={products} showStockHealth stockHealth={mapped}/>
    }
  </div>;
}
export default function InventoryStockHealthProductList(props:Props){
  return isInventoryStockHealthEnabled()?<ActivatedList {...props}/>:<InventoryTestProductList {...props}/>;
}
