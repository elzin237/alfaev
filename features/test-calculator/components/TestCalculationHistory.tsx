import { useState } from "react";
import EmptyState from "../../../shared/components/EmptyState";
import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import StatusBadge from "../../../shared/components/StatusBadge";
import { useTestCalculationHistory } from "../hooks/useTestCalculationHistory";
import TestCalculationDetail from "./TestCalculationDetail";

// Closed gate: disabled rendering mounts no Auth/query hooks and performs no reads.
export default function TestCalculationHistory({enabledAfterActivation=false,pageSize=20}:{enabledAfterActivation?:boolean;pageSize?:number}){
  if(!enabledAfterActivation)return <EmptyState title="Saved calculations" description="History reads are disabled until coordinated Test activation. No history has been loaded."/>;
  return <AuthorizedHistory pageSize={pageSize}/>;
}
function AuthorizedHistory({pageSize}:{pageSize:number}){
  const {query,scope,allowed,isLoading}=useTestCalculationHistory(true,pageSize);
  const [selection,setSelection]=useState<{scope:string;id:string}|null>(null);
  if(isLoading||allowed&&query.isPending)return <LoadingState message="Loading saved calculations..."/>;
  if(!allowed)return <ErrorState title="Access denied" message="Your Test Calculator history access could not be verified."/>;
  const failure=query.data?.pages.find(page=>!page.ok);
  const rows=query.data?.pages.flatMap(page=>page.ok?page.value.rows:[])??[];
  const duplicate=new Set(rows.map(row=>row.calculationId)).size!==rows.length;
  if(query.isError||failure||duplicate)return <ErrorState title="Unable to load saved calculations" message={failure?.ok===false?failure.error.message:"Saved calculation history could not be verified."} onRetry={()=>void query.refetch()}/>;
  return <section aria-label="Saved calculation history" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold text-blue-900">Saved calculations</h2>
      <button type="button" disabled={query.isFetching} onClick={()=>void query.refetch()} className="rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-900">Refresh history</button></div>
    <p className="text-sm text-zinc-600">Shared authorized history, including expired calculations. Status reflects the server snapshot, not a browser-clock estimate. Expired records are not removed.</p>
    {rows.length===0?<EmptyState title="No saved calculations" description="There are no saved Test Calculations in this authorized history."/>:
      <div className="overflow-x-auto rounded-2xl border border-blue-200 bg-white"><table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-blue-50 text-blue-950"><tr>{["Calculation","Creator","Created","Deadline (Europe/Sarajevo)","Status"].map(label=><th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-zinc-100">{rows.map(row=><tr key={row.calculationId}>
          <td className="px-4 py-3"><button type="button" aria-expanded={selection?.scope===scope&&selection.id===row.calculationId} onClick={()=>setSelection({scope,id:row.calculationId})} className="font-semibold text-blue-800 hover:underline">{row.name}</button></td>
          <td className="px-4 py-3">{row.creatorFullName??"Not returned"}</td><td className="px-4 py-3"><time dateTime={row.createdAt}>{row.createdAt}</time></td>
          <td className="px-4 py-3">{row.deadlineDate}</td><td className="px-4 py-3"><StatusBadge label={row.status==="active"?"Active":"Expired"} tone={row.status==="active"?"info":"neutral"}/><p className="mt-1 text-xs text-zinc-500">As of {row.asOf}</p></td>
        </tr>)}</tbody>
      </table></div>}
    {query.hasNextPage&&<button type="button" disabled={query.isFetching} onClick={()=>{if(!query.isFetching)void query.fetchNextPage();}} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white">Load more calculations</button>}
    {query.isFetchingNextPage&&<p role="status">Loading more saved calculations...</p>}
    {selection?.scope===scope&&<div key={`${scope}:${selection.id}`} className="space-y-3">
      <button type="button" onClick={()=>setSelection(null)} className="text-sm font-semibold text-blue-800">Close detail</button>
      <TestCalculationDetail calculationId={selection.id}/>
    </div>}
  </section>;
}
