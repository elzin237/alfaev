import { describe, expect, it } from "vitest";

import { archiveContextPath } from "./archiveContext";

describe("archiveContextPath", () => {
  const id = "00000000-0000-4000-8000-000000000123";

  it.each([
    ["project", `/projects/${id}`],
    ["supplier", `/suppliers/${id}`],
    ["product", `/inventory/${id}`],
    ["pcb_card", `/pcb/${id}`],
    ["work_order", `/work-orders/${id}`],
    ["user_profile", `/users/${id}`],
  ] as const)("maps only allow-listed %s context", (kind, path) => {
    expect(archiveContextPath(kind, id)).toBe(path);
  });
});
