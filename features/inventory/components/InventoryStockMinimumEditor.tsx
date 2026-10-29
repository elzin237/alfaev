import { useId, useRef, useState } from "react";
import { validStockMinimum, type InventoryStockHealth, type StockHealthResult, type StockMinimumConfiguration } from "../services/inventoryStockHealthService";

// Shared version-aware minimum form, moved from the Inventory Product list.
export default function InventoryStockMinimumEditor({ row, canEdit, save }: {
  row: InventoryStockHealth;
  canEdit: boolean;
  save: (id: string, minimum: string | null, version: string | null) => Promise<StockHealthResult<StockMinimumConfiguration>>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.minimumQuantity ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const errorId = useId();
  async function submit(minimum: string | null) {
    if (lock.current || !canEdit || !row.isActive) return;
    if (minimum !== null && !validStockMinimum(minimum)) {
      setError("Enter a positive whole number up to 9223372036854775807.");
      return;
    }
    lock.current = true; setPending(true); setError(null);
    try {
      const result = await save(row.productId, minimum, row.version);
      if (result.ok) setEditing(false); else setError(result.error.message);
    } catch {
      setError("The outcome could not be verified. Refresh and review the minimum before trying again.");
    } finally { lock.current = false; setPending(false); }
  }
  if (!editing || !canEdit || !row.isActive) return <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
    <span className={row.minimumQuantity === null ? "text-sm font-medium text-zinc-500" : "text-xl font-semibold tabular-nums text-zinc-900"}>{row.minimumQuantity ?? "Not Configured"}</span>
    {canEdit && row.isActive && <button type="button" className="inline-flex min-h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-400 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2"
      onClick={() => { setValue(row.minimumQuantity ?? ""); setEditing(true); }}>
      {row.minimumQuantity === null ? "Configure Minimum" : "Edit Minimum"}
    </button>}
  </div>;
  return <form className="w-full max-w-md space-y-3 rounded-xl border border-zinc-200 bg-white p-4" aria-label="Edit minimum stock" aria-busy={pending} onSubmit={event => { event.preventDefault(); void submit(value); }}>
    <label className="block text-sm font-medium text-zinc-700">Minimum for {row.productName}
      <input autoFocus type="text" inputMode="numeric" autoComplete="off" value={value} disabled={pending} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
        onChange={event => { setValue(event.target.value); setError(null); }} className="mt-2 block min-h-11 w-full max-w-xs rounded-xl border border-zinc-300 bg-white px-3 py-2 text-base tabular-nums text-zinc-900 shadow-sm transition focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-60" />
    </label>
    <p className="text-xs leading-5 text-zinc-500">Use a positive whole number. Clear the minimum to leave stock health unconfigured.</p>
    {error && <p id={errorId} role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <button type="submit" disabled={pending} className="min-h-10 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">Save minimum</button>
      <button type="button" disabled={pending} onClick={() => void submit(null)} className="min-h-10 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">Clear minimum</button>
      <button type="button" disabled={pending} onClick={() => { setEditing(false); setError(null); }} className="min-h-10 rounded-xl px-3 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">Cancel</button>
    </div>
  </form>;
}
