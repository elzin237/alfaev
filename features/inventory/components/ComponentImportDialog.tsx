import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import ConfirmDialog from "../../../shared/components/ConfirmDialog";
import { createComponentImportTemplate } from "../import/componentImportTemplate";
import type {
  ComponentImportPreview,
  ComponentImportSubmissionRow,
} from "../import/componentImportTypes";
import { parseComponentImportWorkbook } from "../import/componentImportWorkbook";
import type { Brand } from "../services/brandService";
import type {
  ComponentImportError,
  ComponentImportResult,
  ComponentImportSuccess,
} from "../services/componentImportService";

const xlsxMime =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type DialogState =
  | { kind: "initial" }
  | { kind: "parsing"; filename: string }
  | { kind: "file_error"; message: string }
  | { kind: "preview"; preview: ComponentImportPreview; filename: string }
  | { kind: "confirming"; preview: ComponentImportPreview; filename: string }
  | { kind: "submitting"; preview: ComponentImportPreview; filename: string }
  | {
    kind: "mutation_error";
    preview: ComponentImportPreview;
    filename: string;
    error: ComponentImportError;
  };

export interface ComponentImportDialogProps {
  open: boolean;
  brands: Brand[];
  isBrandsLoading: boolean;
  brandLoadError: string | null;
  onRetryBrands: () => void;
  onClose: () => void;
  onSubmit: (
    rows: readonly ComponentImportSubmissionRow[],
  ) => Promise<ComponentImportResult>;
  onSucceeded: (result: ComponentImportSuccess) => void;
}

