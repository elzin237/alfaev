import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import StatusBadge from "../../../shared/components/StatusBadge";
import { useTestCalculationDetail } from "../hooks/useTestCalculationHistory";
import { testUuid } from "../services/testCalculationSaveService";
import { useTestConversions } from "../hooks/useTestConversions";
import TestConversionProvenance from "./TestConversionProvenance";

const warehouses:Record<string,string>={raw_materials:"Raw Materials",customs:"Customs",finished_goods:"Finished Goods"};
export default function TestCalculationDetail({calculationId}:{calculationId:string}){
  const {query,allowed,isLoading}=useTestCalculationDetail(calculationId,true);
  const conversions=useTestConversions([calculationId],allowed&&Boolean(query.data?.ok),true);
  const conversion=conversions.rows?.[0];
  if(!testUuid(calculationId))return <ErrorState title="Unable to load saved calculation" message="The calculation identity could not be verified."/>;
  if(isLoading||allowed&&query.isPending)return <LoadingState message="Loading saved calculation..."/>;
  if(!allowed)return <ErrorState title="Access denied" message="Your Test Calculator history access could not be verified."/>;
  if(query.isError||!query.data?.ok)return <ErrorState title="Unable to load saved calculation" message={query.data?.ok===false?query.data.error.message:"The saved calculation could not be loaded."} onRetry={()=>void query.refetch()}/>;
  const detail=query.data.value;
  return <section aria-label="Saved calculation detail" className="space-y-4 rounded-3xl border border-blue-200 bg-white p-4 sm:p-6">
    <div className="flex flex-wrap items-center gap-3"><h3 className="text-xl font-bold text-blue-900">{detail.name}</h3><StatusBadge label={detail.status==="active"?"Active":"Expired"} tone={detail.status==="active"?"info":"neutral"}/></div>
    {conversion&&<TestConversionProvenance conversion={conversion} detailed/>}
    {conversions.released&&!conversions.ready&&<p role="status">{conversions.error?"Conversion and effective commitment information unavailable.":"Loading conversion and effective commitments…"}<button type="button" onClick={()=>void conversions.refresh()} className="ml-2 underline">Retry conversion status</button></p>}
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      {detail.creatorFullName&&<div><dt className="font-semibold">Creator</dt><dd>{detail.creatorFullName}</dd></div>}
      <div><dt className="font-semibold">Created</dt><dd><time dateTime={detail.createdAt}>{detail.createdAt}</time></dd></div>
      <div><dt className="font-semibold">Deadline (Europe/Sarajevo)</dt><dd>{detail.deadlineDate}</dd></div>
      <div><dt className="font-semibold">Exclusive expiry</dt><dd><time dateTime={detail.expiresAt}>{detail.expiresAt}</time></dd></div>
    </dl>
    <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">{detail.status==="expired"?"Expired: saved allocations remain historical and no longer contribute active Inventory commitments.":"Saved allocations are historical results, not current warehouse availability."}</p>
    <p className="break-words text-xs text-zinc-600">Status at server snapshot: <time dateTime={detail.asOf}>{detail.asOf}</time>. Refresh to verify current status.</p>
    <div className="overflow-x-auto rounded-xl border border-blue-200"><table className="w-full min-w-[700px] text-left text-sm">
      <thead className="bg-blue-50 text-blue-950"><tr>{["Saved Product","Required","Held at Save","Missing at Save","Saved warehouse allocations",...(conversions.released?["Effective commitments"]:[])].map(label=><th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
      <tbody className="divide-y divide-zinc-100">{detail.items.map(item=><tr key={item.itemId}>
        <td className="px-4 py-3"><p className="font-semibold">{item.name}</p><p className="font-mono">{item.serialNumber}</p><p className="text-xs text-zinc-600">{item.productKind==="component"?"Component":"Finished Product"}</p></td>
        {[item.required,item.held,item.missing].map((quantity,i)=><td key={i} className="px-4 py-3 font-mono tabular-nums">{quantity}</td>)}
        <td className="px-4 py-3">{item.holds.length?<ul>{item.holds.map(hold=><li key={hold.warehouseId}>{warehouses[hold.warehouseCode]}: <span className="font-mono">{hold.quantity}</span></li>)}</ul>:"No saved warehouse holds"}</td>
        {conversions.released&&<td className="px-4 py-3 font-mono">{conversion?.items.find(current=>current.item_id===item.itemId&&current.product_id===item.productId)?.effective_quantity??"Unavailable"}</td>}
      </tr>)}</tbody>
    </table></div>
    {conversions.asOf&&<p className="text-xs text-zinc-500">Effective commitments verified at {conversions.asOf}. Originally held quantities remain unchanged.</p>}
    <button type="button" disabled={query.isFetching} onClick={()=>{void query.refetch();void conversions.refresh();}} className="rounded-xl border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-900">Refresh detail</button>
  </section>;
}
