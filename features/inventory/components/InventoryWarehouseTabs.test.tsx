import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { describe, expect, it, vi } from "vitest";

import InventoryWarehouseTabs from "./InventoryWarehouseTabs";
import { INVENTORY_WAREHOUSES } from "../inventoryWarehouses";
afterEach(cleanup);

describe("InventoryWarehouseTabs", () => {
  it("places All first and preserves complete arrow/Home/End navigation", () => {
    const onSelect = vi.fn(), onSelectAll = vi.fn();
    render(<InventoryWarehouseTabs warehouses={INVENTORY_WAREHOUSES} selectedWarehouseId="" allSelected onSelect={onSelect} onSelectAll={onSelectAll} />);
    expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual(["All", "Raw Materials", "Finished Goods", "Customs Warehouse"]);
    const all = screen.getByRole("tab", { name: /^All$/ });
    expect(all).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(all, { key: "ArrowRight" }); expect(onSelect).toHaveBeenLastCalledWith(INVENTORY_WAREHOUSES[0]);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Raw Materials" }), { key: "Home" }); expect(onSelectAll).toHaveBeenCalledOnce();
    fireEvent.keyDown(all, { key: "ArrowLeft" }); expect(onSelect).toHaveBeenLastCalledWith(INVENTORY_WAREHOUSES[2]);
  });
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
