import {useState} from "react";
import {createPortal} from "react-dom";
import {useAuth} from "../../../app/auth/AuthProvider";
import {isWorkOrderCommitmentReadsEnabled} from "../../../app/config/workOrderCommitmentReadsActivation";
import {INVENTORY_WAREHOUSES} from "../inventoryWarehouses";
import type {BreakdownRequest} from "../services/inventoryCommitmentBreakdownService";
import InventoryCommitmentDialog,{commitmentMetricLabels} from "./InventoryCommitmentDialog";

export interface CommitmentQuantityProps {value:string;productId:string;productName:string;serialNumber:string;warehouseCode?:string;metric:BreakdownRequest["metric"];authorizedWarehouseIds?:readonly string[]}
export function commitmentCellRequest(productId:string,warehouseCode:string|undefined,metric:BreakdownRequest["metric"]):Omit<BreakdownRequest,"cursor">|null{
  const warehouse=INVENTORY_WAREHOUSES.find(w=>w.code===(warehouseCode??"raw_materials"));if(!warehouse)return null;
  if(metric==="project_demand"&&warehouse.code!=="raw_materials"||metric==="fg_project_reservation"&&warehouse.code!=="finished_goods")return null;
  return{productId,warehouseId:warehouse.id,metric,scope:warehouse.code==="raw_materials"&&metric!=="work_order_reservation"?"raw_customs":"warehouse",limit:25};
}
function ActivatedQuantity(props:CommitmentQuantityProps){
  const auth=useAuth(),[open,setOpen]=useState<string|null>(null),request=commitmentCellRequest(props.productId,props.warehouseCode,props.metric);
  const ids=props.authorizedWarehouseIds??[],allowed=Boolean(request&&!auth.isLoading&&!auth.error&&auth.isActive&&auth.profile?.isActive&&auth.session?.access_token&&auth.profile.authUserId===auth.session.user.id&&
    (auth.isAdmin||ids.includes(request.warehouseId)&&(request.scope!=="raw_customs"||ids.includes(INVENTORY_WAREHOUSES[2]!.id))));
  const scope=JSON.stringify([auth.session?.user.id,auth.profile?.id,request,allowed,ids]);
  if(!allowed||!request)return <>{props.value}</>;
  return <><button type="button" aria-label={`${commitmentMetricLabels[props.metric]} ${props.value} for ${props.productName}: view sources`} onClick={()=>setOpen(scope)}
    className="rounded px-1 tabular-nums underline decoration-dotted underline-offset-4 transition hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500">{props.value}</button>
    {open===scope&&createPortal(<InventoryCommitmentDialog key={scope} request={request} productName={props.productName} serialNumber={props.serialNumber} canRead={allowed} onClose={()=>setOpen(null)}/>,document.body)}</>;
}
export default function CommitmentQuantity(props:CommitmentQuantityProps){
  // OFF path mounts neither Auth/query hooks nor dialog; unavailable never becomes 0.
  if(!isWorkOrderCommitmentReadsEnabled()||!/^(0|[1-9][0-9]*)$/.test(props.value))return <>{props.value}</>;
  return <ActivatedQuantity {...props}/>;
}
