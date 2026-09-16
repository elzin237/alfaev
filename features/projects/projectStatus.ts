import type { StatusBadgeTone } from "../../shared/components/StatusBadge";

export const projectStatuses = [
  "planned",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
] as const;

export type ProjectStatus = (typeof projectStatuses)[number];
export type ProjectStatusFilter = "all" | ProjectStatus;

export const projectEditableStatuses = [
  "planned",
  "in_progress",
  "on_hold",
] as const;

export type ProjectEditableStatus = (typeof projectEditableStatuses)[number];

export const projectStatusOptions: ReadonlyArray<{
  label: string;
  value: ProjectStatusFilter;
}> = [
  { value: "all", label: "All" },
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export const projectEditableStatusOptions: ReadonlyArray<{
  label: string;
  value: ProjectEditableStatus;
}> = projectStatusOptions.filter(
  (option): option is { label: string; value: ProjectEditableStatus } =>
    isProjectEditableStatus(option.value),
);

const statusPresentation: Record<
  ProjectStatus,
  { label: string; tone: StatusBadgeTone }
> = {
  planned: { label: "Planned", tone: "neutral" },
  in_progress: { label: "In Progress", tone: "info" },
  on_hold: { label: "On Hold", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export function getProjectStatusPresentation(status: ProjectStatus) {
  return statusPresentation[status];
}

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" &&
    projectStatuses.some((status) => status === value);
}

export function isProjectEditableStatus(
  value: unknown,
): value is ProjectEditableStatus {
  return typeof value === "string" &&
    projectEditableStatuses.some((status) => status === value);
}

export function isProjectStatusFilter(
  value: unknown,
): value is ProjectStatusFilter {
  return value === "all" || isProjectStatus(value);
}
