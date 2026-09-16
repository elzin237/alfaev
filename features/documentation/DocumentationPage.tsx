import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { useAuth } from "../../app/auth/AuthProvider";
import ConfirmDialog from "../../shared/components/ConfirmDialog";
import EmptyState from "../../shared/components/EmptyState";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import StatusBadge from "../../shared/components/StatusBadge";
import DocumentationFormDialog from "./DocumentationFormDialog";
import { documentationListKey } from "./documentationQueryKeys";
import {
  archiveDocumentationRecord, categoryLabels, createDocumentationRecord,
  listDocumentationRecords, updateDocumentationRecord,
  type DocumentationInput, type DocumentationRecord, type DocumentationResult,
} from "./documentationService";
import {
  downloadPdfBlob, fetchDocumentationPdf, openPdfBlob, removeDocumentationPdf,
  uploadDocumentationPdf, validatePdfFile,
} from "./documentationPdfService";

type Confirmation = { kind: "archive" | "remove"; record: DocumentationRecord };

function DocumentationPage() {
  const { profile, isAdmin } = useAuth();
  const client = useQueryClient();
  const key = documentationListKey(profile?.id);
  const query = useQuery({ queryKey: key, queryFn: listDocumentationRecords,
    enabled: Boolean(profile?.id && isAdmin), staleTime: 60_000 });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentationRecord | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadRecordRef = useRef<string | null>(null);

  const invalidate = () => client.invalidateQueries({ queryKey: key, exact: true });
  async function save(input: DocumentationInput, file: File | null): Promise<DocumentationResult<{ pdfFailed: boolean }>> {
    const result = editing ? await updateDocumentationRecord(editing.id, input) : await createDocumentationRecord(input);
    if (!result.ok) return result;
    await invalidate();
    if (!editing && file) {
      const upload = await uploadDocumentationPdf(result.value, file);
      await invalidate();
      return { ok: true, value: { pdfFailed: !upload.ok } };
    }
    return { ok: true, value: { pdfFailed: false } };
  }

  async function confirm() {
    if (!confirmation || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = confirmation.kind === "archive"
        ? await archiveDocumentationRecord(confirmation.record.id)
        : await removeDocumentationPdf(confirmation.record.id);
      if (!result.ok) { setError(result.error); return; }
      await invalidate();
      setNotice(confirmation.kind === "archive" ? "Document archived." : "PDF removed.");
      setConfirmation(null);
    } finally { busyRef.current = false; setBusy(false); }
  }

  async function handlePdf(record: DocumentationRecord, action: "open" | "download") {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await fetchDocumentationPdf(record.id, action);
      if (!result.ok) { setError(result.error); return; }
      if (action === "open") {
        if (!openPdfBlob(result.value)) setError("Your browser blocked the PDF window. Please allow popups and try again.");
      } else downloadPdfBlob(result.value, record.id);
    } finally { busyRef.current = false; setBusy(false); }
  }

  async function handleSelectedPdf(file: File | null) {
    const recordId = uploadRecordRef.current;
    if (!file || !recordId || busyRef.current) return;
    const issue = validatePdfFile(file);
    if (issue) { setError(issue); return; }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await uploadDocumentationPdf(recordId, file);
      if (!result.ok) { setError(result.error); return; }
      await invalidate();
      setNotice("PDF saved.");
    } finally {
      busyRef.current = false;
      setBusy(false);
      uploadRecordRef.current = null;
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  let content: ReactNode;
  if (query.isPending) content = <LoadingState message="Loading Documentation..." />;
  else if (query.isError || !query.data?.ok) content = <ErrorState title="Unable to load Documentation"
    message={query.data?.ok === false ? query.data.error : "The Documentation list could not be loaded."}
    onRetry={() => void query.refetch()} />;
  else if (query.data.value.length === 0) content = <EmptyState title="No documents" description="No Documentation records have been added." />;
  else content = <div className="overflow-x-auto rounded-3xl border border-zinc-200 bg-white shadow-sm">
    <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
      <thead className="bg-zinc-50"><tr>{["Naziv", "Kategorija", "Datum", "Iznos", "PDF", "Status", "Actions"].map((label) =>
        <th key={label} scope="col" className="px-4 py-3 font-semibold text-zinc-600">{label}</th>)}</tr></thead>
      <tbody className="divide-y divide-zinc-100">{query.data.value.map((record) => <tr key={record.id}>
        <td className="px-4 py-3 font-semibold">{record.name}</td>
        <td className="px-4 py-3">{categoryLabels[record.category]}</td>
        <td className="px-4 py-3">{record.documentDate}</td>
        <td className="px-4 py-3 tabular-nums">{record.amount}</td>
        <td className="px-4 py-3">{record.pdfStoragePath ? "Attached" : "None"}</td>
        <td className="px-4 py-3"><StatusBadge label={record.isActive ? "Active" : "Archived"}
          tone={record.isActive ? "success" : "neutral"} /></td>
        <td className="min-w-64 px-4 py-3"><div className="flex flex-wrap gap-2">
          {record.pdfStoragePath && <>
            <button type="button" disabled={busy} onClick={() => void handlePdf(record, "open")}>Open</button>
            <button type="button" disabled={busy} onClick={() => void handlePdf(record, "download")}>Download</button>
          </>}
          {record.isActive && <>
            <button type="button" disabled={busy} onClick={() => { setEditing(record); setFormOpen(true); }}>Edit</button>
            <button type="button" disabled={busy} onClick={() => { uploadRecordRef.current = record.id; fileInputRef.current?.click(); }}>
              {record.pdfStoragePath ? "Replace PDF" : "Upload PDF"}</button>
            {record.pdfStoragePath && <button type="button" disabled={busy} onClick={() => setConfirmation({ kind: "remove", record })}>Remove PDF</button>}
            <button type="button" disabled={busy} onClick={() => setConfirmation({ kind: "archive", record })}>Archive</button>
          </>}
        </div></td>
      </tr>)}</tbody>
    </table>
  </div>;

  return <section className="space-y-6">
    <PageHeader title="Dokumentacija" description="Admin-only company documents and private PDFs."
      actions={<button type="button" onClick={() => { setEditing(null); setFormOpen(true); }}
        className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white">Add Document</button>} />
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">{notice}</p>}
    {error && !confirmation && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
    {content}
    <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" className="sr-only" aria-label="Select PDF"
      onChange={(event) => void handleSelectedPdf(event.target.files?.[0] ?? null)} />
    <DocumentationFormDialog open={formOpen} record={editing} onClose={() => setFormOpen(false)} onSubmit={save}
      onSuccess={(pdfFailed) => setNotice(pdfFailed
        ? "Document created, but PDF upload failed. You can attach it later."
        : editing ? "Document updated." : "Document created.")} />
    <ConfirmDialog open={confirmation !== null} title={confirmation?.kind === "archive" ? "Archive Document" : "Remove PDF"}
      description={confirmation?.kind === "archive"
        ? "This document becomes historical and read-only. Its attached PDF remains preserved."
        : "Remove this PDF attachment from the active document?"}
      confirmLabel={confirmation?.kind === "archive" ? "Archive" : "Remove PDF"} confirmVariant="danger"
      onConfirm={() => void confirm()} onCancel={() => { if (!busy) { setConfirmation(null); setError(null); } }}
      isSubmitting={busy} errorMessage={error} />
  </section>;
}

export default DocumentationPage;
