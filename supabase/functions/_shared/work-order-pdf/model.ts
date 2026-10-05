const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const workOrderNumberPattern = /^RN-[0-9]{4}-[0-9]{4}$/;
const serialNumberPattern = /^[0-9]{7}$/;
const positiveDecimalPattern = /^[1-9][0-9]*$/;
const nonnegativeDecimalPattern = /^(0|[1-9][0-9]*)$/;
const maximumPostgresBigint = 9_223_372_036_854_775_807n;

export interface WorkOrderPdfMaterial {
  position: string;
  productId: string;
  serialNumber: string;
  productName: string;
  quantity: string;
}

export interface WorkOrderPdfSnapshot {
  workOrderId: string;
  workOrderNumber: string;
  projectName: string;
  customerName: string;
  description: string;
  workOrderCreatedAt: string;
  snapshotUpdatedAt: string;
  materials: WorkOrderPdfMaterial[];
  pcbProduction?: {
    pcbCardId: string;
    pcbCardName: string;
    bomVersionNumber: string;
    plannedQuantity: string;
    actualGoodQuantity: string;
    outputProductId: string;
    outputSerialNumber: string;
    outputProductName: string;
  } | null;
}

interface ParsedSnapshotRow {
  workOrderId: string;
  workOrderNumber: string;
  projectName: string;
  customerName: string;
  description: string;
  workOrderCreatedAt: string;
  snapshotUpdatedAt: string;
  material: WorkOrderPdfMaterial | null;
  pcbProduction: WorkOrderPdfSnapshot["pcbProduction"];
}

export class WorkOrderPdfSnapshotError extends Error {
  constructor() {
    super("The Work Order PDF snapshot is unavailable.");
    this.name = "WorkOrderPdfSnapshotError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * PDFMake receives plain text rather than markup. Normalize Unicode/line endings
 * and remove non-printing controls so authoritative text cannot alter PDF syntax.
 */
export function toSafePdfText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function requiredText(value: unknown): string {
  if (typeof value !== "string") throw new WorkOrderPdfSnapshotError();
  const safe = toSafePdfText(value);
  if (safe.trim().length === 0) throw new WorkOrderPdfSnapshotError();
  return safe;
}

function exactPattern(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new WorkOrderPdfSnapshotError();
  }
  return value;
}

function exactTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new WorkOrderPdfSnapshotError();
  }
  return value;
}

function exactPositiveBigint(value: unknown): string {
  if (typeof value !== "string" || !positiveDecimalPattern.test(value)) {
    throw new WorkOrderPdfSnapshotError();
  }
  try {
    if (BigInt(value) > maximumPostgresBigint) {
      throw new WorkOrderPdfSnapshotError();
    }
  } catch (error) {
    if (error instanceof WorkOrderPdfSnapshotError) throw error;
    throw new WorkOrderPdfSnapshotError();
  }
  return value;
}

function exactNonnegativeBigint(value: unknown): string {
  if (typeof value !== "string" || !nonnegativeDecimalPattern.test(value)) {
    throw new WorkOrderPdfSnapshotError();
  }
  try {
    if (BigInt(value) > maximumPostgresBigint) throw new WorkOrderPdfSnapshotError();
  } catch (error) {
    if (error instanceof WorkOrderPdfSnapshotError) throw error;
    throw new WorkOrderPdfSnapshotError();
  }
  return value;
}

