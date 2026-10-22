import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { loadBackendTestEnvironment } from "./env";
import { registerSecurityFixture } from "./helpers/fixture-lifecycle";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { createTestSerialNumber } from "./helpers/serial";
import type { SecurityActor } from "./security-fixtures";

const raw = "10000000-0000-4000-8000-000000000001";
const finished = "10000000-0000-4000-8000-000000000002";
const customs = "10000000-0000-4000-8000-000000000003";

async function actAs(db: PoolClient, actor: SecurityActor | null) {
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [actor?.authUserId ?? ""]);
  await db.query(actor ? "set local role authenticated" : "set local role anon");
}

async function product(db: PoolClient, actorId: string, name: string, kind = "component") {
  const id = randomUUID();
  await db.query(`insert into public.products
    (id, serial_number, name, category, product_kind, created_by_user_id, updated_by_user_id)
    values ($1,$2,$3,$3,$4,$5,$5)`, [id, createTestSerialNumber(), name, kind, actorId]);
  return id;
}

async function card(db: PoolClient, actorId: string, name: string, archived = false) {
  const outputId = await product(db, actorId, name, "pcb_finished_good");
  const id = randomUUID();
  await db.query(`insert into public.pcb_cards(id,name,output_product_id,created_by_user_id,updated_by_user_id)
    values ($1,$2,$3,$4,$4)`, [id, name, outputId, actorId]);
  if (archived) {
    for (const table of ["products", "pcb_cards"]) {
      await db.query(`update public.${table} set is_active=false,archived_at=now(),archived_by_user_id=$2
        where id=$1`, [table === "products" ? outputId : id, actorId]);
    }
  }
  return { id, outputId };
}

async function list(db: PoolClient, actor: SecurityActor, warehouse: string, search: string | null = null) {
  await actAs(db, actor);
  try {
    return (await db.query("select * from public.search_inventory_products_by_warehouse($1,$2)", [warehouse, search])).rows;
  } finally { await db.query("reset role"); }
}

async function adjust(db: PoolClient, actor: SecurityActor, id: string, warehouse: string, kind: string, quantity: string, source: string | null = null) {
  await actAs(db, actor);
  await db.query("select * from public.adjust_inventory_warehouse($1,$2,$3,$4::bigint,'Task 001J local fixture',$5)", [id, warehouse, kind, quantity, source]);
  await db.query("reset role");
}

