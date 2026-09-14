import { useRef, useState } from "react";

import ConfirmDialog from "../../../shared/components/ConfirmDialog";
import EmptyState from "../../../shared/components/EmptyState";
import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import StatusBadge from "../../../shared/components/StatusBadge";
import type { SupplierProductRelation } from "../../inventory/services/productSupplierService";
import { useSupplierProducts } from "../hooks/useSupplierProducts";
import SupplierProductDialog from "./SupplierProductDialog";

export interface SupplierProductsSectionProps {
  supplierId: string;
  supplierName: string;
  supplierIsActive: boolean;
}

function SupplierProductsSection({
  supplierId,
  supplierName,
  supplierIsActive,
}: SupplierProductsSectionProps) {
  const {
    relationQuery,
    productsQuery,
    canManage,
    canAdd,
    create,
    update,
    archive,
  } = useSupplierProducts(supplierId, supplierIsActive);
  const archiveLockRef = useRef(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingRelation, setEditingRelation] =
    useState<SupplierProductRelation | null>(null);
  const [archivingRelation, setArchivingRelation] =
    useState<SupplierProductRelation | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function confirmArchive() {
    if (!archivingRelation || archiveLockRef.current) return;

    archiveLockRef.current = true;
    setIsArchiving(true);
    setActionError(null);

    try {
      const result = await archive(archivingRelation.relationId);
      if (!result.ok) {
        setActionError(result.error.message);
        return;
      }

      setArchivingRelation(null);
      setSuccessMessage("Product link archived.");
    } finally {
      archiveLockRef.current = false;
      setIsArchiving(false);
    }
  }

  const relations = relationQuery.data?.ok ? relationQuery.data.value : [];
  const products = productsQuery.data?.ok ? productsQuery.data.value : [];
  const productLoadError = productsQuery.isError || productsQuery.data?.ok === false
    ? productsQuery.data?.ok === false
      ? productsQuery.data.error.message
      : "The Product list could not be loaded."
    : null;

  return (
    <section
      aria-labelledby="supplier-products-heading"
      className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="supplier-products-heading" className="text-xl font-bold text-zinc-900">
            Products
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Product-specific Catalog Numbers for {supplierName}.
          </p>
        </div>
        {canAdd && (
          <button
            type="button"
            onClick={() => {
              setSuccessMessage(null);
              setActionError(null);
              setIsAddOpen(true);
            }}
            className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
          >
            Add Product
          </button>
        )}
      </div>

      {successMessage && (
        <p role="status" className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800">
          {successMessage}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
          {actionError}
        </p>
      )}

      <div className="mt-6">
        {relationQuery.isPending ? (
          <LoadingState message="Loading Product links..." />
        ) : relationQuery.isError || !relationQuery.data?.ok ? (
          <ErrorState
            title="Unable to load Product links"
            message={relationQuery.data?.ok === false
              ? relationQuery.data.error.message
              : "The Product links could not be loaded."}
            onRetry={() => void relationQuery.refetch()}
          />
        ) : relations.length === 0 ? (
          <EmptyState
            title="No Product links"
            description="This Supplier is not linked to a Product yet."
            action={canAdd
              ? { label: "Add Product", onClick: () => setIsAddOpen(true) }
              : undefined}
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-zinc-200">
            <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
              <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Serial Number</th>
                  <th scope="col" className="px-4 py-3">Product</th>
                  <th scope="col" className="px-4 py-3">Catalog Number</th>
                  <th scope="col" className="px-4 py-3">Relationship</th>
                  <th scope="col" className="px-4 py-3">Product status</th>
                  {canManage && <th scope="col" className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {relations.map((relation) => (
                  <tr key={relation.relationId}>
                    <td className="px-4 py-4 font-mono font-semibold text-zinc-900">
                      {relation.productSerialNumber}
                    </td>
                    <td className="px-4 py-4 font-semibold text-zinc-900">
                      {relation.productName}
                      {!relation.productIsActive && (
                        <span className="ml-2 font-normal text-zinc-500">(archived)</span>
                      )}
                    </td>
                    <td className="px-4 py-4 font-mono text-zinc-700">
                      {relation.catalogNumber ?? "Not provided"}
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge
                        label={relation.isActive ? "Active" : "Archived"}
                        tone={relation.isActive ? "success" : "neutral"}
                      />
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge
                        label={relation.productIsActive ? "Active Product" : "Archived Product"}
                        tone={relation.productIsActive ? "success" : "warning"}
                      />
                    </td>
                    {canManage && (
                      <td className="px-4 py-4 text-right">
                        {relation.isActive && (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSuccessMessage(null);
                                setActionError(null);
                                setEditingRelation(relation);
                              }}
                              className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSuccessMessage(null);
                                setActionError(null);
                                setArchivingRelation(relation);
                              }}
                              className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                            >
                              Archive
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SupplierProductDialog
        open={isAddOpen}
        mode="add"
        products={products}
        isProductsLoading={productsQuery.isPending}
        productLoadError={productLoadError}
        onRetryProducts={() => void productsQuery.refetch()}
        onClose={() => setIsAddOpen(false)}
        onSubmit={create}
        onSucceeded={() => setSuccessMessage("Product link added.")}
      />

      {editingRelation && (
        <SupplierProductDialog
          open
          mode="edit"
          productName={editingRelation.productName}
          initialCatalogNumber={editingRelation.catalogNumber}
          onClose={() => setEditingRelation(null)}
          onSubmit={(input) => update(editingRelation.relationId, input)}
          onSucceeded={() => setSuccessMessage("Catalog Number updated.")}
        />
      )}

      <ConfirmDialog
        open={Boolean(archivingRelation)}
        title="Archive Product Link"
        description={archivingRelation
          ? `Archive the link to ${archivingRelation.productName}? It will remain in historical records and cannot be restored.`
          : "Archive this Product link?"}
        confirmLabel="Archive Link"
        confirmVariant="danger"
        isSubmitting={isArchiving}
        onCancel={() => {
          if (!isArchiving) setArchivingRelation(null);
        }}
        onConfirm={() => void confirmArchive()}
      />
    </section>
  );
}

export default SupplierProductsSection;
