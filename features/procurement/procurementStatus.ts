export const PROCUREMENT_STATUSES = [
  "active",
  "partly_delivered",
  "resolved",
] as const;

export type ProcurementStatus = (typeof PROCUREMENT_STATUSES)[number];
export type ProcurementStatusFilter = ProcurementStatus | "all";

export const procurementStatusOptions: ReadonlyArray<{
  label: string;
  value: ProcurementStatusFilter;
}> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "partly_delivered", label: "Partly Delivered" },
  { value: "resolved", label: "Resolved" },
];

export function isProcurementStatus(
  value: unknown,
): value is ProcurementStatus {
  return typeof value === "string" &&
    PROCUREMENT_STATUSES.some((status) => status === value);
}

export function isProcurementStatusFilter(
  value: unknown,
): value is ProcurementStatusFilter {
  return value === "all" || isProcurementStatus(value);
}

export function getProcurementStatusDisplay(status: ProcurementStatus) {
  switch (status) {
    case "active":
      return { label: "Active", tone: "info" as const };
    case "partly_delivered":
      return { label: "Partly Delivered", tone: "warning" as const };
    case "resolved":
      return { label: "Resolved", tone: "success" as const };
  }
}
