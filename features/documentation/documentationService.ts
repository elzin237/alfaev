import { z } from "zod";
import { supabase } from "../../lib/supabase/client";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export const categorySchema = z.enum(["uvoz", "izvoz", "nabavka", "troskovi"]);
export type DocumentationCategory = z.infer<typeof categorySchema>;
export const categoryLabels: Record<DocumentationCategory, string> = {
  uvoz: "Import", izvoz: "Export", nabavka: "Procurement", troskovi: "Expenses",
};

// Keep PostgreSQL numeric as decimal text. Never round-trip through Number.
export function normalizeAmount(value: string): string | null {
  const input = value.trim();
  if (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)$/.test(input)) return null;
  const unsigned = input.replace(/^\+/, "");
  const [whole = "", fraction] = unsigned.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
  const normalizedFraction = fraction?.replace(/0+$/, "");
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

const rowSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1),
  category: categorySchema,
  document_date: z.iso.date(),
  amount: z.string().refine((value) => normalizeAmount(value) !== null),
  pdf_storage_path: z.string().min(1).nullable(),
  is_active: z.boolean(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  archived_at: z.iso.datetime({ offset: true }).nullable(),
});

export interface DocumentationRecord {
  id: string;
  name: string;
  category: DocumentationCategory;
  documentDate: string;
  amount: string;
  pdfStoragePath: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface DocumentationInput {
  name: string;
  category: DocumentationCategory;
  documentDate: string;
  amount: string;
}

export type DocumentationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function failure(code: string | undefined, operation: string): { ok: false; error: string } {
  const message = code === "42501" ? "Access denied." :
    code === "DOC01" ? "Archived documents cannot be changed." :
    code === "P0002" ? "Document not found." :
    code === "22023" ? "Check the document fields and try again." :
    `Unable to ${operation} the document. Please try again.`;
  return { ok: false, error: message };
}

export async function listDocumentationRecords(): Promise<DocumentationResult<DocumentationRecord[]>> {
  const { data, error } = await supabase.from("documentation_records")
    .select("id,name,category,document_date,amount::text,pdf_storage_path,is_active,created_at,updated_at,archived_at")
    .order("document_date", { ascending: false }).order("id", { ascending: true });
  if (error || !Array.isArray(data)) return failure(error?.code, "load");
  const parsed = z.array(rowSchema).safeParse(data);
  if (!parsed.success) return failure(undefined, "load");
  return { ok: true, value: parsed.data.map((row) => ({
    id: row.id, name: row.name, category: row.category,
    documentDate: row.document_date, amount: normalizeAmount(row.amount) ?? row.amount,
    pdfStoragePath: row.pdf_storage_path, isActive: row.is_active,
    createdAt: row.created_at, updatedAt: row.updated_at, archivedAt: row.archived_at,
  })) };
}

export async function createDocumentationRecord(input: DocumentationInput): Promise<DocumentationResult<string>> {
  const amount = normalizeAmount(input.amount);
  if (!amount) return failure("22023", "create");
  const { data, error } = await supabase.rpc("create_documentation_record", {
    p_name: input.name.trim(), p_category: input.category,
    p_document_date: input.documentDate, p_amount: amount,
  });
  if (error || !uuid.safeParse(data).success) return failure(error?.code, "create");
  return { ok: true, value: data };
}

export async function updateDocumentationRecord(id: string, input: DocumentationInput): Promise<DocumentationResult<string>> {
  const amount = normalizeAmount(input.amount);
  if (!amount) return failure("22023", "update");
  const { data, error } = await supabase.rpc("update_documentation_record", {
    p_record_id: id, p_name: input.name.trim(), p_category: input.category,
    p_document_date: input.documentDate, p_amount: amount,
  });
  if (error || !uuid.safeParse(data).success) return failure(error?.code, "update");
  return { ok: true, value: data };
}

export async function archiveDocumentationRecord(id: string): Promise<DocumentationResult<string>> {
  const { data, error } = await supabase.rpc("archive_documentation_record", { p_record_id: id });
  if (error || !uuid.safeParse(data).success) return failure(error?.code, "archive");
  return { ok: true, value: data };
}
