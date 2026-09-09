import type { Supplier } from "./services/supplierService";

export function filterSuppliers(
  suppliers: readonly Supplier[],
  searchValue: string,
): Supplier[] {
  const search = searchValue.trim().toLowerCase();
  if (!search) return [...suppliers];

  return suppliers.filter((supplier) =>
    [
      supplier.name,
      supplier.country,
      supplier.contactPersonName,
      supplier.contactEmail,
      supplier.contactPhone,
    ].some((value) => value?.toLowerCase().includes(search)),
  );
}
