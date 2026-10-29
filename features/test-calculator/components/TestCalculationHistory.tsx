import { useState } from "react";
import EmptyState from "../../../shared/components/EmptyState";
import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import StatusBadge from "../../../shared/components/StatusBadge";
import { useTestCalculationHistory } from "../hooks/useTestCalculationHistory";
import TestCalculationDetail from "./TestCalculationDetail";
import { formatHistoryDeadline, formatHistoryTimestamp } from "../testCalculationHistoryDates";

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
      <button type="button" disabled={query.isFetching} onClick={()=>void query.refetch()} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:opacity-60">Refresh history</button></div>
    <p className="text-sm text-zinc-600">Shared authorized history, including expired calculations. Status reflects the server snapshot, not a browser-clock estimate. Expired records are not removed.</p>
    {rows.length===0?<EmptyState title="No saved calculations" description="There are no saved Test Calculations in this authorized history."/>:
      <div role="region" aria-label="Saved calculations table" tabIndex={0} className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"><table className="w-full min-w-[42rem] table-fixed text-center text-sm">
        <colgroup><col className="w-[26%]"/><col className="w-[20%]"/><col className="w-[24%]"/><col className="w-[17%]"/><col className="w-[13%]"/></colgroup>
        <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500"><tr>{["Calculation","Creator","Created","Deadline","Status"].map(label=><th scope="col" key={label} title={label==="Created"?"Created date and time in Europe/Sarajevo":label==="Deadline"?"Sarajevo deadline date; expires at the next local midnight (exclusive)":undefined} className="px-3 py-3.5 text-center font-semibold">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-zinc-100">{rows.map(row=><tr key={row.calculationId} className="align-middle transition-colors hover:bg-zinc-50/70 focus-within:bg-blue-50/40">
          <td className="px-3 py-3.5 text-left"><button type="button" aria-expanded={selection?.scope===scope&&selection.id===row.calculationId} onClick={()=>setSelection({scope,id:row.calculationId})} className="w-full break-words rounded text-left font-semibold text-blue-800 underline-offset-4 [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">{row.name}</button></td>
          <td className="break-words px-3 py-3.5 text-left text-xs leading-5 text-zinc-600 [overflow-wrap:anywhere]">{row.creatorFullName??"Not returned"}</td><td className="px-3 py-3.5 text-center text-xs tabular-nums text-zinc-600"><time dateTime={row.createdAt} title={`${row.createdAt} (displayed in Europe/Sarajevo)`} className="whitespace-nowrap">{formatHistoryTimestamp(row.createdAt)}</time></td>
          <td className="px-3 py-3.5 text-center text-xs tabular-nums text-zinc-600"><time dateTime={row.deadlineDate} title="Europe/Sarajevo deadline date; expiry remains server-authoritative" className="whitespace-nowrap">{formatHistoryDeadline(row.deadlineDate)}</time></td><td className="px-2 py-3.5 text-center"><span tabIndex={0} aria-label={`${row.status==="active"?"Active":"Expired"}. Server snapshot: ${formatHistoryTimestamp(row.asOf)} Europe/Sarajevo. Exact as_of: ${row.asOf}`} title={`Server snapshot: ${formatHistoryTimestamp(row.asOf)} (Europe/Sarajevo). Exact as_of: ${row.asOf}`} className="inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 [&>span]:px-2 [&>span]:py-0.5 [&>span]:text-xs"><StatusBadge label={row.status==="active"?"Active":"Expired"} tone={row.status==="active"?"info":"neutral"}/></span></td>
        </tr>)}</tbody>
      </table></div>}
    {rows.length>0&&<p className="text-xs text-zinc-500">Dates are shown in Europe/Sarajevo. Focus or hover over a status for its authoritative server snapshot.</p>}
    {query.hasNextPage&&<button type="button" disabled={query.isFetching} onClick={()=>{if(!query.isFetching)void query.fetchNextPage();}} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white">Load more calculations</button>}
    {query.isFetchingNextPage&&<p role="status">Loading more saved calculations...</p>}
    {selection?.scope===scope&&<div key={`${scope}:${selection.id}`} className="space-y-3">
      <button type="button" onClick={()=>setSelection(null)} className="text-sm font-semibold text-blue-800">Close detail</button>
      <TestCalculationDetail calculationId={selection.id}/>
    </div>}
  </section>;
}