function parseRow(value: unknown): ParsedSnapshotRow {
  if (!isRecord(value)) throw new WorkOrderPdfSnapshotError();

  const hasProduction = value.production_pcb_card_id !== undefined &&
    value.production_pcb_card_id !== null;
  const productionValues = [
    value.production_pcb_card_id,
    value.production_pcb_card_name,
    value.production_bom_version_number,
    value.production_planned_quantity,
    value.production_actual_good_quantity,
    value.production_output_product_id,
    value.production_output_serial_number,
    value.production_output_product_name,
  ];
  if (!hasProduction && productionValues.some((field) => field !== undefined && field !== null)) {
    throw new WorkOrderPdfSnapshotError();
  }
  const hasMaterial = value.product_id !== null;

  return {
    workOrderId: exactPattern(value.work_order_id, uuidPattern),
    workOrderNumber: exactPattern(
      value.work_order_number,
      workOrderNumberPattern,
    ),
    projectName: value.project_name === null && hasProduction
      ? "General Stock"
      : requiredText(value.project_name),
    customerName: value.customer_name_snapshot === null && hasProduction
      ? ""
      : requiredText(value.customer_name_snapshot),
    description: requiredText(value.description),
    workOrderCreatedAt: exactTimestamp(value.work_order_created_at),
    snapshotUpdatedAt: exactTimestamp(value.snapshot_updated_at),
    material: hasMaterial ? {
      position: exactPositiveBigint(value.material_position),
      productId: exactPattern(value.product_id, uuidPattern),
      serialNumber: exactPattern(value.serial_number, serialNumberPattern),
      productName: requiredText(value.product_name),
      quantity: exactPositiveBigint(value.quantity),
    } : null,
    pcbProduction: hasProduction ? {
      pcbCardId: exactPattern(value.production_pcb_card_id, uuidPattern),
      pcbCardName: requiredText(value.production_pcb_card_name),
      bomVersionNumber: exactPositiveBigint(value.production_bom_version_number),
      plannedQuantity: exactPositiveBigint(value.production_planned_quantity),
      actualGoodQuantity: exactNonnegativeBigint(value.production_actual_good_quantity),
      outputProductId: exactPattern(value.production_output_product_id, uuidPattern),
      outputSerialNumber: exactPattern(value.production_output_serial_number, serialNumberPattern),
      outputProductName: requiredText(value.production_output_product_name),
    } : null,
  };
}

function sameHeader(
  first: ParsedSnapshotRow,
  candidate: ParsedSnapshotRow,
): boolean {
  return first.workOrderId === candidate.workOrderId &&
    first.workOrderNumber === candidate.workOrderNumber &&
    first.projectName === candidate.projectName &&
    first.customerName === candidate.customerName &&
    first.description === candidate.description &&
    first.workOrderCreatedAt === candidate.workOrderCreatedAt &&
    first.snapshotUpdatedAt === candidate.snapshotUpdatedAt;

}

/** Parse the narrow RPC result without coercing bigint text through Number. */
export function parseWorkOrderPdfSnapshot(
  value: unknown,
): WorkOrderPdfSnapshot {
  if (!Array.isArray(value) || value.length === 0) {
    throw new WorkOrderPdfSnapshotError();
  }

  const rows = value.map(parseRow);
  const first = rows[0];
  if (!first) throw new WorkOrderPdfSnapshotError();
  if (first.pcbProduction &&
    BigInt(first.pcbProduction.actualGoodQuantity) > BigInt(first.pcbProduction.plannedQuantity)) {
    throw new WorkOrderPdfSnapshotError();
  }

  const productIds = new Set<string>();
  const materials = rows.flatMap((row) => row.material ? [row.material] : []);
  for (const [index, row] of rows.entries()) {
    if (
      !sameHeader(first, row) ||
      JSON.stringify(row.pcbProduction) !== JSON.stringify(first.pcbProduction) ||
      (row.material === null && !(first.pcbProduction && rows.length === 1)) ||
      (row.material !== null && (
        row.material.position !== String(index + 1) ||
        productIds.has(row.material.productId)
      ))
    ) {
      throw new WorkOrderPdfSnapshotError();
    }
    if (row.material) productIds.add(row.material.productId);
  }

  return {
    workOrderId: first.workOrderId,
    workOrderNumber: first.workOrderNumber,
    projectName: first.projectName,
    customerName: first.customerName,
    description: first.description,
    workOrderCreatedAt: first.workOrderCreatedAt,
    snapshotUpdatedAt: first.snapshotUpdatedAt,
    materials,
    pcbProduction: first.pcbProduction,
  };
}
