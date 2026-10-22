import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";

const raw = "10000000-0000-4000-8000-000000000001";
const finished = "10000000-0000-4000-8000-000000000002";
const customs = "10000000-0000-4000-8000-000000000003";
type Actor = { profileId: string; authUserId: string };
type Fixture = { product: string; project: string; component: string; work: string; source: string };

// No remote URL or general backend harness: that harness creates committed Auth
// fixtures. Every data change in this suite is rolled back instead.
describe.skipIf(process.env.PROJECT_CONSUMPTION_SHORTAGE_LOCAL !== "1")(
  "migration 142 local rollback-only Project consumption reconciliation", () => {
    let pool: Pool;
    let db: PoolClient;
    let actor: Actor;
    let baseline: Record<string, unknown>;

    async function snapshot(client: PoolClient) {
      const result: Record<string, unknown> = {};
      const tables = (await client.query<{ tablename: string }>(
        "select tablename from pg_tables where schemaname='public' order by tablename",
      )).rows.map(r => `public.${r.tablename}`).concat(["auth.users", "storage.objects"]);
      for (const table of tables) {
        if (!/^(public|auth|storage)\.[a-z_]+$/.test(table)) throw new Error("Unexpected table");
        result[table] = (await client.query(`select count(*)::int count,
          md5(coalesce(string_agg(to_jsonb(t)::text,chr(10) order by to_jsonb(t)::text),'')) digest
          from ${table} t`)).rows[0];
      }
      return result;
    }

    async function call(client: PoolClient, sql: string, args: unknown[] = [], role = "authenticated") {
      if (!["authenticated", "anon"].includes(role)) throw new Error("Unexpected test role");
      await client.query("savepoint actor_call");
      try {
        await client.query("select set_config('request.jwt.claim.sub',$1,true)", [role === "anon" ? "" : actor.authUserId]);
        await client.query(`set local role ${role}`);
        const result = await client.query(sql, args);
        await client.query("reset role");
        await client.query("release savepoint actor_call");
        return result;
      } catch (error) {
        await client.query("rollback to savepoint actor_call");
        await client.query("release savepoint actor_call");
        throw error;
      }
    }

    async function flush(client = db) {
      await client.query("set constraints project_shortage_reconciliation_queue_process immediate");
      await client.query("set constraints project_shortage_reconciliation_queue_process deferred");
    }

    async function queued(product: string, client = db) {
      return (await client.query(`select count(*)::int n from public.project_shortage_reconciliation_queue
        where transaction_id=txid_current() and product_id=$1`, [product])).rows[0].n as number;
    }

    async function newWork(client: PoolClient, project: string) {
      const id = randomUUID();
      const number = (await client.query(`select 'RN-8993-'||lpad(s::text,4,'0') n
        from generate_series(1,9999) s where not exists(select 1 from public.work_orders w
        where w.work_order_number='RN-8993-'||lpad(s::text,4,'0')) order by s limit 1`)).rows[0].n;
      await client.query(`insert into public.work_orders(id,work_order_number,project_id,
        customer_name_snapshot,description,created_by_user_id,updated_by_user_id)
        values($1,$2,$3,'Local Customer','Migration 142 rollback fixture',$4,$4)`,
      [id, number, project, actor.profileId]);
      return id;
    }

    async function fixture(stocks: [string, number][], quantity = 10): Promise<Fixture> {
      const product = randomUUID(), project = randomUUID(), group = randomUUID(), component = randomUUID();
      const serial = (await db.query(`select s::text serial from generate_series(8000000,8999999) s
        where not exists(select 1 from public.products p where p.serial_number=s::text)
        order by s limit 1`)).rows[0].serial;
      await db.query(`insert into public.products(id,serial_number,name,category,product_kind,
        created_by_user_id,updated_by_user_id) values($1,$2,$3,'Local reconciliation','component',$4,$4)`,
      [product, serial, `Reconciliation ${product}`, actor.profileId]);
      const source = await createSupplierSourceFixture(db, actor, product);
      for (const [warehouse, stock] of stocks) await call(db,
        "select * from public.adjust_inventory_warehouse($1,$2,'add',$3::bigint,'Local rollback stock',$4)",
        [product, warehouse, stock, source.productSupplierId]);
      await db.query(`insert into public.projects(id,name,customer_name,status,start_date,delivery_date,
        created_by_user_id,updated_by_user_id) values($1,$2,'Local Customer','planned','2026-10-22','2026-11-22',$3,$3)`,
      [project, `Reconciliation ${project}`, actor.profileId]);
      await db.query(`insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id)
        values($1,$2,'Local demand',$3,$3)`, [group, project, actor.profileId]);
      await db.query(`insert into public.project_product_components(id,project_product_id,product_id,
        required_quantity,created_by_user_id,updated_by_user_id) values($1,$2,$3,$4,$5,$5)`,
      [component, group, product, quantity, actor.profileId]);
      const work = await newWork(db, project);
      await newWork(db, project); // Keep the Project open after this Finish.
      await flush();
      return { product, project, component, work, source: source.productSupplierId };
    }

    async function finish(client: PoolClient, f: Pick<Fixture, "work" | "product">, quantity: number) {
      await client.query(`insert into public.work_order_items(work_order_id,product_id,quantity,added_by_user_id)
        values($1,$2,$3,$4)`, [f.work, f.product, quantity, actor.profileId]);
      const updated = (await client.query("select updated_at::text value from public.work_orders where id=$1", [f.work])).rows[0].value;
      const fingerprint = (await client.query("select public.get_work_order_source_allocation_fingerprint($1) value", [f.work])).rows[0].value;
      const path = `final/${f.work}/${randomUUID()}.pdf`;
      // Metadata-only local fixture: no Storage API or object bytes are written.
      await client.query(`insert into storage.objects(bucket_id,name,metadata)
        values('work-order-pdfs',$1,jsonb_build_object('mimetype','application/pdf'))`, [path]);
      const args = [f.work, updated, path, "a".repeat(64), fingerprint];
      const result = await call(client, "select * from public.finish_work_order($1,$2::timestamptz,$3,$4,$5)", args);
      expect(result.rows[0].project_completed).toBe(false);
      return args;
    }

    async function state(f: Fixture, client = db) {
      const commitment = (await client.query(`select outstanding_commitment::text outstanding
        from public.calculate_open_project_commitments($1) where project_id=$2`, [f.product, f.project])).rows[0];
      const episodes = (await client.query(`select current_shortage_quantity::text quantity,
        resolved_at is not null resolved from public.project_shortage_episodes
        where project_id=$1 and product_id=$2`, [f.project, f.product])).rows;
      const events = (await client.query(`select event_type,shortage_quantity::text quantity
        from public.project_shortage_events where project_id=$1 and product_id=$2 order by event_type`, [f.project, f.product])).rows;
      const alerts = (await client.query(`select count(*)::int n from public.project_activity_alerts
        where project_id=$1 and product_id=$2 and notification_kind='shortage'`, [f.project, f.product])).rows[0].n;
      expect((await client.query("select status from public.projects where id=$1", [f.project])).rows[0].status).toBe("planned");
      return { commitment, episodes, events, alerts };
    }

    beforeAll(async () => {
      pool = new Pool({ host: "127.0.0.1", port: 54322, database: "postgres", user: "postgres",
        password: process.env.LOCAL_SUPABASE_DB_PASSWORD ?? "postgres", ssl: false, max: 4,
        connectionTimeoutMillis: 5_000, application_name: "task001k-phase2-local-rollback" });
      const client = await pool.connect();
      try {
        expect((await client.query("select current_database() db")).rows[0].db).toBe("postgres");
        expect((await client.query("select max(version) latest from supabase_migrations.schema_migrations")).rows[0].latest)
          .toBe("20261022150000");
        const row = (await client.query(`select p.id,p.auth_user_id from public.user_profiles p
          join auth.users u on u.id=p.auth_user_id where p.is_active and p.is_admin order by p.id limit 1`)).rows[0];
        if (!row) throw new Error("Existing disposable local Admin fixture required; do not reset automatically");
        actor = { profileId: row.id, authUserId: row.auth_user_id };
        baseline = await snapshot(client);
      } finally { client.release(); }
    });

    beforeEach(async () => {
      db = await pool.connect();
      await db.query("begin");
      await db.query("set local statement_timeout='15s'");
      await db.query("set local lock_timeout='5s'");
    });
    afterEach(async () => {
      if (!db) return;
      try { await db.query("set constraints all immediate"); }
      finally { await db.query("rollback"); db.release(); }
    });
    afterAll(async () => {
      if (!pool) return;
      try {
        if (baseline) {
          const client = await pool.connect();
          try { expect(await snapshot(client)).toEqual(baseline); }
          finally { client.release(); }
        }
      } finally { await pool.end(); }
    });

    it.each([5, 10])("reconciles FG-only Finish of %i, preserves an open Project and rejects duplicate Finish", async quantity => {
      const f = await fixture([[finished, 10]]);
      const args = await finish(db, f, quantity);
      expect(await queued(f.product)).toBe(1);
      await flush();
      const expected = await state(f);
      expect(expected.commitment.outstanding).toBe(String(10 - quantity));
      expect(expected.episodes).toEqual([{ quantity: String(10 - quantity), resolved: quantity === 10 }]);
      expect(expected.events).toHaveLength(2);
      expect(expected.events).toContainEqual({ event_type: quantity === 10 ? "resolved" : "decreased", quantity: String(10 - quantity) });
      expect(expected.alerts).toBe(quantity === 10 ? 2 : 1);
      const movements = (await db.query("select id from public.inventory_movements where source_id=$1", [f.work])).rows;
      await expect(call(db, "select * from public.finish_work_order($1,$2::timestamptz,$3,$4,$5)", args))
        .rejects.toMatchObject({ code: "WOR02" });
      expect(await queued(f.product)).toBe(0);
      await db.query("select public.reconcile_project_shortages_for_products(array[$1::uuid,$1::uuid],false)", [f.product]);
      expect(await state(f)).toEqual(expected);
      expect((await db.query("select id from public.inventory_movements where source_id=$1", [f.work])).rows).toEqual(movements);
    });

    it.each([[raw, "Raw Materials"], [customs, "Customs"]])("preserves %s consumption and coalesces balance/movement scheduling (%s)", async warehouse => {
      const f = await fixture([[warehouse, 10]], 20);
      await finish(db, f, 5);
      expect(await queued(f.product)).toBe(1);
      await flush();
      const result = await state(f);
      expect(result.commitment.outstanding).toBe("15");
      expect(result.episodes).toEqual([{ quantity: "10", resolved: false }]);
      expect(result.events).toEqual([{ event_type: "opened", quantity: "10" }]);
      expect(result.alerts).toBe(1);
    });

    it("coalesces mixed-source movements, preserves priority/provenance and evaluates final state", async () => {
      const f = await fixture([[raw, 2], [customs, 3], [finished, 5]]);
      await finish(db, f, 10);
      expect(await queued(f.product)).toBe(1);
      const movements = (await db.query(`select w.code,m.quantity_delta::text quantity
        from public.inventory_movements m join public.inventory_warehouses w on w.id=m.warehouse_id
        where m.source_type='work_order' and m.source_id=$1 order by public.production_warehouse_priority(w.id)`, [f.work])).rows;
      expect(movements).toEqual([{ code: "raw_materials", quantity: "-2" },
        { code: "customs", quantity: "-3" }, { code: "finished_goods", quantity: "-5" }]);
      expect((await db.query(`select sum(a.allocated_quantity)::text quantity from public.inventory_source_allocations a
        join public.inventory_movements m on m.id=a.outbound_inventory_movement_id where m.source_id=$1`, [f.work])).rows[0].quantity).toBe("10");
      await flush();
      expect((await state(f)).episodes).toEqual([{ quantity: "0", resolved: true }]);
    });

    it("qualifies PCB inputs and coalesces duplicate Project-consumption movements", async () => {
      const f = await fixture([[finished, 10]]);
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor.authUserId]);
      for (let i = 0; i < 2; i++) await db.query(`select * from public.apply_inventory_delta_in_warehouse(
        $1,$2,-2,'pcb_production_input',null,'pcb_production_input',$3,$4)`,
      [f.product, finished, randomUUID(), f.project]);
      expect(await queued(f.product)).toBe(1);
      await flush();
      expect((await state(f)).episodes).toEqual([{ quantity: "6", resolved: false }]);
      expect((await state(f)).alerts).toBe(1);
    });

    it.each([0, 2])("preserves PCB planned-input quantities, split PDF provenance and actual-good FG output %i", async good => {
      const f = await fixture([[raw, 2], [customs, 2], [finished, 2]]);
      const output = randomUUID(), card = randomUUID(), version = randomUUID();
      const serial = (await db.query(`select s::text serial from generate_series(8000000,8999999) s
        where not exists(select 1 from public.products p where p.serial_number=s::text)
        order by s limit 1`)).rows[0].serial;
      await db.query(`insert into public.products(id,serial_number,name,category,product_kind,
        created_by_user_id,updated_by_user_id) values($1,$2,$3,'Local PCB','pcb_finished_good',$4,$4)`,
      [output, serial, `Output ${output}`, actor.profileId]);
      await db.query(`insert into public.pcb_cards(id,name,output_product_id,created_by_user_id,updated_by_user_id)
        values($1,$2,$3,$4,$4)`, [card, `Card ${card}`, output, actor.profileId]);
      await db.query(`insert into public.pcb_bom_versions(id,pcb_card_id,version_number,created_by_user_id)
        values($1,$2,1,$3)`, [version, card, actor.profileId]);
      await db.query(`insert into public.pcb_bom_items(bom_version_id,component_product_id,quantity_per_card)
        values($1,$2,2)`, [version, f.product]);
      await expect(call(db, "select * from public.create_pcb_production_work_order($1,'3',$2,$3)",
        [card, f.project, randomUUID()])).rejects.toMatchObject({ code: "PCB10" });
      const request = randomUUID();
      const create = () => call(db, "select * from public.create_pcb_production_work_order($1,'3',null,$2)", [card, request]);
      const created = (await create()).rows[0];
      expect((await create()).rows).toEqual([created]);
      const work = created.work_order_id;
      const updated = (await db.query("select project_id,updated_at::text value from public.work_orders where id=$1", [work])).rows[0];
      expect(updated.project_id).toBeNull();
      expect((await db.query("select quantity::text q from public.work_order_items where work_order_id=$1", [work])).rows).toEqual([{ q: "6" }]);
      // Product initialization legitimately queued its new zero Raw/Customs
      // balances. Drain that existing behavior before testing Finish scheduling.
      await flush();
      const plan = (await db.query(`select warehouse_code,allocated_quantity::text quantity
        from public.get_work_order_warehouse_source_allocation_plan($1)`, [work])).rows;
      expect(plan).toEqual([{ warehouse_code: "raw_materials", quantity: "2" },
        { warehouse_code: "customs", quantity: "2" }, { warehouse_code: "finished_goods", quantity: "2" }]);
      // The PDF RPC intentionally preserves its narrow projection: warehouse
      // identity is bound through the allocation fingerprint, not a new column.
      const snapshot = (await call(db, `select quantity,catalog_number,allocation_fingerprint
        from public.get_work_order_pdf_snapshot($1,$2::timestamptz,$3)`, [work, updated.value, String(good)])).rows;
      expect(snapshot.map(r => r.quantity)).toEqual(["2", "2", "2"]);
      expect(snapshot.every(r => typeof r.catalog_number === "string" && r.catalog_number.startsWith("CAT-"))).toBe(true);
      expect(new Set(snapshot.map(r => r.allocation_fingerprint)).size).toBe(1);
      expect(snapshot[0].allocation_fingerprint).toBe((await db.query(
        "select public.get_work_order_source_allocation_fingerprint($1) value", [work])).rows[0].value);
      const path = `final/${work}/${randomUUID()}.pdf`;
      await db.query(`insert into storage.objects(bucket_id,name,metadata)
        values('work-order-pdfs',$1,jsonb_build_object('mimetype','application/pdf'))`, [path]);
      await call(db, "select * from public.finish_work_order($1,$2::timestamptz,$3,$4,$5,$6)",
        [work, updated.value, path, "b".repeat(64), snapshot[0].allocation_fingerprint, String(good)]);
      const run = (await db.query("select id,quantity_produced::text q,project_id from public.pcb_production_runs where work_order_id=$1", [work])).rows[0];
      expect(run.q).toBe(String(good));
      expect(run.project_id).toBeNull();
      expect((await db.query(`select sum(-quantity_delta)::text q from public.inventory_movements
        where source_id=$1 and source_type='pcb_production_input'`, [run.id])).rows[0].q).toBe("6");
      expect((await db.query(`select warehouse_id,quantity::text q from public.inventory_balances
        where product_id=$1 order by warehouse_id`, [output])).rows).toEqual([
        { warehouse_id: raw, q: "0" }, { warehouse_id: finished, q: String(good) }, { warehouse_id: customs, q: "0" },
      ]);
      expect((await db.query(`select count(*)::int n from public.inventory_source_lots
        where product_id=$1 and source_kind='internal_production'`, [output])).rows[0].n).toBe(good === 0 ? 0 : 1);
      expect(await queued(output)).toBe(0);
      await flush();
      // General-stock manufacturing does not retire a Project's component demand.
      expect((await state(f)).commitment.outstanding).toBe("10");
    });

    it("ignores General Stock, positive and manual movements", async () => {
      const f = await fixture([[finished, 10]]);
      const before = await state(f);
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor.authUserId]);
      await db.query(`select * from public.apply_inventory_delta_in_warehouse(
        $1,$2,-1,'pcb_production_input',null,'pcb_production_input',$3,null)`, [f.product, finished, randomUUID()]);
      expect(await queued(f.product)).toBe(0);
      await db.query(`select * from public.apply_inventory_delta_in_warehouse(
        $1,$2,-1,'work_order',null,'work_order',$3,null)`, [f.product, finished, randomUUID()]);
      expect(await queued(f.product)).toBe(0);
      await db.query(`select * from public.apply_inventory_delta_in_warehouse(
        $1,$2,1,'work_order','Positive control','work_order',$3,$4,null,$5,'supplier')`,
      [f.product, finished, randomUUID(), f.project, f.source]);
      expect(await queued(f.product)).toBe(0);
      await db.query(`select * from public.apply_inventory_delta_in_warehouse(
        $1,$2,-1,'manual_remove','Manual control','manual_adjustment',null,$3)`, [f.product, finished, f.project]);
      expect(await queued(f.product)).toBe(0);
      await flush();
      expect(await state(f)).toEqual(before);
    });

    it("rolls back Finish, movements, allocations, PDFs, queues and shortage notifications", async () => {
      const f = await fixture([[finished, 10]]);
      const before = await state(f);
      await db.query("savepoint failed_operation");
      await finish(db, f, 10);
      await flush();
      expect((await state(f)).episodes[0].resolved).toBe(true);
      await db.query("rollback to savepoint failed_operation");
      expect(await state(f)).toEqual(before);
      expect(await queued(f.product)).toBe(0);
      expect((await db.query("select count(*)::int n from public.inventory_movements where source_id=$1", [f.work])).rows[0].n).toBe(0);
      expect((await db.query("select count(*)::int n from public.work_order_pdfs where work_order_id=$1", [f.work])).rows[0].n).toBe(0);
      expect((await db.query("select status from public.work_orders where id=$1", [f.work])).rows[0].status).toBe("draft");
    });

    it("keeps the helper/queue/events private and preserves helper metadata and enabled triggers", async () => {
      const metadata = (await db.query(`select p.prosecdef,p.provolatile,p.proconfig,
        has_function_privilege('authenticated',p.oid,'execute') authenticated,
        has_function_privilege('anon',p.oid,'execute') anon,
        has_function_privilege('service_role',p.oid,'execute') service_role,
        exists(select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE') public_execute
        from pg_proc p where p.oid='public.queue_project_shortage_reconciliation()'::regprocedure`)).rows[0];
      expect(metadata).toEqual({ prosecdef: true, provolatile: "v", proconfig: ['search_path=""'],
        authenticated: false, anon: false, service_role: false, public_execute: false });
      const triggers = (await db.query(`select tgname,tgenabled from pg_trigger where not tgisinternal
        and tgname in ('inventory_movements_queue_project_shortage_reconciliation',
        'inventory_balances_queue_shortage_reconciliation','project_components_queue_shortage_reconciliation',
        'projects_queue_shortage_reconciliation','project_shortage_reconciliation_queue_process')`)).rows;
      expect(triggers).toHaveLength(5);
      expect(triggers.every(t => t.tgenabled === "O")).toBe(true);
      const f = await fixture([[finished, 10]]);
      for (const role of ["authenticated", "anon"]) for (const sql of [
        "select public.queue_project_shortage_reconciliation()",
        "select public.reconcile_project_shortages_for_products(array[$1::uuid],false)",
        "insert into public.project_shortage_reconciliation_queue(transaction_id,product_id) values(txid_current(),$1)",
        "delete from public.project_shortage_reconciliation_queue where product_id=$1",
        "update public.project_shortage_episodes set current_shortage_quantity=1 where product_id=$1",
        "insert into public.project_shortage_events default values",
        "delete from public.project_shortage_events where product_id=$1",
        "insert into public.inventory_movements default values",
        "update public.inventory_movements set quantity_delta=-1 where product_id=$1",
      ]) await expect(call(db, sql, sql.includes("$1") ? [f.product] : [], role)).rejects.toMatchObject({ code: "42501" });
      expect(await queued(f.product)).toBe(0);
    });

    it("serializes a real Finish against a requirement edit, with both local transactions rolled back", async () => {
      // Use a pre-existing disposable local fixture as the shared MVCC anchor.
      // Newly inserted uncommitted fixtures cannot be visible to a second session.
      const shared = (await db.query(`select c.id component,c.product_id product,g.project_id project,
        c.required_quantity::text required from public.project_product_components c
        join public.project_products g on g.id=c.project_product_id join public.projects p on p.id=g.project_id
        join public.products x on x.id=c.product_id where p.status in('planned','in_progress','on_hold')
        and x.is_active and x.product_kind in('component','pcb_finished_good')
        and exists(select 1 from public.inventory_balances b where b.product_id=c.product_id and b.quantity>0)
        order by c.id limit 1`)).rows[0];
      if (!shared) throw new Error("Existing local shared fixture required; no committed fixture/reset is permitted");
      const first = await pool.connect(), second = await pool.connect();
      let edit: Promise<unknown> | undefined;
      try {
        for (const client of [first, second]) {
          await client.query("begin");
          await client.query("set local statement_timeout='15s'");
          await client.query("set local lock_timeout='10s'");
        }
        await first.query("select id from public.projects where id=$1 for update", [shared.project]);
        const stocks = (await first.query(`select warehouse_id,quantity::text from public.inventory_balances
          where product_id=$1 and warehouse_id<>$2 and quantity>0 order by warehouse_id`, [shared.product, finished])).rows;
        for (const stock of stocks) await call(first,
          "select * from public.transfer_inventory_between_warehouses($1,$2,$3,$4::bigint,'Rollback-only race setup')",
          [shared.product, stock.warehouse_id, finished, stock.quantity]);
        await flush(first);
        const work = await newWork(first, shared.project);
        await newWork(first, shared.project);
        const pid = (await second.query("select pg_backend_pid() pid")).rows[0].pid;
        edit = call(second, "select public.update_project_product_component($1,$2,$3::bigint)",
          [shared.component, shared.product, (BigInt(shared.required) + 1n).toString()]);
        // Observe the actual lock wait, not a timing-only assumption.
        let waiting = false;
        for (let i = 0; i < 150; i++) {
          waiting = (await db.query("select wait_event_type='Lock' waiting from pg_stat_activity where pid=$1", [pid])).rows[0]?.waiting;
          if (waiting) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        await finish(first, { work, product: shared.product }, 1);
        expect(await queued(shared.product, first)).toBe(1);
        await flush(first);
        const assertFinalState = async (client: PoolClient) => {
          const expected = (await client.query(`with expected as (
            select greatest(coalesce((select sum(outstanding_commitment) from public.calculate_open_project_commitments($1)),0)
              -coalesce((select sum(quantity) from public.inventory_balances where product_id=$1 and warehouse_id=any($2::uuid[])),0),0) q
          ) select c.project_id,expected.q::text quantity
            from public.calculate_open_project_commitments($1) c cross join expected
            where c.outstanding_commitment>0 and expected.q>0 order by c.project_id`,
          [shared.product, [raw, customs]])).rows;
          const actual = (await client.query(`select project_id,current_shortage_quantity::text quantity
            from public.project_shortage_episodes where product_id=$1 and resolved_at is null
            order by project_id`, [shared.product])).rows;
          expect(actual).toEqual(expected);
        };
        await assertFinalState(first);
        await first.query("rollback"); // Releases the Project; never commit fixture history.
        await edit;
        await flush(second);
        await assertFinalState(second);
        expect((await second.query("select required_quantity::text q from public.project_product_components where id=$1", [shared.component])).rows[0].q)
          .toBe((BigInt(shared.required) + 1n).toString());
      } finally {
        await first.query("rollback");
        // Unblock before awaiting an in-flight query, including assertion failures.
        await edit?.catch(() => undefined);
        await second.query("rollback");
        first.release(); second.release();
      }
    });
  },
);
