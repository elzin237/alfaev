import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { maximumReservationChange, type useProjectFinishedGoodsMutations } from "../hooks/useProjectFinishedGoodsMutations";

type Controller = ReturnType<typeof useProjectFinishedGoodsMutations>;
const labels = { reserve: "Reserve", release: "Release", fulfill: "Fulfill" };
export function ProjectFinishedGoodsMutationDialog({ controller: c }: { controller: Controller }) {
  const id = useId();
  const dialog = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const selection = c.selection;
  const cannotClose = c.busy || c.frozen && !c.reconciled;
  useEffect(() => {
    if (!selection) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [selection]);
  useEffect(() => {
    if (!selection) return;
    const controls = () => [...(dialog.current?.querySelectorAll<HTMLElement>("input:not(:disabled),button:not(:disabled)") ?? [])];
    function contain() {
      if (!dialog.current?.contains(document.activeElement)) (controls()[0] ?? dialog.current)?.focus();
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); if (!cannotClose) c.close(); }
      if (event.key !== "Tab") return;
      const items = controls(), first = items[0], last = items[items.length - 1];
      if (!first || !last) { event.preventDefault(); dialog.current?.focus(); return; }
      if (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last ||
        !dialog.current?.contains(document.activeElement)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    }
    document.addEventListener("keydown", keydown); document.addEventListener("focusin", contain);
    contain();
    return () => { document.removeEventListener("keydown", keydown); document.removeEventListener("focusin", contain); };
  }, [selection, cannotClose, c.close]);
  useEffect(() => { if (c.outcome) cancel.current?.focus(); }, [c.outcome]);
  useEffect(() => {
    if (selection && !c.busy && !c.frozen && document.activeElement === dialog.current) input.current?.focus();
  }, [selection, c.busy, c.frozen]);
  if (!selection) return null;
  const label = labels[selection.operation];
  const complete = c.outcome?.ok === true && c.reconciled;
  const definiteFailure = c.outcome?.ok === false && !c.outcome.error.uncertain && c.reconciled;
  const eligible = selection.operation === "release" || c.activeProduct === true;
  return createPortal(<div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/40 p-4">
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      aria-busy={c.busy} tabIndex={-1} className="w-full max-w-xl rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl sm:p-8">
      <h2 id={`${id}-title`} className="text-xl font-bold">{label} Finished Goods</h2>
      <p className="mt-2 font-medium">{selection.row.productName} <span className="font-mono">{selection.row.serialNumber}</span></p>
      <p id={`${id}-description`} className="mt-3 text-sm text-zinc-600">{selection.operation === "fulfill"
        ? "Fulfillment deducts this quantity from both this Project's reservation and physical Finished Goods stock."
        : selection.operation === "release" ? "Release reduces this Project's reservation without deducting physical stock."
          : "Reserve an additional quantity for this Project. Available stock alone is not a reservation."}</p>
      <label htmlFor={`${id}-quantity`} className="mt-5 block text-sm font-semibold">Quantity to {selection.operation}</label>
      <input ref={input} id={`${id}-quantity`} type="text" inputMode="numeric" maxLength={19} autoComplete="off" value={c.quantity}
        disabled={c.busy || c.frozen} onChange={event => c.setQuantity(event.target.value)}
        className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:bg-zinc-100" />
      {!c.recovered && <p className="mt-2 text-sm text-zinc-500">Maximum change at review: {maximumReservationChange(selection.row, selection.operation).toString()}.</p>}
      {c.request && <dl className="mt-3 break-all text-xs text-zinc-600">
        <dt>Original request ID</dt><dd>{c.request.requestId}</dd>
        <dt>Product ID</dt><dd>{c.request.productId}</dd>
        <dt>Expected reservation version</dt><dd>{c.request.expectedVersion.toString()}</dd>
      </dl>}
      {c.frozen && <p className="mt-2 text-sm text-zinc-600">The original request is fixed. Retrying never changes its quantity, version or request ID.</p>}
      {c.recovered && <p role="status" className="mt-2 text-sm text-zinc-600">A saved request was recovered. Its saved status is not proof of success. Review the original operation and explicitly retry to verify its result.</p>}
      {c.uncertain && <p className="mt-2 text-sm text-zinc-600">The original request is retained across reloads. Do not clear browser data or submit a replacement operation.</p>}
      {c.recoveryIssue && <p role="alert" className="mt-3 text-sm text-red-700">{c.recoveryIssue}</p>}
      {c.error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{c.error}</p>}
      {complete && <p role="status" className="mt-4 rounded-xl bg-green-50 p-3 text-sm text-green-800">Operation confirmed and authoritative state refreshed. A retry receipt may describe an earlier state; current stock is read separately.</p>}
      {definiteFailure && <p className="mt-2 text-sm">Close and review refreshed quantities before starting a new operation.</p>}
      <div className="mt-6 flex justify-end gap-3">
        <button ref={cancel} type="button" disabled={cannotClose} onClick={c.close}
          className="rounded-xl border border-zinc-300 px-4 py-2 focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50">{complete || definiteFailure ? "Close" : "Cancel"}</button>
        {!complete && !definiteFailure && <button type="button" disabled={c.busy || !c.authorized || Boolean(c.recoveryIssue) || (!c.frozen && (!eligible || !c.openProject))}
          onClick={() => void c.submit()} className="rounded-xl bg-red-600 px-4 py-2 font-semibold text-white focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:opacity-50">
          {c.busy ? "Checking request…" : c.retryRefreshOnly ? "Retry authoritative refresh" : c.frozen ? "Retry exact original request" : label}</button>}
        {c.recoveryIssue && <button type="button" disabled={c.busy} onClick={c.checkRecovery}
          className="rounded-xl border border-zinc-300 px-4 py-2 focus-visible:ring-2 focus-visible:ring-red-500">Check recovery storage</button>}
      </div>
    </section>
  </div>, document.body);
}
