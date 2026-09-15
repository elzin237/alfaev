import { describe, expect, it } from "vitest";

import {
  procurementActiveSupplierChoicesQueryKey,
  normalizeProcurementSearch,
  procurementBadgeQueryKey,
  procurementListQueryKey,
  procurementProductChoicesQueryKey,
  procurementSupplierOptionsQueryKey,
} from "./procurementQueryKeys";

describe("Procurement query keys", () => {
  it("normalizes list search and scopes filters to the current profile", () => {
    expect(normalizeProcurementSearch("  resistor  ")).toBe("resistor");
    expect(procurementListQueryKey("profile-1", {
      search: "  resistor  ",
      status: "active",
      supplierId: "supplier-1",
    })).toEqual([
      "procurement",
      "profile-1",
      "list",
      "resistor",
      "active",
      "supplier-1",
    ]);
  });

  it("keeps Supplier options and badge in distinct profile-scoped boundaries", () => {
    expect(procurementSupplierOptionsQueryKey("profile-1")).toEqual([
      "procurement",
      "profile-1",
      "supplier-options",
    ]);
    expect(procurementBadgeQueryKey("profile-1")).toEqual([
      "procurement",
      "profile-1",
      "badge",
    ]);
    expect(procurementProductChoicesQueryKey("profile-1", "  0001 ")).toEqual([
      "procurement",
      "profile-1",
      "creation",
      "product-choices",
      "0001",
    ]);
    expect(procurementActiveSupplierChoicesQueryKey("profile-1")).toEqual([
      "procurement",
      "profile-1",
      "creation",
      "supplier-choices",
    ]);
  });
});
