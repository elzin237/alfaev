import { useId, useRef, useState, type ComponentProps } from "react";
import { isInventoryStockHealthEnabled } from "../../../app/config/inventoryStockHealthActivation";
import InventoryTestProductList from "./InventoryTestProductList";
import { useInventoryStockHealth } from "../hooks/useInventoryStockHealth";
import { validStockMinimum, stockHealthStatuses, type InventoryStockHealth, type StockHealthResult, type StockHealthStatus, type StockMinimumConfiguration } from "../services/inventoryStockHealthService";

type Props=ComponentProps<typeof InventoryTestProductList>;
function MinimumEditor({row,canEdit,save}:{row:InventoryStockHealth;canEdit:boolean;save:(id:string,minimum:string|null,version:string|null)=>Promise<StockHealthResult<StockMinimumConfiguration>>}){
  const [editing,setEditing]=useState(false),[value,setValue]=useState(row.minimumQuantity??""),[error,setError]=useState<string|null>(null),[pending,setPending]=useState(false);
  const lock=useRef(false);
  const errorId=useId();
  async function submit(minimum:string|null){
    if(lock.current||!canEdit)return;
    if(minimum!==null&&!validStockMinimum(minimum)){setError("Enter a positive whole number up to 9223372036854775807.");return;}
    lock.current=true;setPending(true);setError(null);
    try{const result=await save(row.productId,minimum,row.version);if(result.ok)setEditing(false);else setError(result.error.message);}
    catch{setError("The outcome could not be verified. Refresh and review the minimum before trying again.");}
    finally{lock.current=false;setPending(false);}
  }
  if(!editing||!canEdit||!row.isActive)return <div className="space-y-1"><span>{row.minimumQuantity??"Not Configured"}</span>
    {canEdit&&row.isActive&&<button type="button" className="block text-sm text-red-700 underline" onClick={()=>{setValue(row.minimumQuantity??"");setEditing(true);}}
      aria-label={`Configure minimum for ${row.productName}`}>Configure</button>}</div>;
  return <form className="min-w-60 space-y-2" onSubmit={event=>{event.preventDefault();void submit(value);}}>
    <label className="block text-sm">Minimum for {row.productName}<input autoFocus type="text" inputMode="numeric" value={value} disabled={pending} aria-invalid={Boolean(error)} aria-describedby={error?errorId:undefined}
      onChange={event=>{setValue(event.target.value);setError(null);}} className="mt-1 block w-full rounded-lg border border-zinc-300 px-2 py-1" /></label>
    <p className="text-xs text-zinc-500">Current: {row.minimumQuantity??"Not Configured"} · Version: {row.version??"New"}</p>
    {error&&<p id={errorId} role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex gap-3 text-sm"><button type="submit" disabled={pending}>Save minimum</button>
      <button type="button" disabled={pending} onClick={()=>void submit(null)}>Clear minimum</button>
      <button type="button" disabled={pending} onClick={()=>{setEditing(false);setError(null);}}>Cancel</button></div>
  </form>;
}
function ActivatedList(props:Props){
  const [status,setStatus]=useState<StockHealthStatus|null>(null);
  const {query,rows,allowed,canEdit,save}=useInventoryStockHealth(props.warehouseId,props.search,status,props.authorizedWarehouseIds.includes(props.warehouseId));
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
      <InventoryTestProductList {...props} products={products} showStockHealth stockHealth={mapped}
        renderMinimum={(product,row)=>row?<MinimumEditor key={`${product.id}:${row.version??"new"}`} row={row} canEdit={canEdit&&product.isActive} save={save}/>:"Unavailable"}/>
    }
  </div>;
}
export default function InventoryStockHealthProductList(props:Props){
  return isInventoryStockHealthEnabled()?<ActivatedList {...props}/>:<InventoryTestProductList {...props}/>;
}
