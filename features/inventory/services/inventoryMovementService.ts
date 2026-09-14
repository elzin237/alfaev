import { supabase } from "../../../lib/supabase/client";

export interface InventoryMovement {
  movementId: string;
  createdAt: string;
  movementType: string;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  reason: string | null;
  sourceType: string | null;
  sourceId: string | null;
  projectId: string | null;
  reversalOfMovementId: string | null;
  actorUserId: string;
  actorFullName: string;
}

export interface InventoryMovementListError {
  code: "inventory_history_load_failed";
  message: string;
}

export type InventoryMovementListResult =
  | { ok: true; value: InventoryMovement[] }
  | { ok: false; error: InventoryMovementListError };

interface InventoryMovementRow {
  movement_id: string;
  created_at: string;
  movement_type: string;
  quantity_delta: unknown;
  quantity_before: unknown;
  quantity_after: unknown;
  reason: string | null;
  source_type: string | null;
  source_id: string | null;
  project_id: string | null;
  reversal_of_movement_id: string | null;
  actor_user_id: string;
  actor_full_name: string;
}

function parseInteger(value: unknown): number | null {
  const parsed = typeof value === "string" && /^-?[0-9]+$/.test(value)
    ? Number(value)
    : value;

  return typeof parsed === "number" && Number.isSafeInteger(parsed)
    ? parsed
    : null;
}

function isOptionalId(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

function isOptionalText(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

function isInventoryMovementRow(
  value: unknown,
): value is InventoryMovementRow {
  if (typeof value !== "object" || value === null) return false;

  const delta = "quantity_delta" in value
    ? parseInteger(value.quantity_delta)
    : null;
  const before = "quantity_before" in value
    ? parseInteger(value.quantity_before)
    : null;
  const after = "quantity_after" in value
    ? parseInteger(value.quantity_after)
    : null;

  return (
    "movement_id" in value &&
    typeof value.movement_id === "string" &&
    value.movement_id.length > 0 &&
    "created_at" in value &&
    typeof value.created_at === "string" &&
    Number.isFinite(Date.parse(value.created_at)) &&
    "movement_type" in value &&
    typeof value.movement_type === "string" &&
    value.movement_type.length > 0 &&
    delta !== null &&
    before !== null &&
    before >= 0 &&
    after !== null &&
    after >= 0 &&
    after === before + delta &&
    "reason" in value &&
    isOptionalText(value.reason) &&
    "source_type" in value &&
    isOptionalText(value.source_type) &&
    "source_id" in value &&
    isOptionalId(value.source_id) &&
    "project_id" in value &&
    isOptionalId(value.project_id) &&
    "reversal_of_movement_id" in value &&
    isOptionalId(value.reversal_of_movement_id) &&
    "actor_user_id" in value &&
    typeof value.actor_user_id === "string" &&
    value.actor_user_id.length > 0 &&
    "actor_full_name" in value &&
    typeof value.actor_full_name === "string" &&
    value.actor_full_name.length > 0
  );
}

function failure(): InventoryMovementListResult {
  return {
    ok: false,
    error: {
      code: "inventory_history_load_failed",
      message: "The Inventory history could not be loaded.",
    },
  };
}

function mapMovement(row: InventoryMovementRow): InventoryMovement | null {
  const quantityDelta = parseInteger(row.quantity_delta);
  const quantityBefore = parseInteger(row.quantity_before);
  const quantityAfter = parseInteger(row.quantity_after);

  if (
    quantityDelta === null ||
    quantityBefore === null ||
    quantityAfter === null
  ) {
    return null;
  }

  return {
    movementId: row.movement_id,
    createdAt: row.created_at,
    movementType: row.movement_type,
    quantityDelta,
    quantityBefore,
    quantityAfter,
    reason: row.reason,
    sourceType: row.source_type,
    sourceId: row.source_id,
    projectId: row.project_id,
    reversalOfMovementId: row.reversal_of_movement_id,
    actorUserId: row.actor_user_id,
    actorFullName: row.actor_full_name,
  };
}

export async function listInventoryMovements(
  productId: string,
): Promise<InventoryMovementListResult> {
  try {
    const { data, error } = await supabase.rpc(
      "get_inventory_movements_for_product",
      { p_product_id: productId },
    );

    if (error || !Array.isArray(data)) return failure();

    const movements: InventoryMovement[] = [];
    for (const row of data) {
      if (!isInventoryMovementRow(row)) return failure();
      const movement = mapMovement(row);
      if (movement === null) return failure();
      movements.push(movement);
    }

    return { ok: true, value: movements };
  } catch {
    return failure();
  }
}
