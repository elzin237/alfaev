import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import InventoryWarehouseTabs from "./InventoryWarehouseTabs";
import { INVENTORY_WAREHOUSES } from "../inventoryWarehouses";

describe("InventoryWarehouseTabs", () => {
  it("uses accessible tabs and supports arrows, Home, and End without exposing rows", () => {
    const onSelect = vi.fn();
    render(
      <InventoryWarehouseTabs
        warehouses={INVENTORY_WAREHOUSES}
        selectedWarehouseId={INVENTORY_WAREHOUSES[0]!.id}
        onSelect={onSelect}
      />,
    );

    const raw = screen.getByRole("tab", { name: "Raw Materials" });
    expect(raw).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(raw, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith(INVENTORY_WAREHOUSES[1]!);
    expect(screen.getByRole("tab", { name: "Finished Goods" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Finished Goods" }), { key: "End" });
    expect(onSelect).toHaveBeenLastCalledWith(INVENTORY_WAREHOUSES[2]!);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Customs Warehouse" }), { key: "Home" });
    expect(onSelect).toHaveBeenLastCalledWith(INVENTORY_WAREHOUSES[0]!);
  });
});
