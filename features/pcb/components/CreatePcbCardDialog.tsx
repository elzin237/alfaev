import { useEffect, useId, useRef, useState } from "react";
import type { CreatedPcbCard, PcbResult } from "../services/pcbService";

interface Props {
  onClose: () => void;
  onSubmit: (name: string, serialNumber: string) => Promise<PcbResult<CreatedPcbCard>>;
  onCreated: (created: CreatedPcbCard) => void;
}

export default function CreatePcbCardDialog({ onClose, onSubmit, onCreated }: Props) {
  const titleId = useId();
  const nameId = useId();
  const serialId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const lockRef = useRef(false);
  const [name, setName] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !lockRef.current) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lockRef.current) return;
    const normalizedName = name.trim();
    if (!normalizedName) {
      setError("Name / Code is required.");
      return;
    }
    if (!/^[0-9]{3}$/.test(serialNumber)) {
      setError("Enter an exact three-digit Serial Number.");
      return;
    }
    lockRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await onSubmit(normalizedName, serialNumber);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setName("");
      setSerialNumber("");
      onCreated(result.value);
      onClose();
    } finally {
      lockRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby={titleId}
        aria-busy={isSubmitting}
        className="w-full max-w-lg rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl sm:p-8">
        <h2 id={titleId} className="text-2xl font-bold text-zinc-900">Create Finished Product Calculator</h2>
        <p className="mt-2 text-sm text-zinc-500">Enter the permanent three-digit Product Serial Number. Initial stock starts at 0 in all warehouses.</p>
        <form className="mt-6 space-y-5" onSubmit={(event) => void submit(event)} noValidate>
          <div>
            <label htmlFor={nameId} className="block text-sm font-semibold text-zinc-800">Name / Code</label>
            <input ref={inputRef} id={nameId} value={name} onChange={(event) => setName(event.target.value)}
              disabled={isSubmitting} aria-invalid={Boolean(error)}
              className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:bg-zinc-100" />
          </div>
          <div>
            <label htmlFor={serialId} className="block text-sm font-semibold text-zinc-800">Three-digit Serial Number</label>
            <input id={serialId} value={serialNumber}
              onChange={(event) => setSerialNumber(event.target.value)}
              disabled={isSubmitting} inputMode="numeric" autoComplete="off" maxLength={3}
              aria-describedby={`${serialId}-help`} aria-invalid={Boolean(error)}
              className="mt-2 w-full rounded-xl border border-zinc-300 px-4 py-3 font-mono text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:bg-zinc-100" />
            <p id={`${serialId}-help`} className="mt-2 text-xs text-zinc-500">Exactly three ASCII digits, including leading zeroes.</p>
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} disabled={isSubmitting}
              className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={isSubmitting}
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {isSubmitting ? "Creating..." : "Create Finished Product Calculator"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
