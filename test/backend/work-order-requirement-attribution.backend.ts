import {randomUUID,createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import type {PoolClient} from "pg";
import {beforeAll,beforeEach,afterEach,afterAll,describe,it,expect,vi} from "vitest";
vi.mock("../../lib/supabase/client",()=>({supabase:{}}));
vi.mock("../../lib/config/env",()=>({frontendEnv:{supabaseUrl:"https://yzysgbrpbhiapalgetau.supabase.co",supabasePublishableKey:"local-parser-only"}}));
import {parseAttributionContext} from "../../features/inventory/services/materialAttributionContextService";
import {ReservationLocalTarget,reservationSnapshot,type LocalReservationPool} from "./helpers/reservation-local-target";
import {createSupplierSourceFixture} from "./helpers/inventory-provenance";
const file="20261030180000_add_work_order_requirement_attribution.sql";
const files=readdirSync("supabase/migrations").filter(f=>/^\d{14}_.+\.sql$/.test(f)).sort();
const digest=(f:string)=>createHash("sha256").update(readFileSync(`supabase/migrations/${f}`)).digest("hex");
const historical=files.slice(0,177).map(digest);
const signature="public.declare_work_order_material_independence(uuid,uuid,bigint,uuid,bigint)";
const coverage=process.env.WO_COVERAGE_LOCAL==="1",coverageFile="20261030190000_add_exact_project_requirement_coverage.sql";
const unified=process.env.WO_UNIFIED_LOCAL==="1",unifiedFile="20261030200000_add_unified_committed_contracts.sql";
const adminContext=process.env.WO_ATTRIBUTION_UI_LOCAL==="1",contextFile="20261030210000_add_admin_attribution_context.sql";
const reporting=process.env.WO_REPORTING_LOCAL==="1",reportingFile="20261030220000_simplify_unified_committed_reporting.sql";
const reportingHistorical=files.slice(0,181).map(digest);
describe.skipIf(process.env.WO_ATTRIBUTION_LOCAL!=="1")("Requirement attribution — owned disposable local database",()=>{
  const target=new ReservationLocalTarget(),name=`alfaev_fg_3b1_${randomUUID().replace(/-/g,"")}`;
  let source:LocalReservationPool,pool:LocalReservationPool,created=false,sourceBefore:unknown,baseline:unknown,db:PoolClient,committedFixture=false;
  let actor:{id:string;auth_user_id:string},member:{id:string;auth_user_id:string},product:string;
  async function snapshot(p:LocalReservationPool){const c=await p.connect();try{return await reservationSnapshot(c);}finally{c.release(true);}}
  beforeAll(async()=>{
    if(process.env.WO_ATTRIBUTION_APPROVAL!=="owned-clone-only"||process.env.LOCAL_SUPABASE_DB_PASSWORD)throw Error("Owned local peer scope required");
    expect(files[177]).toBe(file);source=target.pool();await target.acquire(source);sourceBefore=await snapshot(source);
    await target.createTemporary(source,name);created=true;target.copyIntoTemporary(name);pool=target.pool(name);const setup=await pool.connect();
    try{
      await setup.query("begin");for(let i=142;i<150;i++){const f=files[i]!;await setup.query(readFileSync(`supabase/migrations/${f}`,"utf8"));
        await setup.query("insert into supabase_migrations.schema_migrations(version,name) values($1,$2)",[f.slice(0,14),f.slice(15,-4)]);
        if(i>=145){await setup.query("commit");await target.acceptClonePhase(setup,name,(i+1) as 146|147|148|149|150);if(i<149)await setup.query("begin");}}
      for(const f of files.slice(150,177)){await setup.query("begin");await setup.query(readFileSync(`supabase/migrations/${f}`,"utf8"));await setup.query("commit");}
      const prior=await reservationSnapshot(setup),contracts=(await setup.query("select oid::text id,md5(to_jsonb(p)::text) hash from pg_proc p where pronamespace='public'::regnamespace order by oid")).rows;
      await setup.query("begin");await setup.query(readFileSync(`supabase/migrations/${file}`,"utf8"));await setup.query("commit");
      const after=await reservationSnapshot(setup);for(const [key,value] of Object.entries(prior))if(key!=="security")expect(after[key]).toEqual(value);
      expect((await setup.query("select oid::text id,md5(to_jsonb(p)::text) hash from pg_proc p where oid=any($1::oid[]) order by oid",[contracts.map(r=>r.id)])).rows).toEqual(contracts);
      if(coverage){expect(files[178]).toBe(coverageFile);const beforeCoverage=await reservationSnapshot(setup);
        await setup.query("begin");await setup.query(readFileSync(`supabase/migrations/${coverageFile}`,"utf8"));await setup.query("commit");
        const afterCoverage=await reservationSnapshot(setup);for(const [key,value] of Object.entries(beforeCoverage))if(key!=="security")expect(afterCoverage[key]).toEqual(value);}
      if(unified){expect(coverage).toBe(true);expect(files[179]).toBe(unifiedFile);const priorUnified=await reservationSnapshot(setup);
        await setup.query("begin");await setup.query(readFileSync(`supabase/migrations/${unifiedFile}`,"utf8"));await setup.query("commit");
        const afterUnified=await reservationSnapshot(setup);for(const [key,value] of Object.entries(priorUnified))if(key!=="security")expect(afterUnified[key]).toEqual(value);}
      if(adminContext){expect(unified).toBe(true);expect(files[180]).toBe(contextFile);const priorContext=await reservationSnapshot(setup);
        await setup.query("begin");await setup.query(readFileSync(`supabase/migrations/${contextFile}`,"utf8"));await setup.query("commit");
        const afterContext=await reservationSnapshot(setup);for(const [key,value] of Object.entries(priorContext))if(key!=="security")expect(afterContext[key]).toEqual(value);}
      if(reporting){expect(adminContext).toBe(true);expect(files[181]).toBe(reportingFile);const priorReporting=await reservationSnapshot(setup);
        const unchangedFunctions=(await setup.query("select oid::text id,md5(to_jsonb(p)::text) hash from pg_proc p where pronamespace='public'::regnamespace and proname not in ('get_inventory_unified_committed','get_inventory_unified_commitment_breakdown') order by oid")).rows;
        await setup.query("begin");await setup.query(readFileSync(`supabase/migrations/${reportingFile}`,"utf8"));await setup.query("commit");
        const afterReporting=await reservationSnapshot(setup);for(const [key,value] of Object.entries(priorReporting))if(key!=="security")expect(afterReporting[key]).toEqual(value);
        expect((await setup.query("select oid::text id,md5(to_jsonb(p)::text) hash from pg_proc p where oid=any($1::oid[]) order by oid",[unchangedFunctions.map(r=>r.id)])).rows).toEqual(unchangedFunctions);}
      actor=(await setup.query("select id,auth_user_id from public.user_profiles where is_active and is_admin order by id limit 1")).rows[0];
      member=(await setup.query("select id,auth_user_id from public.user_profiles where is_active and not is_admin order by id limit 1")).rows[0];
      if(!actor||!member)throw Error("Existing local actor fixtures required");baseline=await reservationSnapshot(setup);
      process.stdout.write(`Owned attribution clone: ${name}; migrations preserve existing accounting writers and business records\n`);
    }catch(e){await setup.query("rollback");throw e;}finally{setup.release(true);}
  });
  beforeEach(async()=>{await target.assertQuiet();db=await pool.connect();await db.query("begin;set local statement_timeout='15s';set local lock_timeout='3s'");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);
    product=randomUUID();const serial=(await db.query("select n::text serial from generate_series(8000000,8999999) n where not exists(select 1 from public.products where serial_number=n::text) order by n limit 1")).rows[0].serial;
    await db.query("insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id) values($1,$2,'Owned attribution input','Fixture','component',$3,$3)",[product,serial,actor.id]);
  });
  afterEach(async()=>{if(db){await db.query("rollback");db.release(true);}if(pool&&baseline&&!committedFixture)expect(await snapshot(pool)).toEqual(baseline);});
  afterAll(async()=>{try{if(pool)await pool.end();if(source){expect(await snapshot(source)).toEqual(sourceBefore);if(created){await target.dropTemporary(source,name);expect((await source.query("select exists(select 1 from pg_database where datname=$1) present",[name])).rows[0].present).toBe(false);process.stdout.write("Owned attribution clone removed; source data/security/sequences unchanged\n");}}expect(files.slice(0,177).map(digest)).toEqual(historical);if(reporting)expect(files.slice(0,181).map(digest)).toEqual(reportingHistorical);}finally{await target.release();if(source)await source.end();}});
  async function attempt(sql:string,args:unknown[]=[]){await db.query("savepoint attempt");try{const r=await db.query(sql,args);await db.query("release savepoint attempt");return r;}catch(e){await db.query("rollback to savepoint attempt;release savepoint attempt");throw e;}}
  async function fixture(quantity="10"){
    // Private lifecycle staging is invoked only inside this owned transaction.
    const created=(await db.query("select public.stage_draft_work_order_reservations($1,'create',null,null,'{}') r",[randomUUID()])).rows[0].r;
    await db.query("select public.stage_draft_work_order_reservations($1,'edit',$2,$3,$4)",[randomUUID(),created.work_order_id,created.updated_at,{project_id:null,description:"Owned attribution",items:[{product_id:product,quantity}]}]);
    return(await db.query("select id,work_order_id,version::text version from public.work_order_material_reservation_states where work_order_id=$1 and product_id=$2",[created.work_order_id,product])).rows[0] as {id:string;work_order_id:string;version:string};
  }
  async function declare(f:{id:string;version:string},quantity:string,previous:string|null=null,request=randomUUID()){
    return(await db.query("select public.declare_work_order_material_independence($1,$2,$3,$4,$5) id",[request,f.id,f.version,previous,quantity])).rows[0].id as string;
  }
  async function totals(id:string){return(await db.query("select required_quantity::text required,verified_coverage_quantity::text covered,admin_independent_quantity::text independent,unknown_quantity::text unknown from public.work_order_requirement_attribution_totals where state_id=$1",[id])).rows[0];}
  it("keeps missing Project links Unknown and partitions exact Admin declarations without inferred coverage",async()=>{
    const f=await fixture();expect(await totals(f.id)).toEqual({required:"10",covered:"0",independent:"0",unknown:"10"});
    await declare(f,"4");expect(await totals(f.id)).toEqual({required:"10",covered:"0",independent:"4",unknown:"6"});
    expect((await db.query("select actor_user_id,auth_user_id,work_order_id,product_id,material_version::text version from public.work_order_requirement_attribution_evidence")).rows[0]).toEqual({actor_user_id:actor.id,auth_user_id:actor.auth_user_id,work_order_id:f.work_order_id,product_id:product,version:f.version});
  });
  it("supersedes rather than adds, resets to Unknown and prevents stale competing declarations",async()=>{
    const f=await fixture(),first=await declare(f,"4"),second=await declare(f,"6",first);
    expect((await totals(f.id)).independent).toBe("6");
    await expect(attempt("select public.declare_work_order_material_independence($1,$2,$3,$4,8)",[randomUUID(),f.id,f.version,first])).rejects.toMatchObject({code:"WRA02"});
    await declare(f,"0",second);expect((await totals(f.id)).unknown).toBe("10");
    expect((await db.query("select count(*)::int n from public.work_order_requirement_attribution_evidence")).rows[0].n).toBe(3);
  });
  it("supports exact actor-bound request replay but rejects changed payload and other actors",async()=>{
    const f=await fixture(),request=randomUUID();expect(await declare(f,"4",null,request)).toBe(request);expect(await declare(f,"4",null,request)).toBe(request);
    await expect(attempt("select public.declare_work_order_material_independence($1,$2,$3,null,5)",[request,f.id,f.version])).rejects.toMatchObject({code:"WRA03"});
    for(const authId of [member.auth_user_id,""]){await db.query("select set_config('request.jwt.claim.sub',$1,true)",[authId]);
      await expect(attempt("select public.declare_work_order_material_independence($1,$2,$3,null,4)",[request,f.id,f.version])).rejects.toMatchObject({code:"42501"});}
  });
  it("rejects inactive Admins, negative/excess quantities and preserves bigint precision",async()=>{
    const f=await fixture("9223372036854775807");await declare(f,"9007199254740993");expect((await totals(f.id)).unknown).toBe("9214364837600034814");
    const small=await fixture("3");await expect(attempt("select public.declare_work_order_material_independence($1,$2,$3,null,4)",[randomUUID(),small.id,small.version])).rejects.toMatchObject({code:"23514"});
    await expect(attempt("select public.declare_work_order_material_independence($1,$2,$3,null,-1)",[randomUUID(),small.id,small.version])).rejects.toMatchObject({code:"22023"});
    await db.query("update public.user_profiles set is_active=false where id=$1",[actor.id]);
    await expect(attempt("select public.declare_work_order_material_independence($1,$2,$3,null,1)",[randomUUID(),small.id,small.version])).rejects.toMatchObject({code:"42501"});
  });
  it("invalidates edited material evidence, permits explicit re-attestation and retains stale history",async()=>{
    const f=await fixture(),first=await declare(f,"4");
    await db.query("select public.stage_draft_work_order_reservations($1,'edit',$2,(select updated_at from public.work_orders where id=$2),$3)",[randomUUID(),f.work_order_id,{project_id:null,description:"Changed",items:[{product_id:product,quantity:"6"}]}]);
    expect(await totals(f.id)).toEqual({required:"6",covered:"0",independent:"0",unknown:"6"});
    await expect(attempt("select public.declare_work_order_material_independence($1,$2,$3,$4,4)",[randomUUID(),f.id,f.version,first])).rejects.toMatchObject({code:"WRA01"});
    f.version=(await db.query("select version::text version from public.work_order_material_reservation_states where id=$1",[f.id])).rows[0].version;
    await declare(f,"2",first);expect((await totals(f.id)).independent).toBe("2");
    expect((await db.query("select count(*)::int n from public.work_order_requirement_attribution_evidence")).rows[0].n).toBe(2);
  });
  it("preserves immutable history through real Draft deletion and never changes stock or allocations",async()=>{
    const f=await fixture(),before=await reservationSnapshot(db);await declare(f,"4");
    const after=await reservationSnapshot(db);for(const [key,value] of Object.entries(before))if(key!=="public.work_order_requirement_attribution_evidence")expect(after[key]).toEqual(value);
    for(const sql of ["update public.work_order_requirement_attribution_evidence set independent_quantity=1","delete from public.work_order_requirement_attribution_evidence","truncate public.work_order_requirement_attribution_evidence"])
      await expect(attempt(sql)).rejects.toMatchObject({code:"55000"});
    await db.query("select public.stage_draft_work_order_reservations($1,'delete',$2,(select updated_at from public.work_orders where id=$2),'{}')",[randomUUID(),f.work_order_id]);
    expect(await totals(f.id)).toEqual({required:"0",covered:"0",independent:"0",unknown:"0"});
    expect((await db.query("select count(*)::int n from public.work_order_requirement_attribution_evidence")).rows[0].n).toBe(1);
  });
  it("denies real application roles, direct table/view access and private helper execution",async()=>{
    const f=await fixture();expect((await db.query("select enabled from public.work_order_reservation_activation")).rows[0].enabled).toBe(false);
    expect((await db.query("select relrowsecurity r from pg_class where oid='public.work_order_requirement_attribution_evidence'::regclass")).rows[0].r).toBe(true);
    for(const role of ["anon","authenticated","service_role"]){
      expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature])).rows[0].allowed).toBe(false);
      for(const table of ["work_order_requirement_attribution_evidence","work_order_requirement_attribution_totals"])
        await expect(attempt(`set local role ${role};select * from public.${table}`)).rejects.toMatchObject({code:"42501"});
      await db.query(`set local role ${role}`);
      await expect(attempt("select public.declare_work_order_material_independence($1,$2,$3,null,1)",[randomUUID(),f.id,f.version])).rejects.toMatchObject({code:"42501"});
      await db.query("reset role");
    }
  });
  it("invalidates evidence on authoritative Finish while retaining FIFO and immutable evidence",async()=>{
    const project=randomUUID(),raw="10000000-0000-4000-8000-000000000001";
    const supplier=await createSupplierSourceFixture(db,{profileId:actor.id,authUserId:actor.auth_user_id},product);
    await db.query("select * from public.adjust_inventory_warehouse($1,$2,'add','2','Owned Finish fixture',$3)",[product,raw,supplier.productSupplierId]);
    const f=await fixture("2");
    await db.query("insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id) values($1,'Owned attribution Project','Owned',current_date,current_date+1,$2,$2)",[project,actor.id]);
    await db.query("select public.stage_draft_work_order_reservations($1,'edit',$2,(select updated_at from public.work_orders where id=$2),$3)",[randomUUID(),f.work_order_id,{project_id:project,description:"Owned Finish",items:[{product_id:product,quantity:"2"}]}]);
    f.version=(await db.query("select version::text version from public.work_order_material_reservation_states where id=$1",[f.id])).rows[0].version;
    await declare(f,coverage?"1":"2");
    if(coverage){const parent=(await db.query("select public.create_project_product($1,'Finish requirement') id",[project])).rows[0].id;
      const requirement=(await db.query("select public.create_project_product_component($1,$2,2) id",[parent,product])).rows[0].id;
      const revision=(await db.query("select updated_at::text revision from public.project_product_components where id=$1",[requirement])).rows[0].revision;
      await db.query("select public.declare_work_order_requirement_coverage($1,$2,$3,$4,$5,$6,1,null)",[randomUUID(),f.id,f.version,requirement,revision,raw]);
    }
    const updated=(await db.query("select updated_at::text value from public.work_orders where id=$1",[f.work_order_id])).rows[0].value;
    await db.query("select * from public.get_work_order_pdf_snapshot($1,$2)",[f.work_order_id,updated]);
    const fingerprint=(await db.query("select public.get_work_order_source_allocation_fingerprint($1) value",[f.work_order_id])).rows[0].value;
    const path=`final/${f.work_order_id}/${randomUUID()}.pdf`;
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('work-order-pdfs',$1,'{\"mimetype\":\"application/pdf\"}')",[path]);
    await db.query("select * from public.finish_work_order($1,$2,$3,$4,$5)",[f.work_order_id,updated,path,"a".repeat(64),fingerprint]);
    expect(await totals(f.id)).toEqual({required:"0",covered:"0",independent:"0",unknown:"0"});
    expect((await db.query("select quantity::text q from public.inventory_balances where product_id=$1 and warehouse_id=$2",[product,raw])).rows[0].q).toBe("0");
    expect((await db.query("select sum(remaining_quantity)::text q from public.inventory_source_lots where product_id=$1 and warehouse_id=$2",[product,raw])).rows[0].q).toBe("0");
    expect((await db.query("select count(*)::int n from public.work_order_requirement_attribution_evidence where state_id=$1",[f.id])).rows[0].n).toBe(1);
  });
  if(coverage){
    const raw="10000000-0000-4000-8000-000000000001",customs="10000000-0000-4000-8000-000000000003";
    type Material={id:string;work_order_id:string;version:string};
    type Requirement={id:string;revision:string;project:string;parent:string};
    async function coverageFixture(quantity="10",rawStock="10",customsStock="0"){
      const supplier=await createSupplierSourceFixture(db,{profileId:actor.id,authUserId:actor.auth_user_id},product);
      for(const [warehouse,q] of [[raw,rawStock],[customs,customsStock]])if(q!=="0")await db.query("select * from public.adjust_inventory_warehouse($1,$2,'add',$3,'Owned coverage fixture',$4)",[product,warehouse,q,supplier.productSupplierId]);
      const f=await fixture(quantity),project=randomUUID();
      await db.query("insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id) values($1,'Owned exact coverage','Owned',current_date,current_date+1,$2,$2)",[project,actor.id]);
      const parent=(await db.query("select public.create_project_product($1,'Owned group') id",[project])).rows[0].id;
      const id=(await db.query("select public.create_project_product_component($1,$2,$3) id",[parent,product,quantity])).rows[0].id;
      const revision=(await db.query("select updated_at::text revision from public.project_product_components where id=$1",[id])).rows[0].revision;
      return{f,r:{id,revision,project,parent} as Requirement};
    }
    const cover=async(f:Material,r:Requirement,q:string,warehouse=raw,previous:string|null=null,request=randomUUID(),client=db)=>(await client.query("select public.declare_work_order_requirement_coverage($1,$2,$3,$4,$5,$6,$7,$8) id",[request,f.id,f.version,r.id,r.revision,warehouse,q,previous])).rows[0].id as string;
    const failCover=(f:Material,r:Requirement,q:string,warehouse=raw,previous:string|null=null,request=randomUUID())=>attempt("select public.declare_work_order_requirement_coverage($1,$2,$3,$4,$5,$6,$7,$8)",[request,f.id,f.version,r.id,r.revision,warehouse,q,previous]);
    if(reporting){
      const observe=async(warehouse=raw)=>(await db.query("select public.get_inventory_unified_committed($1,$2) value",[product,warehouse])).rows[0].value;
      const page=async(cursor:unknown=null,limit=25)=>(await db.query("select public.get_inventory_unified_commitment_breakdown($1,$2,$3,$4) value",[product,raw,limit,cursor])).rows[0].value;
      it("182 reports 23 plus 68 as 91 without requiring attribution or changing accounting",async()=>{const {r}=await coverageFixture("68","68");await db.query("select public.update_project_product_component($1,$2,23)",[r.id,product]);const before=await reservationSnapshot(db);await db.query("set local role authenticated");expect(await observe()).toMatchObject({schema:2,metric_definition:"project_demand_plus_work_order_held",project_demand:"23",work_order_held:"68",committed_quantity:"91"});expect((await page()).items.map((s:{quantity:string})=>s.quantity)).toEqual(["23","68"]);await db.query("reset role");expect(await reservationSnapshot(db)).toEqual(before);});
      it("182 ignores verified coverage in reporting while retaining immutable evidence",async()=>{const {f,r}=await coverageFixture();await cover(f,r,"10");const before=await reservationSnapshot(db);expect(await observe()).toMatchObject({project_demand:"10",work_order_held:"10",committed_quantity:"20"});const p=await page();expect(p.items.map((s:{source_type:string})=>s.source_type)).toEqual(["project_demand","work_order_held"]);expect(p.source_subtotal).toBe("20");expect(await reservationSnapshot(db)).toEqual(before);});
      it.each(["project","work_order","zero"])("182 handles %s-only and zero reporting",async kind=>{if(kind!=="zero"){const {f,r}=await coverageFixture();if(kind==="project")await db.query("select public.stage_draft_work_order_reservations($1,'delete',$2,(select updated_at from public.work_orders where id=$2),'{}')",[randomUUID(),f.work_order_id]);else await db.query("select public.remove_project_product_component($1)",[r.id]);}const result=await observe();expect(result.committed_quantity).toBe(kind==="zero"?"0":"10");expect(result.project_demand).toBe(kind==="project"?"10":"0");expect(result.work_order_held).toBe(kind==="work_order"?"10":"0");});
      it("182 preserves Raw plus Customs and warehouse-only scopes without merging quantities",async()=>{await coverageFixture("10","6","4");expect(await observe()).toMatchObject({scope:"raw_customs",project_demand:"10",work_order_held:"10",committed_quantity:"20"});expect(await observe(customs)).toMatchObject({scope:"warehouse",project_demand:"0",work_order_held:"4",committed_quantity:"4"});});
      it("182 preserves exact aggregates above bigint and JavaScript safe integers",async()=>{await coverageFixture("9223372036854775807","9223372036854775807");expect((await observe()).committed_quantity).toBe("18446744073709551614");});
      it("182 keeps FG Held separate from Raw planning scope and preserves physical stock",async()=>{const fg="10000000-0000-4000-8000-000000000002";const serial=(await db.query("select lpad(n::text,3,'0') serial from generate_series(0,999) n where not exists(select 1 from public.products where serial_number=lpad(n::text,3,'0')) order by n limit 1")).rows[0].serial;const card=(await db.query("select * from public.create_pcb_card($1,$2)",[`Owned reporting output ${randomUUID()}`,serial])).rows[0];product=(await db.query("select output_product_id from public.pcb_cards where id=$1",[card.pcb_card_id])).rows[0].output_product_id;const supplier=await createSupplierSourceFixture(db,{profileId:actor.id,authUserId:actor.auth_user_id},product);await db.query("select public.adjust_inventory_warehouse($1,$2,'add',10,'Owned FG reporting fixture',$3)",[product,fg,supplier.productSupplierId]);await fixture("10");const before=await reservationSnapshot(db);expect(await observe(fg)).toMatchObject({scope:"warehouse",project_demand:"0",work_order_held:"10",committed_quantity:"10"});await expect(attempt("select public.get_inventory_unified_committed($1,$2)",[product,raw])).rejects.toMatchObject({code:"P0002"});expect(await reservationSnapshot(db)).toEqual(before);});
      it("182 reconciles bounded pages and rejects changed cursors",async()=>{const {r}=await coverageFixture();const first=await page(null,1),second=await page(first.next_cursor,1);expect(first.has_more).toBe(true);expect(second.has_more).toBe(false);expect(BigInt(first.page_subtotal)+BigInt(second.page_subtotal)).toBe(20n);expect(second.before_subtotal).toBe("10");await db.query("select public.update_project_product_component($1,$2,9)",[r.id,product]);await expect(attempt("select public.get_inventory_unified_commitment_breakdown($1,$2,1,$3)",[product,raw,first.next_cursor])).rejects.toMatchObject({code:"ICB01"});});
      it("182 redacts restricted sources and enforces actual authenticated warehouse/module grants",async()=>{const {f,r}=await coverageFixture();await db.query("delete from public.user_permissions where user_id=$1",[member.id]);await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key=any($3::text[])",[member.id,actor.id,["inventory.raw_materials.view","inventory.customs.view"]]);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[member.auth_user_id]);await db.query("set local role authenticated");const restricted=await page();expect(restricted).toMatchObject({source_subtotal:"20",visible_subtotal:"0",restricted_subtotal:"20",items:[]});expect(JSON.stringify(restricted)).not.toContain(f.work_order_id);expect(JSON.stringify(restricted)).not.toContain(r.project);await db.query("reset role");await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key='work_orders.view'",[member.id,actor.id]);await db.query("set local role authenticated");expect(await page()).toMatchObject({visible_subtotal:"10",restricted_subtotal:"10",items:[{source_type:"work_order_held",source_id:f.work_order_id}]});await db.query("reset role");await db.query("delete from public.user_permissions where user_id=$1 and permission_definition_id in(select id from public.permission_definitions where key='inventory.customs.view')",[member.id]);await db.query("set local role authenticated");await expect(attempt("select public.get_inventory_unified_committed($1,$2)",[product,raw])).rejects.toMatchObject({code:"42501"});await db.query("reset role");await db.query("set local role anon");await expect(attempt("select public.get_inventory_unified_committed($1,$2)",[product,raw])).rejects.toMatchObject({code:"42501"});await db.query("reset role");});
    }
    it("179 records partial Admin coverage with no inferred Project link and independent Unknown remainder",async()=>{
      const {f,r}=await coverageFixture(),before=await reservationSnapshot(db);await cover(f,r,"4");
      expect(await totals(f.id)).toEqual({required:"10",covered:"4",independent:"0",unknown:"6"});
      expect((await db.query("select project_id from public.work_orders where id=$1",[f.work_order_id])).rows[0].project_id).toBeNull();
      const after=await reservationSnapshot(db);for(const [key,value] of Object.entries(before))if(key!=="public.work_order_requirement_coverage_evidence")expect(after[key]).toEqual(value);
      expect((await db.query("select actor_user_id,auth_user_id,quantity::text q from public.work_order_requirement_coverage_evidence")).rows[0]).toEqual({actor_user_id:actor.id,auth_user_id:actor.auth_user_id,q:"4"});
      const serial=(await db.query("select serial_number from public.products where id=$1",[product])).rows[0].serial_number;
      await db.query("set local role authenticated");
      const inventory=(await db.query("select public.get_inventory_reservation_accounting($1,$2,true,10,0) value",[raw,serial])).rows[0].value;
      await db.query("reset role");
      expect(inventory.items.find((i:{product_id:string})=>i.product_id===product)).toMatchObject({project_demand_quantity:"10",work_order_held_quantity:"10",project_coverage_quantity:"0",available_after_projects:"0",net_available_after_all_commitments:"-10"});
    });
    it("179 caps shared requirements, warehouse Held and independent/coverage partitions",async()=>{
      const {f,r}=await coverageFixture("10","20"),other=await fixture("10");await cover(f,r,"7");
      await expect(failCover(other,r,"4")).rejects.toMatchObject({code:"23514"});await cover(other,r,"3");
      await expect(attempt("select public.declare_work_order_material_independence($1,$2,$3,null,4)",[randomUUID(),f.id,f.version])).rejects.toMatchObject({code:"23514"});
      await declare(f,"3");expect((await totals(f.id)).unknown).toBe("0");
      await expect(failCover(f,r,"1",customs)).rejects.toMatchObject({code:"23514"});
    });
    it("179 preserves exact Raw/Customs and bigint quantities without double attribution",async()=>{
      const {f,r}=await coverageFixture("9007199254740995","9007199254740993","2");
      await cover(f,r,"9007199254740993",raw);await cover(f,r,"2",customs);
      expect((await totals(f.id)).covered).toBe("9007199254740995");expect((await totals(f.id)).unknown).toBe("0");
      if(unified)expect((await db.query("select public.get_inventory_unified_committed($1,$2) value",[product,raw])).rows[0].value.committed_quantity).toBe("9007199254740995");
    });
    it("179 replays exact actor requests, prevents duplicates and retains immutable supersession",async()=>{
      const {f,r}=await coverageFixture(),request=randomUUID();expect(await cover(f,r,"4",raw,null,request)).toBe(request);expect(await cover(f,r,"4",raw,null,request)).toBe(request);
      await expect(failCover(f,r,"5",raw,null,request)).rejects.toMatchObject({code:"WRC13"});
      await expect(failCover(f,r,"1")).rejects.toMatchObject({code:"WRC12"});
      const next=await cover(f,r,"6",raw,request);expect((await totals(f.id)).covered).toBe("6");await cover(f,r,"0",raw,next);expect((await totals(f.id)).covered).toBe("0");
      for(const sql of ["update public.work_order_requirement_coverage_evidence set quantity=1","delete from public.work_order_requirement_coverage_evidence","truncate public.work_order_requirement_coverage_evidence"])
        await expect(attempt(sql)).rejects.toMatchObject({code:"55000"});
    });
    it("179 denies non-Admin/inactive actors, mismatched Products and real application roles",async()=>{
      const {f,r}=await coverageFixture();
      await db.query("select set_config('request.jwt.claim.sub',$1,true)",[member.auth_user_id]);await expect(failCover(f,r,"1")).rejects.toMatchObject({code:"42501"});
      await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor.auth_user_id]);
      const another=randomUUID();await db.query("insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id) values($1,'7999999','Other coverage Product','Owned','component',$2,$2)",[another,actor.id]);
      const wrong=(await db.query("select public.create_project_product_component($1,$2,10) id",[r.parent,another])).rows[0].id;
      const wrongRevision=(await db.query("select updated_at::text revision from public.project_product_components where id=$1",[wrong])).rows[0].revision;
      await expect(failCover(f,{...r,id:wrong,revision:wrongRevision},"1")).rejects.toMatchObject({code:"WRC10"});
      for(const role of ["anon","authenticated","service_role"]){await db.query(`set local role ${role}`);await expect(failCover(f,r,"1")).rejects.toMatchObject({code:"42501"});
        await expect(attempt("select * from public.work_order_requirement_coverage_evidence")).rejects.toMatchObject({code:"42501"});await db.query("reset role");}
      await db.query("update public.user_profiles set is_active=false where id=$1",[actor.id]);await expect(failCover(f,r,"1")).rejects.toMatchObject({code:"42501"});
    });
    it("179 invalidates requirement and material revisions without deleting history",async()=>{
      const {f,r}=await coverageFixture();await cover(f,r,"4");
      await db.query("select public.update_project_product_component($1,$2,9)",[r.id,product]);expect((await totals(f.id)).covered).toBe("0");await expect(failCover(f,r,"1")).rejects.toMatchObject({code:"WRC10"});
      r.revision=(await db.query("select updated_at::text revision from public.project_product_components where id=$1",[r.id])).rows[0].revision;
      const prior=(await db.query("select request_id from public.work_order_requirement_coverage_evidence")).rows[0].request_id;await cover(f,r,"3",raw,prior);
      await db.query("select public.stage_draft_work_order_reservations($1,'edit',$2,(select updated_at from public.work_orders where id=$2),$3)",[randomUUID(),f.work_order_id,{project_id:null,description:"Changed coverage",items:[{product_id:product,quantity:"8"}]}]);
      expect((await totals(f.id)).covered).toBe("0");expect((await db.query("select count(*)::int n from public.work_order_requirement_coverage_evidence")).rows[0].n).toBe(2);
    });
    it("179 treats subsequent and historical unattributed consumption as Unknown",async()=>{
      const {f,r}=await coverageFixture();await cover(f,r,"4");
      // Owned isolated fixture models an existing aggregate Project debit without
      // assigning it to any requirement; physical balances are not touched.
      await db.query("insert into public.inventory_movements(product_id,warehouse_id,movement_type,quantity_delta,quantity_before,quantity_after,source_type,source_id,project_id,actor_user_id) values($1,$2,'remove',-1,10,9,'work_order',$3,$4,$5)",[product,raw,randomUUID(),r.project,actor.id]);
      expect((await totals(f.id)).covered).toBe("0");await expect(failCover(f,r,"1",customs)).rejects.toMatchObject({code:"WRC11"});
    });
    it("179 invalidates Project cancellation and retains declarations on Draft deletion",async()=>{
      const {f,r}=await coverageFixture();await cover(f,r,"4");await db.query("select public.cancel_project($1)",[r.project]);
      expect((await totals(f.id)).covered).toBe("0");
      await db.query("select public.stage_draft_work_order_reservations($1,'delete',$2,(select updated_at from public.work_orders where id=$2),'{}')",[randomUUID(),f.work_order_id]);
      expect((await totals(f.id)).covered).toBe("0");expect((await db.query("select count(*)::int n from public.work_order_requirement_coverage_evidence")).rows[0].n).toBe(1);
    });
    it("179 retains immutable declarations after requirement deletion",async()=>{
      const {f,r}=await coverageFixture();await cover(f,r,"4");await db.query("select public.remove_project_product_component($1)",[r.id]);
      expect((await totals(f.id)).covered).toBe("0");expect((await db.query("select count(*)::int n from public.work_order_requirement_coverage_evidence")).rows[0].n).toBe(1);
    });
    if(unified){
      const observe=async(warehouse=raw)=>(await db.query("select public.get_inventory_unified_committed($1,$2) value",[product,warehouse])).rows[0].value;
      it("180 keeps unproved and partial overlap Unknown, then proves complete overlap",async()=>{
        const {f,r}=await coverageFixture();expect(await observe()).toMatchObject({proof_status:"unknown",committed_quantity:null,unknown_overlap:"10"});
        const first=await cover(f,r,"4");expect(await observe()).toMatchObject({proof_status:"unknown",committed_quantity:null,verified_coverage:"4",unknown_overlap:"6"});
        await cover(f,r,"10",raw,first);expect(await observe()).toMatchObject({proof_status:"verified",committed_quantity:"10",coverage_adjustment:"10",unknown_overlap:"0"});
      });
      it("180 exposes authenticated Admin declarations with exact replay and no stock changes",async()=>{
        const {f}=await coverageFixture(),request=randomUUID(),before=await reservationSnapshot(db);
        await db.query("set local role authenticated");
        const call=()=>db.query("select public.set_work_order_material_attribution($1,'independent',$2,$3,'10') value",[request,f.id,f.version]);
        const original=(await call()).rows[0].value;expect((await call()).rows[0].value).toEqual(original);await db.query("reset role");
        expect(await observe()).toMatchObject({proof_status:"verified",committed_quantity:"20",independent_held:"10"});
        const after=await reservationSnapshot(db);for(const [key,value] of Object.entries(before))if(key!=="public.work_order_requirement_attribution_evidence")expect(after[key]).toEqual(value);
        await expect(attempt("select public.set_work_order_material_attribution($1,'independent',$2,$3,'9')",[request,f.id,f.version])).rejects.toMatchObject({code:"WRA03"});
      });
      it("180 preserves exact Raw+Customs and warehouse-only metric scopes",async()=>{
        const {f,r}=await coverageFixture("10","6","4");await cover(f,r,"6",raw);await cover(f,r,"4",customs);
        expect(await observe()).toMatchObject({scope:"raw_customs",project_demand:"10",work_order_held:"10",committed_quantity:"10"});
        expect(await observe(customs)).toMatchObject({scope:"warehouse",project_demand:"0",work_order_held:"4",verified_coverage:"4",coverage_adjustment:"0",committed_quantity:"4"});
      });
      it("180 authenticated Admin coverage delegates exact revisions and rejects cross-kind UUID reuse",async()=>{
        const {f,r}=await coverageFixture(),request=randomUUID();await db.query("set local role authenticated");
        const args=[request,f.id,f.version,r.id,r.revision,raw];
        const sql="select public.set_work_order_material_attribution($1,'coverage',$2,$3,'5',null,$4,$5,$6) value";
        const receipt=(await db.query(sql,args)).rows[0].value;expect((await db.query(sql,args)).rows[0].value).toEqual(receipt);
        expect(receipt).toMatchObject({schema:1,request_id:request,kind:"coverage",state_id:f.id});
        await expect(attempt("select public.set_work_order_material_attribution($1,'independent',$2,$3,'5')",[request,f.id,f.version])).rejects.toMatchObject({code:"WRC13"});await db.query("reset role");
      });
      it("180 handles Project-only, Work-Order-only and historical consumption without inventing independence",async()=>{
        const {f,r}=await coverageFixture();await cover(f,r,"10");
        await db.query("insert into public.inventory_movements(product_id,warehouse_id,movement_type,quantity_delta,quantity_before,quantity_after,source_type,source_id,project_id,actor_user_id) values($1,$2,'remove',-1,10,9,'work_order',$3,$4,$5)",[product,raw,randomUUID(),r.project,actor.id]);
        expect(await observe()).toMatchObject({project_demand:"9",verified_coverage:"0",proof_status:"unknown",committed_quantity:null});
        await db.query("select public.remove_project_product_component($1)",[r.id]);
        expect(await observe()).toMatchObject({project_demand:"0",proof_status:"verified",committed_quantity:"10",independent_held:"0"});
        const parent=(await db.query("select public.create_project_product($1,'Another source') id",[r.project])).rows[0].id;
        await db.query("select public.create_project_product_component($1,$2,11)",[parent,product]);
        await db.query("select public.stage_draft_work_order_reservations($1,'delete',$2,(select updated_at from public.work_orders where id=$2),'{}')",[randomUUID(),f.work_order_id]);
        expect(await observe()).toMatchObject({project_demand:"10",work_order_held:"0",proof_status:"verified",committed_quantity:"10"});
      });
      it("180 paginates signed coverage adjustments and rejects stale source snapshots",async()=>{
        const {f,r}=await coverageFixture();const first=await cover(f,r,"4");
        const page=async(cursor:unknown=null)=>(await db.query("select public.get_inventory_unified_commitment_breakdown($1,$2,1,$3) value",[product,raw,cursor])).rows[0].value;
        const a=await page(),b=await page(a.next_cursor),c=await page(b.next_cursor);
        expect(a.observation.committed_quantity).toBeNull();expect(a.source_subtotal).toBe("16");
        expect([a,b,c].flatMap(p=>p.items).map(row=>row.quantity).sort()).toEqual(["-4","10","10"]);
        expect(BigInt(a.page_subtotal)+BigInt(b.page_subtotal)+BigInt(c.page_subtotal)).toBe(16n);expect(c.has_more).toBe(false);
        await cover(f,r,"10",raw,first);await expect(attempt("select public.get_inventory_unified_commitment_breakdown($1,$2,1,$3)",[product,raw,a.next_cursor])).rejects.toMatchObject({code:"ICB01"});
        const complete=(await db.query("select public.get_inventory_unified_commitment_breakdown($1,$2,100,null) value",[product,raw])).rows[0].value;
        expect(complete.observation.committed_quantity).toBe("10");expect(complete.source_subtotal).toBe("10");
      });
      it("180 denies non-Admin attribution and anonymous read execution",async()=>{
        const {f}=await coverageFixture();await db.query("select set_config('request.jwt.claim.sub',$1,true)",[member.auth_user_id]);
        await db.query("set local role authenticated");await expect(attempt("select public.set_work_order_material_attribution($1,'independent',$2,$3,'10')",[randomUUID(),f.id,f.version])).rejects.toMatchObject({code:"42501"});await db.query("reset role");
        await db.query("set local role anon");await expect(attempt("select public.get_inventory_unified_committed($1,$2)",[product,raw])).rejects.toMatchObject({code:"42501"});await db.query("reset role");
      });
      it("180 reconciles multiple independently verified Work Orders without merging demand owners",async()=>{
        const {f}=await coverageFixture("10","20"),other=await fixture("10");await declare(f,"10");await declare(other,"10");
        expect(await observe()).toMatchObject({project_demand:"10",work_order_held:"20",independent_held:"20",unknown_overlap:"0",committed_quantity:"30"});
      });
      it("180 redacts identities while retaining restricted positive and adjustment aggregates",async()=>{
        const {f,r}=await coverageFixture();await cover(f,r,"10");
        await db.query("delete from public.user_permissions where user_id=$1",[member.id]);
        await db.query("insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id) select $1,id,$2 from public.permission_definitions where key=any($3::text[])",[member.id,actor.id,["inventory.raw_materials.view","inventory.customs.view"]]);
        await db.query("select set_config('request.jwt.claim.sub',$1,true)",[member.auth_user_id]);await db.query("set local role authenticated");
        const redacted=(await db.query("select public.get_inventory_unified_commitment_breakdown($1,$2,25,null) value",[product,raw])).rows[0].value;
        expect(redacted.items).toEqual([]);expect(redacted).toMatchObject({source_subtotal:"10",visible_subtotal:"0",restricted_subtotal:"10",restricted_positive_quantity:"20",restricted_coverage_adjustment:"10"});
        expect(JSON.stringify(redacted)).not.toContain(f.work_order_id);expect(JSON.stringify(redacted)).not.toContain(r.project);
        await db.query("reset role");await db.query("delete from public.user_permissions where user_id=$1 and permission_definition_id in(select id from public.permission_definitions where key='inventory.customs.view')",[member.id]);
        await db.query("set local role authenticated");await expect(attempt("select public.get_inventory_unified_committed($1,$2)",[product,raw])).rejects.toMatchObject({code:"42501"});await db.query("reset role");
      });
      if(adminContext){
        const context=async(wo:string,after:string|null=null)=>(await db.query("select public.get_work_order_attribution_context($1,$2,20,$3) value",[wo,product,after])).rows[0].value;
        it("181 gives authenticated Admin exact current revisions, limits and active attribution",async()=>{
          const {f,r}=await coverageFixture();await cover(f,r,"4");await declare(f,"3");await db.query("set local role authenticated");const value=await context(f.work_order_id);await db.query("reset role");
          expect(parseAttributionContext(value,f.work_order_id,product)).not.toBeNull();
          expect(value).toMatchObject({state_id:f.id,material_version:f.version,required:"10",held:"10",uncovered:"0",coverage:"4",independent:"3",unknown:"3",max_independent:"6"});
          expect(value.requirements[0]).toMatchObject({id:r.id,quantity:"10",outstanding:"10",allocations:[{warehouse_id:raw,quantity:"4",max_quantity:"7"}]});
        });
        it("181 provides bounded, Product-matched requirement pages without mixing them",async()=>{
          const {f,r}=await coverageFixture();for(let i=0;i<20;i++){const parent=(await db.query("select public.create_project_product($1,$2) id",[r.project,`Owned page ${i}`])).rows[0].id;await db.query("select public.create_project_product_component($1,$2,1)",[parent,product]);}
          const first=await context(f.work_order_id),next=await context(f.work_order_id,first.next_after);expect(first.requirements).toHaveLength(20);expect(first.has_more).toBe(true);expect(next.requirements).toHaveLength(1);expect(next.has_more).toBe(false);
          expect(new Set([...first.requirements,...next.requirements].map(row=>row.id)).size).toBe(21);expect(parseAttributionContext(first,f.work_order_id,product)).not.toBeNull();expect(parseAttributionContext(next,f.work_order_id,product)).not.toBeNull();
        });
        it("181 preserves Unknown outstanding consumption and rejects untracked/unauthorized context",async()=>{
          const {f,r}=await coverageFixture();await db.query("insert into public.inventory_movements(product_id,warehouse_id,movement_type,quantity_delta,quantity_before,quantity_after,source_type,source_id,project_id,actor_user_id) values($1,$2,'remove',-1,10,9,'work_order',$3,$4,$5)",[product,raw,randomUUID(),r.project,actor.id]);
          const value=await context(f.work_order_id);expect(value.requirements[0]).toMatchObject({outstanding:null,allocations:[{max_quantity:"0"}]});expect(parseAttributionContext(value,f.work_order_id,product)).not.toBeNull();
          await db.query("select set_config('request.jwt.claim.sub',$1,true)",[member.auth_user_id]);await db.query("set local role authenticated");await expect(attempt("select public.get_work_order_attribution_context($1,$2)",[f.work_order_id,product])).rejects.toMatchObject({code:"42501"});await db.query("reset role");
          for(const role of ["anon","service_role"])expect((await db.query("select has_function_privilege($1,'public.get_work_order_attribution_context(uuid,uuid,integer,uuid)','EXECUTE') allowed",[role])).rows[0].allowed).toBe(false);
        });
      }
    }
    it("179 serializes competing Work Orders against one exact requirement and exact replay",async()=>{
      const {f,r}=await coverageFixture("10","20"),other=await fixture("10");await db.query("commit");committedFixture=true;
      const a=await pool.connect(),b=await pool.connect(),requests=[randomUUID(),randomUUID()];
      try{
        for(const c of [a,b])await c.query("select set_config('request.jwt.claim.sub',$1,false)",[actor.auth_user_id]);
        const outcomes=await Promise.allSettled([cover(f,r,"7",raw,null,requests[0],a),cover(other,r,"7",raw,null,requests[1],b)]);
        expect(outcomes.filter(o=>o.status==="fulfilled")).toHaveLength(1);expect(outcomes.find(o=>o.status==="rejected")).toMatchObject({reason:{code:"23514"}});
        const winner=(await a.query("select state_id,request_id from public.work_order_requirement_coverage_evidence where requirement_id=$1",[r.id])).rows[0];
        const owner=winner.state_id===f.id?f:other;
        expect(await Promise.all([a,b].map(c=>cover(owner,r,"7",raw,null,winner.request_id,c)))).toEqual([winner.request_id,winner.request_id]);
        expect((await a.query("select sum(quantity)::text q,count(*)::int n from public.work_order_requirement_coverage_current where requirement_id=$1",[r.id])).rows[0]).toEqual({q:"7",n:1});
      }finally{a.release(true);b.release(true);}
    });
  }
  it("serializes genuine concurrent declarations and exact retries without duplicate counting",async()=>{
    const f=await fixture();await db.query("commit");committedFixture=true;
    const a=await pool.connect(),b=await pool.connect();
    try{
      for(const c of [a,b])await c.query("select set_config('request.jwt.claim.sub',$1,false)",[actor.auth_user_id]);
      const requests=[randomUUID(),randomUUID()];
      const outcomes=await Promise.allSettled([a,b].map((c,i)=>c.query("select public.declare_work_order_material_independence($1,$2,$3,null,4) id",[requests[i],f.id,f.version])));
      expect(outcomes.filter(o=>o.status==="fulfilled")).toHaveLength(1);
      expect(outcomes.find(o=>o.status==="rejected")).toMatchObject({reason:{code:"WRA02"}});
      const winner=(await a.query("select request_id from public.work_order_requirement_attribution_evidence where state_id=$1",[f.id])).rows[0].request_id;
      const replay=await Promise.all([a,b].map(c=>c.query("select public.declare_work_order_material_independence($1,$2,$3,null,4) id",[winner,f.id,f.version])));
      expect(replay.map(r=>r.rows[0].id)).toEqual([winner,winner]);
      expect((await a.query("select count(*)::int n from public.work_order_requirement_attribution_evidence where state_id=$1",[f.id])).rows[0].n).toBe(1);
    }finally{a.release(true);b.release(true);}
  });
});