describe.skipIf(loadBackendTestEnvironment().projectRef !== "local")("Task 001J warehouse listing and Calculator stock", () => {
  const requireHarness = registerSecurityFixture();

  it("preserves Raw visibility and lists only zero-stock/archived Card-linked outputs in Finished Goods", async () => {
    const h = requireHarness();
    await h.withRollbackDatabaseTransaction(async db => {
      const marker = `001J-${randomUUID()}`;
      const ordinary = await product(db, h.actors.admin.profileId, marker);
      const unlinked = await product(db, h.actors.admin.profileId, `${marker}-unlinked`, "pcb_finished_good");
      const active = await card(db, h.actors.admin.profileId, `${marker}-active`);
      const archived = await card(db, h.actors.admin.profileId, `${marker}-archived`, true);
      const rawRows = await list(db, h.actors.admin, raw, marker);
      expect(new Set(rawRows.map(r => r.id))).toEqual(new Set([ordinary, unlinked, active.outputId, archived.outputId]));
      const rows = await list(db, h.actors.admin, finished, marker);
      expect(new Set(rows.map(r => r.id))).toEqual(new Set([active.outputId, archived.outputId]));
      expect(rows.every(r => r.quantity === "0" && r.warehouse_id === finished)).toBe(true);
      expect(rows.find(r => r.id === archived.outputId)?.is_active).toBe(false);
      expect(await list(db, h.actors.admin, customs, marker)).toEqual([]);
      const expected = await db.query(`select id from public.products where id=any($1::uuid[]) order by serial_number,id`, [[active.outputId, archived.outputId]]);
      expect(rows.map(r => r.id)).toEqual(expected.rows.map(r => r.id));
    });
  });

  it("groups every search alternative under membership, preserving escaping and Serial prefixes", async () => {
    const h = requireHarness();
    await h.withRollbackDatabaseTransaction(async db => {
      const marker = `001J-${randomUUID()}`;
      const ordinary = await product(db, h.actors.admin.profileId, marker);
      const output = await card(db, h.actors.admin.profileId, `${marker}-100%_\\literal`);
      const source = await createSupplierSourceFixture(db, h.actors.admin, ordinary, { catalogNumber: `${marker}-CAT` });
      const serial = (await db.query("select serial_number from public.products where id=$1", [ordinary])).rows[0].serial_number as string;
      for (const warehouse of [finished, customs]) {
        for (const search of [marker.toUpperCase(), serial, source.catalogNumber.toUpperCase(), "%", "_", "\\", null]) {
          expect((await list(db, h.actors.admin, warehouse, search)).some(r => r.id === ordinary)).toBe(false);
        }
      }
      expect((await list(db, h.actors.admin, raw, source.catalogNumber.toUpperCase())).map(r => r.id)).toContain(ordinary);
      expect((await list(db, h.actors.admin, raw, serial.slice(0, 5))).map(r => r.id)).toContain(ordinary);
      for (const search of ["100%_\\literal", `${marker}-100`.toUpperCase()]) {
        expect((await list(db, h.actors.admin, finished, search)).map(r => r.id)).toEqual([output.outputId]);
      }
      await db.query("update public.products set name='Different name' where id=$1", [output.outputId]);
      expect((await list(db, h.actors.admin, finished, marker)).map(r => r.id)).toEqual([output.outputId]); // Category match
    });
  });

  it("supports first Customs transfer, rollback, positive balance, and retained depleted movement membership", async () => {
    const h = requireHarness();
    await h.withRollbackDatabaseTransaction(async db => {
      const marker = `001J-${randomUUID()}`;
      const id = await product(db, h.actors.admin.profileId, marker);
      const source = await createSupplierSourceFixture(db, h.actors.admin, id);
      await adjust(db, h.actors.admin, id, raw, "add", "5", source.productSupplierId);
      expect(await list(db, h.actors.admin, customs, marker)).toEqual([]);
      // Detail/destination access must not depend on prior list membership.
      await actAs(db, h.actors.admin);
      expect((await db.query("select quantity from public.get_inventory_product_by_warehouse($1,$2)", [id, customs])).rows).toEqual([{ quantity: "0" }]);
      await db.query("reset role");
      await db.query("savepoint first_customs");
      await actAs(db, h.actors.admin);
      await db.query("select * from public.transfer_inventory_between_warehouses($1,$2,$3,2,'First Customs intake')", [id, raw, customs]);
      await db.query("reset role");
      expect((await list(db, h.actors.admin, customs, marker))[0]?.quantity).toBe("2");
      await db.query("rollback to savepoint first_customs");
      expect(await list(db, h.actors.admin, customs, marker)).toEqual([]);
      expect((await db.query("select count(*)::int n from public.inventory_movements where product_id=$1 and warehouse_id=$2", [id, customs])).rows[0]?.n).toBe(0);
      await db.query("savepoint positive_balance");
      await db.query("update public.inventory_balances set quantity=1 where product_id=$1 and warehouse_id=$2", [id, customs]);
      expect((await list(db, h.actors.admin, customs, marker))[0]?.quantity).toBe("1");
      await db.query("rollback to savepoint positive_balance");
      await adjust(db, h.actors.admin, id, customs, "add", "3", source.productSupplierId);
      await adjust(db, h.actors.admin, id, customs, "remove", "3");
      expect((await list(db, h.actors.admin, customs, marker))[0]?.quantity).toBe("0");
      await db.query("update public.products set is_active=false,archived_at=now(),archived_by_user_id=$2 where id=$1", [id, h.actors.admin.profileId]);
      expect((await list(db, h.actors.admin, customs, marker))[0]?.is_active).toBe(false);
    });
  });

  it("reads both Calculator output quantities from Finished Goods and preserves Raw BOM input/picker stock", async () => {
    const h = requireHarness();
    await h.withRollbackDatabaseTransaction(async db => {
      const output = await card(db, h.actors.admin.profileId, `001J-${randomUUID()}`);
      const inputId = await product(db, h.actors.admin.profileId, `001J-input-${randomUUID()}`);
      const source = await createSupplierSourceFixture(db, h.actors.admin, inputId);
      const outputSource = await createSupplierSourceFixture(db, h.actors.admin, output.outputId);
      for (const [warehouse, quantity] of [[raw,"24"],[finished,"7"],[customs,"3"]]) {
        await adjust(db, h.actors.admin, output.outputId, warehouse!, "add", quantity!, outputSource.productSupplierId);
      }
      await adjust(db, h.actors.admin, inputId, raw, "add", "11", source.productSupplierId);
      await adjust(db, h.actors.admin, inputId, finished, "add", "2", source.productSupplierId);
      const version = randomUUID();
      await db.query(`insert into public.pcb_bom_versions(id,pcb_card_id,version_number,created_by_user_id) values($1,$2,1,$3)`, [version,output.id,h.actors.admin.profileId]);
      await db.query("insert into public.pcb_bom_items(bom_version_id,component_product_id,quantity_per_card) values($1,$2,1)", [version,inputId]);
      const before = (await db.query("select count(*)::int n from public.audit_logs")).rows;
      await actAs(db, h.actors.admin);
      expect((await db.query("select current_stock from public.list_pcb_cards() where pcb_card_id=$1", [output.id])).rows).toEqual([{current_stock:"7"}]);
      const detail = (await db.query("select * from public.get_pcb_bom_editor($1)", [output.id])).rows;
      expect(detail).toHaveLength(1);
      expect(detail[0]).toMatchObject({output_current_stock:"7",input_current_stock:"11"});
      expect((await db.query("select current_stock from public.search_pcb_bom_product_choices($1,null) where product_id=$2", [output.id,inputId])).rows).toEqual([{current_stock:"11"}]);
      await db.query("reset role");
      expect((await db.query("select count(*)::int n from public.audit_logs")).rows).toEqual(before);
    });
  });

  it("preserves exact function ACLs, independent warehouse permissions, pcb.view, and active-user checks", async () => {
    const h = requireHarness();
    await h.withRollbackDatabaseTransaction(async db => {
      const marker = `001J-${randomUUID()}`;
      const output = await card(db,h.actors.admin.profileId,marker);
      const securities = await db.query(`select p.prosecdef,p.provolatile,p.proconfig,
        has_function_privilege('authenticated',p.oid,'execute') authenticated,
        has_function_privilege('anon',p.oid,'execute') anon,
        exists(select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE') public_execute
        from pg_proc p where p.oid=any(array[
        'public.search_inventory_products_by_warehouse(uuid,text)'::regprocedure,
        'public.list_pcb_cards()'::regprocedure,'public.get_pcb_bom_editor(uuid)'::regprocedure])`);
      expect(securities.rows).toHaveLength(3);
      for (const row of securities.rows) expect(row).toEqual({prosecdef:true,provolatile:"s",proconfig:['search_path=""'],authenticated:true,anon:false,public_execute:false});
      await db.query(`insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id)
        select $1,id,$2 from public.permission_definitions where key='inventory.finished_goods.view'`, [h.actors.unpermitted.profileId,h.actors.admin.profileId]);
      await db.query(`insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id)
        select $1,id,$2 from public.permission_definitions where key in ('inventory.finished_goods.view','pcb.view')`, [h.actors.inactive.profileId,h.actors.admin.profileId]);
      expect((await list(db,h.actors.unpermitted,finished,marker)).map(r=>r.id)).toEqual([output.outputId]);
      for (const [actor,sql,args] of [
        [h.actors.unpermitted,'select * from public.search_inventory_products_by_warehouse($1,null)',[raw]],
        [h.actors.unpermitted,'select * from public.list_pcb_cards()',[]],
        [h.actors.inactive,'select * from public.search_inventory_products_by_warehouse($1,null)',[finished]],
        [h.actors.inactive,'select * from public.list_pcb_cards()',[]],
        [h.actors.inactive,'select * from public.get_pcb_bom_editor($1)',[output.id]],
        [null,'select * from public.search_inventory_products_by_warehouse($1,null)',[finished]],
        [null,'select * from public.list_pcb_cards()',[]],
        [null,'select * from public.get_pcb_bom_editor($1)',[output.id]],
      ] as const) {
        await db.query('savepoint denied_read'); await actAs(db,actor);
        await expect(db.query(sql,[...args])).rejects.toMatchObject({code:'42501'});
        await db.query('rollback to savepoint denied_read');
      }
      await db.query(`insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id)
        select $1,id,$2 from public.permission_definitions where key='pcb.view'`, [h.actors.permitted.profileId,h.actors.admin.profileId]);
      await actAs(db,h.actors.permitted);
      expect((await db.query('select current_stock from public.list_pcb_cards() where pcb_card_id=$1',[output.id])).rows).toEqual([{current_stock:'0'}]);
      expect((await db.query('select output_current_stock from public.get_pcb_bom_editor($1)',[output.id])).rows).toEqual([{output_current_stock:'0'}]);
      await db.query('reset role');
    });
  });
});
