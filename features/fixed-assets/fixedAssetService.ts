import { z } from "zod";

import { supabase } from "../../lib/supabase/client";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export const fixedAssetCategorySchema = z.enum(["oprema", "uredjaji", "alati"]);
export type FixedAssetCategory = z.infer<typeof fixedAssetCategorySchema>;
export const fixedAssetCategoryLabels: Record<FixedAssetCategory, string> = {
  oprema: "Oprema",
  uredjaji: "Uređaji",
  alati: "Alati",
};

export function normalizeFixedAssetQuantity(input: string): string | null {
  const value = input.trim();
  if (!/^[0-9]+$/.test(value) || value.length > 128) return null;
  const quantity = BigInt(value);
  if (quantity < 1n || quantity > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return quantity.toString();
}

const rowSchema = z.object({
  id: uuid,
  name: z.string().min(1).refine((value) => value === value.trim()),
  category: fixedAssetCategorySchema,
  purchase_date: z.iso.date(),
  quantity: z.string().refine((value) => normalizeFixedAssetQuantity(value) !== null),
  is_active: z.boolean(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  archived_at: z.iso.datetime({ offset: true }).nullable(),
});

export interface FixedAsset {
  id: string;
  name: string;
  category: FixedAssetCategory;
  purchaseDate: string;
  quantity: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface FixedAssetInput {
  name: string;
  category: FixedAssetCategory;
  purchaseDate: string;
  quantity: string;
}

export type FixedAssetResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function safeError(operation: "load" | "create" | "update" | "archive", code?: string) {
  const message = code === "42501" ? "Access denied." :
    code === "P0002" ? "Fixed Asset not found." :
    code === "FAS01" ? "Archived Fixed Assets cannot be changed." :
    code === "22023" ? "Check the Fixed Asset fields and try again." :
    `Unable to ${operation} Fixed Assets. Please try again.`;
  return { ok: false as const, error: message };
}

export async function listFixedAssets(): Promise<FixedAssetResult<FixedAsset[]>> {
  const { data, error } = await supabase.from("fixed_assets")
    .select("id,name,category,purchase_date,quantity::text,is_active,created_at,updated_at,archived_at")
    .order("purchase_date", { ascending: false })
    .order("id", { ascending: true });
  if (error || !Array.isArray(data)) return safeError("load", error?.code);
  const parsed = z.array(rowSchema).safeParse(data);
  if (!parsed.success) return safeError("load");
  return { ok: true, value: parsed.data.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    purchaseDate: row.purchase_date,
    quantity: Number(row.quantity),
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  })) };
}

export async function createFixedAsset(input: FixedAssetInput): Promise<FixedAssetResult<string>> {
  const quantity = normalizeFixedAssetQuantity(input.quantity);
  if (!quantity) return safeError("create", "22023");
  const { data, error } = await supabase.rpc("create_fixed_asset", {
    p_name: input.name.trim(), p_category: input.category,
    p_purchase_date: input.purchaseDate, p_quantity: quantity,
  });
  if (error || !uuid.safeParse(data).success) return safeError("create", error?.code);
  return { ok: true, value: data };
}

export async function updateFixedAsset(id: string, input: FixedAssetInput): Promise<FixedAssetResult<string>> {
  const quantity = normalizeFixedAssetQuantity(input.quantity);
  if (!quantity) return safeError("update", "22023");
  const { data, error } = await supabase.rpc("update_fixed_asset", {
    p_asset_id: id, p_name: input.name.trim(), p_category: input.category,
    p_purchase_date: input.purchaseDate, p_quantity: quantity,
  });
  if (error || !uuid.safeParse(data).success) return safeError("update", error?.code);
  return { ok: true, value: data };
}

export async function archiveFixedAsset(id: string): Promise<FixedAssetResult<string>> {
  const { data, error } = await supabase.rpc("archive_fixed_asset", { p_asset_id: id });
  if (error || !uuid.safeParse(data).success) return safeError("archive", error?.code);
  return { ok: true, value: data };
}
