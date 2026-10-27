// Opt-in LOCAL HTTP acceptance. NEVER run without separate explicit authorization.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVATION, ActivationRestResources, activationHttp, activationCatalog, assertActivationSecurity,
  checkedActivationSql, requireActivationAuthorization, waitForActivationClients, activationFailure, activationStep, rollbackActivationFailure, waitForActivationIdentity,
  type ActivationContext, type ActivationSide } from "./helpers/reservation-activation";
import { LOCAL_RESERVATION, ReservationLocalTarget, reservationSnapshot, runPinnedDocker, type LocalReservationPool } from "./helpers/reservation-local-target";
import { guardRollbackQueries } from "./helpers/rollback-query-guard";
import { createSupplierSourceFixture } from "./helpers/inventory-provenance";

// Inject the REAL SDK connected only to our isolated HTTP listener. No mocked
// response/SQL implementation: the optional response-loss seam consumes an actual
// committed HTTP response. Existing application services are imported unchanged.
const transport = vi.hoisted(() => ({ sdk: undefined as ReturnType<typeof activationHttp>["sdk"] | undefined }));
vi.mock("../../lib/supabase/client", () => ({ get supabase() {
  if (!transport.sdk) throw new Error("No authorized isolated HTTP client"); return transport.sdk;
} }));
import { reserveFinishedGoods, releaseFinishedGoods, fulfillFinishedGoods,
  type ReservationMutationResult, type ReservationRequest, type ReservationReceipt } from "../../features/projects/services/projectFinishedGoodsMutationService";
import { getProjectFinishedGoods } from "../../features/projects/services/projectFinishedGoodsService";

const enabled = process.env.FG_RESERVATION_ACTIVATION_LOCAL === "1";
const diagnostic = process.env.FG_RESERVATION_ACTIVATION_DIAGNOSTIC === "readiness-only";
const diagnosticTest = "diagnostic: pre-activation authenticated readiness only (no acceptance mutations)";
const sides: readonly ActivationSide[] = diagnostic ? ["pre"] : ["pre","post"];
const permissions = ["projects.view", "projects.edit", "inventory.finished_goods.view", "inventory.finished_goods.reserve"];
const fg = "10000000-0000-4000-8000-000000000002";
type Actor = { profileId: string; authUserId: string };
type Fixture = { product: string; project: string; group: string };
const operations = { reserve: reserveFinishedGoods, release: releaseFinishedGoods, fulfill: fulfillFinishedGoods };

