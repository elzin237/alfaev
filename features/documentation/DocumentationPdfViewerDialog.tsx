import { useEffect, useId, useRef, useState } from "react";

import LoadingState from "../../shared/components/LoadingState";
import { downloadPdfBlob, fetchDocumentationPdf } from "./documentationPdfService";
import type { DocumentationRecord } from "./documentationService";

type ViewerState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; blob: Blob; url: string };

interface DocumentationPdfViewerDialogProps {
  record: DocumentationRecord;
  onClose: () => void;
}

const focusableSelector = [
  "button:not([disabled])",
  "iframe",
  "[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function DocumentationPdfViewerDialog({ record, onClose }: DocumentationPdfViewerDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const [viewer, setViewer] = useState<ViewerState>({ status: "loading" });

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, []);

  useEffect(() => {
    let current = true;
    setViewer({ status: "loading" });

    void fetchDocumentationPdf(record.id, "open")
      .then((result) => {
        if (!current) return;
        if (!result.ok) {
          setViewer({ status: "error", message: result.error });
          return;
        }

        const url = URL.createObjectURL(result.value);
        if (!current) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrlRef.current = url;
        setViewer({ status: "ready", blob: result.value, url });
      })
      .catch(() => {
        if (current) {
          setViewer({ status: "error", message: "PDF could not be loaded. Please try again." });
        }
      });

    return () => {
      current = false;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [record.id, requestVersion]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      ).filter((control) => !control.hasAttribute("disabled"));
      if (controls.length === 0) {
        event.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/55 p-3 sm:p-6">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={viewer.status === "loading"}
        className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="text-xl font-bold text-zinc-900">Document PDF</h2>
            <p id={descriptionId} className="mt-1 truncate text-sm text-zinc-600">{record.name}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close PDF viewer"
            className="shrink-0 rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            Close
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col bg-zinc-100 p-3 sm:p-5">
          {viewer.status === "loading" && (
            <div className="flex flex-1 items-center justify-center rounded-2xl bg-white">
              <LoadingState message="Preparing document PDF..." />
            </div>
          )}
          {viewer.status === "error" && (
            <div className="flex flex-1 items-center justify-center rounded-2xl bg-white p-6">
              <div className="max-w-lg text-center">
                <h3 className="text-lg font-bold text-zinc-900">Unable to open PDF</h3>
                <p role="alert" className="mt-2 text-sm leading-6 text-zinc-600">{viewer.message}</p>
                <button
                  type="button"
                  onClick={() => setRequestVersion((version) => version + 1)}
                  className="mt-5 rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800"
                >
                  Try again
                </button>
              </div>
            </div>
          )}
          {viewer.status === "ready" && (
            <>
              <iframe
                title={`${record.name} PDF`}
                src={viewer.url}
                referrerPolicy="no-referrer"
                className="min-h-0 flex-1 rounded-2xl border border-zinc-300 bg-white shadow-sm"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
                <p>If the PDF does not appear in your browser, download a secure copy.</p>
                <button
                  type="button"
                  onClick={() => downloadPdfBlob(viewer.blob, record.id)}
                  className="rounded-xl border border-zinc-300 px-4 py-2 font-semibold text-zinc-800 transition hover:bg-zinc-50"
                >
                  Download PDF
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export default DocumentationPdfViewerDialog;
