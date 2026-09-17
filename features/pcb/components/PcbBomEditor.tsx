import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import EmptyState from "../../../shared/components/EmptyState";
import ErrorState from "../../../shared/components/ErrorState";
import LoadingState from "../../../shared/components/LoadingState";
import StatusBadge from "../../../shared/components/StatusBadge";
import { pcbBomChoicesQueryKey } from "../pcbQueryKeys";
import {
  parseEditableQuantity, searchPcbBomProductChoices,
  type PcbBomDetail, type PcbBomProductChoice, type PcbBomResult,
  type PcbBomSaveItem,
} from "../services/pcbBomService";

interface Props {
  detail: PcbBomDetail;
  canEdit: boolean;
  profileId: string | undefined;
  onSave: (items: PcbBomSaveItem[]) => Promise<PcbBomResult<{ versionId: string; versionNumber: string }>>;
}

interface DraftRow {
  productId: string;
  name: string;
  serialNumber: string;
  productKind: "component" | "pcb_finished_good";
  isActive: boolean;
  currentStock: string;
  quantityPerCard: string;
}

function fromDetail(detail: PcbBomDetail): DraftRow[] {
  return detail.items.map((item) => ({ ...item }));
}

function signature(rows: Array<{ productId: string; quantityPerCard: string }>): string {
  return JSON.stringify(rows.map((row) => ({
    productId: row.productId,
    quantity: parseEditableQuantity(row.quantityPerCard) ?? row.quantityPerCard,
  })).sort((a, b) => a.productId.localeCompare(b.productId)));
}

function kindLabel(kind: DraftRow["productKind"]): string {
  return kind === "component" ? "Component" : "PCB finished good";
}

