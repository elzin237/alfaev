import {useEffect,useId,useRef,useState,type KeyboardEvent} from "react";
import {Link} from "react-router";
import TestCalculationDetail from "../../test-calculator/components/TestCalculationDetail";
import {useInventoryCommitmentBreakdown} from "../hooks/useInventoryCommitmentBreakdown";
import {INVENTORY_WAREHOUSES} from "../inventoryWarehouses";
import type {CommitmentMetric} from "../services/inventoryCommitmentBreakdownService";
import type {DialogRequest} from "../services/unifiedCommitmentBreakdownService";

export const commitmentMetricLabels:Record<CommitmentMetric|"unified_committed",string>={unified_committed:"Committed",project_demand:"Project Demand",fg_project_reservation:"FG Reserved",test_hold:"Test Holds",work_order_reservation:"Draft Work Order Held"};
export interface CommitmentDialogProps {request:DialogRequest;productName:string;serialNumber:string;canRead:boolean;onClose:()=>void}
const button="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:opacity-50";
export default function InventoryCommitmentDialog({request,productName,serialNumber,canRead,onClose}:CommitmentDialogProps){
  const title=useId(),help=useId(),panel=useRef<HTMLElement>(null),close=useRef<HTMLButtonElement>(null),[selectedTest,setTest]=useState<string|null>(null);
  const data=useInventoryCommitmentBreakdown(request,canRead),value=data.value;
  const reporting=request.metric==="unified_committed";
  const scopeLabel=request.scope==="raw_customs"?"Raw Materials + Customs Warehouse":INVENTORY_WAREHOUSES.find(w=>w.id===request.warehouseId)?.label??"Warehouse";
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;close.current?.focus();return()=>{if(previous?.isConnected)previous.focus();};},[]);
  useEffect(()=>{if(!value)setTest(null);},[value]);
  function keyboard(event:KeyboardEvent){
    if(event.key==="Escape"){event.preventDefault();onClose();}
    if(event.key!=="Tab")return;
    const controls=panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]');
    const first=controls?.[0],last=controls?.[controls.length-1];if(!first||!last)return;
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-3 sm:p-6">
    <section ref={panel} role="dialog" aria-modal="true" aria-labelledby={title} aria-describedby={help} onKeyDown={keyboard}
      className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl sm:p-6">
      <header className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 id={title} className="text-xl font-bold text-zinc-900">{commitmentMetricLabels[request.metric]} breakdown</h2>
        <p className="mt-1 break-words font-semibold text-zinc-800">{productName} <span className="font-mono text-sm font-normal text-zinc-500">{serialNumber}</span></p><p className="text-sm text-zinc-500">{scopeLabel}</p></div>
        <button ref={close} type="button" aria-label="Close commitment breakdown" onClick={onClose} className={button}>Close</button></header>
      <p id={help} className="my-3 text-xs leading-5 text-zinc-600">{reporting?"Committed combines Project Demand and Work Order Held. Linked requirements may overlap.":<>{request.metric==="project_demand"?"Planning demand, not a physical stock reservation. Requirement-level Project coverage remains zero without explicit proof.":"Protected held quantities only. Uncovered requirements are not physically reserved stock."} Quantities reflect the database snapshot, not a guarantee of future availability.</>}</p>
      {!data.allowed?<p role="alert">Access to this commitment scope could not be verified.</p>:data.query.isFetching?<p role="status">Loading commitment sources…</p>:!value?<div role="alert"><p>Commitment sources unavailable. No missing quantities are assumed to be zero.</p><button type="button" onClick={data.refresh} className={`${button} mt-3`}>Retry sources</button></div>:<>
        {data.notice&&<p role="status" className="mb-3 rounded-lg bg-blue-50 p-2 text-sm text-blue-900">{data.notice}</p>}
        <dl className="mb-4 grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-center sm:grid-cols-3">
          {[[reporting?"Total Committed":"Total committed",value.metric_total??"Unavailable"],["Visible authorized quantity",value.visible_total],["Restricted quantity",value.restricted_remainder]].map(([label,quantity])=><div key={label}><dt className="text-xs text-zinc-500">{label}</dt><dd className="break-all font-semibold tabular-nums text-zinc-900">{quantity}</dd></div>)}
        </dl>
        {(value.restricted_remainder!=="0"||value.restricted_label)&&<p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Restricted sources: <span className="font-semibold tabular-nums">{value.restricted_remainder}</span>. Source identities require the corresponding module access.</p>}
        {value.items.length===0?<p role="status" className="rounded-lg bg-zinc-50 p-4 text-sm">{value.metric_total==="0"?"No commitments for this metric and scope.":"No source identities are available under your current access."}</p>:<div role="region" aria-label="Commitment sources" tabIndex={0} className="max-h-80 overflow-auto rounded-xl border border-zinc-200 focus-visible:outline-2 focus-visible:outline-red-500">
          <table className="w-full table-fixed text-sm"><thead className="sticky top-0 bg-zinc-50"><tr>{["Source","Reference","Quantity"].map(label=><th scope="col" key={label} className="px-3 py-2 text-center text-xs font-semibold uppercase text-zinc-500">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-zinc-100">{value.items.map(source=><tr key={source.key??`${source.source_type}:${source.source_id}`} className="align-top hover:bg-zinc-50"><td className="px-3 py-2 text-center text-xs">{source.source_type==="project_demand"?"Project Demand":source.source_type==="fg_project_reservation"?"Project reservation":source.source_type==="test_hold"?"Test Calculation":"Work Order"}<span className="mt-1 block text-zinc-500">{scopeLabel}</span></td>
              <td className="break-words px-3 py-2 text-center font-semibold">{source.navigation_allowed?(source.source_type==="test_hold"?<button type="button" className="rounded text-red-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-red-500" onClick={()=>setTest(source.source_id)} aria-label={`View Test Calculation ${source.label}`}>{source.label}</button>:<Link className="rounded text-red-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-red-500" onClick={onClose} to={["work_order_reservation","work_order_held","coverage_adjustment"].includes(source.source_type)?`/work-orders/${source.source_id}`:`/projects/${source.source_id}`}>{source.label}</Link>):source.label}</td>
              <td className="break-all px-3 py-2 text-center tabular-nums"><span className="font-semibold">{source.quantity}</span>{source.required_quantity!==null&&<dl className="mt-2 space-y-1 text-xs text-zinc-500">{[["Required",source.required_quantity],["Held (all warehouses)",source.held_quantity],["Uncovered (not reserved)",source.uncovered_quantity]].map(([label,q])=><div key={label}><dt>{label}</dt><dd>{q}</dd></div>)}</dl>}</td></tr>)}</tbody>
          </table></div>}
        <p className="mt-3 text-xs text-zinc-500">{reporting?<>On this page: {value.page_subtotal} · Before: {value.visible_before_quantity} · Remaining: {value.visible_after_quantity}. Totals include all pages.</>:<>This page: <span className="tabular-nums">{value.page_subtotal}</span> · Authorized quantity before: {value.visible_before_quantity} · Remaining after: {value.visible_after_quantity}. Page quantities are not the full visible total.</>}</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p title={reporting?`Last updated: ${value.as_of}`:undefined} className="break-all text-xs text-zinc-500">{reporting?"Updated":<>Verified as of <time dateTime={value.as_of}>{value.as_of}</time></>}</p><div className="flex gap-2"><button type="button" className={button} onClick={data.refresh}>Refresh / first page</button>{value.has_more&&<button type="button" className={button} onClick={data.next}>More sources</button>}</div></div>
        {selectedTest&&value.items.some(s=>s.source_id===selectedTest&&s.source_type==="test_hold"&&s.navigation_allowed)&&<div className="mt-4 min-w-0"><button type="button" className={`${button} mb-3`} onClick={()=>setTest(null)}>Close Test detail</button><TestCalculationDetail calculationId={selectedTest}/></div>}
      </>}
    </section>
  </div>;
}
