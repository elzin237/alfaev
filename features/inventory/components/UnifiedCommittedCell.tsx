import {useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {isUnifiedCommittedEnabled} from "../../../app/config/unifiedCommittedActivation";
import {useUnifiedCommitted} from "../hooks/useUnifiedCommitted";
import {INVENTORY_WAREHOUSES} from "../inventoryWarehouses";
import InventoryCommitmentDialog from "./InventoryCommitmentDialog";
interface Props {productId:string;warehouseId:string;authorizedWarehouseIds:readonly string[];productName?:string;serialNumber?:string}
function ActiveCell(props:Props){
  const data=useUnifiedCommitted(props.productId,props.warehouseId,props.authorizedWarehouseIds);
  const [open,setOpen]=useState<string|null>(null);
  const scope=JSON.stringify([data.identityScope,props.productId,props.warehouseId,props.authorizedWarehouseIds]);
  const request={productId:props.productId,warehouseId:props.warehouseId,metric:"unified_committed" as const,scope:props.warehouseId===INVENTORY_WAREHOUSES[0]!.id?"raw_customs" as const:"warehouse" as const,limit:25};
  return <>{data.query.isFetching?<span role="status" className="text-xs text-zinc-500">Loading…</span>:!data.value?<span className="text-xs text-zinc-500">Unavailable</span>:<button type="button" title="Committed combines Project Demand and Work Order Held. Linked requirements may overlap."
    aria-label={`Committed ${data.value.committed_quantity} for ${props.productName??"Product"}: view sources`} onClick={()=>setOpen(scope)}
    className="rounded px-1 tabular-nums underline decoration-dotted underline-offset-4 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500">{data.value.committed_quantity}</button>}
    {open===scope&&data.allowed&&createPortal(<InventoryCommitmentDialog key={scope} request={request} productName={props.productName??"Product"} serialNumber={props.serialNumber??""} canRead={data.allowed} onClose={()=>setOpen(null)}/>,document.body)}</>;
}
function VisibleCell(props:Props){
  const ref=useRef<HTMLSpanElement>(null),[visible,setVisible]=useState(false);
  useEffect(()=>{
    if(typeof IntersectionObserver==="undefined")return;
    const observer=new IntersectionObserver(entries=>setVisible(entries.some(e=>e.isIntersecting)),{threshold:0});
    const row=ref.current?.closest("tr")??ref.current;if(row)observer.observe(row);return()=>observer.disconnect();
  },[]);
  return <span ref={ref}>{visible?<ActiveCell {...props}/>:<span className="text-xs text-zinc-500">{typeof IntersectionObserver==="undefined"?<button type="button" onClick={()=>setVisible(true)} className="rounded underline focus-visible:outline-2 focus-visible:outline-red-500">Load committed</button>:"Loading…"}</span>}</span>;
}
export default function UnifiedCommittedCell(props:Props){return isUnifiedCommittedEnabled()?<VisibleCell {...props}/>:null;}
