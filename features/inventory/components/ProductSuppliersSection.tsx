import { useRef, useState } from "react";

import ConfirmDialog from "../../../shared/components/ConfirmDialog";
import EmptyState from "../../../shared/components/EmptyState";
import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import StatusBadge from "../../../shared/components/StatusBadge";
import { useProductSuppliers } from "../hooks/useProductSuppliers";
import type { ProductSupplierRelation } from "../services/productSupplierService";
import ProductSupplierDialog from "./ProductSupplierDialog";

export interface ProductSuppliersSectionProps {
  productId: string;
  productName: string;
  productIsActive: boolean;
}

function ProductSuppliersSection({
  productId,
  productName,
  productIsActive,
}: ProductSuppliersSectionProps) {
  const {
    relationQuery,
    suppliersQuery,
    canManage,
    canAdd,
    create,
    update,
    archive,
  } = useProductSuppliers(productId, productIsActive);
  const archiveLockRef = useRef(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingRelation, setEditingRelation] =
    useState<ProductSupplierRelation | null>(null);
  const [archivingRelation, setArchivingRelation] =
    useState<ProductSupplierRelation | null>(null);
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
      setSuccessMessage("Supplier link archived.");
    } finally {
      archiveLockRef.current = false;
      setIsArchiving(false);
    }
  }

  const relations = relationQuery.data?.ok ? relationQuery.data.value : [];
  const suppliers = suppliersQuery.data?.ok ? suppliersQuery.data.value : [];
  const supplierLoadError = suppliersQuery.isError ||
      suppliersQuery.data?.ok === false
    ? suppliersQuery.data?.ok === false
      ? suppliersQuery.data.error.message
      : "The Supplier list could not be loaded."
    : null;

  return (
    <section
      aria-labelledby="product-suppliers-heading"
      className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="product-suppliers-heading" className="text-xl font-bold text-zinc-900">
            Suppliers
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Supplier-specific Catalog Numbers for {productName}.
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
            Add Supplier
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
          <LoadingState message="Loading Supplier links..." />
        ) : relationQuery.isError || !relationQuery.data?.ok ? (
          <ErrorState
            title="Unable to load Supplier links"
            message={relationQuery.data?.ok === false
              ? relationQuery.data.error.message
              : "The Supplier links could not be loaded."}
            onRetry={() => void relationQuery.refetch()}
          />
        ) : relations.length === 0 ? (
          <EmptyState
            title="No Supplier links"
            description="This Product is not linked to a Supplier yet."
            action={canAdd
              ? {
                  label: "Add Supplier",
                  onClick: () => setIsAddOpen(true),
                }
              : undefined}
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-zinc-200">
            <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
              <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Supplier</th>
                  <th scope="col" className="px-4 py-3">Catalog Number</th>
                  <th scope="col" className="px-4 py-3">Relationship</th>
                  <th scope="col" className="px-4 py-3">Supplier status</th>
                  {canManage && <th scope="col" className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {relations.map((relation) => (
                  <tr key={relation.relationId}>
                    <td className="px-4 py-4 font-semibold text-zinc-900">
                      {relation.supplierName}
                      {!relation.supplierIsActive && (
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
                        label={relation.supplierIsActive ? "Active Supplier" : "Archived Supplier"}
                        tone={relation.supplierIsActive ? "success" : "warning"}
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

      <ProductSupplierDialog
        open={isAddOpen}
        mode="add"
        suppliers={suppliers}
        isSuppliersLoading={suppliersQuery.isPending}
        supplierLoadError={supplierLoadError}
        onRetrySuppliers={() => void suppliersQuery.refetch()}
        onClose={() => setIsAddOpen(false)}
        onSubmit={create}
        onSucceeded={() => setSuccessMessage("Supplier link added.")}
      />

      {editingRelation && (
        <ProductSupplierDialog
          open
          mode="edit"
          supplierName={editingRelation.supplierName}
          initialCatalogNumber={editingRelation.catalogNumber}
          onClose={() => setEditingRelation(null)}
          onSubmit={(input) => update(editingRelation.relationId, input)}
          onSucceeded={() => setSuccessMessage("Catalog Number updated.")}
        />
      )}

      <ConfirmDialog
        open={Boolean(archivingRelation)}
        title="Archive Supplier Link"
        description={archivingRelation
          ? `Archive the link to ${archivingRelation.supplierName}? It will remain in historical records and cannot be restored.`
          : "Archive this Supplier link?"}
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

export default ProductSuppliersSection;
