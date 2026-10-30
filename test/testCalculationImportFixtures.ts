import type { TestImportReceipt } from "../features/test-calculator/services/testCalculationImportService";
export const importId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const importIdentity = { authUserId: importId(1), profileId: importId(2) };
export const importRequest = { requestId: importId(3), calculationId: importId(4), serialNumber: "007" };
export const importReceipt = (): TestImportReceipt => ({
  import_id: importId(5), calculation_id: importId(4), name: "Saved Test", pcb_card_id: importId(6), output_product_id: importId(7),
  initial_bom_version_id: importId(8), initial_bom_version_number: "1", serial_number: "007", imported_at: "2026-10-29T12:34:56.123456+00:00",
  release_allocations: [{ item_id: importId(9), product_id: importId(10), warehouse_id: "10000000-0000-4000-8000-000000000001", quantity: "9223372036854775807" },
    { item_id: importId(9), product_id: importId(10), warehouse_id: "10000000-0000-4000-8000-000000000003", quantity: "9223372036854775807" }],
  release_totals: [{ product_id: importId(10), quantity: "18446744073709551614" }],
});
