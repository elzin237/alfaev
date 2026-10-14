import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import type { SecurityActor } from "../security-fixtures";

type InventoryFixtureActor = Pick<SecurityActor, "authUserId" | "profileId">;

interface SupplierSourceOptions {
  catalogNumber?: string;
  description?: string | null;
  reason?: string;
  supplierName?: string;
}

interface IdRow {
  id: string;
}

interface MovementRow {
  movement_id: string;
  quantity_after: string;
  quantity_before: string;
}

interface InventoryInvariantRow {
  allocated_quantity: string;
  balance_quantity: string;
  lot_remaining_quantity: string;
  outbound_quantity: string;
}

export interface SupplierSourceFixture {
  catalogNumber: string;
  description: string | null;
  productSupplierId: string;
  supplierId: string;
}

export interface SeededSupplierStock extends SupplierSourceFixture {
  movementId: string;
  quantityAfter: string;
  quantityBefore: string;
}

export async function seedSupplierStockForProfile(
  database: PoolClient,
  profileId: string,
  productId: string,
  quantity: bigint | number | string,
  options: SupplierSourceOptions = {},
): Promise<SeededSupplierStock> {
  const identity = await database.query<{ auth_user_id: string }>(
    `select profile.auth_user_id
     from public.user_profiles as profile
     where profile.id = $1::uuid`,
    [profileId],
  );
  const authUserId = identity.rows[0]?.auth_user_id;
  if (!authUserId) throw new Error("Stock fixture actor has no Auth identity");

  return seedSupplierStock(
    database,
    { authUserId, profileId },
    productId,
    quantity,
    options,
  );
}

export async function setDatabaseActor(
  database: PoolClient,
  actor: InventoryFixtureActor | null,
): Promise<void> {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor?.authUserId ?? ""],
  );
  await database.query(actor ? "set local role authenticated" : "set local role anon");
}

export async function createSupplierSourceFixture(
  database: PoolClient,
  actor: InventoryFixtureActor,
  productId: string,
  options: {
    catalogNumber?: string;
    description?: string | null;
    supplierName?: string;
  } = {},
): Promise<SupplierSourceFixture> {
  const token = randomUUID();
  const supplierName = options.supplierName ?? `Provenance Supplier ${token}`;
  const catalogNumber = options.catalogNumber ?? `CAT-${token}`;
  const description = options.description ?? null;

  await setDatabaseActor(database, actor);
  const supplier = await database.query<IdRow>(
    `select public.create_supplier(
       $1::text, $2::text, 'Bosnia and Herzegovina', $3::text, null, null, null
     ) as id`,
    [supplierName, catalogNumber, description],
  );
  const supplierId = supplier.rows[0]?.id;
  if (!supplierId) throw new Error("Trusted Supplier fixture creation returned no ID");

  const relationship = await database.query<IdRow>(
    `select public.create_product_supplier(
       $1::uuid, $2::uuid
     ) as id`,
    [productId, supplierId],
  );
  const productSupplierId = relationship.rows[0]?.id;
  await database.query("reset role");
  if (!productSupplierId) {
    throw new Error("Trusted ProductSupplier fixture creation returned no ID");
  }

  return {
    catalogNumber,
    description,
    productSupplierId,
    supplierId,
  };
}

export async function seedSupplierStock(
  database: PoolClient,
  actor: InventoryFixtureActor,
  productId: string,
  quantity: bigint | number | string,
  options: SupplierSourceOptions = {},
): Promise<SeededSupplierStock> {
  const source = await createSupplierSourceFixture(
    database,
    actor,
    productId,
    options,
  );

  await setDatabaseActor(database, actor);
  const adjustment = await database.query<MovementRow>(
    `select *
     from public.manual_adjust_inventory(
       $1::uuid, 'add', $2::bigint, $3::text, $4::uuid
     )`,
    [
      productId,
      quantity.toString(),
      options.reason ?? "Canonical supplier stock fixture",
      source.productSupplierId,
    ],
  );
  await database.query("reset role");
  const movement = adjustment.rows[0];
  if (!movement) throw new Error("Trusted stock fixture returned no movement");

  return {
    ...source,
    movementId: movement.movement_id,
    quantityAfter: movement.quantity_after,
    quantityBefore: movement.quantity_before,
  };
}

export async function getWorkOrderAllocationFingerprint(
  database: PoolClient,
  workOrderId: string,
): Promise<string> {
  const role = (await database.query<{ current_user: string }>(
    "select current_user",
  )).rows[0]?.current_user;
  if (role === "authenticated" || role === "anon") {
    await database.query("reset role");
  }
  let result;
  try {
    result = await database.query<{ fingerprint: string }>(
      `select public.get_work_order_source_allocation_fingerprint(
         $1::uuid
       ) as fingerprint`,
      [workOrderId],
    );
  } finally {
    if (result && role === "authenticated") {
      await database.query("set local role authenticated");
    }
    if (result && role === "anon") await database.query("set local role anon");
  }
  const fingerprint = result.rows[0]?.fingerprint;
  if (!fingerprint) throw new Error("Work Order allocation fingerprint is unavailable");
  return fingerprint;
}

export async function assertInventorySourceInvariant(
  database: PoolClient,
  productId: string,
): Promise<void> {
  const result = await database.query<InventoryInvariantRow>(
    `select
       balance.quantity::text as balance_quantity,
       coalesce((
         select pg_catalog.sum(lot.remaining_quantity::numeric)::text
         from public.inventory_source_lots as lot
         where lot.product_id = balance.product_id
       ), '0') as lot_remaining_quantity,
       coalesce((
         select pg_catalog.sum((-movement.quantity_delta)::numeric)::text
         from public.inventory_movements as movement
         where movement.product_id = balance.product_id
           and movement.quantity_delta < 0
       ), '0') as outbound_quantity,
       coalesce((
         select pg_catalog.sum(allocation.allocated_quantity::numeric)::text
         from public.inventory_source_allocations as allocation
         where allocation.product_id = balance.product_id
       ), '0') as allocated_quantity
     from public.inventory_balances as balance
     where balance.product_id = $1::uuid`,
    [productId],
  );
  const state = result.rows[0];
  if (!state) throw new Error("Inventory invariant fixture Product has no balance");
  if (state.balance_quantity !== state.lot_remaining_quantity) {
    throw new Error("InventoryBalance does not equal remaining source-lot stock");
  }
  if (state.outbound_quantity !== state.allocated_quantity) {
    throw new Error("Outbound movement quantity does not equal source allocations");
  }
}
