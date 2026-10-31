import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, X } from "lucide-react";
import { useNavigate } from "react-router";
import ConfirmDialog from "../../../shared/components/ConfirmDialog";
import { useActiveProblemsCountV2, useActiveConditionInboxV2, useAlertsHistoryV2, useUnreadUpdatesV2, useAcknowledgeProblemV2, useAlertReceiptV2 } from "../hooks/useActiveAlertsV2";
import { activeAlertDestination, type AlertCondition } from "../services/activeAlertsV2Service";
import { activeProblemBadge } from "../dashboardAlertCount";

type Section = "active" | "updates" | "history";
const buttonStyle = "rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-red-500 disabled:opacity-50";
const formatter = new Intl.DateTimeFormat("en-GB", {dateStyle:"medium",timeStyle:"short",timeZone:"Europe/Sarajevo"});
const typeLabel = (item:AlertCondition) => item.kind === "project_issue" ? "Project issue" : item.kind === "project_shortage" ? "Project shortage" : item.kind === "work_order_shortage" ? "Work Order shortage" : "Project update";

export default function DashboardActiveAlertsControl() {
  const navigate=useNavigate(),id=useId(),button=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),title=useRef<HTMLHeadingElement>(null);
  const [open,setOpen]=useState(false),[section,setSection]=useState<Section>("active"),[position,setPosition]=useState({left:12,top:12});
  const [target,setTarget]=useState<AlertCondition|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const counts=useActiveProblemsCountV2(),active=useActiveConditionInboxV2(open&&section==='active'),history=useAlertsHistoryV2(open&&section==='history'),updates=useUnreadUpdatesV2(open&&section==='updates');
  const ack=useAcknowledgeProblemV2(),receipt=useAlertReceiptV2(),lock=useRef(false),live=useRef(counts.id);
  live.current=counts.id;
  const feed=section==='active'?active:section==='history'?history:updates;
  const permitted=counts.allowed&&feed.allowed&&ack.allowed&&receipt.allowed;
  const scope=counts.id;
  useEffect(()=>{setOpen(false);setTarget(null);setError(null);setBusy(false);lock.current=false;},[scope]);
  useEffect(()=>()=>{live.current='unmounted';},[]);
  function close(){setOpen(false);queueMicrotask(()=>button.current?.focus());}
  function place(){const b=button.current?.getBoundingClientRect(),p=panel.current?.getBoundingClientRect();if(!b||!p)return;
    setPosition({left:Math.max(12,Math.min(b.right-p.width,window.innerWidth-p.width-12)),top:Math.max(12,Math.min(b.bottom+8,window.innerHeight-p.height-12))});}
  useLayoutEffect(()=>{if(open){place();title.current?.focus();}},[open,section]);
  useLayoutEffect(()=>{if(open)place();},[open,feed.items.length,feed.query.isPending,counts.value]);
  useEffect(()=>{
    if(!open||!panel.current||typeof ResizeObserver==='undefined')return;
    const observer=new ResizeObserver(place);observer.observe(panel.current);
    return()=>observer.disconnect();
  },[open]);
  useEffect(()=>{if(!open)return;
    const outside=(e:MouseEvent)=>{if(target||!(e.target instanceof Node)||button.current?.contains(e.target)||panel.current?.contains(e.target))return;close();};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!target&&!e.defaultPrevented){e.preventDefault();close();}};
    document.addEventListener('mousedown',outside);document.addEventListener('keydown',key);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return()=>{document.removeEventListener('mousedown',outside);document.removeEventListener('keydown',key);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open,target]);
  async function act(item:AlertCondition,action:'open'|'read'|'dismiss'|'acknowledge') {
    if(lock.current||!permitted||live.current!==scope)return;const captured=scope;lock.current=true;setBusy(true);setError(null);
    try {
      const destination=activeAlertDestination(item);
      if(action==='open'&&!destination)return;
      const result=action==='acknowledge'&&item.kind!=='informational_update'&&item.status==='resolved'
        ? await ack.acknowledge(item.kind,item.id)
        : action==='dismiss' ? await receipt.update('dismiss_update',item)
        : item.readAt===null ? await receipt.update('read',item) : {ok:true as const};
      if(live.current!==captured)return;
      if(!result.ok){setError(result.error.message);return;}
      setTarget(null);
      if(action==='open'&&destination){close();navigate(destination);}
    } catch {if(live.current===captured)setError('Unable to update this alert. Please retry.');}
    finally {if(live.current===captured){lock.current=false;setBusy(false);}}
  }
  if(!counts.allowed)return null;
  const badge=activeProblemBadge(counts.value?.activeProblems);
  const label=counts.value?`${counts.value.activeProblems} active problems`:counts.query.isFetching||counts.query.isPending?'active problems loading':'active problems unavailable';
  return <div className="shrink-0">
    <button ref={button} type="button" aria-label={`Alerts, ${label}`} aria-haspopup="dialog" aria-controls={id} aria-expanded={open}
      onClick={()=>{if(!open)void counts.query.refetch();setOpen(v=>!v);}}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-red-500">
      <Bell aria-hidden="true" className="size-4.5 text-zinc-600"/><span>Alerts</span>
      {badge!==null&&<span aria-hidden="true" className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">{badge}</span>}
    </button>
    {open&&createPortal(<section ref={panel} id={id} role="dialog" aria-modal="false" aria-labelledby={`${id}-title`} style={position}
      className="fixed z-[60] flex max-h-[min(38rem,calc(100dvh-1.5rem))] w-[min(30rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl">
      <header className="shrink-0 border-b border-zinc-100 p-4">
        <div className="flex items-center justify-between gap-2"><h2 ref={title} id={`${id}-title`} tabIndex={-1} className="font-bold text-zinc-950 focus:outline-none">Alerts</h2><button type="button" onClick={close} aria-label="Close alerts" className={buttonStyle}><X aria-hidden="true" size={16}/></button></div>
        <nav aria-label="Alert sections" className="mt-3 flex flex-wrap gap-2">
          {(['active','updates','history'] as const).filter(s=>s!=='updates'||counts.access.canReadProjects).map(s=><button key={s} type="button" aria-pressed={section===s} className={`${buttonStyle} ${section===s?'border-red-200 bg-red-50 text-red-700':''}`} onClick={()=>{setSection(s);setError(null);}}>
            {s==='active'?'Active Problems':s==='updates'?'Updates':'History'}{s==='active'&&counts.value?` (${activeProblemBadge(counts.value.activeProblems)??'0'})`:s==='updates'&&counts.value?` (${activeProblemBadge(counts.value.unreadUpdates)??'0'} unread)`:''}
          </button>)}
        </nav>
        {!counts.value&&<p role="status" className="mt-2 text-xs text-zinc-500">{label}. <button className="underline" onClick={()=>void counts.query.refetch()}>Refresh counts</button></p>}
        {counts.value&&<p className="mt-2 text-xs text-zinc-500">Verified as of <time dateTime={counts.value.asOf}>{formatter.format(new Date(counts.value.asOf))}</time>. Updates are separate from active problems.</p>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {!permitted?<p role="alert" className="p-4 text-sm">Alerts are unavailable. Check your access.</p>:
          feed.query.isError&&!feed.query.isFetchNextPageError?<div role="alert" className="p-4 text-sm">Unable to load {section==='active'?'active problems':section}. <button className={buttonStyle} onClick={()=>void feed.query.refetch()}>Retry</button></div>:
          feed.query.isPending||feed.query.isFetching&&!feed.query.isFetchingNextPage?<p role="status" className="p-4 text-sm text-zinc-500">Loading alerts…</p>:
          feed.items.length===0?<p role="status" className="p-4 text-sm text-zinc-500">{section==='active'?'No active problems.':section==='history'?'No resolved alerts.':'No updates.'}</p>:
          <ol aria-label={`${section==='active'?'Active Problems':section==='history'?'Alerts History':'Project Updates'}`} className="divide-y divide-zinc-100">
            {feed.items.map(item=><li key={`${item.kind}:${item.id}`} className="p-4 hover:bg-zinc-50/70">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold text-zinc-600">{typeLabel(item)}</span><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.status==='active'?'bg-red-50 text-red-700':item.status==='resolved'?'bg-emerald-50 text-emerald-700':'bg-zinc-100 text-zinc-600'}`}>{item.status==='active'?'Active':item.status==='resolved'?'Resolved':item.readAt?'Read':'Unread'}</span></div>
              <p className="mt-1 break-words text-sm font-bold text-zinc-950">{item.targetLabel}</p>
              {item.issue&&<p className="mt-1 break-words text-sm text-zinc-700">{item.issue.title}</p>}
              {item.issue&&<p className="mt-1 line-clamp-3 break-words text-xs leading-5 text-zinc-600">{item.issue.description}</p>}
              {item.product&&<p className="mt-1 break-words text-sm text-zinc-700">{item.product.serial?`${item.product.serial} · `:''}{item.product.name}{item.status==='active'?` — Shortage: ${item.shortageQuantity}`:''}</p>}
              {item.issue?.resolutionDescription&&<p className="mt-1 break-words text-xs text-emerald-800">{item.issue.resolutionDescription}</p>}
              <p className="mt-1 text-xs text-zinc-500">Opened <time dateTime={item.openedAt}>{formatter.format(new Date(item.openedAt))}</time>{item.readAt&&item.status==='active'?' · Read':''}</p>
              {item.resolvedAt&&<p className="mt-1 text-xs text-zinc-500">Resolved <time dateTime={item.resolvedAt}>{formatter.format(new Date(item.resolvedAt))}</time></p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {activeAlertDestination(item)&&<button type="button" className={buttonStyle} disabled={busy} onClick={()=>void act(item,'open')}>Open {item.targetType==='project'?'Project':'Work Order'}</button>}
                {item.readAt===null&&<button type="button" className={buttonStyle} disabled={busy} onClick={()=>void act(item,'read')}>Mark read</button>}
                {item.kind==='informational_update'&&<button type="button" className={buttonStyle} disabled={busy} onClick={()=>setTarget(item)}>Dismiss update</button>}
                {item.status==='resolved'&&(item.acknowledgedAt?<span className="text-xs text-zinc-500">Acknowledged</span>:<button type="button" className={buttonStyle} disabled={busy} onClick={()=>void act(item,'acknowledge')}>Acknowledge</button>)}
              </div>
            </li>)}
          </ol>}
        {permitted&&(feed.query.hasNextPage||feed.query.isFetchNextPageError)&&<div className="border-t border-zinc-100 p-3 text-center"><button type="button" className={buttonStyle} disabled={feed.query.isFetching||busy} onClick={()=>void feed.query.fetchNextPage()}>{feed.query.isFetchingNextPage?'Loading…':feed.query.isFetchNextPageError?'Retry more alerts':'Load more'}</button></div>}
        {error&&<p role="alert" className="p-4 text-sm text-red-700">{error}</p>}
      </div>
    </section>,document.body)}
    <ConfirmDialog open={target!==null} title="Dismiss update?" description="This removes the informational update from your inbox. Active Problems are unchanged." confirmLabel="Dismiss update" onCancel={()=>{if(!busy){setTarget(null);setError(null);}}} onConfirm={()=>{if(target)void act(target,'dismiss');}} isSubmitting={busy} errorMessage={error} layerClassName="z-[80]"/>
  </div>;
}
