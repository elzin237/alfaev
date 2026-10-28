import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  fixedAssetCategoryLabels,
  fixedAssetCategorySchema,
  normalizeFixedAssetQuantity,
  type FixedAsset,
  type FixedAssetInput,
  type FixedAssetResult,
} from "./fixedAssetService";

const formSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  category: fixedAssetCategorySchema,
  purchaseDate: z.iso.date(),
  quantity: z.string().refine(
    (value) => normalizeFixedAssetQuantity(value) !== null,
    "Enter a positive whole-number quantity within the safe range.",
  ),
});
type FormValues = z.infer<typeof formSchema>;

interface Props {
  open: boolean;
  asset: FixedAsset | null;
  onClose: () => void;
  onSubmit: (input: FixedAssetInput) => Promise<FixedAssetResult<string>>;
  onSuccess: () => void;
}

function FixedAssetFormDialog({ open, asset, onClose, onSubmit, onSuccess }: Props) {
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement | null>(null);
  const submittingRef = useRef(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const { register, reset, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", category: "oprema", purchaseDate: "", quantity: "" },
  });
  const nameRegistration = register("name");

  useEffect(() => {
    if (!open) return;
    reset({ name: asset?.name ?? "", category: asset?.category ?? "oprema",
      purchaseDate: asset?.purchaseDate ?? "", quantity: asset ? String(asset.quantity) : "" });
    setSubmissionError(null);
    queueMicrotask(() => nameRef.current?.focus());
  }, [asset, open, reset]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submittingRef.current) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  const submit = handleSubmit(async (values) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmissionError(null);
    try {
      const result = await onSubmit({
        ...values,
        quantity: normalizeFixedAssetQuantity(values.quantity) ?? values.quantity,
      });
      if (!result.ok) { setSubmissionError(result.error); return; }
      reset({ name: "", category: "oprema", purchaseDate: "", quantity: "" });
      onSuccess();
      onClose();
    } finally {
      submittingRef.current = false;
    }
  });

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={isSubmitting}
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-xl">
        <h2 id={titleId} className="text-xl font-bold">{asset ? "Edit Asset" : "Add Asset"}</h2>
        <form noValidate onSubmit={(event) => void submit(event)} className="mt-5 space-y-4">
          <label className="block text-sm font-medium">Name
            <input {...nameRegistration} ref={(element) => {
              nameRegistration.ref(element); nameRef.current = element;
            }} className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2" />
            {errors.name && <span role="alert" className="text-red-700">{errors.name.message}</span>}
          </label>
          <label className="block text-sm font-medium">Category
            <select {...register("category")} className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2">
              {fixedAssetCategorySchema.options.map((value) => (
                <option key={value} value={value}>{fixedAssetCategoryLabels[value]}</option>
              ))}
            </select>
            {errors.category && <span role="alert" className="text-red-700">Select a category.</span>}
          </label>
          <label className="block text-sm font-medium">Purchase Date
            <input type="date" {...register("purchaseDate")}
              className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2" />
            {errors.purchaseDate && <span role="alert" className="text-red-700">Select a valid date.</span>}
          </label>
          <label className="block text-sm font-medium">Quantity
            <input type="text" inputMode="numeric" {...register("quantity")}
              className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2" />
            {errors.quantity && <span role="alert" className="text-red-700">{errors.quantity.message}</span>}
          </label>
          {submissionError && <p role="alert" className="text-sm text-red-700">{submissionError}</p>}
          <div className="flex justify-end gap-3 pt-3">
            <button type="button" disabled={isSubmitting} onClick={onClose}
              className="rounded-xl border px-4 py-2">Cancel</button>
            <button type="submit" disabled={isSubmitting}
              className="rounded-xl bg-zinc-900 px-4 py-2 font-semibold text-white disabled:opacity-60">
              {isSubmitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default FixedAssetFormDialog;
