import { useEffect, useRef, useState } from "react";

interface WorkOrderBarcodeScanInputProps {
  disabled?: boolean;
  focusRequestId?: number;
  onScan: (serialNumber: string) => void;
  refocusOnEnable?: boolean;
}

const productSerialNumberPattern = /^(?:[0-9]{3}|[0-9]{7})$/;

function WorkOrderBarcodeScanInput({
  disabled = false,
  focusRequestId = 0,
  onScan,
  refocusOnEnable = true,
}: WorkOrderBarcodeScanInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const wasDisabled = useRef(disabled);
  const [serialNumber, setSerialNumber] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (refocusOnEnable && wasDisabled.current && !disabled) {
      inputRef.current?.focus();
    }
    wasDisabled.current = disabled;
  }, [disabled, refocusOnEnable]);

  useEffect(() => {
    if (focusRequestId > 0 && !disabled) {
      inputRef.current?.focus();
    }
  }, [disabled, focusRequestId]);

  return (
    <div>
      <label
        htmlFor="work-order-barcode-scan"
        className="block text-sm font-semibold text-zinc-800"
      >
        Scan Product Barcode
      </label>
      <p id="work-order-barcode-scan-help" className="mt-1 text-sm text-zinc-500">
        Scan a 3- or 7-digit Product Serial Number or enter it manually.
      </p>
      <input
        ref={inputRef}
        id="work-order-barcode-scan"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={7}
        disabled={disabled}
        value={serialNumber}
        aria-describedby={error
          ? "work-order-barcode-scan-help work-order-barcode-scan-error"
          : "work-order-barcode-scan-help"}
        aria-invalid={Boolean(error)}
        onChange={(event) => {
          setSerialNumber(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;

          event.preventDefault();
          event.stopPropagation();
          if (!productSerialNumberPattern.test(serialNumber)) {
            setError("Enter a 3- or 7-digit Serial Number.");
            return;
          }

          onScan(serialNumber);
          setSerialNumber("");
          setError(null);
          inputRef.current?.focus();
        }}
        className="mt-3 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 font-mono text-sm tracking-widest text-zinc-900 outline-none transition disabled:cursor-not-allowed disabled:bg-zinc-100 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
      />
      {error && (
        <p
          id="work-order-barcode-scan-error"
          role="alert"
          className="mt-2 text-sm font-medium text-red-700"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export default WorkOrderBarcodeScanInput;
