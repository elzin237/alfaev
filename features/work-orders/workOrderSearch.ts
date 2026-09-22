import type {
  WorkOrderListItem,
  WorkOrderStatus,
} from "./services/workOrderService";

export type WorkOrderStatusFilter = "all" | WorkOrderStatus;

export const workOrderStatusOptions: ReadonlyArray<{
  label: string;
  value: WorkOrderStatusFilter;
}> = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Finished", value: "finished" },
];

export function isWorkOrderStatusFilter(
  value: string,
): value is WorkOrderStatusFilter {
  return value === "all" || value === "draft" || value === "finished";
}

export function filterWorkOrders(
  workOrders: readonly WorkOrderListItem[],
  searchValue: string,
  statusFilter: WorkOrderStatusFilter,
): WorkOrderListItem[] {
  const search = searchValue.trim().toLowerCase();

  return workOrders.filter((workOrder) => {
    if (statusFilter !== "all" && workOrder.status !== statusFilter) {
      return false;
    }

    if (!search) return true;

    return [
      workOrder.workOrderNumber,
      workOrder.projectName,
      workOrder.customerName,
    ].some((value) => value?.toLowerCase().includes(search));
  });
}
