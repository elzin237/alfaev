import { useEffect, useRef, useState } from "react";

import ErrorState from "../../../shared/components/ErrorState";
import {
  createProductBarcodeSvg,
  type ProductBarcodeSvg,
} from "../../../shared/utils/productBarcodeSvg";

export interface ProductBarcodeSectionProps {
  serialNumber: string;
}

const OPEN_URL_LIFETIME_MS = 1_000;

function ProductBarcodeSection({ serialNumber }: ProductBarcodeSectionProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const objectUrlsRef = useRef(new Set<string>());
  const timersRef = useRef(new Set<number>());

  useEffect(() => () => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    for (const objectUrl of objectUrlsRef.current) {
      URL.revokeObjectURL(objectUrl);
    }
    timersRef.current.clear();
    objectUrlsRef.current.clear();
  }, []);

  function createSvgObjectUrl(svg: string): string {
    const objectUrl = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml" }),
    );
    objectUrlsRef.current.add(objectUrl);
    return objectUrl;
  }

  function revokeObjectUrlLater(objectUrl: string, delay: number) {
    const timer = window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      objectUrlsRef.current.delete(objectUrl);
      timersRef.current.delete(timer);
    }, delay);
    timersRef.current.add(timer);
  }

  let renderedBarcode: ProductBarcodeSvg;
  try {
    renderedBarcode = createProductBarcodeSvg(serialNumber);
  } catch {
    return (
      <section aria-labelledby="barcode-heading" className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 id="barcode-heading" className="text-xl font-bold text-zinc-900">
          Barcode
        </h2>
        <div className="mt-6">
          <ErrorState
            title="Barcode unavailable"
            message="A barcode cannot be generated for this Product Serial Number."
          />
        </div>
      </section>
    );
  }

  function openBarcode() {
    setActionError(null);
    let objectUrl: string | null = null;

    try {
      objectUrl = createSvgObjectUrl(renderedBarcode.svg);
      const openedWindow = window.open(
        objectUrl,
        "_blank",
        "noopener,noreferrer",
      );

      if (openedWindow === null) {
        URL.revokeObjectURL(objectUrl);
        objectUrlsRef.current.delete(objectUrl);
        setActionError("The barcode could not be opened. Allow pop-ups and try again.");
        return;
      }

      revokeObjectUrlLater(objectUrl, OPEN_URL_LIFETIME_MS);
    } catch {
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
        objectUrlsRef.current.delete(objectUrl);
      }
      setActionError("The barcode could not be opened.");
    }
  }

  function downloadBarcode() {
    setActionError(null);
    let objectUrl: string | null = null;

    try {
      objectUrl = createSvgObjectUrl(renderedBarcode.svg);
      const downloadLink = document.createElement("a");
      downloadLink.href = objectUrl;
      downloadLink.download = `alfaev-${serialNumber}-barcode.svg`;
      document.body.append(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      revokeObjectUrlLater(objectUrl, 0);
    } catch {
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
        objectUrlsRef.current.delete(objectUrl);
      }
      setActionError("The barcode could not be downloaded.");
    }
  }

  return (
    <section aria-labelledby="barcode-heading" className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="barcode-heading" className="text-xl font-bold text-zinc-900">
            Barcode
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Deterministic Code 128 representation of this Product Serial Number.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={openBarcode}
            className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-300 focus:ring-offset-2"
          >
            Open / View
          </button>
          <button
            type="button"
            onClick={downloadBarcode}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
          >
            Download
          </button>
        </div>
      </div>

      {actionError && (
        <p role="alert" className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
          {actionError}
        </p>
      )}

      <div className="mt-6 overflow-x-auto rounded-2xl border border-zinc-200 bg-white p-4">
        <div
          className="mx-auto min-w-[33rem] max-w-3xl"
          dangerouslySetInnerHTML={{ __html: renderedBarcode.svg }}
        />
      </div>
      <p className="mt-4 text-center font-mono text-base font-semibold tracking-[0.2em] text-zinc-900">
        <span className="sr-only">Serial Number: </span>
        {serialNumber}
      </p>
    </section>
  );
}

export default ProductBarcodeSection;
