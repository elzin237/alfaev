import { useRef, type KeyboardEvent } from "react";

import type { InventoryWarehouse } from "../inventoryWarehouses";

interface InventoryWarehouseTabsProps {
  warehouses: readonly InventoryWarehouse[];
  selectedWarehouseId: string;
  onSelect: (warehouse: InventoryWarehouse) => void;
}

export default function InventoryWarehouseTabs({
  warehouses,
  selectedWarehouseId,
  onSelect,
}: InventoryWarehouseTabsProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % warehouses.length;
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + warehouses.length) % warehouses.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = warehouses.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const next = warehouses[nextIndex];
    if (!next) return;
    onSelect(next);
    refs.current.get(next.id)?.focus();
  }

  return (
    <div className="overflow-x-auto pb-1">
      <div
        role="tablist"
        aria-label="Inventory warehouses"
        className="inline-flex min-w-max gap-1 rounded-2xl border border-zinc-200 bg-zinc-100 p-1"
      >
        {warehouses.map((warehouse, index) => {
          const selected = warehouse.id === selectedWarehouseId;
          return (
            <button
              key={warehouse.id}
              ref={(node) => {
                if (node) refs.current.set(warehouse.id, node);
                else refs.current.delete(warehouse.id);
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(warehouse)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={selected
                ? "rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-red-700 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                : "rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-600 transition hover:bg-white/70 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"}
            >
              {warehouse.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
