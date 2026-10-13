import { supabase } from "../../../lib/supabase/client";

export type InventoryAdjustmentType = "add" | "remove" | "correction";

export interface InventoryBalance {
  productId: string;
  quantity: number;
  updatedAt: string;
}

export interface InventoryAdjustmentInput {
  adjustmentType: InventoryAdjustmentType;
  quantity: number;
  reason: string;
  productSupplierId?: string | null;
}

export interface InventoryAdjustment {
  movementId: string;
  quantityBefore: number;
  quantityAfter: number;
}

export interface InventoryBalanceError {
  code: "inventory_balance_not_found" | "inventory_balance_load_failed";
  message: string;
}

export interface InventoryAdjustmentError {
  code:
    | "access_denied"
    | "adjustment_invalid"
    | "adjustment_no_op"
    | "balance_unavailable"
    | "insufficient_stock"
    | "inventory_source_unavailable"
    | "product_unavailable"
    | "inventory_adjustment_failed";
  message: string;
}

export type InventoryBalanceResult =
  | { ok: true; value: InventoryBalance }
  | { ok: false; error: InventoryBalanceError };

export type InventoryAdjustmentResult =
  | { ok: true; value: InventoryAdjustment }
  | { ok: false; error: InventoryAdjustmentError };

interface InventoryBalanceRow {
  product_id: string;
  quantity: unknown;
  updated_at: string;
}

interface InventoryAdjustmentRow {
  movement_id: string;
  quantity_before: unknown;
  quantity_after: unknown;
}

function parseQuantity(value: unknown): number | null {
  const parsed = typeof value === "string" && /^[0-9]+$/.test(value)
    ? Number(value)
    : value;

  return typeof parsed === "number" &&
    Number.isSafeInteger(parsed) &&
    parsed >= 0
    ? parsed
    : null;
}

function isDateTime(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function isInventoryBalanceRow(value: unknown): value is InventoryBalanceRow {
  return typeof value === "object" &&
    value !== null &&
    "product_id" in value &&
    typeof value.product_id === "string" &&
    value.product_id.length > 0 &&
    "quantity" in value &&
    parseQuantity(value.quantity) !== null &&
    "updated_at" in value &&
    typeof value.updated_at === "string" &&
    isDateTime(value.updated_at);
}

function isInventoryAdjustmentRow(
  value: unknown,
): value is InventoryAdjustmentRow {
  return typeof value === "object" &&
    value !== null &&
    "movement_id" in value &&
    typeof value.movement_id === "string" &&
    value.movement_id.length > 0 &&
    "quantity_before" in value &&
    parseQuantity(value.quantity_before) !== null &&
    "quantity_after" in value &&
    parseQuantity(value.quantity_after) !== null;
}

function adjustmentFailure(providerCode?: string): InventoryAdjustmentResult {
  switch (providerCode) {
    case "42501":
      return {
        ok: false,
        error: {
          code: "access_denied",
          message: "Only an Admin can adjust Inventory.",
        },
      };
    case "MIA01":
    case "22023":
      return {
        ok: false,
        error: {
          code: "adjustment_invalid",
          message: "Enter a valid Inventory adjustment.",
        },
      };
    case "MIA02":
      return {
        ok: false,
        error: {
          code: "adjustment_no_op",
          message: "The correction target must differ from the current quantity.",
        },
      };
    case "IVB01":
      return {
        ok: false,
        error: {
          code: "balance_unavailable",
          message: "The Inventory balance is unavailable.",
        },
      };
    case "IVB02":
      return {
        ok: false,
        error: {
          code: "insufficient_stock",
          message: "The requested removal exceeds the available stock.",
        },
      };
    case "IVL03":
      return {
        ok: false,
        error: {
          code: "inventory_source_unavailable",
          message: "Select an active Supplier Catalog source for inbound stock.",
        },
      };
    case "P0002":
    case "PRD01":
      return {
        ok: false,
        error: {
          code: "product_unavailable",
          message: "This Product is unavailable for Inventory adjustment.",
        },
      };
    default:
      return {
        ok: false,
        error: {
          code: "inventory_adjustment_failed",
          message: "The Inventory adjustment could not be completed. Please try again.",
        },
      };
  }
}

export async function getInventoryBalance(
  productId: string,
): Promise<InventoryBalanceResult> {
  try {
    const { data, error } = await supabase
      .from("inventory_balances")
      .select("product_id,quantity,updated_at")
      .eq("product_id", productId)
      .maybeSingle();

    if (error) {
      return {
        ok: false,
        error: {
          code: "inventory_balance_load_failed",
          message: "The Inventory balance could not be loaded.",
        },
      };
    }

    if (data === null) {
      return {
        ok: false,
        error: {
          code: "inventory_balance_not_found",
          message: "The Inventory balance could not be found.",
        },
      };
    }

    if (!isInventoryBalanceRow(data)) {
      return {
        ok: false,
        error: {
          code: "inventory_balance_load_failed",
          message: "The Inventory balance could not be loaded.",
        },
      };
    }

    const quantity = parseQuantity(data.quantity);
    if (quantity === null) {
      return {
        ok: false,
        error: {
          code: "inventory_balance_load_failed",
          message: "The Inventory balance could not be loaded.",
        },
      };
    }

    return {
      ok: true,
      value: {
        productId: data.product_id,
        quantity,
        updatedAt: data.updated_at,
      },
    };
  } catch {
    return {
      ok: false,
      error: {
        code: "inventory_balance_load_failed",
        message: "The Inventory balance could not be loaded.",
      },
    };
  }
}

export async function adjustInventory(
  productId: string,
  input: InventoryAdjustmentInput,
): Promise<InventoryAdjustmentResult> {
  try {
    const { data, error } = await supabase.rpc("manual_adjust_inventory", {
      p_product_id: productId,
      p_adjustment_type: input.adjustmentType,
      p_quantity: input.quantity,
      p_reason: input.reason.trim(),
      p_product_supplier_id: input.productSupplierId ?? null,
    });

    if (error) return adjustmentFailure(error.code);
    if (
      !Array.isArray(data) ||
      data.length !== 1 ||
      !isInventoryAdjustmentRow(data[0])
    ) {
      return adjustmentFailure();
    }

    const quantityBefore = parseQuantity(data[0].quantity_before);
    const quantityAfter = parseQuantity(data[0].quantity_after);
    if (quantityBefore === null || quantityAfter === null) {
      return adjustmentFailure();
    }

    return {
      ok: true,
      value: {
        movementId: data[0].movement_id,
        quantityBefore,
        quantityAfter,
      },
    };
  } catch {
    return adjustmentFailure();
  }
}
