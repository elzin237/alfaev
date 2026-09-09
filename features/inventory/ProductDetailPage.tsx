import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";

import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import StatusBadge from "../../shared/components/StatusBadge";
import ProductEditDialog from "./components/ProductEditDialog";
import { useProductDetail } from "./hooks/useProductDetail";

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
  const { productQuery, brandsQuery, canEdit, update } =
    useProductDetail(productId);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  let content: ReactNode;

  if (!productId) {
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
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-mono text-sm font-semibold text-zinc-500">
                  {product.serialNumber}
                </p>
                <h2 className="mt-2 text-2xl font-bold text-zinc-900">
                  {product.name}
                </h2>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setSuccessMessage(null);
                    setIsEditOpen(true);
                  }}
                  className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
                >
                  Edit Product
                </button>
              )}
            </div>

            <dl className="mt-8 grid gap-6 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Category</dt>
                <dd className="mt-2 text-sm font-medium text-zinc-900">{product.category}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Brand</dt>
                <dd className="mt-2 text-sm font-medium text-zinc-900">
                  {product.brandName ?? "Not assigned"}
                  {product.brandName && product.brandIsActive === false
                    ? " (archived)"
                    : ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Product kind</dt>
                <dd className="mt-2 text-sm font-medium text-zinc-900">{formatProductKind(product.productKind)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Serial Number</dt>
                <dd className="mt-2 font-mono text-sm font-semibold text-zinc-900">{product.serialNumber}</dd>
              </div>
            </dl>
          </section>

          <aside className="h-fit rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-zinc-900">Product status</h2>
            <dl className="mt-5 space-y-5">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Status</dt>
                <dd className="mt-2">
                  <StatusBadge
                    label={product.isActive ? "Active" : "Archived"}
                    tone={product.isActive ? "success" : "neutral"}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Created</dt>
                <dd className="mt-1 text-sm font-medium text-zinc-900">{formatDate(product.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Last updated</dt>
                <dd className="mt-1 text-sm font-medium text-zinc-900">{formatDate(product.updatedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Archived at</dt>
                <dd className="mt-1 text-sm font-medium text-zinc-900">
                  {product.archivedAt ? formatDate(product.archivedAt) : "Not archived"}
                </dd>
              </div>
            </dl>
          </aside>
        </div>

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
            to="/inventory"
            className="rounded-xl border border-zinc-300 px-5 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-300 focus:ring-offset-2"
          >
            Back to Inventory
          </Link>
        }
      />

      {successMessage && (
        <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800">
          {successMessage}
        </p>
      )}

      {content}
    </section>
  );
}

export default ProductDetailPage;