describe.skipIf(!enabled)("Phase 3D3D genuine authenticated PostgREST activation (LOCAL owned clones)", () => {
  const target = new ReservationLocalTarget(), control = new AbortController();
  const resources = new ActivationRestResources(target,runPinnedDocker,diagnostic?"readiness-only":"acceptance");
  const pools = new Map<ActivationSide, LocalReservationPool>();
  const http = new Map<ActivationSide, ReturnType<typeof activationHttp>>();
  const created: ActivationSide[] = [];
  let source: LocalReservationPool | undefined, baseline: unknown, databaseBaseline: unknown;
  let actors: { admin: Actor; delegated: Actor };
  let interrupted = false;
  const interrupt = () => { interrupted = true; control.abort(); };
  function live() { if (control.signal.aborted) throw new Error("Activation run interrupted; no further fixture/mutation allowed"); }
  function pool(side: ActivationSide) {
    live(); target.assertOwnedClone(ACTIVATION[side].database, ACTIVATION[side].phase);
    const result = pools.get(side); if (!result) throw new Error("Unowned activation clone"); return result;
  }
  async function setupTransaction<T>(side: ActivationSide, action: (db: PoolClient) => Promise<T>) {
    const owner = pool(side), raw = await owner.connect();
    const transaction = guardRollbackQueries(raw, control.signal);
    try {
      await transaction.client.query("begin");
      const result = await action(transaction.client);
      live(); target.assertOwnedClone(owner.database, ACTIVATION[side].phase);
      await transaction.client.query("commit"); return result;
    } catch (error) { transaction.close(); return await rollbackActivationFailure(raw,{phase:"clone",operation:"fixture-transaction",side},error); }
    finally { transaction.close(); raw.release(true); }
  }
  async function sourceSnapshot() {
    if (!source) throw new Error("Source verification unavailable");
    const db = await source.connect();
    try {
      await db.query("begin isolation level repeatable read read only");
      const result = await reservationSnapshot(db, true);
      await db.query("commit"); return result;
    } finally { db.release(true); }
  }
  async function databaseInventory() {
    if (!source) throw new Error("Source inventory unavailable");
    return (await source.query("select datname,oid::text oid,datdba::text owner from pg_database order by datname")).rows;
  }
  async function migrate(side: ActivationSide) {
    const owner = pools.get(side)!;
    let db = await owner.connect();
    const sql = checkedActivationSql(), guarded = guardRollbackQueries(db, control.signal);
    try {
      await guarded.client.query("begin");
      for (let i=0;i<4;i++) {
        await activationStep({phase:"migration",operation:`apply-frozen-${143+i}`,side},async()=>{
          await guarded.client.query(sql[i]!);
          await guarded.client.query("insert into supabase_migrations.schema_migrations(version) values($1)", [`202610231${i}0000`]);
        });
      }
      live(); await guarded.client.query("commit");
      await target.acceptClonePhase(db, owner.database, 146);
    } catch (error) { guarded.close(); return await rollbackActivationFailure(db,{phase:"migration",operation:"143-through-146-transaction",side},error); }
    finally { guarded.close(); db.release(true); }
    db = await owner.connect();
    try {
      await activationStep({phase:"security",operation:"private-146-acl-inventory",side},()=>assertActivationSecurity(db,false));
      if (side === "post") {
        const before = await reservationSnapshot(db, true), catalog = await activationCatalog(db);
        const transaction = guardRollbackQueries(db, control.signal);
        try {
          await transaction.client.query("begin");
          await activationStep({phase:"migration",operation:"apply-frozen-147",side},()=>transaction.client.query(sql[4]!));
          await transaction.client.query("insert into supabase_migrations.schema_migrations(version) values('20261023140000')");
          live(); await transaction.client.query("commit");
        } catch (error) { transaction.close(); return await rollbackActivationFailure(db,{phase:"migration",operation:"147-transaction",side},error); }
        finally { transaction.close(); }
        await target.acceptClonePhase(db, owner.database, 147);
        await activationStep({phase:"security",operation:"activated-147-acl-inventory",side},()=>assertActivationSecurity(db,true));
        const after = await reservationSnapshot(db, true);
        const withoutExpected = (value: Record<string,unknown>) => Object.fromEntries(Object.entries(value)
          .filter(([key]) => key !== "security" && key !== "supabase_migrations.schema_migrations"));
        expect(withoutExpected(after)).toEqual(withoutExpected(before));
        expect(await activationCatalog(db)).toBe(catalog);
      }
    } finally { db.release(true); }
  }
  function use(side: ActivationSide) { live(); const client = http.get(side)!; transport.sdk=client.sdk; return client; }
  function token(actor: Actor = actors.admin, role: "authenticated" | "anon" | "service_role" = "authenticated") {
    return resources.token(role === "anon" ? null : actor.authUserId, role);
  }
  function request(f: Fixture, quantity=1n, patch: Partial<Omit<ReservationRequest,"operation">> = {}) {
    return { projectId: f.project, productId: f.product, quantity, reservationId: null, expectedVersion: 0n,
      requestId: randomUUID(), ...patch };
  }
  function receipt(result: ReservationMutationResult): ReservationReceipt {
    if (!result.ok) throw new Error(`Expected HTTP success, received ${result.error.code}`); return result.value;
  }
  async function fixture(side: ActivationSide = "post", physical = 10n): Promise<Fixture> {
    return setupTransaction(side, async db => {
      const product=randomUUID(), card=randomUUID(), project=randomUUID(), group=randomUUID();
      if (product === LOCAL_RESERVATION.residue) throw new Error("Retained residue is never a fixture");
      const serial=(await db.query(`select s::text serial from generate_series(8000000,8999999) s
        where not exists(select 1 from public.products where serial_number=s::text) order by s limit 1`)).rows[0]?.serial;
      if (!serial) throw new Error("No unique fixture serial");
      await db.query(`insert into public.products(id,serial_number,name,category,product_kind,created_by_user_id,updated_by_user_id)
        values($1,$2,$3,'PCB','pcb_finished_good',$4,$4)`, [product,serial,`Activation ${product}`,actors.admin.profileId]);
      await db.query(`insert into public.pcb_cards(id,name,output_product_id,created_by_user_id,updated_by_user_id)
        values($1,$2,$3,$4,$4)`,[card,`Activation ${card}`,product,actors.admin.profileId]);
      const supplier=await createSupplierSourceFixture(db,actors.admin,product);
      for (const q of [physical/2n,physical-physical/2n].filter(q=>q>0n)) {
        await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actors.admin.authUserId]);
        await db.query("set local role authenticated");
        await db.query("select * from public.adjust_inventory_warehouse($1,$2,'add',$3::bigint,'Local HTTP activation fixture',$4)",
          [product,fg,q.toString(),supplier.productSupplierId]); await db.query("reset role");
      }
      await db.query(`insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id)
        values($1,$2,'Local HTTP fixture','2026-10-23','2026-11-23',$3,$3)`,[project,`Activation ${project}`,actors.admin.profileId]);
      await db.query(`insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id)
        values($1,$2,'Explicit demand',$3,$3)`,[group,project,actors.admin.profileId]);
      await db.query(`insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id)
        values($1,$2,$3::bigint,$4,$4)`,[group,product,physical.toString(),actors.admin.profileId]);
      return { product,project,group };
    });
  }
  async function delegate(missing?: string, inactive=false, side:ActivationSide="post") {
    await setupTransaction(side,async db=>{
      await db.query("delete from public.user_permissions where user_id=$1",[actors.delegated.profileId]);
      await db.query(`insert into public.user_permissions(user_id,permission_definition_id,granted_by_user_id)
        select $1,id,$2 from public.permission_definitions where key=any($3::text[])`,
      [actors.delegated.profileId,actors.admin.profileId,permissions.filter(p=>p!==missing)]);
      await db.query("update public.user_profiles set is_active=$2 where id=$1",[actors.delegated.profileId,!inactive]);
    });
  }
  async function additionalDemand(f:Fixture,quantity:bigint) {
    return setupTransaction("post",async db=>{
      const project=randomUUID(),group=randomUUID();
      await db.query(`insert into public.projects(id,name,customer_name,start_date,delivery_date,created_by_user_id,updated_by_user_id)
        values($1,$2,'Local HTTP fixture','2026-10-23','2026-11-23',$3,$3)`,[project,`Other ${project}`,actors.admin.profileId]);
      await db.query(`insert into public.project_products(id,project_id,name,created_by_user_id,updated_by_user_id)
        values($1,$2,'Other explicit demand',$3,$3)`,[group,project,actors.admin.profileId]);
      await db.query(`insert into public.project_product_components(project_product_id,product_id,required_quantity,created_by_user_id,updated_by_user_id)
        values($1,$2,$3::bigint,$4,$4)`,[group,f.product,quantity.toString(),actors.admin.profileId]);
      return {...f,project,group};
    });
  }
  async function ledger(f: Fixture) {
    return (await pool("post").query(`select b.quantity::text physical,
      (select coalesce(sum(remaining_quantity),0)::text from public.inventory_source_lots where product_id=$1 and warehouse_id=$2) lots,
      (select coalesce(sum(reserved_quantity),0)::text from public.finished_goods_project_reservations where product_id=$1) reserved,
      (select count(*)::int from public.finished_goods_project_reservation_events where product_id=$1) events,
      (select count(*)::int from public.inventory_movements where product_id=$1 and source_type='finished_goods_reservation_fulfillment') movements,
      (select count(*)::int from public.audit_logs where entity_type='finished_goods_reservation'
        and entity_id in (select id from public.finished_goods_project_reservations where product_id=$1)) audits
      from public.inventory_balances b where b.product_id=$1 and b.warehouse_id=$2`,[f.product,fg])).rows[0];
  }
  async function context(f: Fixture) {
    use("post"); const result=await getProjectFinishedGoods(f.project,control.signal,token());
    if (!result.ok) throw new Error(`Authoritative HTTP read failed: ${result.error.code}`);
    const row=result.value.find(r=>r.productId===f.product); if (!row) throw new Error("Missing authoritative row"); return row;
  }
  beforeAll(async()=>{
    const setupTimeout=setTimeout(interrupt,170_000);
    process.once("SIGINT",interrupt); process.once("SIGTERM",interrupt);
    let stage: ActivationContext={phase:"preflight",operation:"authorization-and-frozen-sql"};
    try {
      requireActivationAuthorization(process.env); checkedActivationSql();
      stage={phase:"source",operation:"verify-identity-and-acquire-lease"};
      source=target.pool(); await target.acquire(source);
      stage={phase:"source",operation:"verify-no-unrecorded-reservation-schema"};
      const sourceContract=(await source.query(`select
        to_regclass('public.finished_goods_project_reservations') is null
        and to_regclass('public.finished_goods_project_reservation_events') is null
        and to_regprocedure('public.reserve_finished_goods_for_project(uuid,uuid,bigint,bigint,uuid)') is null
        and to_regprocedure('public.release_finished_goods_project_reservation(uuid,uuid,bigint,bigint,uuid)') is null
        and to_regprocedure('public.fulfill_finished_goods_project_reservation(uuid,uuid,uuid,bigint,bigint,uuid)') is null clean`)).rows[0];
      if(sourceContract?.clean!==true)throw new Error("Source has unrecorded reservation schema; stop without fixtures");
      stage={phase:"source",operation:"capture-data-security-sequences-and-database-inventory"};
      baseline=await sourceSnapshot(); databaseBaseline=await databaseInventory();
      // Record new OID ownership only after CREATE succeeds. No existing clones adopted.
      for (const side of sides) {
        stage={phase:"clone",operation:"create-new-owned-database",side};
        live(); await target.createTemporary(source,ACTIVATION[side].database); created.push(side);
        stage={phase:"clone",operation:"dump-and-restore-source-into-owned-clone",side};
        live(); target.copyIntoTemporary(ACTIVATION[side].database);
        stage={phase:"migration",operation:"migrate-and-verify-owned-clone",side};
        pools.set(side,target.pool(ACTIVATION[side].database)); await migrate(side);
      }
      stage={phase:"clone",operation:"select-existing-active-actors",side:diagnostic?"pre":"post"};
      const profiles=(await pool(diagnostic?"pre":"post").query(`select id,auth_user_id,is_admin from public.user_profiles
        where is_active and auth_user_id is not null order by id`)).rows;
      const admin=profiles.find(p=>p.is_admin), delegated=profiles.find(p=>!p.is_admin);
      if (!admin || !delegated) throw new Error("Existing local Admin/non-Admin fixtures required");
      actors={admin:{profileId:admin.id,authUserId:admin.auth_user_id},delegated:{profileId:delegated.id,authUserId:delegated.auth_user_id}};
      for(const side of sides){
        stage={phase:"http",operation:"create-owned-container",side};
        resources.create(side,control.signal);
      }
      stage={phase:"http",operation:"start-watchdog-and-stdin-configured-clients"};
      await resources.start(control.signal,interrupt);
      for (const side of sides) {
        stage={phase:"http",operation:"authenticated-identity-readiness",side};
        const client=activationHttp(side,control.signal); http.set(side,client);
        await waitForActivationIdentity(side,actors.admin.profileId,control.signal,
          signal=>client.sdk.rpc("current_active_user_profile_id").setHeader("Authorization",`Bearer ${token()}`).abortSignal(signal),
          ()=>resources.startupEvidence(side));
      }
    } catch(error) { interrupt(); throw activationFailure(stage,error); }
    finally { clearTimeout(setupTimeout); }
  },180_000);
  beforeEach(async context=>{
    if(diagnostic && context.task.name!==diagnosticTest)context.skip();
    live(); context.signal.addEventListener("abort",interrupt,{once:true});
    try { await target.assertQuiet(); live(); use(diagnostic?"pre":"post"); }
    catch { interrupt(); throw new Error("Local target is not quiet/verified; no further fixtures"); }
  });
  afterEach(async context=>{
    if(context.task.result?.state==="fail")interrupt();
    // Even failures must independently verify the protected source. Never repair.
    if(baseline)try{expect(await sourceSnapshot()).toEqual(baseline);}
      catch{interrupt();throw new Error("SOURCE PRESERVATION UNVERIFIED; no retry or repair");}
  });
  afterAll(async()=>{
    const failures:string[]=[];
    let httpCleanup;
    try { httpCleanup=await resources.close();
      if(httpCleanup.status!=="COMPLETE")failures.push(`HTTP cleanup ${httpCleanup.status}: ${httpCleanup.diagnostics.join("; ")}`);
      else if(httpCleanup.diagnostics.length)failures.push(`HTTP cleanup operation failed; independent outcome COMPLETE: ${httpCleanup.diagnostics.join("; ")}`);
    } catch(error) { failures.push(activationFailure({phase:"cleanup",operation:"http-cleanup-outcome-unverified"},error).message); }
    for(const [side,owner] of pools)try{await owner.end();}catch(error){failures.push(activationFailure({phase:"cleanup",operation:"owner-session-drain",side},error).message);}
    if(source && baseline)try{expect(await sourceSnapshot()).toEqual(baseline);}catch{failures.push("SOURCE PRESERVATION UNVERIFIED");}
    // Drop only positively owned clones; do not force or terminate unrelated clients.
    for(const side of created)try{
      await waitForActivationClients(target,source!,ACTIVATION[side].database);
      await target.dropTemporary(source!,ACTIVATION[side].database);
    }catch(error){failures.push(activationFailure({phase:"cleanup",operation:"drain-and-drop-owned-clone",side},error).message);}
    if(source && databaseBaseline)try{expect(await databaseInventory()).toEqual(databaseBaseline);}catch{failures.push("database inventory");}
    if(source && baseline)try{expect(await sourceSnapshot()).toEqual(baseline);}catch{failures.push("FINAL SOURCE PRESERVATION UNVERIFIED");}
    try{await target.release();if(source)await source.end();}catch{failures.push("control session closure");}
    process.removeListener("SIGINT",interrupt);process.removeListener("SIGTERM",interrupt);transport.sdk=undefined;
    if(failures.length)throw new Error(`Activation cleanup/restoration not complete: ${failures.join("; ")}`);
    console.info(`Activation cleanup independently verified COMPLETE: HTTP ownership inventory${databaseBaseline ? ", owned clone inventory" : ""}${baseline ? ", protected source data/security/sequences" : "; source baseline not captured"}`);
    if(interrupted)throw new Error("Activation run failed/interrupted; cleanup verification is not a runtime PASS");
  },180_000);

  it.skipIf(!diagnostic)(diagnosticTest,async()=>{
    expect(created).toEqual(["pre"]);
    expect(pools.has("post")).toBe(false);
    const pre=pool("pre"),db=await pre.connect();
    try{await assertActivationSecurity(db,false);}finally{db.release(true);}
    expect(http.get("pre")!.requests.every(r=>r.path==="/rpc/current_active_user_profile_id")).toBe(true);
    console.info(`Readiness-only probe verified; safe startup evidence: ${JSON.stringify(resources.startupEvidence("pre"))}`);
  });
  it("keeps exact pre-147 Admin/delegated mutation denial and separate post-147 security",async()=>{
    await delegate(undefined,false,"pre");
    const f=await fixture("pre");use("pre");
    for(const actor of [actors.admin,actors.delegated])for(const operation of ["reserve","release","fulfill"] as const){
      const result=await operations[operation](request(f,1n,operation==="reserve"?{}:{reservationId:randomUUID(),expectedVersion:1n}),token(actor));
      expect(result.ok).toBe(false);
      if(!result.ok)expect(["42501","PGRST202"]).toContain(result.error.code);
    }
    const pre=await pools.get("pre")!.connect(),post=await pool("post").connect();
    try{await assertActivationSecurity(pre,false);await assertActivationSecurity(post,true);}finally{pre.release(true);post.release(true);}
  });
  it("allows Admin partial/full reserve, release and fulfillment with authoritative current-state reads",async()=>{
    const f=await fixture(); const r=receipt(await reserveFinishedGoods(request(f,6n),token()));
    expect(await ledger(f)).toMatchObject({physical:"10",lots:"10",reserved:"6",events:1,movements:0,audits:1});
    receipt(await releaseFinishedGoods(request(f,2n,{reservationId:r.reservationId,expectedVersion:1n}),token()));
    receipt(await reserveFinishedGoods(request(f,2n,{reservationId:r.reservationId,expectedVersion:2n}),token()));
    const partial=receipt(await fulfillFinishedGoods(request(f,2n,{reservationId:r.reservationId,expectedVersion:3n}),token()));
    expect(partial.physicalQuantityAfter).toBe(8n);
    receipt(await fulfillFinishedGoods(request(f,4n,{reservationId:r.reservationId,expectedVersion:4n}),token()));
    expect(await ledger(f)).toMatchObject({physical:"4",lots:"4",reserved:"0",events:5,movements:2,audits:5});
    expect(await context(f)).toMatchObject({actualProjectConsumption:6n,outstandingDemand:4n,reservationVersion:5n,projectReservedQuantity:0n});
    // Retained zero state is not a missing version-zero reservation.
    receipt(await reserveFinishedGoods(request(f,4n,{reservationId:r.reservationId,expectedVersion:5n}),token()));
    receipt(await releaseFinishedGoods(request(f,4n,{reservationId:r.reservationId,expectedVersion:6n}),token()));
  });
  it("allows delegated Reserve/Release/Fulfill only with all four independent permissions",async()=>{
    await delegate();const f=await fixture();const r=receipt(await reserveFinishedGoods(request(f,3n),token(actors.delegated)));
    receipt(await releaseFinishedGoods(request(f,1n,{reservationId:r.reservationId,expectedVersion:1n}),token(actors.delegated)));
    receipt(await fulfillFinishedGoods(request(f,2n,{reservationId:r.reservationId,expectedVersion:2n}),token(actors.delegated)));
    expect(await ledger(f)).toMatchObject({physical:"8",reserved:"0",movements:1,events:3});
  });
  it.each(permissions)("denies all wrappers when delegated caller lacks %s",async missing=>{
    const f=await fixture(),r=receipt(await reserveFinishedGoods(request(f,3n),token()));await delegate(missing);
    const before=await ledger(f);
    for(const operation of ["reserve","release","fulfill"] as const)
      expect(await operations[operation](request(f,1n,{reservationId:r.reservationId,expectedVersion:1n}),token(actors.delegated)))
        .toMatchObject({ok:false,error:{code:"42501",uncertain:false}});
    expect(await ledger(f)).toEqual(before);
  });
  it("denies inactive, anonymous and expired-token requests without changing state",async()=>{
    await delegate(undefined,true);const f=await fixture(),r=receipt(await reserveFinishedGoods(request(f,3n),token())),before=await ledger(f);
    for(const operation of ["reserve","release","fulfill"] as const)
      expect(await operations[operation](request(f,1n,{reservationId:r.reservationId,expectedVersion:1n}),token(actors.delegated)))
        .toMatchObject({ok:false,error:{code:"42501"}});
    for(const jwt of [token(actors.admin,"anon"),resources.token(actors.admin.authUserId,"authenticated",true)]){
      const result=await use("post").sdk.rpc("reserve_finished_goods_for_project",{p_project_id:f.project,p_product_id:f.product,
        p_quantity:"1",p_expected_version:"0",p_request_id:randomUUID()}).setHeader("Authorization",`Bearer ${jwt}`);
      expect(result.error).not.toBeNull();expect([401,403,404]).toContain(result.status);
    }
    const anonymous=await use("post").sdk.rpc("reserve_finished_goods_for_project",{p_project_id:f.project,p_product_id:f.product,
      p_quantity:"1",p_expected_version:"1",p_request_id:randomUUID()}).setHeader("Authorization","");
    expect(anonymous.error).not.toBeNull();expect([401,403,404]).toContain(anonymous.status);
    expect(await ledger(f)).toEqual(before);
  });
  it("denies private helper invocation and direct table writes even to Admin/service JWTs",async()=>{
    const sdk=use("post").sdk;
    for(const jwt of [token(),token(actors.admin,"anon"),token(actors.admin,"service_role")]){
      for(const table of ["finished_goods_project_reservations","finished_goods_project_reservation_events"])
        for(const query of [sdk.from(table).insert({}),sdk.from(table).select("*")])
          expect((await query.setHeader("Authorization",`Bearer ${jwt}`)).error).not.toBeNull();
      const result=await sdk.rpc("change_finished_goods_project_reservation",{p_project_id:randomUUID(),p_product_id:randomUUID(),
        p_quantity:"1",p_expected_version:"0",p_request_id:randomUUID(),p_release:false}).setHeader("Authorization",`Bearer ${jwt}`);
      expect(result.error).not.toBeNull();expect(["42501","PGRST202"]).toContain(result.error?.code);
    }
  });
  it("preserves original-author ownership and immutable UUID payload across exact and conflicting retries",async()=>{
    await delegate();const f=await fixture(),q=request(f,4n),r=receipt(await reserveFinishedGoods(q,token(actors.delegated)));
    const before=await ledger(f);expect(await reserveFinishedGoods(q,token(actors.delegated))).toEqual({ok:true,value:r});
    expect(await reserveFinishedGoods(q,token())).toMatchObject({ok:false,error:{code:"42501"}});
    expect(await reserveFinishedGoods({...q,quantity:3n},token(actors.delegated))).toMatchObject({ok:false,error:{code:"FGR01"}});
    expect(await releaseFinishedGoods({...q,reservationId:r.reservationId,expectedVersion:1n},token(actors.delegated)))
      .toMatchObject({ok:false,error:{code:"FGR01"}});
    expect(await ledger(f)).toEqual(before);
    const observed=http.get("post")!.requests.filter(r=>r.path==="/rpc/reserve_finished_goods_for_project").slice(-4);
    expect(observed.every(r=>(r.payload as {p_request_id:string}).p_request_id===q.requestId)).toBe(true);
  });
  it.each(["reserve","release","fulfill"] as const)("keeps %s receipt replay exclusive to its original author, including against Admin",async operation=>{
    await delegate();const f=await fixture();
    const state=operation==="reserve"?null:receipt(await reserveFinishedGoods(request(f,4n),token(actors.delegated)));
    const q=request(f,1n,state?{reservationId:state.reservationId,expectedVersion:1n}:{});
    const first=await operations[operation](q,token(actors.delegated));receipt(first);
    const before=await ledger(f);
    expect(await operations[operation](q,token())).toMatchObject({ok:false,error:{code:"42501"}});
    expect(await operations[operation]({...q,quantity:2n},token(actors.delegated))).toMatchObject({ok:false,error:{code:"FGR01"}});
    expect(await operations[operation](q,token(actors.delegated))).toEqual(first);
    expect(await ledger(f)).toEqual(before);
  });
  it("rejects stale versions, foreign reservation identities and over-demand/over-stock without partial history",async()=>{
    const f=await fixture(),other=await fixture(),r=receipt(await reserveFinishedGoods(request(f,8n),token())),before=await ledger(f);
    expect(await reserveFinishedGoods(request(f,1n),token())).toMatchObject({ok:false,error:{code:"FGR04"}});
    expect(await reserveFinishedGoods(request(f,3n,{reservationId:r.reservationId,expectedVersion:1n}),token())).toMatchObject({ok:false,error:{code:"FGR06"}});
    expect(await fulfillFinishedGoods(request(other,1n,{reservationId:r.reservationId,expectedVersion:1n}),token())).toMatchObject({ok:false,error:{code:"P0002"}});
    const competing=await additionalDemand(f,10n);
    expect(await reserveFinishedGoods(request(competing,3n),token())).toMatchObject({ok:false,error:{code:"FGR07"}});
    expect(await ledger(f)).toEqual(before);
  });
  it("protects reserved stock from genuine adjustment HTTP calls and preserves FG-only FIFO provenance/audit attribution",async()=>{
    const f=await fixture(),r=receipt(await reserveFinishedGoods(request(f,6n),token())),before=await ledger(f);
    const debit=await use("post").sdk.rpc("adjust_inventory_warehouse",{p_product_id:f.product,p_warehouse_id:fg,
      p_adjustment_type:"remove",p_quantity:"5",p_reason:"Denied isolated HTTP proof",p_product_supplier_id:null})
      .setHeader("Authorization",`Bearer ${token()}`);
    expect(debit.error?.code).toBe("IVB02");expect(await ledger(f)).toEqual(before);
    const result=receipt(await fulfillFinishedGoods(request(f,6n,{reservationId:r.reservationId,expectedVersion:1n}),token()));
    const allocations=(await pool("post").query(`select a.source_lot_id,a.allocated_quantity::text quantity,a.warehouse_id,
      l.catalog_number_snapshot from public.inventory_source_allocations a join public.inventory_source_lots l on l.id=a.source_lot_id
      where a.outbound_inventory_movement_id=$1 order by l.received_at,l.id`,[result.movementId])).rows;
    expect(allocations.map(a=>a.quantity)).toEqual(["5","1"]);
    expect(allocations.every(a=>a.warehouse_id===fg && typeof a.catalog_number_snapshot==="string")).toBe(true);
    const event=(await pool("post").query(`select e.request_id,e.actor_user_id,e.inventory_movement_id,
      m.source_type,m.source_id,m.project_id,m.product_id,m.quantity_delta::text quantity
      from public.finished_goods_project_reservation_events e join public.inventory_movements m on m.id=e.inventory_movement_id
      where e.id=$1`,[result.eventId])).rows[0];
    expect(event).toMatchObject({actor_user_id:actors.admin.profileId,inventory_movement_id:result.movementId,
      source_type:"finished_goods_reservation_fulfillment",source_id:result.eventId,project_id:f.project,product_id:f.product,quantity:"-6"});
    const audit=(await pool("post").query(`select actor_user_id,action_type from public.audit_logs
      where entity_id=$1 and action_type='finished_goods_reservation.fulfilled'`,[r.reservationId])).rows;
    expect(audit).toEqual([{actor_user_id:actors.admin.profileId,action_type:"finished_goods_reservation.fulfilled"}]);
  });
  it("serializes real simultaneous HTTP reservations across Projects without over-reservation",async()=>{
    const f=await fixture(),other=await additionalDemand(f,10n);
    const results=await Promise.all([reserveFinishedGoods(request(f,6n),token()),reserveFinishedGoods(request(other,6n),token())]);
    expect(results.filter(r=>r.ok)).toHaveLength(1);
    expect(results.find(r=>!r.ok)).toMatchObject({ok:false,error:{code:"FGR07"}});
    expect(await ledger(f)).toMatchObject({physical:"10",reserved:"6",events:1,movements:0,audits:1});
  });
  it("coalesces simultaneous identical HTTP submissions into one committed immutable receipt",async()=>{
    const f=await fixture(),q=request(f,3n),results=await Promise.all([reserveFinishedGoods(q,token()),reserveFinishedGoods(q,token())]);
    expect(results[0]?.ok).toBe(true);expect(results[1]).toEqual(results[0]);
    expect(await ledger(f)).toMatchObject({physical:"10",reserved:"3",events:1,movements:0,audits:1});
  });
  it.each(["drop","malformed"] as const)("reconciles %s response after actual commit without a duplicate effect",async mode=>{
    const f=await fixture(),r=receipt(await reserveFinishedGoods(request(f,5n),token()));
    const q=request(f,2n,{reservationId:r.reservationId,expectedVersion:1n});http.get("post")!.loseNextSuccess(mode);
    expect(await fulfillFinishedGoods(q,token())).toMatchObject({ok:false,error:{uncertain:true}});
    const committed=await ledger(f);expect(committed).toMatchObject({physical:"8",reserved:"3",movements:1,events:2,audits:2});
    const replay=receipt(await fulfillFinishedGoods(q,token()));
    expect(replay.physicalQuantityAfter).toBe(8n);expect(await ledger(f)).toEqual(committed);
    receipt(await fulfillFinishedGoods(request(f,1n,{reservationId:r.reservationId,expectedVersion:2n}),token()));
    expect(receipt(await fulfillFinishedGoods(q,token()))).toEqual(replay);
    expect(await context(f)).toMatchObject({physicalQuantity:7n,projectReservedQuantity:2n,reservationVersion:3n});
  });
  it("preserves bigint HTTP payloads and receipt/context precision beyond Number.MAX_SAFE_INTEGER",async()=>{
    const quantity=9007199254740993n,f=await fixture("post",quantity),q=request(f,quantity);
    const r=receipt(await reserveFinishedGoods(q,token()));expect(r.reservedQuantity).toBe(quantity);
    expect(await context(f)).toMatchObject({physicalQuantity:quantity,plannedRequirement:quantity,projectReservedQuantity:quantity});
    const payload=[...http.get("post")!.requests].reverse().find(item=>(item.payload as {p_request_id?:string}|null)?.p_request_id===q.requestId)?.payload;
    expect(payload).toMatchObject({p_quantity:quantity.toString(),p_expected_version:"0",p_request_id:q.requestId});
    // A huge stale version is transported exactly, not mistaken for permission to
    // fabricate historical versions. Valid database constraints remain authoritative.
    const stale={...q,quantity:1n,reservationId:r.reservationId,expectedVersion:9007199254740993n,requestId:randomUUID()};
    expect(await releaseFinishedGoods(stale,token()))
      .toMatchObject({ok:false,error:{code:"FGR04"}});
    expect(http.get("post")!.requests.find(item=>(item.payload as {p_request_id?:string}|null)?.p_request_id===stale.requestId)?.payload)
      .toMatchObject({p_expected_version:"9007199254740993"});
    receipt(await releaseFinishedGoods(request(f,quantity,{reservationId:r.reservationId,expectedVersion:1n}),token()));
  });
});
