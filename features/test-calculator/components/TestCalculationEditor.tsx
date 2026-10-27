import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTestCalculatorProducts } from "../hooks/useTestCalculatorProducts";
import type { TestCalculatorProduct } from "../services/testCalculatorSearchService";
import { sarajevoToday, validateTestCalculationDraft, type TestCalculationDraft } from "../testCalculationDraft";
import { useTestCalculationPreview } from "../hooks/useTestCalculationPreview";
import TestCalculationPreviewTable from "./TestCalculationPreviewTable";
import { useTestCalculationSave } from "../hooks/useTestCalculationSave";

interface Props {
  initialDraft?: TestCalculationDraft;
  searchEnabledAfterActivation?: boolean;
  previewEnabledAfterActivation?: boolean;
  saveEnabledAfterActivation?: boolean;
  onProve?: (draft: TestCalculationDraft) => void;
  // Consumers must clear any prior proof on EVERY draft edit, not just quantities.
  onPreviewInvalidated?: () => void;
  onSaved?: () => void;
}
const inputClass = "w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-blue-600";
export default function TestCalculationEditor({ initialDraft, searchEnabledAfterActivation = false, previewEnabledAfterActivation = false, saveEnabledAfterActivation = false, onProve, onPreviewInvalidated, onSaved }: Props) {
  const id = useId();
  const [draft, setDraft] = useState<TestCalculationDraft>(() => initialDraft
    ? { ...initialDraft, items: initialDraft.items.map(item => ({ ...item })) }
    : { name: "", deadlineDate: "", items: [] });
  const [search, setSearch] = useState(""), [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const products = useTestCalculatorProducts(search, searchEnabledAfterActivation);
  const preview = useTestCalculationPreview(draft, previewEnabledAfterActivation);
  const save = useTestCalculationSave(draft,preview.preview,preview.draftFingerprint,saveEnabledAfterActivation);
  const notifiedSave = useRef<string | null>(null);
  useEffect(() => {
    if (save.saved && notifiedSave.current !== save.saved.calculationId) {
      notifiedSave.current = save.saved.calculationId;
      onSaved?.();
    }
  }, [save.saved, onSaved]);
  const change = (next: TestCalculationDraft) => {
    if(save.frozen)return;
    preview.invalidate(); setDraft(next); setErrors([]); setNotice(""); onPreviewInvalidated?.();
  };
  const add = (product: TestCalculatorProduct) => {
    if (draft.items.some(item => item.product.productId.toLowerCase() === product.productId.toLowerCase())) {
      setErrors(["Each Product may only be selected once."]); return;
    }
    if (draft.items.length >= 100) { setErrors(["Select 1 to 100 distinct Products."]); return; }
    change({ ...draft, items: [...draft.items, { product, quantity: "1" }] });
  };
  const prove = (event: FormEvent) => {
    event.preventDefault();
    if (preview.isPending) return;
    preview.invalidate();
    const failures = validateTestCalculationDraft(draft); setErrors(failures);
    if (failures.length) return;
    onProve?.({ ...draft, name: draft.name.trim(), items: draft.items.map(item => ({ ...item, product: { ...item.product } })) });
    if (previewEnabledAfterActivation) { setNotice(""); void preview.prove(); }
    else setNotice("Preview is not enabled until coordinated Test activation. No stock has been reserved; Save remains unavailable.");
  };
  const failed = products.isError || products.data?.ok === false;
  return <form noValidate onSubmit={prove} aria-label="Test Calculation editor"
    className="space-y-5 rounded-3xl border border-blue-200 bg-white p-4 shadow-sm sm:p-6">
    <h2 className="text-xl font-bold text-blue-900">Create Test Calculation</h2>
    <fieldset disabled={save.frozen} className="space-y-5">
    <label className="block space-y-2 text-sm font-semibold">Calculation name
      <input className={inputClass} required value={draft.name} onChange={e => change({ ...draft, name: e.target.value })} />
    </label>
    <label className="block space-y-2 text-sm font-semibold">Deadline (Europe/Sarajevo)
      <input type="date" className={inputClass} required min={sarajevoToday()} max="9999-12-31" aria-describedby={`${id}-deadline`}
        value={draft.deadlineDate} onChange={e => change({ ...draft, deadlineDate: e.target.value })} />
    </label>
    <p id={`${id}-deadline`} className="text-sm text-zinc-600">Reserved through this date; expires at the next Europe/Sarajevo local midnight, exclusive. Client date validation is advisory; the backend is authoritative.</p>
    <label className="block space-y-2 text-sm font-semibold">Search eligible Products
      <input type="search" maxLength={200} className={inputClass} value={search}
        onChange={e => setSearch(e.target.value)} disabled={!searchEnabledAfterActivation} />
    </label>
    {!searchEnabledAfterActivation ? <p className="text-sm text-blue-900">Product search is disabled until coordinated Test activation.</p>
      : !search.trim() ? <p className="text-sm text-zinc-600">Search by Product name or serial number.</p>
      : products.isSearchSettling || (products.isSearchEnabled && products.isPending) ? <p role="status">Searching eligible Products...</p>
      : failed ? <p role="alert" className="text-sm text-red-700">{products.data?.ok === false ? products.data.error.message : "Eligible Products could not be loaded."}</p>
      : products.data?.ok && products.data.value.length === 0 ? <p role="status">No eligible Products found.</p>
      : products.data?.ok ? <ul aria-label="Eligible Products" className="max-h-64 space-y-2 overflow-y-auto">
        {products.data.value.map(product => <li key={product.productId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-blue-50 p-3 text-sm">
          <span>{product.name} · <span className="font-mono">{product.serialNumber}</span> · {product.sourcePolicy === "finished_goods_only" ? "Finished Goods only" : "Raw → Customs → Finished Goods"}</span>
          <button type="button" className="rounded-lg border border-blue-300 px-3 py-2 font-semibold text-blue-900" onClick={() => add(product)}>Add {product.name}</button>
        </li>)}
      </ul> : <p role="status">Product search is unavailable.</p>}
    <fieldset className="space-y-3">
      <legend className="mb-3 font-semibold">Selected Products ({draft.items.length}/100)</legend>
      {draft.items.length === 0 && <p className="text-sm text-zinc-600">Add at least one eligible Product.</p>}
      {draft.items.map((item,index) => <div key={`${item.product.productId}-${index}`} className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 text-sm"><p className="font-semibold">{item.product.name}</p><p className="font-mono">{item.product.serialNumber}</p></div>
        <label className="space-y-1 text-sm">Required quantity for {item.product.name}
          <input type="text" inputMode="numeric" className={inputClass} required value={item.quantity}
            onChange={e => change({ ...draft, items: draft.items.map((row,i) => i === index ? { ...row, quantity: e.target.value } : row) })} />
        </label>
        <button type="button" className="rounded-lg px-3 py-2 text-sm font-semibold text-red-700" onClick={() => change({ ...draft, items: draft.items.filter((_,i) => i !== index) })}>Remove {item.product.name}</button>
      </div>)}
    </fieldset>
    </fieldset>
    {errors.length > 0 && <ul role="alert" className="space-y-1 text-sm text-red-700">{errors.map((error,index) => <li key={index}>{error}</li>)}</ul>}
    {notice && <p role="status" className="text-sm text-blue-900">{notice}</p>}
    {preview.isPending && <p role="status" className="text-sm text-blue-900">Proving calculation...</p>}
    {preview.error && <p role="alert" className="text-sm text-red-700">{preview.error}</p>}
    {preview.preview && !save.pending && !save.saved && <TestCalculationPreviewTable preview={preview.preview} />}
    {save.error && <p role="alert" className="text-sm text-red-700">{save.error}</p>}
    {save.pending && <section className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-4" aria-label="Pending Test Save recovery">
      <p>Unresolved Test Save: {save.pending.request.name}. Its original request is retained. Recovery replays the immutable payload, even after the deadline.</p>
      <p className="break-all text-sm">Original request: {save.pending.request.requestId}; Sarajevo deadline: {save.pending.request.deadlineDate}.</p>
      <ul className="text-sm">{save.pending.request.items.map(item=><li key={item.product_id}>{item.product_id}: required {item.quantity}</li>)}</ul>
      <button type="button" disabled={save.busy||save.blocked} onClick={()=>void save.recover()} className="rounded-xl border border-blue-700 px-4 py-2 text-sm font-semibold text-blue-900">Recover original Test Save</button>
    </section>}
    {save.saved && <section aria-label="Saved Test Calculation" className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-4">
      <h3 className="font-semibold text-blue-900">Test Calculation saved and reconciled</h3>
      <p>{save.saved.name} · {save.saved.calculationId}</p><p>Expires: {save.saved.expiresAt} (Europe/Sarajevo deadline).</p>
      <p>Historical saved allocations below are not a current stock balance.</p>
      <ul>{save.saved.items.map(item=><li key={item.productId}>{item.name} ({item.serialNumber}): Required {item.required}; Reserved {item.held}; Missing {item.missing}</li>)}</ul>
    </section>}
    <div className="flex flex-wrap gap-3">
      <button type="submit" disabled={preview.isPending||save.frozen} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:bg-blue-100 disabled:text-blue-800">Prove Calculation</button>
      <button type="button" disabled={!save.canSave} onClick={()=>void save.submit()} aria-describedby={`${id}-save`} className="rounded-xl bg-blue-700 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-600">{save.busy?"Saving Test Calculation...":"Save Test Calculation"}</button>
    </div>
    <p id={`${id}-save`} className="text-sm text-zinc-600">Save requires a current preview, valid deadline, verified recovery storage and coordinated activation. Preview availability is provisional; Save recalculates actual allocations.</p>
  </form>;
}
