import { useRef, type KeyboardEvent } from "react";

import type { InventoryWarehouse } from "../inventoryWarehouses";

interface InventoryWarehouseTabsProps {
  warehouses: readonly InventoryWarehouse[];
  selectedWarehouseId: string;
  onSelect: (warehouse: InventoryWarehouse) => void;
  allSelected?: boolean;
  onSelectAll?: () => void;
}

export default function InventoryWarehouseTabs({
  warehouses,
  selectedWarehouseId,
  onSelect,
  allSelected = false,
  onSelectAll,
}: InventoryWarehouseTabsProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const total = warehouses.length + (onSelectAll ? 1 : 0);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % total;
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + total) % total;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = total - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    if (onSelectAll && nextIndex === 0) { onSelectAll(); refs.current.get("all")?.focus(); return; }
    const next = warehouses[nextIndex - (onSelectAll ? 1 : 0)];
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
        {onSelectAll && <button type="button" role="tab" aria-selected={allSelected} tabIndex={allSelected ? 0 : -1}
          ref={node => { if (node) refs.current.set("all", node); else refs.current.delete("all"); }}
          onClick={onSelectAll} onKeyDown={event => handleKeyDown(event, 0)}
          className={`rounded-xl px-4 py-2.5 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-red-500 ${allSelected ? "bg-white text-red-700 shadow-sm" : "text-zinc-600 hover:bg-white/70"}`}>All</button>}
        {warehouses.map((warehouse, index) => {
          const selected = !allSelected && warehouse.id === selectedWarehouseId;
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
              onKeyDown={(event) => handleKeyDown(event, index + (onSelectAll ? 1 : 0))}
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
