import {useEffect,useId,useRef,useState,type KeyboardEvent} from "react";
import {createPortal} from "react-dom";
import {useQuery} from "@tanstack/react-query";
import {useAuth} from "../../../app/auth/AuthProvider";
import {isUnifiedCommittedEnabled} from "../../../app/config/unifiedCommittedActivation";
import {useAttributionWorkflow} from "../../inventory/hooks/useAttributionWorkflow";
import {getAttributionContext,type AttributionContext} from "../../inventory/services/materialAttributionContextService";
import {unifiedCommittedPrefix} from "../../inventory/services/unifiedCommittedService";
import type {AttributionIntent} from "../../inventory/services/materialAttributionRecoveryStore";
import {INVENTORY_WAREHOUSES} from "../../inventory/inventoryWarehouses";
import {testUuid} from "../../test-calculator/services/testCalculationSaveService";
interface Props {workOrderId:string;materials:readonly {productId:string;productName:string;serialNumber:string}[];disabled?:boolean}
const button="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:opacity-50";
const input="mt-1 block h-10 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 disabled:bg-zinc-100";
const label=(id:string)=>INVENTORY_WAREHOUSES.find(w=>w.id===id)?.label??"Warehouse";
type Workflow=ReturnType<typeof useAttributionWorkflow>;
function AttributionForm({context:c,workflow,onRefresh}:{context:AttributionContext;workflow:Workflow;onRefresh:()=>void}){
  const [mode,setMode]=useState<"coverage"|"independent"|"unknown">("independent"),[requirementId,setRequirement]=useState(""),[warehouseId,setWarehouse]=useState(""),[unknownTarget,setUnknownTarget]=useState("independent"),[quantity,setQuantity]=useState(""),[confirmed,setConfirmed]=useState(false);
  const requirement=c.requirements.find(r=>r.id===requirementId),allocation=requirement?.allocations.find(a=>a.warehouse_id===warehouseId);
  const coverageTargets=c.requirements.flatMap(r=>r.allocations.filter(a=>a.quantity!=="0").map(a=>({key:`${r.id}:${a.warehouse_id}`,requirement:r,allocation:a})));
  const unknownCoverage=coverageTargets.find(t=>t.key===unknownTarget);
  const limit=mode==="independent"?c.max_independent:mode==="coverage"?allocation?.max_quantity??"0":unknownTarget==="independent"?c.independent:unknownCoverage?.allocation.quantity??"0";
  const valid=/^[1-9][0-9]{0,18}$/.test(quantity)&&BigInt(quantity)<=9223372036854775807n&&BigInt(quantity)<=BigInt(limit);
  const error=quantity&&!valid?`Enter a positive whole quantity no greater than ${limit}.`:null;
  function submit(){
    if(!valid||!confirmed||workflow.busy||workflow.pending||!workflow.ready)return;
    const targetRequirement=mode==="coverage"?requirement:unknownCoverage?.requirement;
    const targetAllocation=mode==="coverage"?allocation:unknownCoverage?.allocation;
    const independent=mode==="independent"||mode==="unknown"&&unknownTarget==="independent";
    if(!independent&&(!targetRequirement||!targetAllocation))return;
    const intent:AttributionIntent={workOrderId:c.work_order_id,productId:c.product_id,classification:mode,request:{requestId:crypto.randomUUID(),kind:independent?"independent":"coverage",stateId:c.state_id,materialVersion:c.material_version,
      quantity:mode==="unknown"?(BigInt(limit)-BigInt(quantity)).toString():quantity,supersedesRequestId:independent?c.independence_request_id:targetAllocation!.request_id,
      ...(independent?{}:{requirementId:targetRequirement!.id,requirementUpdatedAt:targetRequirement!.revision,warehouseId:targetAllocation!.warehouse_id})}};
    setConfirmed(false);void workflow.submit(intent,true);
  }
  return <form className="mt-4 space-y-3" onSubmit={e=>{e.preventDefault();submit();}}>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">Classification<select className={input} value={mode} onChange={e=>{setMode(e.target.value as typeof mode);setQuantity("");setConfirmed(false);}}>
      <option value="independent">Confirmed independent demand</option><option value="coverage">Covered by Project requirement</option><option value="unknown">Return attribution to Unknown</option></select></label>
      <label className="text-sm font-semibold">{mode==="unknown"?"Quantity to return to Unknown":"New total attributed quantity"}<input className={input} inputMode="numeric" value={quantity} aria-invalid={Boolean(error)} aria-describedby="attribution-quantity-help" onChange={e=>{setQuantity(e.target.value);setConfirmed(false);}}/></label></div>
    {mode==="coverage"&&<div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">Project requirement<select className={input} value={requirementId} onChange={e=>{setRequirement(e.target.value);setWarehouse("");setQuantity("");setConfirmed(false);}}><option value="">Select an exact requirement</option>{c.requirements.map(r=><option key={r.id} value={r.id} disabled={r.outstanding===null}>{r.project_name} / {r.group_name} · {r.outstanding===null?"Outstanding Unknown":`Outstanding ${r.outstanding}`}</option>)}</select></label>
      <label className="text-sm font-semibold">Held warehouse<select className={input} value={warehouseId} onChange={e=>{setWarehouse(e.target.value);setQuantity("");setConfirmed(false);}}><option value="">Select a warehouse allocation</option>{requirement?.allocations.map(a=><option key={a.warehouse_id} value={a.warehouse_id}>{label(a.warehouse_id)} · current {a.quantity} · maximum {a.max_quantity}</option>)}</select></label></div>}
    {mode==="coverage"&&requirement&&<p className="break-all text-xs text-zinc-500">Requirement {requirement.id} · revision <time dateTime={requirement.revision}>{requirement.revision}</time></p>}
    {mode==="unknown"&&<label className="block text-sm font-semibold">Existing attribution to withdraw<select className={input} value={unknownTarget} onChange={e=>{setUnknownTarget(e.target.value);setQuantity("");setConfirmed(false);}}><option value="independent" disabled={c.independent==="0"}>Independent demand · {c.independent}</option>{coverageTargets.map(t=><option key={t.key} value={t.key}>{t.requirement.project_name} / {t.requirement.group_name} · {label(t.allocation.warehouse_id)} · {t.allocation.quantity}</option>)}</select></label>}
    <p id="attribution-quantity-help" className="text-xs text-zinc-500">Current maximum: {limit}. {mode==="unknown"?"Withdraws only the selected declaration's quantity; history is retained.":"Replaces the selected attribution total; this is not an additive increment."} Partial material-wide independence may still leave warehouse overlap Unknown.</p>
    {mode==="unknown"&&limit==="0"&&<p className="text-xs text-zinc-500">There is no active quantity in this selection to withdraw. Already-unattributed quantities remain Unknown without another write.</p>}
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I explicitly confirm this exact material attribution. Physical stock and reservations will not change.</label>
    <div className="flex flex-wrap gap-2"><button className={`${button} border-red-300 text-red-700`} type="submit" disabled={!valid||!confirmed||!workflow.ready||workflow.busy||Boolean(workflow.pending)}>{workflow.busy?"Saving attribution…":"Confirm attribution"}</button><button className={button} type="button" onClick={onRefresh} disabled={workflow.busy}>Reload current revisions</button></div>
  </form>;
}
function AttributionDialog({workOrderId,materials,onClose}:{workOrderId:string;materials:Props["materials"];onClose:()=>void}){
  const auth=useAuth(),workflow=useAttributionWorkflow(),title=useId(),panel=useRef<HTMLElement>(null),close=useRef<HTMLButtonElement>(null);
  const choices=[...new Map(materials.map(m=>[m.productId,m])).values()];
  const [product,setProduct]=useState(choices[0]?.productId??""),[after,setAfter]=useState<string|null>(null);
  const query=useQuery({queryKey:[...unifiedCommittedPrefix(auth.session?.user.id,auth.profile?.id),"admin-context",workOrderId,product,after],queryFn:({signal})=>workflow.allowed?getAttributionContext(workOrderId,product,auth.session!.access_token,after,signal):Promise.resolve(null),enabled:workflow.allowed&&Boolean(product),retry:false,staleTime:0,refetchOnMount:"always",refetchOnWindowFocus:"always",refetchOnReconnect:"always"});
  const c=workflow.allowed&&!query.isFetching&&!query.isError&&query.isFetchedAfterMount?query.data:null;
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;close.current?.focus();return()=>{if(previous?.isConnected)previous.focus();};},[]);
  function keyboard(e:KeyboardEvent){if(e.key==="Escape"&&!workflow.busy){e.preventDefault();onClose();}if(e.key!=="Tab")return;const controls=panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]');const first=controls?.[0],last=controls?.[controls.length-1];if(!first||!last)return;if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-3 sm:p-6"><section ref={panel} role="dialog" aria-modal="true" aria-labelledby={title} onKeyDown={keyboard} className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl sm:p-6">
    <header className="flex items-start justify-between gap-3"><div><h2 id={title} className="text-lg font-bold">Material attribution</h2><p className="mt-1 text-xs text-zinc-500">Admin declaration only. No physical stock, reservation or availability changes.</p></div><button ref={close} className={button} type="button" disabled={workflow.busy} onClick={onClose}>Close</button></header>
    {workflow.error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{workflow.error}</p>}
    {workflow.saved&&<p role="status" className="mt-3 text-sm text-emerald-700">Attribution confirmed.</p>}
    {workflow.pending?<div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"><p>Original request {workflow.pending.intent.request.requestId} remains in recovery for Work Order {workflow.pending.intent.workOrderId}. No replacement request is allowed.</p><p className="mt-1">Original classification: {workflow.pending.intent.classification}; replacement quantity: {workflow.pending.intent.request.quantity}.</p><button className={`${button} mt-3`} type="button" disabled={workflow.busy||!workflow.ready} onClick={()=>void workflow.recover()}>Retry original request</button></div>:<>
      <label className="mt-4 block text-sm font-semibold">Saved material component<select className={input} value={product} disabled={workflow.busy||choices.length===0} onChange={e=>{setProduct(e.target.value);setAfter(null);}}>{choices.map(m=><option key={m.productId} value={m.productId}>{m.productName} · {m.serialNumber}</option>)}</select></label>
      {choices.length===0?<p role="status" className="mt-3 text-sm">No saved materials to attribute. Existing original requests can still be recovered here.</p>:query.isFetching?<p role="status" className="mt-3 text-sm">Loading current material and requirement revisions…</p>:!c?<div role="alert" className="mt-3 text-sm"><p>Current attribution context unavailable. Historical untracked Drafts are not initialized automatically.</p><button className={`${button} mt-2`} type="button" onClick={()=>void query.refetch({cancelRefetch:false})}>Retry context</button></div>:<>
        <p className="mt-3 text-xs text-zinc-500">Material version {c.material_version} · verified <time dateTime={c.as_of}>{c.as_of}</time></p>
        <dl className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-zinc-50 p-3 text-center text-sm">{[["Required",c.required],["Held",c.held],["Uncovered",c.uncovered],["Verified coverage",c.coverage],["Independent",c.independent],["Unknown",c.unknown]].map(([name,q])=><div key={name}><dt className="text-xs text-zinc-500">{name}</dt><dd className="break-all font-semibold tabular-nums">{q}</dd></div>)}</dl>
        <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold">Active attribution on this requirement page</summary><ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">{c.independent!=="0"&&<li>Independent material demand: {c.independent}</li>}{c.requirements.flatMap(r=>r.allocations.filter(a=>a.quantity!=="0").map(a=><li key={`${r.id}:${a.warehouse_id}`}>{r.project_name} / {r.group_name} · {label(a.warehouse_id)}: {a.quantity} · revision {r.revision}</li>))}</ul><p className="mt-1 text-xs text-zinc-500">Totals cover the material; Project rows are bounded to this page. Stale evidence contributes to Unknown, not active attribution.</p></details>
        <AttributionForm key={JSON.stringify(c)} context={c} workflow={workflow} onRefresh={()=>void query.refetch({cancelRefetch:false})}/>
        <div className="mt-4 flex flex-wrap gap-2">{after&&<button className={button} type="button" onClick={()=>setAfter(null)} disabled={workflow.busy}>First requirements page</button>}{c.has_more&&<button className={button} type="button" onClick={()=>setAfter(c.next_after)} disabled={workflow.busy}>Next requirements page</button>}</div>
      </>}
    </>}
  </section></div>;
}
function ActiveAction(props:Props){
  const auth=useAuth(),[open,setOpen]=useState<string|null>(null);const scope=JSON.stringify([auth.session?.user.id,auth.profile?.id,props.workOrderId]);
  useEffect(()=>{setOpen(null);},[scope]);
  if(auth.isLoading||auth.error||!auth.isActive||!auth.isAdmin||!auth.profile?.isActive||!auth.session?.access_token||auth.profile.authUserId!==auth.session.user.id||!testUuid(auth.profile.id)||!testUuid(auth.session.user.id))return null;
  return <><button type="button" className={`${button} mt-3`} disabled={props.disabled} onClick={()=>setOpen(scope)}>Attribute commitments</button>{open===scope&&createPortal(<AttributionDialog key={scope} workOrderId={props.workOrderId} materials={props.materials} onClose={()=>setOpen(null)}/>,document.body)}</>;
}
export default function WorkOrderAttributionAction(props:Props){return isUnifiedCommittedEnabled()?<ActiveAction {...props}/>:null;}
