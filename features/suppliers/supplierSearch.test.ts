import { describe, expect, it } from "vitest";

import type { Supplier } from "./services/supplierService";
import { filterSuppliers } from "./supplierSearch";

const suppliers: Supplier[] = [
  {
    id: "supplier-1",
    name: "Bosch",
    country: "Germany",
    contactPersonName: "Mira Marić",
    contactPhone: "+387 61 111 222",
    contactEmail: "mira@bosch.example",
    isActive: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    archivedAt: null,
  },
  {
    id: "supplier-2",
    name: "ABB",
    country: "Switzerland",
    contactPersonName: null,
    contactPhone: null,
    contactEmail: null,
    isActive: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    archivedAt: "2026-09-02T00:00:00.000Z",
  },
];

describe("filterSuppliers", () => {
  it.each(["bosch", " GERMANY ", "mira marić", "MIRA@BOSCH", "+387 61"])(
    "matches the displayed Supplier fields case-insensitively for %s",
    (search) => {
      expect(filterSuppliers(suppliers, search)).toEqual([suppliers[0]]);
    },
  );

  it("returns no matches distinctly and restores the full list when cleared", () => {
    expect(filterSuppliers(suppliers, "no match")).toEqual([]);
    expect(filterSuppliers(suppliers, "   ")).toEqual(suppliers);
  });
});
