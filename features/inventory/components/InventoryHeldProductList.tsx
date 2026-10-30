import ProductList,{type ProductListProps} from "./ProductList";
import {isWorkOrderCommitmentReadsEnabled} from "../../../app/config/workOrderCommitmentReadsActivation";
import {useInventoryHeldAccounting} from "../hooks/useInventoryHeldAccounting";

interface Props extends ProductListProps {warehouseId:string;search:string;authorizedWarehouseIds:readonly string[]}
function ActiveList({warehouseId,search,authorizedWarehouseIds,...props}:Props){
  const data=useInventoryHeldAccounting(warehouseId,search,authorizedWarehouseIds);
  return <div className="space-y-2">
    <p className="text-xs text-zinc-500">WO Held is reserved stock in this warehouse only. Net incl. WO also deducts actual Work Order holds; Raw uses Raw + Customs. Project Demand remains independent. Each accounting page is verified separately.</p>
    {(!data.rows||props.products.some(p=>!data.rows?.has(p.id)))&&<p role={data.query.isFetching?"status":"alert"} className="text-sm text-zinc-600">{data.query.isFetching?"Loading Work Order commitment accounting…":"Work Order commitment accounting unavailable for one or more Products; no missing values are assumed to be zero."}</p>}
    {data.allowed&&<button type="button" disabled={data.query.isFetching} className="text-xs text-zinc-600 underline focus-visible:outline-2 focus-visible:outline-red-500" onClick={()=>void data.query.refetch({cancelRefetch:false})}>Refresh WO commitments</button>}
    <ProductList {...props} commitmentBreakdownWarehouseIds={authorizedWarehouseIds} showWorkOrderCommitments reservationAccounting={data.rows}/>
  </div>;
}
export default function InventoryHeldProductList(props:Props){
  if(!isWorkOrderCommitmentReadsEnabled())return <ProductList {...props}/>;
  return <ActiveList {...props}/>;
}