export default function PcbBomEditor({ detail, canEdit, profileId, onSave }: Props) {
  const [rows, setRows] = useState<DraftRow[]>(() => fromDetail(detail));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    setRows(fromDetail(detail));
  }, [detail]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const choicesQuery = useQuery({
    queryKey: pcbBomChoicesQueryKey(profileId, detail.cardId, debouncedSearch),
    queryFn: () => searchPcbBomProductChoices(detail.cardId, debouncedSearch),
    enabled: Boolean(canEdit && pickerOpen && profileId),
    staleTime: 0,
  });
  const selectedIds = new Set(rows.map((row) => row.productId));
  const choices = choicesQuery.data?.ok
    ? choicesQuery.data.value.filter((choice) => !selectedIds.has(choice.productId) &&
      choice.productId !== detail.outputProductId)
    : [];
  const dirty = detail.versionId === null || signature(rows) !== signature(detail.items);

  function addProduct(choice: PcbBomProductChoice) {
    if (!canEdit || selectedIds.has(choice.productId) || choice.productId === detail.outputProductId) return;
    setRows((current) => [...current, { ...choice, isActive: true, quantityPerCard: "1" }]);
    setPickerOpen(false);
    setSearch("");
    setDebouncedSearch("");
    setError(null);
    setSuccess(null);
  }

  async function save() {
    if (!canEdit || savingRef.current || !dirty) return;
    const ids = rows.map((row) => row.productId);
    if (new Set(ids).size !== ids.length || ids.includes(detail.outputProductId)) {
      setError("Each eligible Product may appear only once in the BOM.");
      return;
    }
    if (rows.some((row) => parseEditableQuantity(row.quantityPerCard) === null)) {
      setError("Qty per Card must be a positive whole number within the bigint range.");
      return;
    }
    if (rows.some((row) => !row.isActive &&
      detail.items.find((item) => item.productId === row.productId)?.quantityPerCard !== row.quantityPerCard)) {
      setError("An archived Product's Qty per Card cannot be changed.");
      return;
    }
    savingRef.current = true;
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await onSave(rows.map((row) => ({
        productId: row.productId,
        quantityPerCard: parseEditableQuantity(row.quantityPerCard) ?? row.quantityPerCard,
      })));
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setSuccess(`PCB BOM version ${result.value.versionNumber} saved.`);
    } catch {
      setError("PCB BOM could not be saved.");
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  return (
    <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8" aria-label="Active BOM">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-900">Active BOM</h2>
          <p className="mt-1 text-sm text-zinc-500">{detail.versionNumber === null
            ? "No BOM saved yet." : `Version ${detail.versionNumber}`}</p>
        </div>
        {canEdit && <button type="button" disabled={isSaving} onClick={() => setPickerOpen((open) => !open)}
          className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800">
          Add Product
        </button>}
      </div>

      {rows.length === 0 ? <div className="mt-5"><EmptyState title="No BOM inputs"
        description="Add eligible Products to define this PCB Card's BOM." /></div> :
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-600"><tr>
              <th className="py-3 pr-4">Product</th><th className="py-3 pr-4">Serial Number</th>
              <th className="py-3 pr-4">Kind / Status</th><th className="py-3 pr-4">Current Stock</th>
              <th className="py-3 pr-4">Qty per Card</th>{canEdit && <th className="py-3">Action</th>}
            </tr></thead>
            <tbody className="divide-y divide-zinc-100">{rows.map((row) => <tr key={row.productId}>
              <td className="py-4 pr-4 font-semibold text-zinc-900">{row.name}</td>
              <td className="py-4 pr-4 font-mono">{row.serialNumber}</td>
              <td className="py-4 pr-4"><span className="mr-2">{kindLabel(row.productKind)}</span>
                {!row.isActive && <StatusBadge label="Archived" tone="neutral" />}</td>
              <td className="py-4 pr-4">{row.currentStock}</td>
              <td className="py-4 pr-4">{canEdit && row.isActive
                ? <input aria-label={`Qty per Card for ${row.name}`} inputMode="numeric" value={row.quantityPerCard}
                    disabled={isSaving}
                    onChange={(event) => { setRows((current) => current.map((item) => item.productId === row.productId
                      ? { ...item, quantityPerCard: event.target.value } : item)); setSuccess(null); }}
                    className="w-28 rounded-xl border border-zinc-300 px-3 py-2" />
                : <span>{row.quantityPerCard}</span>}</td>
              {canEdit && <td className="py-4"><button type="button" disabled={isSaving} onClick={() => {
                setRows((current) => current.filter((item) => item.productId !== row.productId));
                setSuccess(null);
              }} className="text-sm font-semibold text-red-700">Remove</button></td>}
            </tr>)}</tbody>
          </table>
        </div>}

      {canEdit && pickerOpen && <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
        <label htmlFor="pcb-product-search" className="block text-sm font-semibold text-zinc-800">Search Products</label>
        <input id="pcb-product-search" value={search} disabled={isSaving}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Name or Serial Number" className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-2 text-sm" />
        <div className="mt-4">{choicesQuery.isPending ? <LoadingState message="Loading Product choices..." /> :
          choicesQuery.isError || !choicesQuery.data?.ok ?
            <ErrorState message="Product choices could not be loaded." onRetry={() => void choicesQuery.refetch()} /> :
          choices.length === 0 ? <p className="text-sm text-zinc-600">No eligible Products found.</p> :
          <ul className="max-h-72 divide-y divide-zinc-200 overflow-y-auto">{choices.map((choice) => <li key={choice.productId}>
            <button type="button" disabled={isSaving} onClick={() => addProduct(choice)}
              className="flex w-full flex-wrap justify-between gap-2 py-3 text-left text-sm hover:text-red-700">
              <span className="font-semibold">{choice.name} <span className="font-mono">{choice.serialNumber}</span></span>
              <span>{kindLabel(choice.productKind)} · Stock: {choice.currentStock}</span>
            </button>
          </li>)}</ul>}</div>
      </div>}

      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      {success && <p role="status" className="mt-4 text-sm text-emerald-700">{success}</p>}
      {canEdit && <div className="mt-6 flex justify-end">
        <button type="button" onClick={() => void save()} disabled={!dirty || isSaving}
          className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
          {isSaving ? "Saving..." : "Save BOM"}
        </button>
      </div>}
    </section>
  );
}
