import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import ConfirmDialog from "../../shared/components/ConfirmDialog";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import StatusBadge from "../../shared/components/StatusBadge";
import InventoryBalanceSection from "./components/InventoryBalanceSection";
import ProductStockHealthSection from "./components/ProductStockHealthSection";
import InventoryHistorySection from "./components/InventoryHistorySection";
import ProductBarcodeSection from "./components/ProductBarcodeSection";
import ProductEditDialog from "./components/ProductEditDialog";
import ProductSuppliersSection from "./components/ProductSuppliersSection";
import SupplierStockHistorySection from "./components/SupplierStockHistorySection";
import InventoryWarehouseTabs from "./components/InventoryWarehouseTabs";
import { useProductDetail } from "./hooks/useProductDetail";
import {
  useInventoryLegacyViewPermission,
  useInventoryWarehouseAccess,
} from "./hooks/useInventoryWarehouseAccess";
import { findInventoryWarehouse, INVENTORY_WAREHOUSES } from "./inventoryWarehouses";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

function formatProductKind(kind: "component" | "pcb_finished_good"): string {
  return kind === "component" ? "Component" : "PCB finished good";
}

function ProductDetailPage() {
  const { productId = "" } = useParams<{ productId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const warehouseAccess = useInventoryWarehouseAccess();
  const legacyAccess = useInventoryLegacyViewPermission();
  const requestedWarehouse = findInventoryWarehouse(searchParams.get("warehouse"));
  const selectedWarehouse = warehouseAccess.authorizedWarehouses.find(
    (warehouse) => warehouse.id === requestedWarehouse?.id,
  ) ?? warehouseAccess.authorizedWarehouses[0];
  const { productQuery, brandsQuery, canEdit, canArchive, update, archive } =
    useProductDetail(
      productId,
      selectedWarehouse?.id ?? "",
      Boolean(selectedWarehouse),
      legacyAccess.canReadLegacyInventory,
    );
  const archiveLockRef = useRef(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  let content: ReactNode;

  useEffect(() => {
    if (!selectedWarehouse || requestedWarehouse?.id === selectedWarehouse.id) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("warehouse", selectedWarehouse.code);
      return next;
    }, { replace: true });
  }, [requestedWarehouse?.id, selectedWarehouse, setSearchParams]);

  async function confirmArchive() {
    if (archiveLockRef.current) return;

    archiveLockRef.current = true;
    setIsArchiving(true);
    setActionError(null);

    try {
      const result = await archive();
      if (!result.ok) {
        setActionError(result.error.message);
        return;
      }

      setIsArchiveOpen(false);
      setSuccessMessage("Product archived.");
    } finally {
      archiveLockRef.current = false;
      setIsArchiving(false);
    }
  }

  if (warehouseAccess.isPending) {
    content = <LoadingState message="Checking warehouse access..." />;
  } else if (warehouseAccess.isError) {
    content = <ErrorState title="Unable to verify access" message="Your warehouse access could not be verified." />;
  } else if (!selectedWarehouse) {
    content = <ErrorState title="Access denied" message="You do not have permission to view any Inventory warehouse." />;
  } else if (!productId) {
    content = (
      <ErrorState title="Product not found" message="The Product could not be found." />
    );
  } else if (productQuery.isPending) {
    content = <LoadingState message="Loading Product details..." />;
  } else if (productQuery.isError || !productQuery.data?.ok) {
    const isNotFound = productQuery.data?.ok === false &&
      productQuery.data.error.code === "product_not_found";
    content = (
      <ErrorState
        title={isNotFound ? "Product not found" : "Unable to load Product"}
        message={productQuery.data?.ok === false
          ? productQuery.data.error.message
          : "The Product details could not be loaded."}
        onRetry={isNotFound ? undefined : () => void productQuery.refetch()}
      />
    );
  } else {
    const product = productQuery.data.value;
    content = (
      <>
          <section aria-label="Product overview" className="min-w-0 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Product Overview</p>
                  <p className="inline-flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
                    <span className="text-xs font-medium text-zinc-500">Serial</span>
                    <span className="font-mono font-semibold text-zinc-700 [overflow-wrap:anywhere]">{product.serialNumber}</span>
                  </p>
                </div>
                <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                  <h2 className="min-w-0 text-2xl font-bold tracking-tight text-zinc-900 [overflow-wrap:anywhere] sm:text-3xl">
                    {product.name}
                  </h2>
                  <StatusBadge label={product.isActive ? "Active" : "Archived"} tone={product.isActive ? "success" : "neutral"} />
                </div>
              </div>
              {(canEdit || canArchive) && <div role="group" aria-label="Product actions" className="flex shrink-0 flex-wrap items-center gap-2">
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setSuccessMessage(null);
                      setActionError(null);
                      setIsEditOpen(true);
                    }}
                    className="min-h-11 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
                  >
                    Edit Product
                  </button>
                )}
                {canArchive && (
                  <button
                    type="button"
                    onClick={() => {
                      setSuccessMessage(null);
                      setActionError(null);
                      setIsArchiveOpen(true);
                    }}
                    className="min-h-11 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-2"
                  >
                    Archive Product
                  </button>
                )}
              </div>}
            </div>

            <dl className="mt-5 grid min-w-0 gap-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-3 sm:gap-5">
              <div className="min-w-0">
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Category</dt>
                <dd className="mt-1 text-sm font-semibold leading-6 text-zinc-900 [overflow-wrap:anywhere]">{product.category}</dd>
              </div>
              <div className="min-w-0 sm:border-l sm:border-zinc-200 sm:pl-5">
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Brand</dt>
                <dd className="mt-1 text-sm font-semibold leading-6 text-zinc-900 [overflow-wrap:anywhere]">
                  {product.brandName ?? "Not assigned"}
                  {product.brandName && product.brandIsActive === false
                    ? " (archived)"
                    : ""}
                </dd>
              </div>
              <div className="min-w-0 sm:border-l sm:border-zinc-200 sm:pl-5">
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Product kind</dt>
                <dd className="mt-1 text-sm font-semibold leading-6 text-zinc-900">{formatProductKind(product.productKind)}</dd>
              </div>
            </dl>
            <dl aria-label="Product record metadata" className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs leading-5 text-zinc-500">
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium">Created</dt>
                <dd><time dateTime={product.createdAt}>{formatDate(product.createdAt)}</time></dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium">Last updated</dt>
                <dd><time dateTime={product.updatedAt}>{formatDate(product.updatedAt)}</time></dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium">Archived at</dt>
                <dd>
                  {product.archivedAt ? <time dateTime={product.archivedAt}>{formatDate(product.archivedAt)}</time> : "Not archived"}
                </dd>
              </div>
            </dl>
          </section>

        <InventoryBalanceSection
          productId={product.id}
          productIsActive={product.isActive}
          stockHealth={<ProductStockHealthSection
            productId={product.id}
            serialNumber={product.serialNumber}
            productIsActive={product.isActive}
            warehouseId={selectedWarehouse.id}
          />}
          warehouse={selectedWarehouse}
          canAdjust={warehouseAccess.adjustableWarehouseIds.has(selectedWarehouse.id)}
          transferDestinations={INVENTORY_WAREHOUSES.filter(
            (warehouse) => warehouse.id !== selectedWarehouse.id &&
              warehouseAccess.adjustableWarehouseIds.has(warehouse.id),
          )}
          canReadCommitments={
            warehouseAccess.canReadProjectAvailability &&
              selectedWarehouse.code === "raw_materials"
          }
        />

        <InventoryHistorySection productId={product.id} warehouseId={selectedWarehouse.id} />

        <ProductBarcodeSection serialNumber={product.serialNumber} />

        {legacyAccess.canReadLegacyInventory && <ProductSuppliersSection
          productId={product.id}
          productName={product.name}
          productIsActive={product.isActive}
        />}

        <SupplierStockHistorySection productId={product.id} warehouseId={selectedWarehouse.id} />

        <ProductEditDialog
          open={isEditOpen}
          initialValues={{
            name: product.name,
            category: product.category,
            brandId: product.brandId,
          }}
          currentBrandName={product.brandName}
          currentBrandIsActive={product.brandIsActive}
          brands={brandsQuery.data?.ok ? brandsQuery.data.value : []}
          isBrandsLoading={brandsQuery.isPending}
          brandLoadError={brandsQuery.isError || brandsQuery.data?.ok === false
            ? brandsQuery.data?.ok === false
              ? brandsQuery.data.error.message
              : "The Brand list could not be loaded."
            : null}
          onRetryBrands={() => void brandsQuery.refetch()}
          onClose={() => setIsEditOpen(false)}
          onSubmit={update}
          onSucceeded={() => setSuccessMessage("Product updated.")}
        />

        <ConfirmDialog
          open={isArchiveOpen}
          title="Archive Product"
          description={`Archive ${product.name}? It will remain in historical records, be removed from normal active use, and reactivation is not supported.`}
          confirmLabel="Archive Product"
          confirmVariant="danger"
          isSubmitting={isArchiving}
          onCancel={() => {
            if (!isArchiving) setIsArchiveOpen(false);
          }}
          onConfirm={() => void confirmArchive()}
        />
      </>
    );
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Product Detail"
        description="View Product master data and lifecycle information."
        actions={
          <Link
            to={selectedWarehouse ? `/inventory?warehouse=${selectedWarehouse.code}` : "/inventory"}
            className="rounded-xl border border-zinc-300 px-5 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-300 focus:ring-offset-2"
          >
            Back to Inventory
          </Link>
        }
      />

      {!warehouseAccess.isPending && selectedWarehouse && (
        <InventoryWarehouseTabs
          warehouses={warehouseAccess.authorizedWarehouses}
          selectedWarehouseId={selectedWarehouse.id}
          onSelect={(warehouse) => {
            setSearchParams((current) => {
              const next = new URLSearchParams(current);
              next.set("warehouse", warehouse.code);
              return next;
            });
          }}
        />
      )}

      {successMessage && (
        <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800">
          {successMessage}
        </p>
      )}
      {actionError && (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
          {actionError}
        </p>
      )}

      {content}
    </section>
  );
}

export default ProductDetailPage;
