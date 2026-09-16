import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";

import { useAuth } from "../../app/auth/AuthProvider";
import ConfirmDialog from "../../shared/components/ConfirmDialog";
import EmptyState from "../../shared/components/EmptyState";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import StatusBadge from "../../shared/components/StatusBadge";
import FixedAssetFormDialog from "./FixedAssetFormDialog";
import { fixedAssetListKey } from "./fixedAssetQueryKeys";
import {
  archiveFixedAsset,
  createFixedAsset,
  fixedAssetCategoryLabels,
  listFixedAssets,
  updateFixedAsset,
  type FixedAsset,
  type FixedAssetInput,
} from "./fixedAssetService";

function FixedAssetsPage() {
  const { profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const listKey = fixedAssetListKey(profile?.id);
  const query = useQuery({
    queryKey: listKey,
    queryFn: listFixedAssets,
    enabled: Boolean(profile?.id && isAdmin),
    staleTime: 60_000,
  });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FixedAsset | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<FixedAsset | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const archivingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: listKey, exact: true });

  async function save(input: FixedAssetInput) {
    const result = editing
      ? await updateFixedAsset(editing.id, input)
      : await createFixedAsset(input);
    if (result.ok) await invalidate();
    return result;
  }

  async function archive() {
    if (!archiveTarget || archivingRef.current) return;
    archivingRef.current = true;
    setIsArchiving(true);
    setError(null);
    try {
      const result = await archiveFixedAsset(archiveTarget.id);
      if (!result.ok) { setError(result.error); return; }
      await invalidate();
      setNotice("Fixed Asset archived.");
      setArchiveTarget(null);
    } finally {
      archivingRef.current = false;
      setIsArchiving(false);
    }
  }

  if (!profile || !isAdmin) {
    return <ErrorState title="Access denied" message="You do not have permission to view this area." />;
  }

  let content: ReactNode;
  if (query.isPending) {
    content = <LoadingState message="Loading Fixed Assets..." />;
  } else if (query.isError || !query.data?.ok) {
    content = <ErrorState title="Unable to load Fixed Assets"
      message={query.data?.ok === false ? query.data.error : "The Fixed Asset list could not be loaded."}
      onRetry={() => void query.refetch()} />;
  } else if (query.data.value.length === 0) {
    content = <EmptyState title="No Fixed Assets" description="No company assets have been added." />;
  } else {
    content = (
      <div className="overflow-x-auto rounded-3xl border border-zinc-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
          <thead className="bg-zinc-50"><tr>
            {["Naziv", "Kategorija", "Datum nabavke", "Količina", "Status", "Actions"].map((label) => (
              <th key={label} scope="col" className="px-4 py-3 font-semibold text-zinc-600">{label}</th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-zinc-100">
            {query.data.value.map((asset) => (
              <tr key={asset.id}>
                <td className="px-4 py-3 font-semibold">{asset.name}</td>
                <td className="px-4 py-3">{fixedAssetCategoryLabels[asset.category]}</td>
                <td className="px-4 py-3">{asset.purchaseDate}</td>
                <td className="px-4 py-3 tabular-nums">{asset.quantity}</td>
                <td className="px-4 py-3">
                  <StatusBadge label={asset.isActive ? "Active" : "Archived"}
                    tone={asset.isActive ? "success" : "neutral"} />
                </td>
                <td className="px-4 py-3">
                  {asset.isActive && <div className="flex gap-3">
                    <button type="button" onClick={() => { setEditing(asset); setFormOpen(true); }}>Edit</button>
                    <button type="button" onClick={() => { setError(null); setArchiveTarget(asset); }}>Archive</button>
                  </div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return <section className="space-y-6">
    <PageHeader title="Osnovna sredstva"
      description="Admin-only company assets, separate from warehouse Inventory."
      actions={<button type="button" onClick={() => { setEditing(null); setFormOpen(true); }}
        className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white">Add Asset</button>} />
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">{notice}</p>}
    {content}
    <FixedAssetFormDialog open={formOpen} asset={editing}
      onClose={() => setFormOpen(false)} onSubmit={save}
      onSuccess={() => setNotice(editing ? "Fixed Asset updated." : "Fixed Asset added.")} />
    <ConfirmDialog open={archiveTarget !== null} title="Archive Fixed Asset"
      description="This asset becomes historical and read-only. It is not deleted, and restoration is not currently supported."
      confirmLabel="Archive" confirmVariant="danger"
      onConfirm={() => void archive()}
      onCancel={() => { if (!isArchiving) { setArchiveTarget(null); setError(null); } }}
      isSubmitting={isArchiving} errorMessage={error} />
  </section>;
}

export default FixedAssetsPage;
