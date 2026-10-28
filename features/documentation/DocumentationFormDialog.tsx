import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  categoryLabels, categorySchema, normalizeAmount,
  type DocumentationInput, type DocumentationRecord, type DocumentationResult,
} from "./documentationService";
import { validatePdfFile } from "./documentationPdfService";

const formSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  category: categorySchema,
  documentDate: z.iso.date(),
  amount: z.string().refine((value) => normalizeAmount(value) !== null, "Enter a non-negative decimal amount."),
});
type FormValues = z.infer<typeof formSchema>;

interface Props {
  open: boolean;
  record: DocumentationRecord | null;
  onClose: () => void;
  onSubmit: (input: DocumentationInput, file: File | null) => Promise<DocumentationResult<{ pdfFailed: boolean }>>;
  onSuccess: (pdfFailed: boolean) => void;
}

function DocumentationFormDialog({ open, record, onClose, onSubmit, onSuccess }: Props) {
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement | null>(null);
  const lockRef = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", category: "uvoz", documentDate: "", amount: "" },
  });
  const nameField = register("name");

  useEffect(() => {
    if (!open) return;
    reset({ name: record?.name ?? "", category: record?.category ?? "uvoz",
      documentDate: record?.documentDate ?? "", amount: record?.amount ?? "" });
    setFile(null);
    setFileError(null);
    setError(null);
    queueMicrotask(() => nameRef.current?.focus());
  }, [open, record, reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !lockRef.current) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  const submit = handleSubmit(async (values) => {
    if (lockRef.current) return;
    if (fileError) return;
    lockRef.current = true;
    setError(null);
    try {
      const result = await onSubmit({ ...values, amount: normalizeAmount(values.amount) ?? values.amount }, file);
      if (!result.ok) { setError(result.error); return; }
      onSuccess(result.value.pdfFailed);
      onClose();
    } finally { lockRef.current = false; }
  });

  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={isSubmitting}
      className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-xl">
      <h2 id={titleId} className="text-xl font-bold">{record ? "Edit Document" : "Add Document"}</h2>
      <form noValidate onSubmit={(event) => void submit(event)} className="mt-5 space-y-4">
        <label className="block text-sm font-medium">Name
          <input {...nameField} ref={(element) => { nameField.ref(element); nameRef.current = element; }}
            className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2" />
          {errors.name && <span role="alert" className="text-red-700">{errors.name.message}</span>}
        </label>
        <label className="block text-sm font-medium">Category
          <select {...register("category")} className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2">
            {categorySchema.options.map((value) => <option key={value} value={value}>{categoryLabels[value]}</option>)}
          </select>
          {errors.category && <span role="alert" className="text-red-700">Select a category.</span>}
        </label>
        <label className="block text-sm font-medium">Date
          <input type="date" {...register("documentDate")} className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2" />
          {errors.documentDate && <span role="alert" className="text-red-700">Select a valid date.</span>}
        </label>
        <label className="block text-sm font-medium">Amount
          <input type="text" inputMode="decimal" {...register("amount")}
            className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2" />
          {errors.amount && <span role="alert" className="text-red-700">{errors.amount.message}</span>}
        </label>
        {!record && <label className="block text-sm font-medium">PDF (optional)
          <input type="file" accept=".pdf,application/pdf" onChange={(event) => {
            const chosen = event.target.files?.[0] ?? null;
            const issue = chosen ? validatePdfFile(chosen) : null;
            setFileError(issue);
            setFile(issue ? null : chosen);
          }} className="mt-1 block w-full text-sm" />
        </label>}
        {fileError && <p role="alert" className="text-sm text-red-700">{fileError}</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3 pt-3">
          <button type="button" disabled={isSubmitting} onClick={onClose} className="rounded-xl border px-4 py-2">Cancel</button>
          <button type="submit" disabled={isSubmitting || Boolean(fileError)} className="rounded-xl bg-zinc-900 px-4 py-2 font-semibold text-white disabled:opacity-60">
            {isSubmitting ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </section>
  </div>;
}

export default DocumentationFormDialog;
