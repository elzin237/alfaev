import { randomUUID } from "node:crypto";
import { readFileSync,readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it } from "vitest";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { LOCAL_RESERVATION,ReservationLocalTarget,type LocalReservationPool,
  reservationSnapshot,rollbackReservationTransactions } from "./helpers/reservation-local-target";

const paths=["20261023100000_add_finished_goods_project_reservation_foundation.sql",
  "20261023110000_protect_finished_goods_hard_reservations.sql","20261023120000_add_finished_goods_reservation_fulfillment.sql",
  ...(process.env.FG_RESERVATION_READ_LOCAL==="1"?["20261023130000_add_project_finished_goods_reservation_context.sql"]:[])];
const migrations=paths.map(p=>readFileSync(`supabase/migrations/${p}`,"utf8"));
const fg="10000000-0000-4000-8000-000000000002",raw="10000000-0000-4000-8000-000000000001";
const fulfill="select * from public.fulfill_finished_goods_project_reservation($1,$2,$3,$4::bigint,$5::bigint,$6)";
const reserve="select * from public.reserve_finished_goods_for_project($1,$2,$3::bigint,$4::bigint,$5)";
describe.skipIf(process.env.FG_RESERVATION_FULFILLMENT_LOCAL!=="1")("Phase 3C isolated atomic fulfillment",()=>{
  const target=new ReservationLocalTarget(),name=`alfaev_fg_3b1_${randomUUID().replace(/-/g,"")}`;
  let source:LocalReservationPool,pool:LocalReservationPool,db:PoolClient,created=false;
  let sourceBaseline:unknown,baseline:unknown,transaction:ReturnType<typeof guardRollbackQueries>|undefined;
  let actor:{profileId:string;authUserId:string};
  async function call(sql:string,args:unknown[]=[],role="postgres") {
    if(!["postgres","authenticated","anon","service_role"].includes(role))throw new Error("Unsafe role");
    await db.query("savepoint rpc");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)",[role==="anon"?"":actor.authUserId]);
      await db.query(`set local role ${role}`);
      const rows=(await db.query(sql,args)).rows;
      await db.query("reset role; release savepoint rpc");return rows;
    }catch(error){await db.query("rollback to savepoint rpc; release savepoint rpc");throw error;}
  }
  async function fixture(planned=10,reserved=6) {
    const product=randomUUID(),card=randomUUID(),project=randomUUID(),group=randomUUID();
    if(product===LOCAL_RESERVATION.residue)throw new Error("Retained residue forbidden");
    const serial=(await db.query(`select s::text serial from generate_series(8000000,8999999) s
      where not exists(select 1 from public.products where serial_number=s::text) order by s limit 1`)).rows[0].serial;
    await db.query(`insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,'PCB','pcb_finished_good',$4,$4)`,[product,serial,`Fulfillment ${product}`,actor.profileId]);
    await db.query(`insert into public.pcb_cards(id,name,output_product_id,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,$4,$4)`,[card,`Fulfillment ${card}`,product,actor.profileId]);
    const supplier=await createSupplierSourceFixture(db,actor,product);await db.query("reset role");
    for(const qty of [4,6]) await call("select * from public.adjust_inventory_warehouse($1,$2,'add',$3::bigint,'Local fulfillment proof',$4)",
      [product,fg,qty,supplier.productSupplierId],"authenticated");
    await db.query(`insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id)
      values($1,$2,'Local','2026-10-23','2026-11-23',$3,$3)`,[project,`Fulfillment ${project}`,actor.profileId]);
    await db.query(`insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id)
      values($1,$2,'Explicit Product demand',$3,$3)`,[group,project,actor.profileId]);
    await db.query(`insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,$4,$4)`,[group,product,planned,actor.profileId]);
    const result=(await call(reserve,[project,product,reserved,0,randomUUID()]))[0];
    return {product,project,group,reservation:result.reservation_id as string};
  }
  type Fixture=Awaited<ReturnType<typeof fixture>>;
  const args=(f:Fixture,qty=2,version=1,request=randomUUID())=>[f.reservation,f.project,f.product,qty,version,request];
  async function state(f:Fixture) {
    return (await db.query(`select b.quantity::text physical,r.reserved_quantity::text reserved,r.version::text version,
      (b.quantity-r.reserved_quantity)::text free,c.outstanding_commitment::text outstanding,c.actual_project_consumption::text consumed
      from public.finished_goods_project_reservations r join public.inventory_balances b on b.product_id=r.product_id and b.warehouse_id=r.warehouse_id
      join public.calculate_open_project_commitments($1) c on c.project_id=r.project_id where r.id=$2`,[f.product,f.reservation])).rows[0];
  }
  beforeAll(async()=>{
    source=target.pool();await target.acquire(source);sourceBaseline=await reservationSnapshot(source);
    await target.createTemporary(source,name);created=true;target.copyIntoTemporary(name);pool=target.pool(name);
    const c=await pool.connect();try {
      const row=(await c.query("select id,auth_user_id from public.user_profiles where is_admin and is_active order by id limit 1")).rows[0];
      if(!row)throw new Error("Existing disposable Admin required");actor={profileId:row.id,authUserId:row.auth_user_id};
      baseline=await reservationSnapshot(c);
    }finally{c.release();}
  });
  beforeEach(async context=>{
    await target.assertQuiet();const client=await pool.connect();await client.query("begin");
    transaction=guardRollbackQueries(client,context.signal);db=transaction.client;
    await db.query("set local statement_timeout='15s'; set local lock_timeout='3s'");
    if(!context.task.name.startsWith("migration proof:"))for(const sql of migrations)await db.query(sql);
  });
  afterEach(async()=>{
    let failure:unknown;
    try{if(transaction)await rollbackReservationTransactions([transaction]);}catch(error){failure=error;}
    finally{transaction=undefined;try{if(baseline)expect(await reservationSnapshot(pool)).toEqual(baseline);}finally{if(failure)throw failure;}}
  });
  afterAll(async()=>{
    try{if(sourceBaseline)expect(await reservationSnapshot(source)).toEqual(sourceBaseline);}
    finally{try{if(pool)await pool.end();if(created)await target.dropTemporary(source,name);}
      finally{await target.release();if(source)await source.end();}}
  });
  it("migration proof: fresh application schema 0 -> 145",async()=>{
    expect((await db.query("select current_database() db")).rows[0].db).toBe(name);
    await db.query("drop schema public cascade; create schema public; grant usage on schema public to postgres,anon,authenticated,service_role; drop schema supabase_migrations cascade; create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text); truncate auth.users cascade; truncate storage.buckets cascade");
    await db.query(`do $fresh$ declare p record; begin for p in select schemaname,tablename,policyname from pg_policies where schemaname in ('storage','realtime') loop
      execute format('drop policy %I on %I.%I',p.policyname,p.schemaname,p.tablename);end loop;end $fresh$`);
    const files=readdirSync("supabase/migrations").filter(p=>/^\d{14}_.+\.sql$/.test(p) && p.slice(0,14)<="20261023120000").sort();expect(files).toHaveLength(145);
    for(const file of files){await db.query(readFileSync(`supabase/migrations/${file}`,"utf8"));
      await db.query("insert into supabase_migrations.schema_migrations(version) values($1)",[file.slice(0,14)]);}
    expect((await db.query("select count(*)::int n,max(version) latest from supabase_migrations.schema_migrations")).rows[0])
      .toEqual({n:145,latest:"20261023120000"});await db.query("set constraints all immediate");
  });
  it(`migration proof: 142 -> 143 -> 144 -> 145${process.env.FG_RESERVATION_READ_LOCAL==="1"?" -> 146":""}`,async()=>{
    let existing:Fixture|undefined,receipts:Record<string,unknown>[]=[];
    for(let i=0;i<migrations.length;i++){
      await db.query(migrations[i]!);await db.query("insert into supabase_migrations.schema_migrations(version) values($1)",[paths[i]!.slice(0,14)]);
      expect((await db.query("select count(*)::int n from supabase_migrations.schema_migrations")).rows[0].n).toBe(143+i);
      if(i===1){existing=await fixture();
        await call("select * from public.release_finished_goods_project_reservation($1,$2,2,1,$3)",[existing.project,existing.product,randomUUID()]);
        receipts=(await db.query("select id,event_type,quantity_before::text,quantity_after::text from public.finished_goods_project_reservation_events where reservation_id=$1 order by id",[existing.reservation])).rows;
      }
    }
    expect(existing).toBeDefined();
    expect((await db.query("select id,event_type,quantity_before::text,quantity_after::text from public.finished_goods_project_reservation_events where id=any($1::uuid[]) order by id",[receipts.map(r=>r.id)])).rows).toEqual(receipts);
    expect((await db.query("select count(*)::int n from public.finished_goods_project_reservation_events where event_type<>'fulfilled' and inventory_movement_id is not null")).rows[0].n).toBe(0);
    await call(fulfill,args(existing!,1,2));
    expect(await state(existing!)).toMatchObject({physical:"9",reserved:"3",version:"3",outstanding:"9",consumed:"1"});
    await db.query("set constraints all immediate");
  });
  it("fulfills partially and fully without rewriting requirements or counting delivered demand twice",async()=>{
    const f=await fixture();const partial=(await call(fulfill,args(f)))[0];
    expect(partial).toMatchObject({reserved_quantity:"4",reservation_version:"2",physical_quantity_before:"10",physical_quantity_after:"8"});
    expect(await state(f)).toEqual({physical:"8",reserved:"4",version:"2",free:"4",outstanding:"8",consumed:"2"});
    expect((await call("select * from public.get_inventory_project_commitments()",[],"authenticated")).find(r=>r.product_id===f.product))
      .toMatchObject({physical_quantity:"0",committed_to_projects:"8",available_after_commitments:"-8"});
    await call(fulfill,args(f,4,2));
    expect(await state(f)).toEqual({physical:"4",reserved:"0",version:"3",free:"4",outstanding:"4",consumed:"6"});
    expect((await db.query("select required_quantity::text q from public.project_product_components where project_product_id=$1",[f.group])).rows[0].q).toBe("10");
    await expect(call(reserve,[f.project,f.product,5,3,randomUUID()])).rejects.toMatchObject({code:"FGR06"});
    await db.query("set constraints all immediate");
  });
  it("consumes exact FG FIFO lots with frozen Catalog provenance and immutable movement/receipt/allocation links",async()=>{
    const f=await fixture(),lots=(await db.query("select id,remaining_quantity::text q,catalog_number_snapshot from public.inventory_source_lots where product_id=$1 order by received_at,id",[f.product])).rows;
    const result=(await call(fulfill,args(f,5)))[0];
    const allocations=(await db.query(`select a.source_lot_id,a.allocated_quantity::text q,l.catalog_number_snapshot from public.inventory_source_allocations a
      join public.inventory_source_lots l on l.id=a.source_lot_id where a.outbound_inventory_movement_id=$1 order by l.received_at,l.id`,[result.movement_id])).rows;
    expect(allocations).toEqual([{source_lot_id:lots[0].id,q:"4",catalog_number_snapshot:lots[0].catalog_number_snapshot},
      {source_lot_id:lots[1].id,q:"1",catalog_number_snapshot:lots[1].catalog_number_snapshot}]);
    expect((await db.query("select source_type,source_id,project_id,quantity_delta::text q from public.inventory_movements where id=$1",[result.movement_id])).rows[0])
      .toEqual({source_type:"finished_goods_reservation_fulfillment",source_id:result.event_id,project_id:f.project,q:"-5"});
    for(const sql of ["update public.inventory_movements set reason='changed' where id=$1",
      "delete from public.inventory_movements where id=$1"])
      await expect(call(sql,[result.movement_id])).rejects.toMatchObject({code:"55000"});
    await expect(call("update public.inventory_source_allocations set allocated_quantity=1 where outbound_inventory_movement_id=$1",[result.movement_id]))
      .rejects.toMatchObject({code:"IVL01"});
    await expect(call("update public.finished_goods_project_reservation_events set inventory_movement_id=null where id=$1",[result.event_id])).rejects.toMatchObject({code:"55000"});
    await db.query("set constraints all immediate");
  });
  it("replays the original result after later operations without duplicate movements, receipts or audits",async()=>{
    const f=await fixture(),request=args(f),first=await call(fulfill,request);
    await call(fulfill,args(f,1,2));const before=await reservationSnapshot(db);
    expect(await call(fulfill,request)).toEqual(first);expect(await reservationSnapshot(db)).toEqual(before);
    await expect(call(fulfill,[...request.slice(0,3),3,...request.slice(4)])).rejects.toMatchObject({code:"FGR01"});
    await expect(call(reserve,[f.project,f.product,2,1,request[5]])).rejects.toMatchObject({code:"FGR01"});
    await db.query("set constraints all immediate");
  });
  it("rejects over-fulfillment, stale version, invalid identity, archived Product and closed Project atomically",async()=>{
    const f=await fixture(),before=await reservationSnapshot(db);
    await expect(call(fulfill,args(f,7))).rejects.toMatchObject({code:"FGR05"});
    await expect(call(fulfill,args(f,1,2))).rejects.toMatchObject({code:"FGR04"});
    await expect(call(fulfill,[randomUUID(),...args(f).slice(1)])).rejects.toMatchObject({code:"P0002"});
    expect(await reservationSnapshot(db)).toEqual(before);
    await db.query("savepoint archival");
    await db.query("update public.products set is_active=false,archived_at=now(),archived_by_user_id=$2 where id=$1",[f.product,actor.profileId]);
    await expect(call(fulfill,args(f))).rejects.toMatchObject({code:"FGR03"});await db.query("rollback to savepoint archival");
    await call("select public.cancel_project($1)",[f.project],"authenticated");
    await expect(call(fulfill,args(f))).rejects.toMatchObject({code:"FGR02"});
    await db.query("set constraints all immediate");
  });
  it("keeps the new helper/RPC private and preserves the complete trusted-function/RLS inventory",async()=>{
    const functions=(await db.query(`select proname,proconfig,has_function_privilege('public',oid,'execute') public,
      has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') browser,
      has_function_privilege('service_role',oid,'execute') service from pg_proc
      where pronamespace='public'::regnamespace and prosecdef and proname<>'rls_auto_enable'`)).rows;
    expect(functions).toHaveLength(process.env.FG_RESERVATION_READ_LOCAL==="1"?185:184);
    for(const row of functions)expect(row).toMatchObject({proconfig:['search_path=""'],public:false,anon:false});
    for(const routine of ["fulfill_finished_goods_project_reservation","validate_finished_goods_fulfillment_link"])
      expect(functions.find(r=>r.proname===routine)).toMatchObject({browser:false,service:false});
    const f=await fixture();for(const role of ["authenticated","anon","service_role"]){
      await expect(call(fulfill,args(f),role)).rejects.toMatchObject({code:"42501"});
      for(const table of ["finished_goods_project_reservations","finished_goods_project_reservation_events"]){
        await expect(call(`insert into public.${table} default values`,[],role)).rejects.toMatchObject({code:"42501"});
        expect((await db.query("select relrowsecurity rls from pg_class where oid=$1::regclass",[`public.${table}`])).rows[0].rls).toBe(true);
      }
    }
  });
  it("never consumes another Project's protected stock and rejects demand edits below remaining reservations",async()=>{
    const f=await fixture(),other=randomUUID(),group=randomUUID();
    await db.query(`insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id)
      values($1,'Other reservation','Local','2026-10-23','2026-11-23',$2,$2)`,[other,actor.profileId]);
    await db.query(`insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id)
      values($1,$2,'Exact same Product',$3,$3)`,[group,other,actor.profileId]);
    await db.query(`insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id)
      values($1,$2,4,$3,$3)`,[group,f.product,actor.profileId]);
    const otherReservation=(await call(reserve,[other,f.product,4,0,randomUUID()]))[0];
    await call(fulfill,args(f));
    expect((await db.query("select reserved_quantity::text q,version::text v from public.finished_goods_project_reservations where id=$1",[otherReservation.reservation_id])).rows[0])
      .toEqual({q:"4",v:"1"});
    expect((await state(f)).physical).toBe("8");
    const component=(await db.query("select id from public.project_product_components where project_product_id=$1",[f.group])).rows[0].id;
    await expect(call("select public.update_project_product_component($1,$2,5)",[component,f.product],"authenticated")).rejects.toMatchObject({code:"FGR06"});
    await expect(call(fulfill,[f.reservation,other,f.product,1,2,randomUUID()])).rejects.toMatchObject({code:"P0002"});
    await db.query("set constraints all immediate");
  });
  it("requires the dedicated delegated capability, denies inactive/anonymous and preserves request ownership",async()=>{
    const f=await fixture(),admin=actor;
    const row=(await db.query("select id,auth_user_id from public.user_profiles where not is_admin and is_active order by id limit 1")).rows[0];
    if(!row)throw new Error("Existing local non-Admin required");
    await db.query("delete from public.user_permissions where user_id=$1",[row.id]);
    actor={profileId:row.id,authUserId:row.auth_user_id};
    try {
      await expect(call(fulfill,args(f))).rejects.toMatchObject({code:"42501"});
      await db.query(`insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id)
        select $1,id,$2 from public.permission_definitions where key in ('projects.view','projects.edit','inventory.finished_goods.view')`,[row.id,admin.profileId]);
      await expect(call(fulfill,args(f))).rejects.toMatchObject({code:"42501"});
      await db.query(`insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id)
        select $1,id,$2 from public.permission_definitions where key='inventory.finished_goods.reserve'`,[row.id,admin.profileId]);
      const request=args(f);await call(fulfill,request);actor=admin;
      await expect(call(fulfill,request)).rejects.toMatchObject({code:"42501"});
      actor={profileId:row.id,authUserId:row.auth_user_id};
      await db.query("update public.user_profiles set is_active=false where id=$1",[row.id]);
      await expect(call(fulfill,request)).rejects.toMatchObject({code:"42501"});
    }finally{actor=admin;}
    actor={...admin,authUserId:""};
    try{await expect(call(fulfill,args(f))).rejects.toMatchObject({code:"42501"});}finally{actor=admin;}
  });
  it("rolls the whole operation back when source lots are insufficient",async()=>{
    const f=await fixture();await db.query("savepoint insufficient");
    await db.query("update public.inventory_source_lots set remaining_quantity=0 where product_id=$1",[f.product]);
    const before=await reservationSnapshot(db);
    await expect(call(fulfill,args(f))).rejects.toMatchObject({code:"IVB02"});expect(await reservationSnapshot(db)).toEqual(before);
    await db.query("rollback to savepoint insufficient");await db.query("set constraints all immediate");
  });
  it("rolls back physical stock, reservation, FIFO, receipt and audit after a simulated late audit failure",async()=>{
    const f=await fixture();await db.query(`create function pg_temp.reject_fulfillment_audit() returns trigger language plpgsql as $fail$
      begin if new.action_type='finished_goods_reservation.fulfilled' then raise exception 'Simulated audit failure';end if;return new;end $fail$;
      create trigger local_fulfillment_failure before insert on public.audit_logs for each row execute function pg_temp.reject_fulfillment_audit()`);
    const before=await reservationSnapshot(db);
    await expect(call(fulfill,args(f))).rejects.toMatchObject({code:"P0001"});expect(await reservationSnapshot(db)).toEqual(before);
    await db.query("drop trigger local_fulfillment_failure on public.audit_logs; set constraints all immediate");
  });
  it("rejects a forged fulfillment source without a matching immutable receipt",async()=>{
    const f=await fixture(),before=await reservationSnapshot(db);await db.query("savepoint forged");
    await call("select * from public.apply_inventory_delta_in_warehouse($1,$2,-1,'finished_goods_reservation_fulfillment',null,'finished_goods_reservation_fulfillment',$3,$4)",
      [f.product,fg,randomUUID(),f.project]);
    await expect(db.query("set constraints all immediate")).rejects.toMatchObject({code:"FGR09"});
    await db.query("rollback to savepoint forged");expect(await reservationSnapshot(db)).toEqual(before);
  });
  it("deduplicates deferred shortage reconciliation and resolves once without duplicate notifications on replay",async()=>{
    const f=await fixture(6,6);await db.query("set constraints all immediate; set constraints all deferred");
    const request=args(f,6);await call(fulfill,request);await db.query("set constraints all immediate; set constraints all deferred");
    const before=await reservationSnapshot(db);await call(fulfill,request);await db.query("set constraints all immediate");
    expect(await reservationSnapshot(db)).toEqual(before);
    expect((await db.query("select event_type,count(*)::int n from public.project_shortage_events where project_id=$1 and product_id=$2 group by event_type order by event_type",[f.project,f.product])).rows)
      .toEqual([{event_type:"opened",n:1},{event_type:"resolved",n:1}]);
    expect((await db.query("select count(*)::int n from public.project_activity_alerts where project_id=$1 and product_id=$2 and notification_kind='shortage'",[f.project,f.product])).rows[0].n).toBe(2);
    expect((await call("select * from public.get_inventory_project_commitments()",[],"authenticated")).find(r=>r.product_id===f.product))
      .toMatchObject({physical_quantity:"0",committed_to_projects:"0",available_after_commitments:"0"});
    expect((await db.query("select quantity::text q from public.inventory_balances where product_id=$1 and warehouse_id=$2",[f.product,raw])).rows[0].q).toBe("0");
  });
});