function downloadTemplate(): void {
  const bytes = createComponentImportTemplate();
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: xlsxMime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "alfaev-component-import-template.xlsx";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function previewFromState(state: DialogState): ComponentImportPreview | null {
  return "preview" in state ? state.preview : null;
}

function ComponentImportDialog({
  open,
  brands,
  isBrandsLoading,
  brandLoadError,
  onRetryBrands,
  onClose,
  onSubmit,
  onSucceeded,
}: ComponentImportDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const parseRevisionRef = useRef(0);
  const submissionLockRef = useRef(false);
  const [state, setState] = useState<DialogState>({ kind: "initial" });
  const isSubmitting = state.kind === "submitting";
  const preview = previewFromState(state);

  const reset = useCallback(() => {
    parseRevisionRef.current += 1;
    submissionLockRef.current = false;
    setState({ kind: "initial" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const closeSafely = useCallback(() => {
    if (submissionLockRef.current || isSubmitting) return;
    reset();
    onClose();
  }, [isSubmitting, onClose, reset]);

  useEffect(() => {
    if (open) {
      reset();
      queueMicrotask(() => fileInputRef.current?.focus());
    } else {
      parseRevisionRef.current += 1;
    }
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && state.kind !== "confirming") {
        event.preventDefault();
        closeSafely();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeSafely, open, state.kind]);

  async function selectFile(file: File | undefined): Promise<void> {
    if (!file || isBrandsLoading || brandLoadError || submissionLockRef.current) return;
    const revision = ++parseRevisionRef.current;
    setState({ kind: "parsing", filename: file.name });
    const result = await parseComponentImportWorkbook(file, brands);
    if (revision !== parseRevisionRef.current || !open) return;
    if (!result.ok) {
      setState({ kind: "file_error", message: result.error.message });
      return;
    }
    setState({ kind: "preview", preview: result.preview, filename: file.name });
  }

  async function confirmImport(): Promise<void> {
    if (state.kind !== "confirming" || submissionLockRef.current) return;
    const rows = state.preview.submissionRows;
    if (!rows) return;

    submissionLockRef.current = true;
    setState({ ...state, kind: "submitting" });
    try {
      const result = await onSubmit(rows);
      if (!result.ok) {
        setState({ ...state, kind: "mutation_error", error: result.error });
        return;
      }
      onSucceeded(result.value);
      reset();
      onClose();
    } finally {
      submissionLockRef.current = false;
    }
  }

  if (!open) return null;

  const canChooseFile = !isBrandsLoading && !brandLoadError && !isSubmitting;
  const canRequestImport = state.kind === "preview" &&
    state.preview.canImport &&
    state.preview.submissionRows !== null &&
    !isBrandsLoading &&
    !brandLoadError;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60] overflow-x-hidden overflow-y-auto bg-black/40 p-3 sm:p-6">
        <div className="flex min-h-full items-center justify-center">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          aria-busy={isSubmitting || state.kind === "parsing"}
          className="flex max-h-[calc(100dvh-1.5rem)] min-w-0 w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-xl sm:max-h-[calc(100dvh-3rem)]"
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200 px-4 py-4 sm:px-6 sm:py-5">
            <div className="min-w-0">
              <h2 id={titleId} className="text-2xl font-bold text-zinc-900">
                Import Components from Excel
              </h2>
              <p id={descriptionId} className="mt-2 text-sm leading-6 text-zinc-500">
                Upload one .xlsx workbook. AlfaEV imports the complete valid batch only after confirmation.
              </p>
            </div>
            <button
              type="button"
              onClick={closeSafely}
              disabled={isSubmitting}
              aria-label="Close Component import"
              className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Close
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex min-w-0 flex-col gap-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0 flex-1">
              <label htmlFor="component-import-file" className="block text-sm font-semibold text-zinc-800">
                Excel workbook
              </label>
              <input
                ref={fileInputRef}
                id="component-import-file"
                type="file"
                accept={`.xlsx,${xlsxMime}`}
                disabled={!canChooseFile}
                onClick={(event) => {
                  event.currentTarget.value = "";
                }}
                onChange={(event) => void selectFile(event.target.files?.[0])}
                className="mt-2 block min-w-0 max-w-full text-sm text-zinc-700 file:mr-4 file:rounded-lg file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:font-semibold file:text-white disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <button
              type="button"
              onClick={downloadTemplate}
              disabled={isSubmitting}
              className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Download Template
            </button>
          </div>

          {isBrandsLoading && (
            <p role="status" className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
              Loading Brands before workbook validation...
            </p>
          )}
          {brandLoadError && (
            <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <p>{brandLoadError}</p>
              <button type="button" onClick={onRetryBrands} className="mt-2 font-semibold underline underline-offset-2">
                Try again
              </button>
            </div>
          )}
          {state.kind === "parsing" && (
            <p role="status" className="mt-4 text-sm font-medium text-zinc-700">
              Parsing {state.filename}...
            </p>
          )}
          {state.kind === "file_error" && (
            <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {state.message}
            </p>
          )}
          {state.kind === "mutation_error" && (
            <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <p>{state.error.message}</p>
              <button
                type="button"
                onClick={() => {
                  if (state.error.code === "brand_unavailable") onRetryBrands();
                  reset();
                }}
                className="mt-2 font-semibold underline underline-offset-2"
              >
                {state.error.code === "brand_unavailable"
                  ? "Refresh Brands and upload again"
                  : "Upload workbook again"}
              </button>
            </div>
          )}

          {preview && (
            <div className="mt-6 space-y-4">
              <div className="grid gap-3 sm:grid-cols-3" aria-label="Import summary">
                {[
                  ["Total", preview.totalRows],
                  ["Ready", preview.readyRows],
                  ["Invalid", preview.invalidRows],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
                    <p className="mt-1 text-xl font-bold text-zinc-900">{value}</p>
                  </div>
                ))}
              </div>

              {preview.invalidRows > 0 && (
                <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Correct every invalid row in the workbook and upload it again. No rows can be imported from this preview.
                </p>
              )}

              <div className="max-h-96 max-w-full overflow-x-auto overflow-y-auto rounded-2xl border border-zinc-200">
                <table className="w-full min-w-[48rem] divide-y divide-zinc-200 text-left text-sm">
                  <thead className="sticky top-0 bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600">
                    <tr>
                      <th className="px-4 py-3">Row</th>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Brand</th>
                      <th className="px-4 py-3">Status / Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 bg-white">
                    {preview.rows.map((row) => (
                      <tr key={row.rowNumber}>
                        <td className="px-4 py-3 font-mono text-zinc-700">{row.rowNumber}</td>
                        <td className="px-4 py-3 text-zinc-900">{row.name || "—"}</td>
                        <td className="px-4 py-3 text-zinc-700">{row.category || "—"}</td>
                        <td className="px-4 py-3 text-zinc-700">{row.brand ?? "No Brand"}</td>
                        <td className="px-4 py-3">
                          <span className={row.status === "ready" ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>
                            {row.status === "ready" ? "Ready" : "Invalid"}
                          </span>
                          {row.errors.length > 0 && (
                            <ul className="mt-1 list-disc space-y-1 pl-5 text-red-700">
                              {row.errors.map((error) => (
                                <li key={`${error.field}-${error.code}`}>{error.message}</li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          </div>

          <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-zinc-200 px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
            <button
              type="button"
              onClick={closeSafely}
              disabled={isSubmitting}
              className="rounded-xl border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            {preview && (
              <button
                type="button"
                disabled={!canRequestImport}
                onClick={() => {
                  if (state.kind === "preview") setState({ ...state, kind: "confirming" });
                }}
                className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Import {preview.totalRows} {preview.totalRows === 1 ? "Component" : "Components"}
              </button>
            )}
          </div>
        </section>
        </div>
      </div>

      <ConfirmDialog
        open={state.kind === "confirming" || state.kind === "submitting"}
        title="Import Components"
        description={`Import ${preview?.totalRows ?? 0} ${preview?.totalRows === 1 ? "Component" : "Components"} into Inventory? AlfaEV will generate Serial Numbers automatically. The entire batch succeeds or fails together.`}
        confirmLabel={isSubmitting ? "Importing" : "Import Components"}
        isSubmitting={isSubmitting}
        layerClassName="z-[70]"
        onCancel={() => {
          if (state.kind === "confirming") setState({ ...state, kind: "preview" });
        }}
        onConfirm={() => void confirmImport()}
      />
    </>,
    document.body,
  );
}

export default ComponentImportDialog;
