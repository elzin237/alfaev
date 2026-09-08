import { useRef, useState, type ReactNode } from "react";

import ConfirmDialog from "../../shared/components/ConfirmDialog";
import EmptyState from "../../shared/components/EmptyState";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import BrandFormDialog from "./components/BrandFormDialog";
import BrandList from "./components/BrandList";
import { useBrandManagement } from "./hooks/useBrandManagement";
import type { Brand } from "./services/brandService";

function InventoryPage() {
  const { brandsQuery, canManage, create, update, archive } =
    useBrandManagement();
  const archiveLockRef = useRef(false);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Brand | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  let content: ReactNode;

  if (brandsQuery.isPending) {
    content = <LoadingState message="Loading Brands..." />;
  } else if (brandsQuery.isError || !brandsQuery.data?.ok) {
    content = (
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
    content = (
      <EmptyState
        title="No Brands found"
        description="There are no Inventory Brands to display."
        action={canManage ? { label: "Add Brand", onClick: openCreateDialog } : undefined}
      />
    );
  } else {
    content = (
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
      />

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
        {content}
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
            : create(name)
        }
        onSucceeded={() => {
          setSuccessMessage(
            formMode === "edit" ? "Brand updated." : "Brand added.",
          );
          setActionError(null);
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
