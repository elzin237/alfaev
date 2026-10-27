import { testCalculatorBatchSteps, testCalculatorBatchPreamble, testCalculatorBatchPostamble } from "../../scripts/deployment/test-calculator-atomic-batch";
import { APPROVED_DATA, DEV_REF, createDevAdapter, devHttpIO, type PsqlInvocation } from "../../scripts/deployment/test-calculator-dev-adapter";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { LOCAL_RESERVATION, ReservationLocalTarget, reservationSnapshot,
  rollbackReservationTransactions, containerArguments, runPinnedDocker, type LocalReservationPool } from "./helpers/reservation-local-target";

const enabled = process.env.TEST_CALCULATOR_ACCEPTANCE_LOCAL === "1";
const raw = "10000000-0000-4000-8000-000000000001", fg = "10000000-0000-4000-8000-000000000002", customs = "10000000-0000-4000-8000-000000000003";
const saveSql="select public.save_test_calculation($1,$2,$3::jsonb,$4::date) receipt";

describe.skipIf(!enabled)("Integrated Test acceptance and atomic deployment — owned local clone only", () => {
  const target = new ReservationLocalTarget(), name = `alfaev_fg_3b1_${randomUUID().replace(/-/g, "")}`;
  let source: LocalReservationPool | undefined, pool: LocalReservationPool | undefined;
  let sourceBaseline: unknown, baseline: unknown, created = false, db: PoolClient;
  let transaction: ReturnType<typeof guardRollbackQueries> | undefined;
  const branches: ReturnType<typeof guardRollbackQueries>[] = [];
  let admin: { id: string; auth_user_id: string }, member: typeof admin;
  async function snapshot(pool: LocalReservationPool) {
    const c = await pool.connect(); try { return await reservationSnapshot(c); } finally { c.release(true); }
  }
  async function call(sql: string, args: unknown[], actor = admin, role = "authenticated") {
    if (!["anon", "authenticated", "service_role"].includes(role)) throw new Error("Unsafe role");
    await db.query("savepoint caller");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor.auth_user_id]);
      await db.query(`set local role ${role}`); const rows = (await db.query(sql,args)).rows;
      await db.query("reset role; release savepoint caller"); return rows;
    } catch (error) { await db.query("rollback to savepoint caller; release savepoint caller"); throw error; }
  }
  async function product(finished = false, quantities = [5,4,3].map(String), linked = true) {
    const id = randomUUID(), card = randomUUID();
    if (id === LOCAL_RESERVATION.residue) throw new Error("Retained residue forbidden");
    const serial = (await db.query(`select s::text serial from generate_series(8000000,8999999) s
      where not exists(select 1 from public.products where serial_number=s::text) order by s limit 1`)).rows[0].serial;
    await db.query(`insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id)
      values($1,$2,$3,'Local Test Preview',$4,$5,$5)`, [id,serial,`TC preview ${id}`,finished?"pcb_finished_good":"component",admin.id]);
    if (finished && linked) await db.query("insert into public.pcb_cards(id,name,output_product_id,created_by_user_id,updated_by_user_id) values($1,$2,$3,$4,$4)", [card,`TC ${card}`,id,admin.id]);
    const supplier = await createSupplierSourceFixture(db,{profileId:admin.id,authUserId:admin.auth_user_id},id);
    for (const [index,warehouse] of [raw,customs,fg].entries()) if (BigInt(quantities[index]!) > 0n)
      await call("select * from public.adjust_inventory_warehouse($1,$2,'add',$3::bigint,'Owned Test preview fixture',$4)", [id,warehouse,quantities[index],supplier.productSupplierId]);
    return {id,serial,productSupplierId:supplier.productSupplierId};
  }
  async function grant(keys: string[]) {
    await db.query("delete from public.user_permissions where user_id=$1",[member.id]);
    await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key=any($3::text[])",[member.id,admin.id,keys]);
  }
  beforeAll(async () => {
    if (process.env.TEST_CALCULATOR_ACCEPTANCE_APPROVAL !== "owned-clone-only" || process.env.LOCAL_SUPABASE_DB_PASSWORD) throw new Error("Owned-clone peer scope required");
    source = target.pool(); await target.acquire(source); sourceBaseline = await snapshot(source);
    await target.createTemporary(source,name); created=true;
    // Non-secret positive ownership evidence remains visible if setup/teardown fails.
    console.info(`TC-16B newly owned local clone: ${name}`);
    target.copyIntoTemporary(name); pool=target.pool(name);
    const setup=await pool.connect();
    try {
      const files=readdirSync("supabase/migrations").filter(p=>/^\d{14}_.+\.sql$/.test(p)).sort();
      expect(files[151]).toBe("20261027110000_add_test_calculator_search_and_preview.sql");
      await setup.query("begin");
      try { for(let i=142;i<150;i++) {
        const file=files[i]!; await setup.query(readFileSync(`supabase/migrations/${file}`,"utf8"));
        await setup.query("insert into supabase_migrations.schema_migrations(version,name) values($1,$2)",[file.slice(0,14),file.slice(15,-4)]);
        if(i>=145) { await setup.query("commit"); await target.acceptClonePhase(setup,name,(i+1) as 146|147|148|149|150); if(i<149)await setup.query("begin"); }
      }} catch(error) {await setup.query("rollback");throw error;}
      admin=(await setup.query("select id,auth_user_id from public.user_profiles where is_active and is_admin order by id limit 1")).rows[0];
      member=(await setup.query("select id,auth_user_id from public.user_profiles where is_active and not is_admin order by id limit 1")).rows[0];
      if(!admin||!member)throw new Error("Existing local identities required");
      // Reproduce the verified DEV platform identity ONLY in this newly owned clone.
      // This is an event-trigger helper, not an application RPC or a new migration.
      await setup.query(`create function public.rls_auto_enable() returns event_trigger
        language plpgsql security definer set search_path to pg_catalog as $platform$
        declare cmd record; begin
          for cmd in select * from pg_event_trigger_ddl_commands()
            where command_tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
              and object_type in ('table','partitioned table') loop
            if cmd.schema_name='public' then
              execute format('alter table if exists %s enable row level security',cmd.object_identity);
            end if;
          end loop;
        end $platform$;
        create event trigger ensure_rls on ddl_command_end
          when tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO') execute function public.rls_auto_enable();`);
      const platformSnapshot=async()=> (await setup.query(`select pg_get_functiondef(p.oid) definition,
        p.proowner,p.proacl,p.proconfig,to_jsonb(e) wiring from pg_proc p
        join pg_event_trigger e on e.evtfoid=p.oid where p.oid='public.rls_auto_enable()'::regprocedure`)).rows;
      const originalPlatform=await platformSnapshot();
      const steps=testCalculatorBatchSteps(), original=await reservationSnapshot(setup);
      // Reject lookalikes, changed security/wiring, and unexpected extra definers.
      for(const defect of [
        "alter function public.rls_auto_enable() set search_path=public",
        "alter event trigger ensure_rls disable",
        "revoke execute on function public.rls_auto_enable() from public",
        "create function public.rls_auto_enable(integer) returns integer language sql security definer as 'select $1'",
      ]) {
        await setup.query("begin");
        try {
          await setup.query(defect);
          await expect(setup.query(testCalculatorBatchPreamble)).rejects.toMatchObject({code:"P0001"});
        } finally {await setup.query("rollback");}
        expect(await reservationSnapshot(setup)).toEqual(original);
      }
      // A failed atomic batch must publish neither Save nor ledger changes.
      await setup.query("begin"); await setup.query(testCalculatorBatchPreamble);
      try {
        for(const step of steps.slice(0,3)){await setup.query(step.sql);await setup.query(step.ledger);}
        await setup.query("select 1/0");
        throw new Error("Expected intentional atomic rollback failure");
      } catch(error) {if((error as {code?:string}).code!=="22012")throw error;}
      finally {await setup.query("rollback");}
      expect(await reservationSnapshot(setup)).toEqual(original);
      const observer=await pool.connect();
      try {
        await observer.query("select set_config('request.jwt.claim.sub',$1,false)",[admin.auth_user_id]);
        await observer.query("set role authenticated");
        await setup.query("begin");await setup.query(testCalculatorBatchPreamble);
        try {
          for(const [index,step] of steps.entries()){
            await setup.query(step.sql);await setup.query(step.ledger);
            if(index===2){
              expect((await observer.query("select to_regprocedure('public.save_test_calculation(uuid,text,jsonb,date)') value")).rows[0].value).toBeNull();
              await expect(observer.query("select public.save_test_calculation($1,'Unpublished','[]'::jsonb,'2030-01-01')",[randomUUID()])).rejects.toMatchObject({code:"42883"});
            }
          }
          await setup.query(testCalculatorBatchPostamble);
          // Observer proof above uses real independent authentication. Roll back
          // this proof so the adapter itself must perform the actual atomic install.
          await setup.query("rollback");
        } catch(error){await setup.query("rollback");throw error;}
        expect((await observer.query("select to_regprocedure('public.save_test_calculation(uuid,text,jsonb,date)') value")).rows[0].value).toBeNull();
      } finally {observer.release(true);}
      expect(await reservationSnapshot(setup)).toEqual(original);
      // No live API or temporary role is created. Every real read is restricted to
      // the owned clone; production snapshot SQL is exercised, not simulated SQL.
      const localHttp = devHttpIO("sbp_LOCAL_MOCK_ONLY", async (url, init) => {
        if (url !== `https://api.supabase.com/v1/projects/${DEV_REF}/database/query`) throw new Error("Live API forbidden");
        const request=JSON.parse(init!.body as string);
        if(request.read_only!==true || !/^select\b/i.test(request.query))throw new Error("Only clone read-only snapshots authorized");
        await setup.query("begin read only");
        try{return new Response(JSON.stringify((await setup.query(request.query)).rows),{status:200});}
        finally{await setup.query("rollback");}
      });
      const localSnapshot=async()=>{
        const current=await localHttp.snapshot();
        // Only the gate's approved DEV quantities/IDs are mocked. Actual local
        // datasets are independently compared against original below and in teardown.
        for(const [table,value]of Object.entries(APPROVED_DATA))current.data[`public.${table}`]=[...value];
        current.stock=["4189","13","0"];
        return current;
      };
      const runLocalPsql=async(plan:PsqlInvocation,fail=false)=>{
        target.assertOwnedClone(name,150);target.verifyDocker();
        expect(plan.args).toContain("--single-transaction");expect(plan.args).toContain("--file=-");
        expect(plan.args.join(" ")).not.toContain("LOCAL_MOCK_PASSWORD");
        const args=plan.args.map(arg=>arg.startsWith("--command=")
          ?`--command=SET SESSION ROLE postgres; DO $local$ BEGIN IF current_database()<>'${name}' OR current_user<>'postgres' THEN RAISE EXCEPTION 'Owned local identity mismatch'; END IF; END $local$;`:arg);
        // Full container ID, clean environment, peer socket and owned database only.
        // Never forward plan.env (which contains only a mock credential here).
        runPinnedDocker(containerArguments([`${LOCAL_RESERVATION.pgBin}/psql`,...args,
          "--dbname",`host=/var/run/postgresql port=5432 dbname=${name} user=postgres passfile=/dev/null connect_timeout=5 sslmode=disable gssencmode=disable application_name=${plan.env.PGAPPNAME}`,
          ...(fail?["--command=select 1/0"]:[])],"postgres",true),Buffer.from(plan.input));
      };
      const mockedIO={project:async()=>({id:DEV_REF,name:"alfaev-dev",status:"ACTIVE_HEALTHY"}),snapshot:localSnapshot,
        login:async()=>({role:"cli_login_postgres",password:"LOCAL_MOCK_PASSWORD"}),execute:(plan:PsqlInvocation)=>runLocalPsql(plan,true),
        settled:async(plan:PsqlInvocation)=>(await setup.query("select not exists(select 1 from pg_stat_activity where datname=$1 and application_name=$2) settled",[name,plan.env.PGAPPNAME])).rows[0].settled===true};
      const request={target:DEV_REF,approval:"151-158-atomic-once",localVersions:files.map(f=>f.slice(0,14))};
      await expect(createDevAdapter(mockedIO)(request)).rejects.toThrow("EXECUTION_FAILED_RESTORATION_VERIFIED");
      expect(await reservationSnapshot(setup)).toEqual(original);
      // Separate, intentional success case after the independently verified forced rollback.
      expect((await createDevAdapter({...mockedIO,execute:(plan:PsqlInvocation)=>runLocalPsql(plan)})(request)).verdict).toBe("PASS");
      console.info("Adapter proof: real psql rollback and successful single-transaction install; authentication mocked; no live credentials.");
      await target.acceptClonePhase(setup,name,158);
      expect(await platformSnapshot()).toEqual(originalPlatform);
      const installed=await reservationSnapshot(setup);
      for(const [key,value] of Object.entries(original))if(!["security","public.permission_definitions","supabase_migrations.schema_migrations"].includes(key))expect(installed[key]).toEqual(value);
      console.info("Atomic migration proof: failure rolled back; authenticated observer saw no Save before commit; final parity 158.");
      baseline=await reservationSnapshot(setup);
    } finally {setup.release(true);}
  });
  beforeEach(async context => {
    await target.assertQuiet();const client=await pool!.connect();transaction=guardRollbackQueries(client,context.signal);db=transaction.client;await db.query("begin");
    await db.query("set local statement_timeout='15s'; set local lock_timeout='3s'");
  });
  afterEach(async () => {
    let failure:unknown;
    if(transaction){const current=transaction;transaction=undefined;try{await rollbackReservationTransactions([current,...branches.splice(0)]);}catch(error){failure=error;}}
    try{if(pool&&baseline)expect(await snapshot(pool)).toEqual(baseline);}finally{if(failure)throw failure;}
  });
  afterAll(async () => {
    try {if(pool)await pool.end();if(source&&sourceBaseline)expect(await snapshot(source)).toEqual(sourceBaseline);
      if(created&&source){await target.dropTemporary(source,name);expect((await source.query("select exists(select 1 from pg_database where datname=$1) present",[name])).rows[0].present).toBe(false);}
      if(source&&sourceBaseline)expect(await snapshot(source)).toEqual(sourceBaseline);
    } finally {await target.release();if(source)await source.end();}
  });


  const save=async(id:string,quantity="8",request=randomUUID(),actor=admin,deadline="2030-01-01",name="Owned Save")=>
    (await call(saveSql,[request,name,JSON.stringify([{product_id:id,quantity}]),deadline],actor))[0].receipt;


  const listSql="select * from public.list_test_calculations($1,$2,$3)";
  const detailSql="select public.get_test_calculation($1) result";
  const list=(limit=50,before:Date|null=null,id:string|null=null,actor=admin)=>call(listSql,[limit,before,id],actor);
  const detail=async(id:string|null,actor=admin)=>(await call(detailSql,[id],actor))[0].result;
  const headerKeys=["calculation_id","name","creator_full_name","created_at","deadline_date","deadline_timezone","expires_at","status","as_of"];
  async function seeded(productId:string,expired=false,actor=admin,required="9",held="5"){
    const id=randomUUID(),item=randomUUID(),request=randomUUID();
    await db.query(`insert into public.test_calculations(id,name,created_by_user_id,created_at,deadline_date,expires_at,request_id,submitted_payload,save_receipt)
      values($1,'Owned history fixture',$2,'2019-01-01',$3::date,($3::date+1)::timestamp at time zone 'Europe/Sarajevo',$4,
      '{"private_marker":"never_expose_payload"}','{"private_marker":"never_expose_receipt"}')`,[id,actor.id,expired?"2020-01-01":"2030-01-01",request]);
    await db.query(`insert into public.test_calculation_items(id,calculation_id,product_id,product_name_snapshot,serial_number_snapshot,product_kind_snapshot,required_quantity,held_quantity,uncovered_quantity)
      select $1,$2,id,'Saved historical name','0000123',product_kind,$4::bigint,$5::bigint,($4::numeric-$5::numeric)::bigint from public.products where id=$3`,[item,id,productId,required,held]);
    if(BigInt(held)>0n)await db.query("insert into public.test_calculation_holds(item_id,calculation_id,product_id,warehouse_id,quantity) values($1,$2,$3,$4,$5::bigint)",[item,id,productId,raw,held]);
    await db.query("set constraints all immediate;set constraints all deferred");
    return {id,item,request};
  }
  it("lists active and expired history and preserves saved quantities after expiry",async()=>{
    const p=await product(),a=await seeded(p.id),e=await seeded(p.id,true);
    const before=await reservationSnapshot(db),rows=await list();
    for(const [id,status] of [[a.id,"active"],[e.id,"expired"]]){
      const row=rows.find(r=>r.calculation_id===id);expect(row.status).toBe(status);
      expect(Object.keys(row).sort()).toEqual([...headerKeys].sort());
      const d=await detail(id!);expect(d.status).toBe(status);
      expect(d.items[0]).toMatchObject({required_quantity:"9",held_quantity:"5",missing_quantity:"4"});
      expect(d.items[0].holds).toEqual([{warehouse_id:raw,warehouse_code:"raw_materials",quantity:"5"}]);
      expect(Date.parse(d.expires_at)>Date.parse(d.as_of)).toBe(status==="active");
    }
    expect(new Set(rows.map(r=>r.as_of.toISOString())).size).toBe(1);
    expect(await reservationSnapshot(db)).toEqual(before);
  });
  it("projects actual Save allocations and missing quantities without returning its receipt",async()=>{
    const p=await product(),receipt=await save(p.id,"15");
    const id=(await db.query("select id from public.test_calculations where created_by_user_id=$1 order by created_at desc limit 1",[admin.id])).rows[0].id;
    const d=await detail(id),item=d.items[0];
    expect(receipt).toBeDefined();expect(item).toMatchObject({required_quantity:"15",held_quantity:"12",missing_quantity:"3"});
    expect(item.holds.map((h:{quantity:string})=>h.quantity).sort()).toEqual(["3","4","5"]);
    expect(Object.keys(d).sort()).toEqual([...headerKeys,"items"].sort());
    expect(Object.keys(item).sort()).toEqual(["item_id","product_id","product_name_snapshot","serial_number_snapshot","product_kind_snapshot","required_quantity","held_quantity","missing_quantity","holds"].sort());
  });
  it("allows view-only shared history across creators without current warehouse permissions",async()=>{
    const p=await product(),a=await seeded(p.id),m=await seeded(p.id,false,member);
    await grant(["test_calculator.view"]);
    expect((await list(50,null,null,member)).map(r=>r.calculation_id)).toEqual(expect.arrayContaining([a.id,m.id]));
    expect((await detail(a.id,member)).creator_full_name).toBe((await db.query("select full_name from public.user_profiles where id=$1",[admin.id])).rows[0].full_name);
    await db.query("update public.user_profiles set is_active=false where id=$1",[admin.id]);
    expect((await detail(a.id,member)).calculation_id).toBe(a.id);
  });
  it("denies missing view authority, inactive, anonymous and service-role callers before existence disclosure",async()=>{
    const p=await product(),a=await seeded(p.id);
    for(const permissions of [[],["test_calculator.manage"],["inventory.raw_materials.view","inventory.customs.view","inventory.finished_goods.view"]]){
      await grant(permissions);await expect(list(50,null,null,member)).rejects.toMatchObject({code:"42501"});
      await expect(detail(a.id,member)).rejects.toMatchObject({code:"42501"});
      await expect(detail(randomUUID(),member)).rejects.toMatchObject({code:"42501"});
    }
    await grant(["test_calculator.view"]);await db.query("update public.user_profiles set is_active=false where id=$1",[member.id]);
    await expect(detail(a.id,member)).rejects.toMatchObject({code:"42501"});
    for(const role of ["anon","service_role"]){
      await expect(call(listSql,[50,null,null],admin,role)).rejects.toMatchObject({code:"42501"});
      await expect(call(detailSql,[a.id],admin,role)).rejects.toMatchObject({code:"42501"});
    }
    await expect(call(listSql,[50,null,null],{id:admin.id,auth_user_id:""})).rejects.toMatchObject({code:"42501"});
  });
  it("retains snapshots for archived/renamed Products and never leaks private identities or payloads",async()=>{
    const p=await product(),a=await seeded(p.id);
    await db.query("update public.products set name='Current renamed Product',is_active=false,archived_at=clock_timestamp(),archived_by_user_id=$2 where id=$1",[p.id,admin.id]);
    const before=await reservationSnapshot(db),d=await detail(a.id);
    expect(d.items[0]).toMatchObject({product_name_snapshot:"Saved historical name",serial_number_snapshot:"0000123",product_id:p.id});
    const encoded=JSON.stringify([d,await list()]);
    for(const secret of [a.request,admin.auth_user_id,"never_expose_payload","never_expose_receipt","submitted_payload","save_receipt","auth_user_id","birthday","email"])expect(encoded).not.toContain(secret);
    expect(await reservationSnapshot(db)).toEqual(before);
  });
  it("keeps SQL bigint quantities lossless and zero allocations distinct from expired saved holds",async()=>{
    const p=await product(),a=await seeded(p.id,true,admin,"9223372036854775807","9007199254740993");
    const z=await seeded(p.id,false,admin,"9223372036854775807","0"),d=await detail(a.id);
    expect(d.items[0]).toMatchObject({required_quantity:"9223372036854775807",held_quantity:"9007199254740993",missing_quantity:"9214364837600034814"});
    expect(d.items[0].holds[0].quantity).toBe("9007199254740993");
    const zero=(await detail(z.id)).items[0];expect(zero.held_quantity).toBe("0");expect(zero.holds).toEqual([]);
    const inventory=(await call("select * from public.get_inventory_test_commitments($1,$2)",[raw,p.serial]))[0];
    expect(inventory.committed_to_tests).toBe("0");
  });
  it("paginates deterministically across equal timestamps and validates all cursor inputs",async()=>{
    const p=await product(),a=await seeded(p.id),b=await seeded(p.id,true),c=await seeded(p.id);
    const rows=await list(100),expected:string[]=[a.id,b.id,c.id].sort().reverse(),ids:string[]=[];
    let page=await list(1);
    while(page.length){const r=page[0];ids.push(r.calculation_id);page=await list(1,r.created_at,r.calculation_id);}
    expect(ids).toEqual(rows.map(r=>r.calculation_id));expect(ids.filter(id=>expected.includes(id))).toEqual(expected);
    for(const args of [[0,null,null],[101,null,null],[null,null,null],[1,new Date(),null],[1,null,randomUUID()],[1,"infinity",randomUUID()]])
      await expect(call(listSql,args)).rejects.toMatchObject({code:"22023"});
    await expect(detail(null)).rejects.toMatchObject({code:"22023"});
    await expect(detail(randomUUID())).rejects.toMatchObject({code:"P0002"});
  });
  it("preserves RLS, table privacy and narrow trusted read grants without data/security/sequence writes",async()=>{
    const p=await product(),a=await seeded(p.id),before=await reservationSnapshot(db);
    await list();await detail(a.id);expect(await reservationSnapshot(db)).toEqual(before);
    for(const fn of ["public.list_test_calculations(integer,timestamptz,uuid)","public.get_test_calculation(uuid)"]){
      expect((await db.query("select prosecdef,provolatile,proconfig from pg_proc where oid=$1::regprocedure",[fn])).rows[0])
        .toMatchObject({prosecdef:true,provolatile:"s",proconfig:['search_path=""']});
      for(const role of ["anon","service_role"])expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,fn])).rows[0].allowed).toBe(false);
      expect((await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') allowed",[fn])).rows[0].allowed).toBe(true);
    }
    for(const table of ["test_calculations","test_calculation_items","test_calculation_holds"]){
      expect((await db.query("select relrowsecurity from pg_class where oid=$1::regclass",[`public.${table}`])).rows[0].relrowsecurity).toBe(true);
      await expect(call(`select * from public.${table}`,[])).rejects.toMatchObject({code:"42501"});
    }
    expect((await db.query("select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and prosecdef")).rows[0].n).toBe(198);
    expect((await db.query("select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and prosecdef and oid<>'public.rls_auto_enable()'::regprocedure")).rows[0].n).toBe(197);
  });
  it("searches, previews and saves full/partial/zero results on schema 158 without physical/provenance writes",async()=>{
    const p=await product(false,["3","0","0"]);
    const before=(await db.query("select quantity::text q from public.inventory_balances where product_id=$1 order by warehouse_id",[p.id])).rows;
    const movements=(await db.query("select count(*)::int n from public.inventory_movements where product_id=$1",[p.id])).rows[0].n;
    const provenance=await db.query("select to_jsonb(l) row from public.inventory_source_lots l where product_id=$1 order by id",[p.id]);
    const allocations=await db.query("select count(*)::text n from public.inventory_source_allocations");
    expect((await call("select * from public.search_test_calculator_products($1,50)",[p.serial])).map(r=>r.product_id)).toContain(p.id);
    for(const [required,held,missing] of [["2","2","0"],["2","1","1"],["1","0","1"]]){
      const items=JSON.stringify([{product_id:p.id,quantity:required}]);
      const preview=(await call("select * from public.preview_test_calculation($1::jsonb)",[items]))[0];
      expect(preview).toMatchObject({reservable_quantity:held,missing_quantity:missing});
      const receipt=await save(p.id,required),d=await detail(receipt.calculation_id);
      expect(d.items[0]).toMatchObject({required_quantity:required,held_quantity:held,missing_quantity:missing});
      const stock=(await call("select * from public.get_inventory_test_commitments($1,$2)",[raw,p.serial]))[0];
      expect(stock.physical_quantity).toBe("3");
    }
    expect((await db.query("select quantity::text q from public.inventory_balances where product_id=$1 order by warehouse_id",[p.id])).rows).toEqual(before);
    expect((await db.query("select count(*)::int n from public.inventory_movements where product_id=$1",[p.id])).rows[0].n).toBe(movements);
    expect((await db.query("select to_jsonb(l) row from public.inventory_source_lots l where product_id=$1 order by id",[p.id])).rows).toEqual(provenance.rows);
    expect((await db.query("select count(*)::text n from public.inventory_source_allocations")).rows).toEqual(allocations.rows);
    expect((await call("select * from public.get_inventory_test_commitments($1,$2)",[raw,p.serial]))[0]).toMatchObject({committed_to_tests:"3",available_after_projects_and_tests:"0"});
    await expect(call("select * from public.adjust_inventory_warehouse($1,$2,'remove',1,'Protected owned Test')",[p.id,raw])).rejects.toMatchObject({code:"IVB02"});
  });
  it("keeps Project reservations and production capacity disjoint from active Test holds on schema 158",async()=>{
    const p=await product(true,["0","0","5"]),projectId=randomUUID(),group=randomUUID();
    await db.query("insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id) values($1,$2,'Local',current_date,current_date+1,$3,$3)",[projectId,`TC integrated ${projectId}`,admin.id]);
    await db.query("insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id) values($1,$2,'Owned integrated',$3,$3)",[group,projectId,admin.id]);
    await db.query("insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id) values($1,$2,3,$3,$3)",[group,p.id,admin.id]);
    const request=randomUUID();
    await call("select * from public.reserve_finished_goods_for_project($1,$2,2,0,$3)",[projectId,p.id,request]);
    const receipt=await save(p.id,"4");expect(receipt.items[0].held_quantity).toBe("3");
    expect((await call("select * from public.get_inventory_test_commitments($1,$2)",[fg,p.serial]))[0]).toMatchObject({physical_quantity:"5",project_commitment_quantity:"2",committed_to_tests:"3",available_after_projects_and_tests:"0"});
    expect((await db.query("select public.get_production_free_warehouse_quantity($1,$2)::text free",[p.id,fg])).rows[0].free).toBe("0");
    await expect(call("select * from public.reserve_finished_goods_for_project($1,$2,1,1,$3)",[projectId,p.id,randomUUID()])).rejects.toMatchObject({code:"FGR07"});
    expect((await detail(receipt.calculation_id)).items[0].held_quantity).toBe("3");
  });

  it("enforces the real 41-key permission matrix and Test Save/read authority on schema 158",async()=>{
    const p=await product(true,["0","0","3"]);
    const matrix=await call("select * from public.get_user_permissions_admin($1)",[member.id]);
    expect(matrix).toHaveLength(41);expect(new Set(matrix.map(r=>r.permission_key)).size).toBe(41);
    expect(matrix.map(r=>r.permission_key)).toEqual(expect.arrayContaining(["test_calculator.view","test_calculator.manage"]));
    const items=JSON.stringify([{product_id:p.id,quantity:"1"}]);
    async function denied(){
      const before=await reservationSnapshot(db);
      await expect(call("select * from public.search_test_calculator_products($1,50)",[p.serial],member)).rejects.toMatchObject({code:"42501"});
      await expect(call("select * from public.preview_test_calculation($1::jsonb)",[items],member)).rejects.toMatchObject({code:"42501"});
      await expect(save(p.id,"1",randomUUID(),member)).rejects.toMatchObject({code:"42501"});
      expect(await reservationSnapshot(db)).toEqual(before);
    }
    for(const keys of [[],["pcb.edit"],["test_calculator.view"],["test_calculator.manage"]]){
      await grant([...keys,"inventory.finished_goods.view"]);await denied();
    }
    await grant(["test_calculator.view","test_calculator.manage","inventory.finished_goods.view"]);
    expect((await call("select * from public.preview_test_calculation($1::jsonb)",[items],member))[0].reservable_quantity).toBe("1");
    expect((await save(p.id,"1",randomUUID(),member)).items[0].held_quantity).toBe("1");
    await db.query("update public.user_profiles set is_active=false where id=$1",[member.id]);await denied();
  });
});
