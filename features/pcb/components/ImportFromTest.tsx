import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { isTestCalculationImportEnabled } from "../../../app/config/testCalculationImportActivation";
import StatusBadge from "../../../shared/components/StatusBadge";
import { useTestCalculationImport } from "../../test-calculator/hooks/useTestCalculationImport";
import { useTestCalculationDetail } from "../../test-calculator/hooks/useTestCalculationHistory";
import { useTestImportSelection } from "../../test-calculator/hooks/useTestImportSelection";
import { validImportSerial } from "../../test-calculator/services/testCalculationImportService";
import { formatHistoryDeadline, formatHistoryTimestamp } from "../../test-calculator/testCalculationHistoryDates";
import { useTestConversions } from "../../test-calculator/hooks/useTestConversions";

const secondary = "rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50";
const primary = "rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50";
const inputStyle = "mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";
type ImportController = ReturnType<typeof useTestCalculationImport>;

// Gate OFF mounts no auth, history, permission or import hooks.
export default function ImportFromTest() {
  return isTestCalculationImportEnabled() ? <AuthorizedImport /> : null;
}
function AuthorizedImport() {
  const importer = useTestCalculationImport();
  return importer.authorized ? <ImportEntry key={importer.scope} importer={importer} /> : null;
}
function ImportEntry({ importer }: { importer: ImportController }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={secondary} onClick={() => setOpen(true)}>Import from Test</button>
    {open && <ImportDialog importer={importer} onClose={() => setOpen(false)} />}
  </>;
}
function ImportDialog({ importer, onClose }: { importer: ImportController; onClose: () => void }) {
  const titleId = useId(), searchId = useId(), serialId = useId(), confirmId = useId();
  const panel = useRef<HTMLElement>(null), closeButton = useRef<HTMLButtonElement>(null), submitLock = useRef(false);
  const [search, setSearch] = useState(""), [selectedId, setSelectedId] = useState<string | null>(null);
  const [serial, setSerial] = useState(""), [confirm, setConfirm] = useState(false), [serialError, setSerialError] = useState(false);
  const frozen = Boolean(importer.pending || importer.busy || importer.saved || importer.blocked);
  const history = useTestImportSelection(!frozen);
  const detail = useTestCalculationDetail(selectedId, !frozen);
  const conversions = useTestConversions([...new Set([...history.rows.map(row=>row.calculationId),...(selectedId?[selectedId]:[])])],!frozen);
  const selectedConversion = conversions.rows?.find(row=>row.calculation_id===selectedId);
  const savedSource = !frozen && !detail.query.isFetching && !detail.query.isError && detail.query.data?.ok &&
    detail.query.data.value.calculationId === selectedId ? detail.query.data.value : null;
  const rows = history.rows.filter(row => conversions.rows?.some(c=>c.calculation_id===row.calculationId&&!c.imported)&&row.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (!importer.busy && !submitLock.current) onClose(); }
      if (event.key !== "Tab") return;
      const controls = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]');
      const first = controls?.[0], last = controls?.[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown); return () => document.removeEventListener("keydown", keydown);
  }, [importer.busy, onClose]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (submitLock.current || frozen) return;
    setSerialError(!validImportSerial(serial));
    if (!savedSource || !conversions.ready || selectedConversion?.imported!==false || !validImportSerial(serial) || !confirm || !importer.canImport) return;
    submitLock.current = true;
    try { await importer.submit({ calculationId: savedSource.calculationId, serialNumber: serial }, true); }
    finally { submitLock.current = false; }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-6">
    <section ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={importer.busy}
      className="max-h-[90dvh] w-full max-w-3xl space-y-5 overflow-y-auto rounded-3xl border border-zinc-200 bg-white p-5 shadow-xl sm:p-7">
      <header className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 id={titleId} className="text-xl font-bold text-zinc-900">Import from Test</h2>
        <p className="mt-1 text-sm text-zinc-500">Create a permanent Product Calculator from an immutable saved Test.</p></div>
        <button ref={closeButton} type="button" className={secondary} disabled={importer.busy} onClick={onClose}>Close</button></header>
      {importer.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{importer.error}</p>}
      {importer.saved ? <div role="status" className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <h3 className="font-bold">Product Calculator imported</h3><p className="break-words">{importer.saved.name} · Serial {importer.saved.serial_number}</p>
        <p>The source Test remains in history. Physical Inventory stock has not changed.</p>
        <Link className="inline-block font-semibold underline" to={`/pcb/${importer.saved.pcb_card_id}`}>Open Product Calculator</Link>
      </div> : importer.pending ? <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <h3 className="font-bold">Recover original import</h3><p>No replacement import will be created. Recovery uses the original request UUID and unchanged payload.</p>
        <dl className="space-y-1 break-all"><div><dt className="inline font-semibold">Source Test: </dt><dd className="inline">{importer.pending.request.calculationId}</dd></div>
          <div><dt className="inline font-semibold">Output serial: </dt><dd className="inline font-mono">{importer.pending.request.serialNumber}</dd></div></dl>
        <button type="button" className={primary} disabled={importer.busy || importer.blocked} onClick={() => void importer.recover()}>{importer.busy ? "Verifying import…" : "Recover original request"}</button>
      </div> : importer.blocked ? <p role="alert" className="text-sm text-red-700">Import recovery is unavailable. No new request can be submitted.</p> : <form className="space-y-5" onSubmit={event => void submit(event)} noValidate>
        <section aria-label="Select saved Test Calculation" className="space-y-3">
          <label htmlFor={searchId} className="block text-sm font-semibold text-zinc-800">Search calculations on this page</label>
          <input id={searchId} type="search" value={search} onChange={event => setSearch(event.target.value)} className={inputStyle} aria-describedby={`${searchId}-help`} />
          <p id={`${searchId}-help`} className="text-xs text-zinc-500">20 calculations per page. Search applies to this page; use Next for older calculations. Active and Expired Tests can be imported. Dates: Europe/Sarajevo.</p>
          {history.query.isFetching ? <p role="status">Loading saved calculations…</p> : conversions.error ? <div role="alert">Conversion status unavailable. Selection is blocked.<button type="button" className={secondary} onClick={()=>void conversions.refresh()}>Retry conversion status</button></div> : history.rows.length>0&&!conversions.ready ? <p role="status">Checking conversion status…</p> : history.query.isError || history.query.data?.ok === false ?
            <div role="alert"><p>{history.query.data?.ok === false ? history.query.data.error.message : "Saved calculations could not be loaded."}</p><button className={secondary} type="button" onClick={() => void history.query.refetch()}>Retry history</button></div> :
            rows.length === 0 ? <p className="rounded-xl bg-zinc-50 p-4 text-sm text-zinc-600">{search ? "No matching calculations on this page." : history.rows.length ? "All calculations on this page have already been imported." : "No saved calculations on this page."}</p> :
            <fieldset className="max-h-60 space-y-2 overflow-y-auto rounded-xl border border-zinc-200 p-2"><legend className="sr-only">Choose a source Test</legend>
              {rows.map(row => <label key={row.calculationId} className="flex cursor-pointer items-start gap-3 rounded-lg p-3 hover:bg-zinc-50">
                <input type="radio" name={titleId} value={row.calculationId} checked={selectedId === row.calculationId} onChange={() => { setSelectedId(row.calculationId); setConfirm(false); }} className="mt-1 shrink-0" />
                <span className="min-w-0 flex-1"><span className="block break-words font-semibold text-zinc-900">{row.name}</span>
                  <span className="block text-xs leading-5 text-zinc-500">Created {formatHistoryTimestamp(row.createdAt)} · Deadline {formatHistoryDeadline(row.deadlineDate)}</span></span>
                <StatusBadge label={row.status === "active" ? "Active" : "Expired"} tone={row.status === "active" ? "info" : "neutral"} />
              </label>)}
            </fieldset>}
          <nav aria-label="Test Calculation pages" className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <button type="button" className={secondary} disabled={!history.hasPrevious || history.query.isFetching} onClick={() => { history.previous(); setSearch(""); }}>Previous</button>
            <span>Page {history.page}</span><button type="button" className={secondary} disabled={!history.hasNext || history.query.isFetching} onClick={() => { history.next(); setSearch(""); }}>Next</button>
          </nav>
        </section>
        {selectedId && <section aria-label="Selected Test preview" className="space-y-3 rounded-xl border border-zinc-200 p-4">
          {selectedConversion?.imported&&<p role="alert" className="text-sm text-amber-800">The selected Test has already been imported. Choose another calculation.</p>}
          {detail.query.isFetching ? <p role="status">Loading saved component definition…</p> : !savedSource ? <div role="alert"><p>Selected Test details are unavailable. Import is blocked.</p><button type="button" className={secondary} onClick={() => void detail.query.refetch()}>Retry detail</button></div> : <>
            <h3 className="break-words font-bold text-zinc-900">{savedSource.name}</h3>
            <p className="text-xs text-zinc-500">Saved, immutable component definition. Each required quantity becomes BOM quantity per one finished Product unit.</p>
            <ul className="max-h-52 divide-y divide-zinc-100 overflow-y-auto text-sm">{savedSource.items.map(item => <li key={item.itemId} className="flex flex-wrap justify-between gap-2 py-2">
              <span className="min-w-0 break-words font-semibold" title={`Product ID: ${item.productId}`}>{item.name} <span className="font-mono font-normal text-zinc-500">({item.serialNumber})</span></span>
              <span className="break-all font-mono">Required: {item.required}</span></li>)}</ul>
          </>}
        </section>}
        <div><label htmlFor={serialId} className="block text-sm font-semibold text-zinc-800">New output Product serial</label>
          <input id={serialId} type="text" inputMode="numeric" autoComplete="off" value={serial} maxLength={3} className={`${inputStyle} max-w-40 font-mono`}
            aria-describedby={`${serialId}-help`} aria-invalid={serialError || Boolean(serial && !validImportSerial(serial))}
            onChange={event => { setSerial(event.target.value); setConfirm(false); setSerialError(false); }} />
          <p id={`${serialId}-help`} className="mt-1 text-xs text-zinc-500">Exactly three ASCII digits, e.g. 006. Serial uniqueness is checked by the server.</p>
          {(serialError || Boolean(serial && !validImportSerial(serial))) && <p role="alert" className="mt-1 text-sm text-red-700">Enter exactly three ASCII digits.</p>}
        </div>
        {savedSource && selectedConversion?.imported===false && validImportSerial(serial) && <section aria-label="Import confirmation" className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-sm text-blue-950">
          <h3 className="font-bold">Confirm permanent import</h3>
          <dl className="space-y-1 break-words"><div><dt className="inline font-semibold">Source Test: </dt><dd className="inline">{savedSource.name}</dd></div>
            <div><dt className="inline font-semibold">Destination Product / Calculator: </dt><dd className="inline">{savedSource.name}</dd></div>
            <div><dt className="inline font-semibold">New serial: </dt><dd className="inline font-mono">{serial}</dd></div>
            <div><dt className="inline font-semibold">Source components: </dt><dd className="inline">{savedSource.items.length}</dd></div></dl>
          <p>Importing releases only the selected Test’s remaining active commitments. Physical Inventory stock will not change. The original Test remains immutable in history.</p>
          <label htmlFor={confirmId} className="flex items-start gap-2 font-semibold"><input id={confirmId} type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)} className="mt-1" />I confirm this permanent import and the commitment release described above.</label>
        </section>}
        <div className="flex justify-end"><button type="submit" className={primary} disabled={!importer.canImport || !conversions.ready || selectedConversion?.imported!==false || !savedSource || !validImportSerial(serial) || !confirm}>Import Product Calculator</button></div>
      </form>}
    </section>
  </div>;
}
