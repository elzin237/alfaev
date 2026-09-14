import { useEffect, useRef, useState, type ReactNode } from "react";

import ConfirmDialog from "../../shared/components/ConfirmDialog";
import EmptyState from "../../shared/components/EmptyState";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import AddComponentDialog from "./components/AddComponentDialog";
import BrandFormDialog from "./components/BrandFormDialog";
import BrandList from "./components/BrandList";
import ProductList from "./components/ProductList";
import { useBrandManagement } from "./hooks/useBrandManagement";
import { useProductCreation } from "./hooks/useProductCreation";
import { useProducts } from "./hooks/useProducts";
import type { Brand } from "./services/brandService";

function InventoryPage() {
  const { brandsQuery, canManage, create: createBrand, update, archive } =
    useBrandManagement();
  const { canCreate, create: createProduct } = useProductCreation();
  const [productSearch, setProductSearch] = useState("");
  const [debouncedProductSearch, setDebouncedProductSearch] = useState("");
  const productsQuery = useProducts(debouncedProductSearch);
  const archiveLockRef = useRef(false);
  const [isComponentDialogOpen, setIsComponentDialogOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Brand | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [productSuccessMessage, setProductSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedProductSearch(productSearch.trim());
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [productSearch]);

  function clearProductSearch() {
    setProductSearch("");
    setDebouncedProductSearch("");
  }

  function openCreateDialog() {
    setSuccessMessage(null);
    setActionError(null);
    setSelectedBrand(null);
    setFormMode("create");
  }

  function openEditDialog(brand: Brand) {
    setSuccessMessage(null);
    setActionError(null);
    setSelectedBrand(brand);
    setFormMode("edit");
  }

  function openComponentDialog() {
    setProductSuccessMessage(null);
    setIsComponentDialogOpen(true);
  }

  async function confirmArchive() {
    if (!archiveTarget || archiveLockRef.current) return;

    archiveLockRef.current = true;
    setIsArchiving(true);
    setActionError(null);

    try {
      const result = await archive(archiveTarget.id);
      if (!result.ok) {
        setActionError(result.error.message);
        return;
      }

      setArchiveTarget(null);
      setSuccessMessage("Brand archived.");
    } finally {
      archiveLockRef.current = false;
      setIsArchiving(false);
    }
  }

  let productContent: ReactNode;

  if (productsQuery.isPending) {
    productContent = <LoadingState message="Loading Products..." />;
  } else if (productsQuery.isError || !productsQuery.data?.ok) {
    productContent = (
      <ErrorState
        title="Unable to load Products"
        message={
          productsQuery.data?.ok === false
            ? productsQuery.data.error.message
            : "The Product list could not be loaded."
        }
        onRetry={() => void productsQuery.refetch()}
      />
    );
  } else if (productsQuery.data.value.length === 0) {
    productContent = debouncedProductSearch ? (
      <EmptyState
        title="No matching Products"
        description="No Products match the current search."
        action={{ label: "Clear Search", onClick: clearProductSearch }}
      />
    ) : (
      <EmptyState
        title="No Products found"
        description="There are no Inventory Products to display."
        action={canCreate
          ? { label: "Add Component", onClick: openComponentDialog }
          : undefined}
      />
    );
  } else {
    productContent = <ProductList products={productsQuery.data.value} />;
  }

  let brandContent: ReactNode;

  if (brandsQuery.isPending) {
    brandContent = <LoadingState message="Loading Brands..." />;
  } else if (brandsQuery.isError || !brandsQuery.data?.ok) {
    brandContent = (
      <ErrorState
        title="Unable to load Brands"
        message={
          brandsQuery.data?.ok === false
            ? brandsQuery.data.error.message
            : "The Brand list could not be loaded."
        }
        onRetry={() => void brandsQuery.refetch()}
      />
    );
  } else if (brandsQuery.data.value.length === 0) {
    brandContent = (
      <EmptyState
        title="No Brands found"
        description="There are no Inventory Brands to display."
        action={canManage ? { label: "Add Brand", onClick: openCreateDialog } : undefined}
      />
    );
  } else {
    brandContent = (
      <BrandList
        brands={brandsQuery.data.value}
        canManage={canManage}
        onEdit={openEditDialog}
        onArchive={(brand) => {
          setSuccessMessage(null);
          setActionError(null);
          setArchiveTarget(brand);
        }}
      />
    );
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Manage AlfaEV Inventory reference data."
        actions={canCreate ? (
          <button
            type="button"
            onClick={openComponentDialog}
            className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
          >
            Add Component
          </button>
        ) : undefined}
      />

      {productSuccessMessage && (
        <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800">
          {productSuccessMessage}
        </p>
      )}

      <section className="space-y-5" aria-labelledby="products-heading">
        <div>
          <h2 id="products-heading" className="text-2xl font-bold text-zinc-900">
            Products
          </h2>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            Active and archived Inventory Products.
          </p>
        </div>

        <div className="max-w-xl">
          <label
            htmlFor="inventory-product-search"
            className="mb-2 block text-sm font-semibold text-zinc-700"
          >
            Search Products
          </label>
          <input
            id="inventory-product-search"
            type="search"
            value={productSearch}
            onChange={(event) => setProductSearch(event.target.value)}
            placeholder="Name, Serial Number / Šifra, or Catalog Number"
            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
          />
        </div>

        {productContent}
      </section>

      <section className="space-y-5" aria-labelledby="brands-heading">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="brands-heading" className="text-2xl font-bold text-zinc-900">
              Brands
            </h2>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              Active and archived Brands used by Inventory products.
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={openCreateDialog}
              className="w-fit rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
            >
              Add Brand
            </button>
          )}
        </div>

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
        {brandContent}
      </section>

      <BrandFormDialog
        open={formMode !== null}
        mode={formMode ?? "create"}
        initialName={formMode === "edit" ? selectedBrand?.name : ""}
        onClose={() => {
          setFormMode(null);
          setSelectedBrand(null);
        }}
        onSubmit={(name) =>
          formMode === "edit" && selectedBrand
            ? update(selectedBrand.id, name)
            : createBrand(name)
        }
        onSucceeded={() => {
          setSuccessMessage(
            formMode === "edit" ? "Brand updated." : "Brand added.",
          );
          setActionError(null);
        }}
      />

      <AddComponentDialog
        open={isComponentDialogOpen}
        brands={brandsQuery.data?.ok ? brandsQuery.data.value : []}
        isBrandsLoading={brandsQuery.isPending}
        brandLoadError={
          brandsQuery.isError || brandsQuery.data?.ok === false
            ? brandsQuery.data?.ok === false
              ? brandsQuery.data.error.message
              : "The Brand list could not be loaded."
            : null
        }
        onRetryBrands={() => void brandsQuery.refetch()}
        onClose={() => setIsComponentDialogOpen(false)}
        onSubmit={createProduct}
        onSucceeded={(product) => {
          setProductSuccessMessage(
            `Component created. Serial Number: ${product.serialNumber}`,
          );
        }}
      />

      <ConfirmDialog
        open={archiveTarget !== null}
        title="Archive Brand"
        description={`Archive ${archiveTarget?.name ?? "this Brand"}? It will remain in historical records, cannot be used for new Products, and reactivation is not currently supported.`}
        confirmLabel="Archive Brand"
        confirmVariant="danger"
        isSubmitting={isArchiving}
        onCancel={() => {
          if (!isArchiving) setArchiveTarget(null);
        }}
        onConfirm={() => void confirmArchive()}
      />
    </section>
  );
}

export default InventoryPage;
