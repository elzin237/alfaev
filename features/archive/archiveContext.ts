import type { ArchiveContextKind } from "./archiveService";

export function archiveContextPath(
  contextKind: ArchiveContextKind,
  contextId: string,
): string {
  switch (contextKind) {
    case "project":
      return `/projects/${contextId}`;
    case "supplier":
      return `/suppliers/${contextId}`;
    case "product":
      return `/inventory/${contextId}`;
    case "pcb_card":
      return `/pcb/${contextId}`;
    case "work_order":
      return `/work-orders/${contextId}`;
    case "user_profile":
      return `/users/${contextId}`;
  }
}
