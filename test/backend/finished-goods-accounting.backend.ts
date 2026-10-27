import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { LOCAL_RESERVATION, ReservationLocalTarget, reservationSnapshot,
  rollbackReservationTransactions, type LocalReservationPool } from "./helpers/reservation-local-target";

const paths = readdirSync("supabase/migrations").filter(p => /^\d{14}_.+\.sql$/.test(p)
  && p.slice(0, 14) <= "20261026100000").sort();
const additions = paths.slice(142).map(p => readFileSync(`supabase/migrations/${p}`, "utf8"));
const fg = "10000000-0000-4000-8000-000000000002";
const read = "select * from public.get_finished_goods_inventory_commitments()";
const raw = "10000000-0000-4000-8000-000000000001", customs = "10000000-0000-4000-8000-000000000003";
const reserve = "select * from public.reserve_finished_goods_for_project($1,$2,$3::bigint,$4::bigint,$5)";

describe.skipIf(process.env.FG_ACCOUNTING_LOCAL !== "1")("Finished Goods sourcing and warehouse accounting — isolated local", () => {
  const target = new ReservationLocalTarget(), name = `alfaev_fg_3b1_${randomUUID().replace(/-/g, "")}`;
  let source: LocalReservationPool, pool: LocalReservationPool, db: PoolClient, created = false;
  let sourceBaseline: unknown, baseline: unknown, transaction: ReturnType<typeof guardRollbackQueries> | undefined;
  let beforeCorrection: Record<string,unknown> | undefined;
  let securityBefore: unknown;
  let admin: { profileId: string; authUserId: string }, actor: typeof admin;
  async function call(sql: string, args: unknown[] = [], role = "authenticated", client = db) {
    if (!["postgres", "authenticated", "anon", "service_role"].includes(role)) throw new Error("Unsafe role");
    await client.query("savepoint rpc");
    try {
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [role === "anon" ? "" : actor.authUserId]);
      await client.query(`set local role ${role}`);
      const rows = (await client.query(sql, args)).rows;
      await client.query("reset role; release savepoint rpc"); return rows;
    } catch (error) { await client.query("rollback to savepoint rpc; release savepoint rpc"); throw error; }
  }
  async function demand(product: string, quantity: string | number = 20, client = db) {
    const project = randomUUID(), group = randomUUID();
    await client.query(`insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id)
      values($1,$2,'Local read proof','2026-10-23','2026-11-23',$3,$3)`, [project, `Read ${project}`, admin.profileId]);
    await client.query(`insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id)
      values($1,$2,'Explicit FG demand',$3,$3)`, [group, project, admin.profileId]);
    await client.query(`insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id)
      values($1,$2,$3::bigint,$4,$4)`, [group, product, quantity, admin.profileId]);
    return project;
  }
  async function fixture(quantity: string | number = 20, client = db) {
    const product = randomUUID(), card = randomUUID();
    if (product === LOCAL_RESERVATION.residue) throw new Error("Retained residue forbidden");
    const serial = (await client.query(`select s::text serial from generate_series(8000000,8999999) s
      where not exists(select 1 from public.products where serial_number=s::text) order by s limit 1`)).rows[0].serial;
    await client.query(`insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,'PCB','pcb_finished_good',$4,$4)`, [product, serial, `Read ${product}`, admin.profileId]);
    await client.query(`insert into public.pcb_cards(id,name,output_product_id,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,$4,$4)`, [card, `Read ${card}`, product, admin.profileId]);
    const project = await demand(product, quantity || 1, client);
    if (quantity !== 0) {
      const supplier = await createSupplierSourceFixture(client, admin, product);
      await call("select * from public.adjust_inventory_warehouse($1,$2,'add',$3::bigint,'Local FG read proof',$4)",
        [product, fg, quantity, supplier.productSupplierId], "authenticated", client);
    }
    return { product, project, serial };
  }
  beforeAll(async () => {
    expect(paths).toHaveLength(148);
    source = target.pool(); await target.acquire(source); sourceBaseline = await reservationSnapshot(source);
    await target.createTemporary(source, name); created = true; target.copyIntoTemporary(name); pool = target.pool(name);
    const setup = await pool.connect();
    try {
      const row = (await setup.query("select id,auth_user_id from public.user_profiles where is_admin and is_active order by id limit 1")).rows[0];
      if (!row) throw new Error("Existing local active Admin required");
      admin = { profileId: row.id, authUserId: row.auth_user_id }; actor = admin;
      // Commit schema only inside this owned clone so a second session can read it.
      await setup.query("begin");
      try {
        for (let i = 0; i < additions.length; i++) {
          if (i === 5) {
            beforeCorrection=await reservationSnapshot(setup);
            securityBefore=(await setup.query(`select md5(jsonb_build_object(
              'tables',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_class c where c.relnamespace='public'::regnamespace),
              'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p),
              'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t))::text) digest`)).rows;
          }
          await setup.query(additions[i]!);
          await setup.query("insert into supabase_migrations.schema_migrations(version,name) values($1,$2)",
            [paths[142+i]!.slice(0,14), paths[142+i]!.slice(15,-4)]);
          if (i === 3 || i === 4 || i === 5) {
            await setup.query("commit");
            await target.acceptClonePhase(setup,name,(143+i) as 146|147|148);
            if (i !== 5) await setup.query("begin");
          }
        }
      }
      catch (error) { await setup.query("rollback"); throw error; }
      baseline = await reservationSnapshot(setup);
      if(!beforeCorrection)throw new Error("Missing pre-148 preservation baseline");
      for(const [key,value] of Object.entries(beforeCorrection)) {
        if(key!=="security" && key!=="supabase_migrations.schema_migrations")
          expect((baseline as Record<string,unknown>)[key]).toEqual(value);
      }
      expect((await setup.query(`select md5(jsonb_build_object(
        'tables',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_class c where c.relnamespace='public'::regnamespace),
        'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p),
        'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t))::text) digest`)).rows).toEqual(securityBefore);
    } finally { setup.release(); }
  });
  beforeEach(async context => {
    await target.assertQuiet(); actor = admin;
    const client = await pool.connect(); await client.query("begin");
    transaction = guardRollbackQueries(client, context.signal); db = transaction.client;
    await db.query("set local statement_timeout='15s'; set local lock_timeout='3s'");
  });
  afterEach(async () => {
    try { if (transaction) await rollbackReservationTransactions([transaction]); }
    finally { transaction = undefined; if (baseline) expect(await reservationSnapshot(pool)).toEqual(baseline); }
  });
  afterAll(async () => {
    try { if (sourceBaseline) expect(await reservationSnapshot(source)).toEqual(sourceBaseline); }
    finally { try { if (pool) await pool.end(); if (created) await target.dropTemporary(source, name); }
      finally { await target.release(); if (source) await source.end(); } }
  });


  async function stock(product: string, warehouse: string, quantity: number) {
    const supplier = await createSupplierSourceFixture(db,admin,product);
    await call("select * from public.adjust_inventory_warehouse($1,$2,'add',$3::bigint,'Accounting proof',$4)",
      [product,warehouse,quantity,supplier.productSupplierId]);
  }
  async function balances(product: string) {
    return (await db.query("select warehouse_id,quantity::text from public.inventory_balances where product_id=$1 order by warehouse_id",[product])).rows;
  }
  async function order(project: string, product: string, quantity: number) {
    const id=randomUUID();
    const number=(await db.query(`select 'RN-8992-'||lpad(s::text,4,'0') n from generate_series(1,9999) s
      where not exists(select 1 from public.work_orders where work_order_number='RN-8992-'||lpad(s::text,4,'0')) order by s limit 1`)).rows[0].n;
    await db.query(`insert into public.work_orders(id,work_order_number,project_id,customer_name_snapshot,description,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,'Local','Accounting proof',$4,$4)`,[id,number,project,admin.profileId]);
    await db.query("insert into public.work_order_items(work_order_id,product_id,quantity,added_by_user_id) values($1,$2,$3,$4)",[id,product,quantity,admin.profileId]);
    return id;
  }
  async function finish(id: string, actual: string | null = null) {
    const stamp=(await db.query("select updated_at::text stamp from public.work_orders where id=$1",[id])).rows[0].stamp;
    const fp=(await db.query("select public.get_work_order_source_allocation_fingerprint($1) fp",[id])).rows[0].fp;
    const pdf=actual===null
      ? await call("select * from public.get_work_order_pdf_snapshot($1,$2::timestamptz)",[id,stamp])
      : await call("select * from public.get_work_order_pdf_snapshot($1,$2::timestamptz,$3::text)",[id,stamp,actual]);
    expect(pdf.length).toBeGreaterThan(0);
    expect(new Set(pdf.map(row=>row.allocation_fingerprint))).toEqual(new Set([fp]));
    const path=`final/${id}/${randomUUID()}.pdf`;
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('work-order-pdfs',$1,jsonb_build_object('mimetype','application/pdf'))",[path]);
    const args=[id,stamp,path,"a".repeat(64),fp,...(actual===null?[]:[actual])];
    const sql=actual===null ? "select * from public.finish_work_order($1,$2::timestamptz,$3,$4,$5)"
      : "select * from public.finish_work_order($1,$2::timestamptz,$3,$4,$5,$6::text)";
    await call(sql,args);
    // Existing Finish rejects a completed Work Order rather than consuming twice.
    const snapshot=await reservationSnapshot(db);
    await expect(call(sql,args)).rejects.toMatchObject({code:"WOR02"});
    expect(await reservationSnapshot(db)).toEqual(snapshot);
    return pdf;
  }
  it("applies 148 only in an owned clone and preserves exact 186-function ACL/security inventory",async()=>{
    expect((await db.query("select count(*)::int n,max(version) latest from supabase_migrations.schema_migrations")).rows[0])
      .toEqual({n:148,latest:"20261026100000"});
    expect((await db.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef and p.proname<>'rls_auto_enable'`)).rows[0].n).toBe(186);
    const meta=(await db.query(`select p.prosecdef,p.provolatile,p.proconfig,
      has_function_privilege('authenticated',p.oid,'execute') authenticated,
      has_function_privilege('anon',p.oid,'execute') anon,
      has_function_privilege('service_role',p.oid,'execute') service,
      exists(select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE') public
      from pg_proc p where p.oid='public.get_finished_goods_inventory_commitments()'::regprocedure`)).rows[0];
    expect(meta).toMatchObject({prosecdef:true,provolatile:"s",authenticated:true,anon:false,service:false,public:false});
    expect(meta.proconfig).toContain('search_path=""');
  });
  it("aggregates multiple Projects, then Reserve/Release/Fulfill changes only exact FG totals",async()=>{
    const f=await fixture(), other=await demand(f.product);
    await call(reserve,[f.project,f.product,3,0,randomUUID()]);
    const foreign=(await call(reserve,[other,f.product,5,0,randomUUID()]))[0];
    const row=()=>call(read).then(rows=>rows.find(r=>r.product_id===f.product));
    expect(await row()).toEqual({product_id:f.product,physical_quantity:"20",committed_to_projects:"8",available_after_commitments:"12"});
    await call("select * from public.release_finished_goods_project_reservation($1,$2,$3::bigint,$4::bigint,$5)",
      [f.project,f.product,1,1,randomUUID()]);
    expect(await row()).toMatchObject({physical_quantity:"20",committed_to_projects:"7",available_after_commitments:"13"});
    const before=await balances(f.product);
    const args=[foreign.reservation_id,other,f.product,2,1,randomUUID()];
    await call("select * from public.fulfill_finished_goods_project_reservation($1,$2,$3,$4::bigint,$5::bigint,$6)",args);
    await call("select * from public.fulfill_finished_goods_project_reservation($1,$2,$3,$4::bigint,$5::bigint,$6)",args);
    expect(await row()).toMatchObject({physical_quantity:"18",committed_to_projects:"5",available_after_commitments:"13"});
    expect((await balances(f.product)).filter(r=>r.warehouse_id!==fg)).toEqual(before.filter(r=>r.warehouse_id!==fg));
    await db.query("set constraints all immediate");
  });
  it("Calculator inputs ignore Raw/Customs, cap FG at unreserved stock and retain FIFO/PDF provenance",async()=>{
    const f=await fixture(6); await stock(f.product,raw,10); await stock(f.product,customs,10); await stock(f.product,fg,4);
    const r=(await call(reserve,[f.project,f.product,2,0,randomUUID()]))[0];
    expect(r.reservation_id).toBeTruthy();
    expect((await db.query("select public.get_production_eligible_quantity($1)::text q",[f.product])).rows[0].q).toBe("8");
    const wo=await order(await demand(f.product),f.product,7);
    const plan=(await db.query("select * from public.get_work_order_warehouse_source_allocation_plan($1)",[wo])).rows;
    expect(plan.map(r=>r.warehouse_id)).toEqual([fg,fg]);
    expect(plan.reduce((sum,r)=>sum+BigInt(r.allocated_quantity),0n)).toBe(7n);
    const before=await balances(f.product); const pdf=await finish(wo);
    expect(pdf.map(r=>r.quantity)).toEqual(plan.map(r=>r.allocated_quantity));
    expect((await call("select warehouse_code from public.list_finished_work_order_materials($1)",[wo]))
      .map(r=>r.warehouse_code)).toEqual(["finished_goods","finished_goods"]);
    expect((await balances(f.product)).filter(r=>r.warehouse_id!==fg)).toEqual(before.filter(r=>r.warehouse_id!==fg));
    const insufficient=await order(await demand(f.product),f.product,2);
    const stamp=(await db.query("select updated_at::text stamp from public.work_orders where id=$1",[insufficient])).rows[0].stamp;
    expect((await call("select available_quantity::text,missing_quantity::text,inventory_sufficient from public.preflight_finish_work_order($1,$2::timestamptz)",
      [insufficient,stamp]))[0]).toMatchObject({available_quantity:"1",missing_quantity:"1",inventory_sufficient:false});
    await expect(call("select * from public.get_work_order_warehouse_source_allocation_plan($1)",[insufficient],"postgres"))
      .rejects.toMatchObject({code:"IVB02"});
    expect((await db.query("select public.get_production_eligible_quantity($1)::text q",[f.product])).rows[0].q).toBe("1");
    const allocations=(await db.query(`select a.source_lot_id,a.allocated_quantity::text from public.inventory_source_allocations a
      join public.inventory_movements m on m.id=a.outbound_inventory_movement_id where m.source_id=$1 order by a.source_lot_id`,[wo])).rows;
    expect(allocations.map(a=>a.source_lot_id)).toEqual(plan.map(r=>r.source_lot_id).sort());
    await db.query("set constraints all immediate");
  });
  it("ordinary inputs preserve Raw -> Customs -> unreserved FG priority",async()=>{
    const f=await fixture(5);
    // An ordinary Product is deliberately not a Calculator output.
    const product=randomUUID();
    await db.query(`insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id)
      values($1,'7999999',$2,'Local','component',$3,$3)`,[product,`Ordinary ${product}`,admin.profileId]);
    await stock(product,raw,4);await stock(product,customs,3);await stock(product,fg,5);
    const wo=await order(f.project,product,10);
    const plan=(await db.query("select * from public.get_work_order_warehouse_source_allocation_plan($1)",[wo])).rows;
    expect(plan.map(r=>[r.warehouse_code,r.allocated_quantity])).toEqual([["raw_materials","4"],["customs","3"],["finished_goods","3"]]);
    expect((await db.query("select public.get_production_eligible_quantity($1)::text q",[product])).rows[0].q).toBe("12");
    await finish(wo);await db.query("set constraints all immediate");
  });
  it("manufacturing consumes original components once, credits actual good, fulfillment never consumes BOM again",async()=>{
    const component=randomUUID();
    await db.query(`insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id)
      values($1,'7999998',$2,'Local','component',$3,$3)`,[component,`Component ${component}`,admin.profileId]);
    await stock(component,raw,8);
    const serial=(await db.query(`select lpad(s::text,3,'0') serial from generate_series(0,999) s
      where not exists(select 1 from public.products where serial_number=lpad(s::text,3,'0')) order by s limit 1`)).rows[0].serial;
    const card=(await call("select * from public.create_pcb_card($1,$2)",[`Accounting ${randomUUID()}`,serial]))[0];
    await call("select * from public.save_initial_pcb_bom($1,$2::jsonb)",[card.pcb_card_id,JSON.stringify([{product_id:component,quantity_per_card:"2"}])]);
    const output=(await db.query("select output_product_id id from public.pcb_cards where id=$1",[card.pcb_card_id])).rows[0].id;
    const wo=(await call("select * from public.create_pcb_production_work_order($1,$2,null,$3)",[card.pcb_card_id,3,randomUUID()]))[0].work_order_id;
    await finish(wo,"2");
    expect((await balances(component)).find(r=>r.warehouse_id===raw)?.quantity).toBe("2");
    expect((await balances(output)).find(r=>r.warehouse_id===fg)?.quantity).toBe("2");
    const componentBefore=await balances(component);
    // A manufactured Product has its own real BOM, but using it as a new input
    // must debit only that finished SKU, never recursively debit its component.
    const secondSerial=(await db.query(`select lpad(s::text,3,'0') serial from generate_series(0,999) s
      where not exists(select 1 from public.products where serial_number=lpad(s::text,3,'0')) order by s limit 1`)).rows[0].serial;
    const secondCard=(await call("select * from public.create_pcb_card($1,$2)",[`Assembly ${randomUUID()}`,secondSerial]))[0];
    await call("select * from public.save_initial_pcb_bom($1,$2::jsonb)",[secondCard.pcb_card_id,JSON.stringify([{product_id:output,quantity_per_card:"1"}])]);
    const secondOrder=(await call("select * from public.create_pcb_production_work_order($1,$2,null,$3)",[secondCard.pcb_card_id,1,randomUUID()]))[0].work_order_id;
    await finish(secondOrder,"1");
    expect(await balances(component)).toEqual(componentBefore);
    expect((await balances(output)).find(r=>r.warehouse_id===fg)?.quantity).toBe("1");
    const project=await demand(output,1), r=(await call(reserve,[project,output,1,0,randomUUID()]))[0];
    await call("select * from public.fulfill_finished_goods_project_reservation($1,$2,$3,$4::bigint,$5::bigint,$6)",
      [r.reservation_id,project,output,1,1,randomUUID()]);
    expect(await balances(component)).toEqual(componentBefore);
    expect((await balances(output)).find(r=>r.warehouse_id===fg)?.quantity).toBe("0");
    await db.query("set constraints all immediate");
  });
  it("requires only active FG warehouse view, denies other warehouses, inactive, anonymous and direct tables",async()=>{
    const f=await fixture();
    const profile=(await db.query("select id,auth_user_id from public.user_profiles where not is_admin and is_active order by id limit 1")).rows[0];
    if(!profile)throw new Error("Existing active local non-Admin required");
    actor={profileId:profile.id,authUserId:profile.auth_user_id};
    for(const keys of [[],["projects.view"],["inventory.raw_materials.view"],["inventory.customs.view"],["inventory.finished_goods.adjust"]]) {
      await db.query("delete from public.user_permissions where user_id=$1",[profile.id]);
      await db.query(`insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id)
        select $1,id,$2 from public.permission_definitions where key=any($3::text[])`,[profile.id,admin.profileId,keys]);
      await expect(call(read)).rejects.toMatchObject({code:"42501"});
    }
    await db.query(`insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id)
      select $1,id,$2 from public.permission_definitions where key='inventory.finished_goods.view'`,[profile.id,admin.profileId]);
    expect((await call(read)).some(r=>r.product_id===f.product)).toBe(true);
    await expect(call("select * from public.get_project_finished_goods_reservation_context($1)",[f.project]))
      .rejects.toMatchObject({code:"42501"});
    await expect(call("select * from public.finished_goods_project_reservations")).rejects.toMatchObject({code:"42501"});
    await expect(call(read,[],"anon")).rejects.toMatchObject({code:"42501"});
    await db.query("update public.user_profiles set is_active=false where id=$1",[profile.id]);
    await expect(call(read)).rejects.toMatchObject({code:"42501"});
  });
  it("keeps zero-stock archived Calculator visibility and exact SQL bigint aggregate quantities",async()=>{
    const zero=await fixture(0);
    await db.query("update public.products set is_active=false,archived_at=now(),archived_by_user_id=$2 where id=$1",[zero.product,admin.profileId]);
    expect((await call(read)).find(r=>r.product_id===zero.product)).toEqual({product_id:zero.product,
      physical_quantity:"0",committed_to_projects:"0",available_after_commitments:"0"});
    const large=await fixture("9007199254740993");
    await call(reserve,[large.project,large.product,3,0,randomUUID()]);
    expect((await call(read)).find(r=>r.product_id===large.product)).toEqual({product_id:large.product,
      physical_quantity:"9007199254740993",committed_to_projects:"3",available_after_commitments:"9007199254740990"});
    await db.query("set constraints all immediate");
  });
});
