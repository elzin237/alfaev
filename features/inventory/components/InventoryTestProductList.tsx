import { useRef, useState } from "react";
import ProductList, { type ProductListProps } from "./ProductList";
import { useInventoryTestCommitments } from "../hooks/useInventoryTestCommitments";
import { INVENTORY_WAREHOUSES } from "../inventoryWarehouses";

interface Props extends ProductListProps {
  warehouseId: string;
  search: string;
  authorizedWarehouseIds: readonly string[];
  enabledAfterActivation?: boolean;
}
function ActivatedList({ warehouseId, search, authorizedWarehouseIds, ...props }: Omit<Props, "enabledAfterActivation">) {
  const raw = INVENTORY_WAREHOUSES[0]!, customs = INVENTORY_WAREHOUSES[2]!;
  const canRead = authorizedWarehouseIds.includes(warehouseId) &&
    (warehouseId !== raw.id || authorizedWarehouseIds.includes(customs.id));
  const { allowed, query, rows } = useInventoryTestCommitments(warehouseId, search, canRead, true);
  const missing = rows && props.products.some(p => !rows.some(r => r.productId === p.id));
  const retryLock = useRef(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  async function retry() {
    if (!allowed || query.isFetching || retryLock.current) return;
    retryLock.current = true; setRetrying(true); setRetryError(null);
    try { await query.refetch({ cancelRefetch: false }); }
    catch { setRetryError("Test commitments could not be refreshed. Try again."); }
    finally { retryLock.current = false; setRetrying(false); }
  }
  const retryButton = <button type="button" className="ml-2 text-blue-700 underline" disabled={retrying || query.isFetching}
    onClick={() => void retry()}>Retry Test commitments</button>;
  return <div className="space-y-3">
    <p className="text-sm text-blue-800">Test commitments are active holds only.{warehouseId === raw.id ? " Both Test columns cover Raw + Customs and preserve the existing Project planning scope." : ""}</p>
    {rows?.[0] && <p className="text-xs text-zinc-500">Test quantities verified as of <time dateTime={rows[0].asOf}>{rows[0].asOf}</time>.</p>}
    {!rows && <div role={query.isFetching ? "status" : "alert"} className="text-sm text-zinc-700">
      {query.isFetching ? "Loading current Test commitments…" : !allowed ? "Test commitments unavailable: required warehouse access could not be verified." :
        query.data?.result.ok === false ? query.data.result.error.message : "Current Test commitments are unavailable."}
      {allowed && !query.isFetching && retryButton}
    </div>}
    {missing && <p role="alert">Some Test commitment figures are unavailable. No missing figures are assumed to be zero.{allowed && retryButton}</p>}
    {retryError && <p role="alert">{retryError}</p>}
    <ProductList {...props} showTestCommitments testCommitments={rows ? new Map(rows.map(r => [r.productId, r])) : undefined} />
  </div>;
}
// Deliberately closed, including for Admins, until coordinated backend activation.
// The inactive path mounts no new hook and makes no Test RPC/permission requests.
export default function InventoryTestProductList({ enabledAfterActivation = false, ...props }: Props) {
  if (!enabledAfterActivation) return <ProductList {...props} />;
  return <ActivatedList {...props} />;
}
