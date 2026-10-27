import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const external=vi.hoisted(()=>({run:vi.fn(),spawn:vi.fn(),pool:vi.fn()}));
vi.mock("node:child_process",()=>({default:{execFileSync:external.run,spawn:external.spawn},execFileSync:external.run,spawn:external.spawn}));
vi.mock("pg",()=>({default:{Pool:external.pool},Pool:external.pool}));
import { LOCAL_RESERVATION, type ReservationLocalTarget } from "./backend/helpers/reservation-local-target";
import { ACTIVATION, ActivationRestResources, activationHttp, activationUrl, cloneDatabaseUri, routeActivationUrl,
  assertRestOwnership, assertActivationSecurity, activationCatalog, checkedActivationSql, requireActivationAuthorization,
  restWatchdogSource, waitForActivationClients, activationStdinConfig, activationFailure, activationStep, cleanupVerdict, rollbackActivationFailure,
  ActivationStartupEvidence, waitForActivationIdentity,
  type ActivationSide, type RestMetadata } from "./backend/helpers/reservation-activation";

const application=`alfaev_fg_${"a".repeat(32)}`,localUri="postgresql://authenticator:synthetic-unit-only@supabase_db_internal-tool:5432/postgres";
const subject="00000000-0000-4000-8000-000000000001";
function memory(mode:"acceptance"|"readiness-only"="acceptance") {
  const rows=new Map<string,RestMetadata>(),calls:{args:string[];input?:Buffer}[]=[];
  const target={application,verifyDocker:vi.fn(),assertOwnedClone:vi.fn((name:string,phase?:number)=>{
    if(!Object.values(ACTIVATION).some(v=>typeof v==="object" && "database" in v && v.database===name && (phase===undefined || v.phase===phase)))throw new Error("Wrong phase");
  })} as unknown as ReservationLocalTarget;
  const existing:RestMetadata={Id:ACTIVATION.existingRestId,Name:"/supabase_rest_internal-tool",Image:ACTIVATION.image,
    State:{Running:true},Config:{Env:[`PGRST_DB_URI=${localUri}`],Labels:{"com.supabase.cli.project":"internal-tool"}},
    Mounts:[],HostConfig:{PortBindings:{},NetworkMode:ACTIVATION.network},
    NetworkSettings:{Networks:{[ACTIVATION.network]:{NetworkID:ACTIVATION.networkId}},Ports:{}}};
  rows.set(ACTIVATION.existingRestId,existing);
  const command=vi.fn((args:string[],input?:Buffer)=>{
    calls.push({args:[...args],input:input?Buffer.from(input):undefined});
    if(args[0]!=="--host"||args[1]!==`unix://${LOCAL_RESERVATION.socket}`)throw new Error("Wrong Docker socket");
    if(args[2]==="network")return Buffer.from(JSON.stringify({Id:ACTIVATION.networkId,Name:ACTIVATION.network}));
    if(args[2]==="image")return Buffer.from(ACTIVATION.image);
    if(args[2]==="inspect") {const row=rows.get(args[3]!);if(!row)throw new Error("Missing synthetic container");return Buffer.from(JSON.stringify(row));}
    if(args[2]==="ps") return Buffer.from([...rows.values()].map(r=>JSON.stringify({ID:r.Id,Names:r.Name.slice(1)})).join("\n"));
    if(args[2]==="create"){
      const name=args[args.indexOf("--name")+1],side=name===ACTIVATION.pre.name?"pre":"post",config=ACTIVATION[side];
      if([...rows.values()].some(row=>row.Name===`/${name}`))throw new Error("Synthetic name collision");
      const id=(side==="pre"?"1":"2").repeat(64);
      rows.set(id,{Id:id,Name:`/${name}`,Image:ACTIVATION.image,State:{Running:false},
        Config:{Env:[],Cmd:["postgrest","/dev/stdin"],OpenStdin:true,Tty:false,
          Labels:{"alfaev.fg-activation.run":args[args.indexOf("--label")+1]!.split("=")[1]!}},
        Mounts:[],HostConfig:{NetworkMode:ACTIVATION.network,PortBindings:{"3000/tcp":[{HostIp:"127.0.0.1",HostPort:String(config.port)}]}},
        NetworkSettings:{Networks:{[ACTIVATION.network]:{NetworkID:ACTIVATION.networkId}},Ports:{"3000/tcp":null}}});
      return Buffer.from(id);
    }
    const id=args[args.length-1]!,row=rows.get(id);
    if(!row)throw new Error("Unowned synthetic container");
    if(args[2]==="start"){row.State.Running=true;row.NetworkSettings.Ports=row.HostConfig.PortBindings;return Buffer.from(id);}
    if(args[2]==="stop"){row.State.Running=false;row.NetworkSettings.Ports={"3000/tcp":null};return Buffer.from(id);}
    if(args[2]==="rm"){if(row.State.Running)throw new Error("Still running");rows.delete(id);return Buffer.from(id);}
    throw new Error("Unexpected mock command");
  });
  return {rows,calls,command,target,existing,resources:new ActivationRestResources(target,command,mode)};
}
function watchdog(m?:ReturnType<typeof memory>) {
  const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});
  child.stdin.once("finish",()=>queueMicrotask(()=>child.emit("close",0)));
  const configs:Buffer[]=[];
  const attachments:EventEmitter[]=[];
  external.spawn.mockImplementation((binary:string,args:string[])=>{
    if(binary===process.execPath){queueMicrotask(()=>child.stdout.write("ready\n"));return child;}
    const attached=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});
    attachments.push(attached);
    const chunks:Buffer[]=[];
    attached.stdin.on("data",data=>chunks.push(Buffer.from(data)));
    attached.stdin.on("finish",()=>configs.push(Buffer.concat(chunks)));
    const row=m!.rows.get(args[args.length-1]!)!;
    row.State.Running=true;row.NetworkSettings.Ports=row.HostConfig.PortBindings;
    return attached;
  });
  // Simulate docker stop closing the attached client, without a real process.
  if(m){const original=m.command.getMockImplementation()!;
    m.command.mockImplementation((args,input)=>{
      const result=original(args,input);
      if(args[2]==="stop")for(const attached of attachments)queueMicrotask(()=>attached.emit("close",0));
      return result;
    });}
  return {child,configs,attachments};
}
beforeEach(()=>{
  external.run.mockReset().mockImplementation(()=>{throw new Error("REAL DOCKER FORBIDDEN");});
  external.pool.mockReset().mockImplementation(()=>{throw new Error("REAL DATABASE FORBIDDEN");});
  external.spawn.mockReset().mockImplementation(()=>{throw new Error("REAL PROCESS FORBIDDEN");});
  vi.stubGlobal("fetch",vi.fn(()=>{throw new Error("REAL HTTP FORBIDDEN");}));
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

describe("activation preparation — connection-free pins and authorization",()=>{
  it("requires a separate opt-in and refuses ambient PostgreSQL/Docker/remote configuration",()=>{
    const approved={FG_RESERVATION_ACTIVATION_LOCAL:"1",FG_RESERVATION_ACTIVATION_APPROVAL:"isolated-clones-only"};
    expect(()=>requireActivationAuthorization({})).toThrow("Separate");
    requireActivationAuthorization(approved);
    for(const key of ["PGHOST","PGPASSWORD","DATABASE_URL","SUPABASE_DB_URL","LOCAL_SUPABASE_DB_PASSWORD","DOCKER_HOST","DOCKER_CONTEXT"])
      expect(()=>requireActivationAuthorization({...approved,[key]:"synthetic"})).toThrow("Ambient");
    expect(external.run).not.toHaveBeenCalled();expect(external.pool).not.toHaveBeenCalled();
    requireActivationAuthorization({...approved,FG_RESERVATION_ACTIVATION_DIAGNOSTIC:"readiness-only"});
    expect(()=>requireActivationAuthorization({...approved,FG_RESERVATION_ACTIVATION_DIAGNOSTIC:"anything-else"})).toThrow("diagnostic mode");
  });
  it("pins all five frozen migrations before any resource creation",()=>{
    const sql=checkedActivationSql();expect(sql).toHaveLength(5);
    expect(sql[4]).toContain("grant execute on function public.reserve_finished_goods_for_project");
    expect(external.run).not.toHaveBeenCalled();
  });
  it.each(["postgresql://authenticator:mock@remote.invalid/postgres","postgresql://postgres:mock@supabase_db_internal-tool/postgres",
    "postgresql://authenticator@supabase_db_internal-tool/postgres","postgresql://authenticator:mock@supabase_db_internal-tool/other",
    "postgresql://authenticator:mock@supabase_db_internal-tool:7777/postgres",localUri+"?host=remote.invalid","not a URI"])("rejects an unverified authenticator source %s",uri=>{
    expect(()=>cloneDatabaseUri(uri,ACTIVATION.pre.database,application)).toThrow();
  });
  it("retains encoded local authentication only in memory and reconstructs the exact clone URI",()=>{
    const uri=new URL(cloneDatabaseUri(localUri+"?sslmode=disable",ACTIVATION.pre.database,application));
    expect(uri.hostname).toBe(LOCAL_RESERVATION.container);expect(uri.pathname).toBe(`/${ACTIVATION.pre.database}`);
    expect(uri.searchParams.has("host")).toBe(false);expect(uri.searchParams.get("application_name")).toBe(application);
    expect(()=>cloneDatabaseUri(localUri,"postgres",application)).toThrow("clone target");
    expect(()=>cloneDatabaseUri(localUri,ACTIVATION.pre.database,"unsafe")).toThrow();
  });
  it("serializes startup options for libpq percent decoding, NOT WHATWG form decoding",()=>{
    const expected="-c statement_timeout=15000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=15000";
    const uri=cloneDatabaseUri(localUri,ACTIVATION.pre.database,application);
    const raw=new URL(uri).search.slice(1).split("&").find(p=>p.startsWith("options="))!.slice("options=".length);
    // libpq conninfo_uri_decode preserves + and only decodes %XX.
    expect(decodeURIComponent(raw)).toBe(expected);expect(raw).not.toContain("+");expect(raw).toContain("%20");
    const obsolete=new URLSearchParams({options:expected}).toString().slice("options=".length);
    expect(decodeURIComponent(obsolete)).not.toBe(expected);
    expect(decodeURIComponent(obsolete)).toContain("-c+statement_timeout=");
    expect(new URL(uri).searchParams.get("options")).toBe(expected);
  });
  it.each(["synthetic+only","synthetic%2Bonly","synthetic%20only","synthetic%2520only","synthetic$only"])(
    "encoding correction preserves password bytes for %s",password=>{
      const original=localUri.replace("synthetic-unit-only",password);
      const cloned=cloneDatabaseUri(original,ACTIVATION.pre.database,application);
      expect(decodeURIComponent(new URL(cloned).password)).toBe(decodeURIComponent(new URL(original).password));
    });
});

describe("bounded redacted PostgREST startup observations",()=>{
  it("distinguishes connection, cache, authentication, target, permission and configuration evidence without text leakage",()=>{
    const evidence=new ActivationStartupEvidence();
    const lines=[
      '22/Oct/2026:01:02:03 +0000: Failed to query the PostgreSQL version. {"code":"PGRST000","message":"FATAL: unrecognized configuration parameter: +statement_timeout; password synthetic-hidden"}',
      '22/Oct/2026:01:02:03 +0000: Failed to load the schema cache using db-schemas=public. {"code":"42501","message":"permission denied: Bearer synthetic.jwt.value"}',
      'FATAL: password authentication failed for user synthetic-user',
      'FATAL: database synthetic-db does not exist',
      'could not translate host name synthetic-host',
      'Connection refused at synthetic-host',
      'Successfully connected to PostgreSQL 17.6',
      'Schema cache loaded in 12 milliseconds',
    ].join("\n")+"\n";
    for(let i=0;i<lines.length;i+=13)evidence.feed(Buffer.from(lines.slice(i,i+13)));
    const summary=evidence.snapshot();
    expect(summary.connected).toBe(true);expect(summary.cacheLoaded).toBe(true);
    expect(summary.categories).toEqual(["configuration","database-authentication","database-dns","database-permission",
      "database-target","database-transport","database-version-query","schema-cache-query"]);
    expect(summary.codes).toEqual(["42501","PGRST000"]);
    expect(JSON.stringify(summary)).not.toContain("synthetic");expect(JSON.stringify(evidence)).toBe("{}");
  });
  it("drops malformed/unknown/oversized logs, including secret-bearing config excerpts",()=>{
    const evidence=new ActivationStartupEvidence();
    evidence.feed('Error in config db-uri="postgresql://a:synthetic-hidden@host" jwt-secret=synthetic-jwt\n');
    evidence.feed('{"code":"synthetic-hidden","details":"secret"}\n');
    evidence.feed('{malformed\n');
    evidence.feed("x".repeat(20000));evidence.feed("secret\nSchema cache loaded in 1 milliseconds\n");
    expect(evidence.snapshot()).toMatchObject({truncated:true,cacheLoaded:true,categories:["configuration"],codes:[]});
    evidence.feed("x".repeat(262145));evidence.end();
    expect(JSON.stringify(evidence.snapshot())).not.toContain("secret");expect(JSON.stringify(evidence)).toBe("{}");
  });
});

describe("schema-cache-aware authenticated readiness (mock responses only)",()=>{
  it("allows a slow cache initialization beyond the obsolete six-second window",async()=>{
    let time=0;const observations=new ActivationStartupEvidence();
    const read=vi.fn(async()=>{time+=4000;return time<12000?
      {data:null,error:{code:"PGRST002",message:"hidden"},status:503}:
      {data:subject,error:null,status:200};});
    await waitForActivationIdentity("pre",subject,new AbortController().signal,read,()=>observations.snapshot(),()=>time,async()=>{time+=200;});
    expect(read).toHaveBeenCalledTimes(3);expect(time).toBeGreaterThan(6000);
  });
  it("reports status, bounded attempts and safe startup evidence at the deadline",async()=>{
    let time=0;const observations=new ActivationStartupEvidence();
    observations.feed('Failed to query the PostgreSQL version. {"code":"PGRST000","message":"unrecognized configuration parameter synthetic-private"}\n');
    const read=vi.fn(async()=>({data:null,error:{code:"PGRST002",message:"password synthetic-private"},status:503}));
    const failure=await waitForActivationIdentity("pre",subject,new AbortController().signal,read,()=>observations.snapshot(),
      ()=>time,async()=>{time+=10000;}).catch(e=>e as Error);
    if(!(failure instanceof Error))throw new Error("Readiness unexpectedly succeeded");
    expect(failure.message).toContain("code=PGRST002");expect(failure.message).toContain("http_status=503");
    expect(failure.message).toContain('"configuration"');expect(failure.message).toContain('"PGRST000"');
    expect(failure.message).not.toContain("synthetic-private");expect(read).toHaveBeenCalledTimes(3);
  });
  it("never accepts wrong identity or evidence arriving after the hard deadline",async()=>{
    for(const late of [false,true]){
      let time=0;
      const read=vi.fn(async()=>{time=late?30001:time;return {data:late?subject:"foreign-profile",error:null,status:200};});
      await expect(waitForActivationIdentity("pre",subject,new AbortController().signal,read,
        ()=>new ActivationStartupEvidence().snapshot(),()=>time,async()=>{time+=30001;})).rejects.toThrow("authenticated-identity-readiness");
    }
  });
  it.each([401,403,503,undefined])("requires genuine HTTP 200 identity success, not status %s",async status=>{
    let time=0;
    const read=vi.fn(async()=>({data:subject,error:null,status}));
    await expect(waitForActivationIdentity("pre",subject,new AbortController().signal,read,
      ()=>new ActivationStartupEvidence().snapshot(),()=>time,async()=>{time+=30001;})).rejects.toThrow("authenticated-identity-readiness");
  });
  it("does not read after interruption or fall back to another endpoint",async()=>{
    const signal=new AbortController();signal.abort();const read=vi.fn();
    await expect(waitForActivationIdentity("pre",subject,signal.signal,read,()=>new ActivationStartupEvidence().snapshot())).rejects.toThrow("category=interrupted");
    expect(read).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();expect(external.pool).not.toHaveBeenCalled();
  });
});

describe("redacted phase diagnostics (no raw cause retention)",()=>{
  it("retains phase/resource/guard or safe SQLSTATE without messages, stderr, JWTs or URI secrets",async()=>{
    const secret="synthetic-private-value",jwt="eyJ.synthetic.token";
    const raw=Object.assign(new Error(`postgresql://authenticator:${secret}@host/db Bearer ${jwt}`),{
      code:"42703",stderr:Buffer.from(secret),query:secret,environment:{PASSWORD:secret}});
    const failure=activationFailure({phase:"migration",operation:"apply-frozen-143",side:"pre"},raw);
    expect(failure.message).toContain("phase=migration; operation=apply-frozen-143");
    expect(failure.message).toContain(ACTIVATION.pre.database);expect(failure.message).toContain("code=42703");
    expect(JSON.stringify(failure)).not.toContain(secret);expect(String(failure)).not.toContain(jwt);
    expect("cause" in failure).toBe(false);expect(failure.stack).not.toContain(secret);
    const guard=activationFailure({phase:"security",operation:"private-146-acl-inventory",side:"post"},
      new Error("Unexpected trusted-function security inventory"));
    expect(guard.message).toContain("guard=trusted-function-inventory");
    expect(activationFailure({phase:"source",operation:"connect"},Object.assign(raw,{code:secret})).message).toContain("code=unavailable");
    const docker=activationFailure({phase:"clone",operation:"dump-and-restore",side:"pre"},
      new Error("Pinned local Docker command failed (status 1, signal none); outcome unverified"));
    expect(docker.message).toContain("code=DOCKER_EXIT_1_none");
    await expect(activationStep({phase:"clone",operation:"copy",side:"pre"},()=>{throw raw;})).rejects.toThrow("phase=clone");
  });
  it("does not run later setup/acceptance steps after a failed guard",async()=>{
    const create=vi.fn(),acceptance=vi.fn();
    const setup=async()=>{
      await activationStep({phase:"source",operation:"verify-identity"},()=>{throw new Error("untrusted secret text");});
      create(); acceptance();
    };
    await expect(setup()).rejects.toThrow("phase=source; operation=verify-identity");
    expect(create).not.toHaveBeenCalled();expect(acceptance).not.toHaveBeenCalled();
    const m=memory();expect(await m.resources.close()).toEqual({status:"COMPLETE",diagnostics:[]});
    expect(m.command).not.toHaveBeenCalled();
  });
  it("the actual runner wires diagnostics before fixtures and never converts an interrupted setup to PASS",()=>{
    const source=readFileSync("test/backend/finished-goods-reservation-activation.backend.ts","utf8");
    expect(source).not.toContain("guard/transport");
    expect(source).toContain("throw activationFailure(stage,error)");
    expect(source.indexOf('operation:"create-new-owned-database"')).toBeLessThan(source.indexOf("await target.createTemporary"));
    expect(source).toContain('if(interrupted)throw new Error("Activation run failed/interrupted');
    expect(source).toContain('HTTP cleanup operation failed; independent outcome COMPLETE');
    expect(source).toContain("return await rollbackActivationFailure");
    expect(source).toContain('const sides: readonly ActivationSide[] = diagnostic ? ["pre"] : ["pre","post"]');
    expect(source).toContain('if(diagnostic && context.task.name!==diagnosticTest)context.skip()');
    expect(source).toContain('pool(diagnostic?"pre":"post")');
    expect(source).toContain('r.path==="/rpc/current_active_user_profile_id"');
  });
  it("preserves the original inner step identity, not an arbitrary raw error object",async()=>{
    const inner=activationFailure({phase:"security",operation:"wrapper-acl",side:"post"},new Error("hidden"));
    expect(activationFailure({phase:"http",operation:"outer"},inner)).toBe(inner);
  });
  it("keeps the original setup failure when transaction rollback also fails",async()=>{
    const db={query:vi.fn().mockRejectedValue(Object.assign(new Error("sensitive rollback detail"),{code:"ECONNRESET"}))};
    const original=Object.assign(new Error("sensitive SQL detail"),{code:"42703"});
    const failure=await rollbackActivationFailure(db as never,{phase:"migration",operation:"apply-frozen-143",side:"pre"},original).catch(e=>e as Error);
    expect(failure.message).toContain("operation=apply-frozen-143");expect(failure.message).toContain("code=42703");
    expect(failure.message).toContain("rollback-status=UNVERIFIED");expect(failure.message).toContain("code=ECONNRESET");
    expect(failure.message).not.toContain("sensitive");expect(db.query).toHaveBeenCalledExactlyOnceWith("rollback");
  });
  it("quotes configuration as data and prevents configurator interpolation",()=>{
    const uri=cloneDatabaseUri(localUri.replace("synthetic-unit-only","synthetic$literal%22"),ACTIVATION.pre.database,application);
    const text=activationStdinConfig(uri,"a".repeat(64)).toString();
    expect(text).not.toContain("$");expect(text).toContain("synthetic%24literal%22");
    expect(()=>activationStdinConfig(uri,'"bad\nconfig')).toThrow();
  });
});

describe("independent watchdog failure paths (VM, no processes)",()=>{
  function simulated(changed=false,commandFails=false) {
    const stdin=Object.assign(new EventEmitter(),{resume:vi.fn()}),exit=vi.fn(),stop=vi.fn(),write=vi.fn();
    let deadline:()=>void=()=>{};
    const execute=vi.fn((_binary:string,args:string[])=>{
      if(commandFails)throw new Error("Synthetic Docker failure");
      if(args[2]==="inspect")return Buffer.from(JSON.stringify({Id:changed?"foreign":"1".repeat(64),Image:ACTIVATION.image,
        Config:{Labels:{"alfaev.fg-activation.run":"synthetic-run"}},Name:"/alfaev-fg-3d3d-pre-unit",State:{Running:true}}));
      stop(args);return Buffer.from("");
    });
    runInNewContext(restWatchdogSource.replace("import {execFileSync} from 'node:child_process';", ""),{
      execFileSync:execute,Buffer,clearTimeout:vi.fn(),setTimeout:(callback:()=>void,milliseconds:number)=>{expect(milliseconds).toBe(1200000);deadline=callback;return 1;},
      process:{argv:["node",LOCAL_RESERVATION.docker,`unix://${LOCAL_RESERVATION.socket}`,ACTIVATION.image,"synthetic-run","1".repeat(64)],
        stdin,stdout:{write},on:vi.fn(),exit},
    });
    return {stdin,exit,stop,execute,write,deadline:()=>deadline()};
  }
  it.each(["owner EOF","deadline"])("%s stops the actual owned container without SQL or drop",cause=>{
    const m=simulated();if(cause==="deadline")m.deadline();else m.stdin.emit("end");
    expect(m.stop).toHaveBeenCalledWith(["--host",`unix://${LOCAL_RESERVATION.socket}`,"stop","--time","5","1".repeat(64)]);
    expect(m.exit).toHaveBeenCalledWith(0);expect(m.execute.mock.calls.every(([binary])=>binary===LOCAL_RESERVATION.docker)).toBe(true);
  });
  it.each(["wrong identity","Docker failure"])("%s produces uncertainty and never stops another container",cause=>{
    const m=simulated(cause==="wrong identity",cause==="Docker failure");m.deadline();
    expect(m.stop).not.toHaveBeenCalled();expect(m.exit).toHaveBeenCalledWith(1);
  });
  it("normal explicit disarm exits without inspecting/removing resources",()=>{
    const m=simulated();m.stdin.emit("data",Buffer.from("disarm\n"));
    expect(m.exit).toHaveBeenCalledWith(0);expect(m.execute).not.toHaveBeenCalled();
  });
  it("emits the exact real handshake expected by the parent (not a mocked ready event)",()=>{
    expect(simulated().write).toHaveBeenCalledWith("ready\n");
  });
});

describe("bounded owned-client drain (mock metadata only)",()=>{
  it("waits for natural shutdown, never forces or terminates a backend",async()=>{
    const m=memory();let time=0;const query=vi.fn().mockResolvedValueOnce({rows:[{clients:2}]}).mockResolvedValueOnce({rows:[{clients:1}]}).mockResolvedValueOnce({rows:[{clients:0}]});
    await waitForActivationClients(m.target,{database:"postgres",query} as never,ACTIVATION.pre.database,()=>time,async()=>{time+=100;});
    expect(query).toHaveBeenCalledTimes(3);expect(query.mock.calls.every(([sql])=>sql.startsWith("select count(*)"))).toBe(true);
    expect(external.run).not.toHaveBeenCalled();
  });
  it("retains the clone when a read times out, clients remain, or final evidence arrives too late",async()=>{
    for(const mode of ["read failure","remaining","late zero"]) {
      const m=memory();let time=0;
      const query=vi.fn(async()=>{if(mode==="read failure")throw new Error("Synthetic timeout");if(mode==="late zero")time=9000;return {rows:[{clients:mode==="late zero"?0:1}]};});
      await expect(waitForActivationClients(m.target,{database:"postgres",query} as never,ACTIVATION.pre.database,()=>time,async()=>{time+=1000;})).rejects.toThrow();
      expect(m.command).not.toHaveBeenCalled();
    }
  });
  it("rejects unowned targets and non-source control sessions before any query",async()=>{
    const m=memory(),query=vi.fn();
    await expect(waitForActivationClients(m.target,{database:"other",query} as never,ACTIVATION.pre.database)).rejects.toThrow("control session");
    vi.mocked(m.target.assertOwnedClone).mockImplementation(()=>{throw new Error("Unowned");});
    await expect(waitForActivationClients(m.target,{database:"postgres",query} as never,ACTIVATION.pre.database)).rejects.toThrow("Unowned");
    expect(query).not.toHaveBeenCalled();
  });
});

describe("owned isolated PostgREST lifecycle (all Docker calls mocked)",()=>{
  it("the prepared diagnostic mode permits only one pre-activation HTTP resource",async()=>{
    const m=memory("readiness-only"),control=new AbortController();watchdog(m);
    expect(()=>m.resources.create("post",control.signal)).toThrow("pre-activation only");
    expect(m.command).not.toHaveBeenCalled();
    m.resources.create("pre",control.signal);await m.resources.start(control.signal,()=>control.abort());
    const attachment=external.spawn.mock.results[1]!.value;
    attachment.stderr.write('Successfully connected to PostgreSQL 17.6\nSchema cache loaded in 2 milliseconds\n');
    expect(m.resources.startupEvidence("pre")).toMatchObject({connected:true,cacheLoaded:true});
    expect(m.calls.filter(c=>c.args[2]==="create")).toHaveLength(1);
    expect((await m.resources.close()).status).toBe("COMPLETE");
    expect([...m.rows.keys()]).toEqual([ACTIVATION.existingRestId]);
  });
  it("uses a stdin config pipe, never Docker environment/argv/files/logs for password or JWT",async()=>{
    const m=memory(),signal=new AbortController(),mock=watchdog(m);
    m.resources.create("pre",signal.signal);m.resources.create("post",signal.signal);
    await m.resources.start(signal.signal,()=>signal.abort());
    const creates=m.calls.filter(c=>c.args[2]==="create");expect(creates).toHaveLength(2);
    for(const c of creates){
      expect(c.args).toContain("--pull");expect(c.args).toContain("never");expect(c.args).toContain("/dev/stdin");
      expect(c.args).toContain("--interactive");expect(c.args).toContain("core=0:0");
      expect(c.args).not.toContain("--env-file");expect(c.input).toBeUndefined();
      expect(c.args.join(" ")).not.toContain("synthetic-unit-only");expect(c.args.join(" ")).not.toContain("PGRST_JWT_SECRET=");
      expect(c.args).toContain(ACTIVATION.image);expect(c.args).toContain("--read-only");
      expect(c.args.some(a=>/^127\.0\.0\.1:5547[12]:3000$/.test(a))).toBe(true);
    }
    const token=m.resources.token(subject),[header,payload,signature]=token.split(".");
    expect(JSON.parse(Buffer.from(payload!,"base64url").toString())).toMatchObject({sub:subject,role:"authenticated"});
    expect(mock.configs).toHaveLength(2);
    const text=mock.configs[0]!.toString(),secret=text.match(/^jwt-secret = "([A-Za-z0-9_-]+)"$/m)![1]!;
    expect(text).toContain(`/${ACTIVATION.pre.database}?`);
    expect(text).toContain("synthetic-unit-only");
    expect(text).toContain("db-config = false");expect(text).toContain("db-channel-enabled = false");
    for(const row of m.rows.values())if(row.Id!==ACTIVATION.existingRestId){
      expect(row.Config.Env).toEqual([]);expect(JSON.stringify(row)).not.toContain(secret);
      expect(JSON.stringify(row)).not.toContain("synthetic-unit-only");
    }
    expect(signature).toBe(createHmac("sha256",secret).update(`${header}.${payload}`).digest("base64url"));
    const [binary,args,options]=external.spawn.mock.calls[0]!;expect(binary).toBe(process.execPath);
    expect(args).toContain(restWatchdogSource);expect(args.join(" ")).not.toContain(secret);
    expect(options.env).toEqual({PATH:"/usr/bin:/bin",LC_ALL:"C"});
    expect(JSON.stringify(external.spawn.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(external.spawn.mock.calls)).not.toContain("synthetic-unit-only");
    expect(JSON.stringify(m.calls)).not.toContain("synthetic-unit-only");
    expect(await m.resources.close()).toMatchObject({status:"COMPLETE",diagnostics:[]});
    expect([...m.rows.keys()]).toEqual([ACTIVATION.existingRestId]);
    expect(m.calls.filter(c=>["stop","rm"].includes(c.args[2]!)).every(c=>c.args[c.args.length-1]!==ACTIVATION.existingRestId)).toBe(true);
    expect(external.run).not.toHaveBeenCalled();expect(external.pool).not.toHaveBeenCalled();
  });
  it.each(["Docker","clone","network","image","credential"])("fails before creating when %s identity/material is unavailable",kind=>{
    const m=memory(),signal=new AbortController();
    if(kind==="Docker")vi.mocked(m.target.verifyDocker).mockImplementation(()=>{throw new Error("Wrong socket/container");});
    if(kind==="clone")vi.mocked(m.target.assertOwnedClone).mockImplementation(()=>{throw new Error("Unowned clone");});
    if(kind==="credential")m.existing.Config.Env=[];
    if(kind==="image")m.existing.Image="wrong";
    if(kind==="network")m.existing.NetworkSettings.Networks={};
    expect(()=>m.resources.create("pre",signal.signal)).toThrow();
    expect(m.calls.some(c=>c.args[2]==="create")).toBe(false);
  });
  it("does not adopt a colliding name, retry an uncertain create, or remove an unrecorded ID",async()=>{
    const m=memory(),signal=new AbortController();const real=m.command.getMockImplementation()!;
    m.command.mockImplementation((args,input)=>{if(args[2]==="create")throw new Error("Synthetic timeout/collision");return real(args,input);});
    expect(()=>m.resources.create("pre",signal.signal)).toThrow();
    expect(()=>m.resources.create("pre",signal.signal)).toThrow("repeated create");
    expect((await m.resources.close()).status).toBe("UNVERIFIED");
    expect(m.calls.some(c=>c.args[2]==="rm")).toBe(false);
  });
  it.each(["binding","run","command","network","id","mount","options","JWT","stdin","TTY"])("refuses unsafe cleanup when %s ownership is changed",async kind=>{
    const m=memory(),signal=new AbortController();m.resources.create("pre",signal.signal);
    const row=m.rows.get("1".repeat(64))!;
    if(kind==="binding")row.HostConfig.PortBindings["3000/tcp"]![0]!.HostIp="0.0.0.0";
    if(kind==="run")row.Config.Labels["alfaev.fg-activation.run"]="foreign";
    if(kind==="command")row.Config.Cmd=["postgrest","/other/config"];
    if(kind==="network")row.HostConfig.NetworkMode="host";
    if(kind==="id")row.Id="3".repeat(64);
    if(kind==="mount")row.Mounts=[{Source:"foreign"}];
    if(kind==="options")row.Config.Env=["PGHOST=remote.invalid"];
    if(kind==="JWT")row.Config.Env=["PGRST_JWT_SECRET=synthetic-forbidden"];
    if(kind==="stdin")row.Config.OpenStdin=false;
    if(kind==="TTY")row.Config.Tty=true;
    expect(()=>assertRestOwnership(row,"pre","1".repeat(64),m.resources.runId)).toThrow();
    expect((await m.resources.close()).status).toBe("FAILED");
    expect(m.calls.some(c=>c.args[2]==="rm")).toBe(false);
  });
  it("interruption denies later creation/start; watchdog owns actual container IDs, not host PIDs",async()=>{
    const m=memory(),signal=new AbortController();m.resources.create("pre",signal.signal);signal.abort();
    expect(()=>m.resources.create("post",signal.signal)).toThrow("closed");
    await expect(m.resources.start(signal.signal,()=>{})).rejects.toThrow("ownership");await m.resources.close();
    expect(restWatchdogSource).toContain("['stop','--time','5',id]");expect(restWatchdogSource).toContain("1200000");
    expect(restWatchdogSource).toContain("process.stdin.on('end',stop)");expect(restWatchdogSource).not.toContain("kill -9");
  });
  it("distinguishes confirmed remaining resources, unknown inventory, and independently verified removal",async()=>{
    expect(cleanupVerdict(true,true,[]).status).toBe("FAILED");
    expect(cleanupVerdict(false,false,[]).status).toBe("UNVERIFIED");
    for(const mode of ["inventory unavailable","rm failed","rm response lost"]){
      const m=memory();m.resources.create("pre",new AbortController().signal);
      const original=m.command.getMockImplementation()!;
      m.command.mockImplementation((args,input)=>{
        if(mode==="inventory unavailable" && args[2]==="ps")throw new Error("sensitive Docker output");
        if(mode.startsWith("rm") && args[2]==="rm"){
          if(mode==="rm response lost")original(args,input);
          throw new Error("sensitive failed command output");
        }
        return original(args,input);
      });
      const result=await m.resources.close();
      expect(result.status).toBe(mode==="rm failed"?"FAILED":mode==="rm response lost"?"COMPLETE":"UNVERIFIED");
      expect(JSON.stringify(result)).not.toContain("sensitive");
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });
  it("joins an already-triggered abort watchdog before removing containers",async()=>{
    const m=memory(),signal=new AbortController(),mock=watchdog(m);
    m.resources.create("pre",signal.signal);m.resources.create("post",signal.signal);
    await m.resources.start(signal.signal,()=>signal.abort());signal.abort();
    let removedBeforeWatchdogExit=false,exited=false;
    mock.child.once("close",()=>{exited=true;});
    const original=m.command.getMockImplementation()!;
    m.command.mockImplementation((args,input)=>{
      if(args[2]==="rm" && !exited)removedBeforeWatchdogExit=true;
      return original(args,input);
    });
    expect((await m.resources.close()).status).toBe("COMPLETE");
    expect(removedBeforeWatchdogExit).toBe(false);
  });
  it("keeps the owner-death watchdog armed throughout normal resource removal",async()=>{
    const m=memory(),signal=new AbortController(),mock=watchdog(m);
    m.resources.create("pre",signal.signal);m.resources.create("post",signal.signal);
    await m.resources.start(signal.signal,()=>signal.abort());
    const original=m.command.getMockImplementation()!;let armedDuringRemoval=true;
    m.command.mockImplementation((args,input)=>{
      if(args[2]==="rm" && mock.child.stdin.writableEnded)armedDuringRemoval=false;
      return original(args,input);
    });
    expect((await m.resources.close()).status).toBe("COMPLETE");expect(armedDuringRemoval).toBe(true);
    expect(mock.child.stdin.writableEnded).toBe(true);
  });
  it("discards config buffers and never sends credentials after interruption before startup",async()=>{
    const m=memory(),signal=new AbortController();m.resources.create("pre",signal.signal);signal.abort();
    await expect(m.resources.start(signal.signal,()=>{})).rejects.toThrow();
    expect((await m.resources.close()).status).toBe("COMPLETE");
    expect(external.spawn).not.toHaveBeenCalled();
    expect(m.calls.every(c=>c.input===undefined)).toBe(true);
  });
  it("reports an independently unknown cleanup inventory instead of false COMPLETE after interruption",async()=>{
    const m=memory(),signal=new AbortController();watchdog(m);
    m.resources.create("pre",signal.signal);m.resources.create("post",signal.signal);
    await m.resources.start(signal.signal,()=>signal.abort());signal.abort();
    const original=m.command.getMockImplementation()!;
    m.command.mockImplementation((args,input)=>{
      if(args[2]==="ps")throw Object.assign(new Error("Bearer synthetic-hidden"),{code:"EACCES"});
      return original(args,input);
    });
    const report=await m.resources.close();expect(report.status).toBe("UNVERIFIED");
    expect(report.diagnostics.join(";")).toContain("independent-container-inventory");
    expect(report.diagnostics.join(";")).not.toContain("Bearer");
  });
  it("never reports COMPLETE when watchdog termination cannot be established",async()=>{
    const m=memory(),signal=new AbortController(),mock=watchdog(m);
    m.resources.create("pre",signal.signal);m.resources.create("post",signal.signal);
    await m.resources.start(signal.signal,()=>signal.abort());
    mock.child.stdin.removeAllListeners("finish"); // Simulate a hung child, no real process.
    vi.useFakeTimers();
    try {
      const pending=m.resources.close();
      await vi.advanceTimersByTimeAsync(40_000);
      const report=await pending;
      expect(report.status).toBe("UNVERIFIED");
      expect(report.diagnostics.join(";")).toContain("operation=watchdog-stop");
      expect([...m.rows.keys()]).toEqual([ACTIVATION.existingRestId]);
    } finally {vi.useRealTimers();}
  });
});

describe("real SDK adapter, but synthetic fetch in THIS connection-free unit file",()=>{
  it.each(["https://remote.invalid/rest/v1/rpc/x","http://localhost:55472/rest/v1/rpc/x","http://127.0.0.1:54321/rest/v1/rpc/x",
    "http://127.0.0.1:55472/auth/v1/token","http://x:y@127.0.0.1:55472/rest/v1/rpc/x"])("rejects remote/wrong endpoint %s",url=>{
    expect(()=>routeActivationUrl(url,"post")).toThrow();expect(fetch).not.toHaveBeenCalled();
  });
  it("strips only the Supabase prefix, preserves projections/payload precision, and rejects redirects",async()=>{
    const fake=vi.fn<typeof fetch>().mockResolvedValue(new Response('[{"reserved_quantity":"9007199254740993"}]',{headers:{"Content-Type":"application/json"}}));
    const http=activationHttp("post",new AbortController().signal,fake);
    const result=await http.sdk.rpc("reserve_finished_goods_for_project",{p_quantity:"9007199254740993",p_request_id:subject})
      .select("reserved_quantity::text").setHeader("Authorization","Bearer synthetic");
    expect(result.data).toEqual([{reserved_quantity:"9007199254740993"}]);
    const [url,init]=fake.mock.calls[0]!;expect(url).toBe(`${activationUrl("post")}/rpc/reserve_finished_goods_for_project?select=reserved_quantity%3A%3Atext`);
    expect(init).toMatchObject({redirect:"error",credentials:"omit",cache:"no-store"});
    expect(JSON.parse(String(init?.body))).toMatchObject({p_quantity:"9007199254740993"});
    expect(JSON.stringify(http.requests)).not.toContain("Bearer");expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["drop","malformed"] as const)("consumes committed response before simulating %s",async mode=>{
    const response=new Response('[{"ok":true}]',{headers:{"Content-Type":"application/json"}}),consume=vi.spyOn(response,"arrayBuffer");
    const fake=vi.fn<typeof fetch>().mockResolvedValue(response),http=activationHttp("post",new AbortController().signal,fake);
    http.loseNextSuccess(mode);const result=await http.sdk.rpc("reserve_finished_goods_for_project",{});
    expect(consume).toHaveBeenCalledOnce();expect(fake).toHaveBeenCalledOnce();
    if(mode==="drop")expect(result.error).not.toBeNull();else expect(result.data).toEqual([{}]);
  });
  it("does not fetch after interruption and combines request/deadline abort signals",async()=>{
    const control=new AbortController(),fake=vi.fn<typeof fetch>();control.abort();
    const http=activationHttp("post",control.signal,fake);expect((await http.sdk.rpc("x",{})).error).not.toBeNull();
    expect(fake).not.toHaveBeenCalled();
  });
  it("bounds a stalled HTTP operation and reports an error without replaying POST",async()=>{
    const deadline=new AbortController();const clock=vi.spyOn(AbortSignal,"timeout").mockReturnValue(deadline.signal);
    const fake=vi.fn<typeof fetch>().mockImplementation((_url,init)=>new Promise((_resolve,reject)=>{
      init!.signal!.addEventListener("abort",()=>reject(new Error("Synthetic timeout")),{once:true});
    }));
    const http=activationHttp("post",new AbortController().signal,fake),pending=http.sdk.rpc("x",{}).then(value=>value);
    await vi.waitFor(()=>expect(fake).toHaveBeenCalledOnce());deadline.abort();
    expect((await pending).error).not.toBeNull();expect(clock).toHaveBeenCalledWith(10000);expect(fake).toHaveBeenCalledOnce();
  });
});

describe("separate activation ACL assertions",()=>{
  function catalog(active:boolean) {
    const wrapperNames=["reserve_finished_goods_for_project","release_finished_goods_project_reservation","fulfill_finished_goods_project_reservation"];
    const helpers=["change_finished_goods_project_reservation","calculate_project_product_demand","calculate_open_project_commitments",
      "protect_finished_goods_reserved_stock","protect_finished_goods_reservation_demand","protect_finished_goods_reservation_project_lifecycle",
      "validate_finished_goods_fulfillment_link","apply_inventory_delta_in_warehouse","enforce_finished_goods_reservation_history",
      "get_production_eligible_quantity","get_work_order_warehouse_source_allocation_plan"];
    const rows=[...wrapperNames,...helpers,...Array.from({length:185-wrapperNames.length-helpers.length},(_,i)=>`other_${i}`)]
      .map((proname,i)=>({oid:String(i),proname,prosecdef:true,provolatile:"v",proconfig:['search_path=""'],
        browser:active&&wrapperNames.includes(proname),browser_grantable:false,anon:false,service:false,public:false}));
    const query=vi.fn(async(sql:string,args?:unknown[]):Promise<{rows:Record<string,unknown>[]} >=>sql.includes("rolsuper")?{rows:["anon","authenticated","authenticator"].map(rolname=>({rolname,
      rolsuper:false,rolbypassrls:false,rolinherit:rolname!=="authenticator",rolcanlogin:rolname==="authenticator"}))}
      :sql.includes("from pg_auth_members")?{rows:["anon","authenticated","service_role"].map(rolname=>({rolname}))}
      :sql.includes("from pg_proc p join")?{rows}
      :sql.startsWith("select $1::regprocedure")?{rows:[{oid:rows.find(r=>String(args?.[0]).includes(`.${r.proname}(`))!.oid}]}
      :{rows:[{rls:true,public:false,exposed:false}]});
    return {rows,query};
  }
  it("accepts distinct pre/private and post/three-wrapper inventories",async()=>{
    await assertActivationSecurity(catalog(false) as never,false);await assertActivationSecurity(catalog(true) as never,true);
    await expect(assertActivationSecurity(catalog(true) as never,false)).rejects.toThrow("wrapper");
    await expect(assertActivationSecurity(catalog(false) as never,true)).rejects.toThrow("wrapper");
  });
  it.each(["helper","PUBLIC","anon","service","grant option","overload","search_path","count","table"])("rejects unexpected %s exposure",async kind=>{
    const state=catalog(true);
    if(kind==="helper")state.rows[3]!.browser=true;
    if(kind==="PUBLIC")state.rows[0]!.public=true;
    if(kind==="anon")state.rows[0]!.anon=true;
    if(kind==="service")state.rows[0]!.service=true;
    if(kind==="grant option")state.rows[0]!.browser_grantable=true;
    if(kind==="overload")state.rows[1]!.proname=state.rows[0]!.proname;
    if(kind==="search_path")state.rows[0]!.proconfig=[];
    if(kind==="count")state.rows.pop();
    if(kind==="table"){
      const previous=state.query.getMockImplementation()!;
      state.query.mockImplementation((sql,args)=>sql.includes("from pg_class c")?Promise.resolve({rows:[{rls:false,public:false,exposed:true}]}):previous(sql,args));
    }
    await expect(assertActivationSecurity(state as never,true)).rejects.toThrow();
  });
  it("rejects a privileged application role or unexpected authenticator membership",async()=>{
    for(const scenario of ["role","membership"]) {
      const state=catalog(true),previous=state.query.getMockImplementation()!;
      state.query.mockImplementation(async(sql,args)=>{
        const result=await previous(sql,args);
        if(scenario==="role" && sql.includes("rolsuper"))return {rows:result.rows.map(r=>({...r,rolsuper:true}))};
        if(scenario==="membership" && sql.includes("from pg_auth_members"))return {rows:[{rolname:"postgres"}]};
        return result;
      });
      await expect(assertActivationSecurity(state as never,true)).rejects.toThrow();
    }
  });
  it("normalizes only the three permitted authenticated EXECUTE edges in catalog comparison",async()=>{
    const query=vi.fn().mockResolvedValue({rows:[{digest:"a".repeat(32)}]});await activationCatalog({query} as never);
    expect(query.mock.calls[0]![0]).toContain("a.grantee='authenticated'::regrole");
    expect(query.mock.calls[0]![1][0]).toHaveLength(3);
    expect(query.mock.calls[0]![0]).toContain("and not a.is_grantable");
    const existing=readFileSync("test/backend/rls-policy-matrix.suite.ts","utf8");
    expect(existing).toContain('["reserve_finished_goods_for_project", false]');
    expect(existing).toContain('expected.set("fulfill_finished_goods_project_reservation", false)');
  });
  it("refuses missing/malformed catalog evidence rather than comparing two undefined digests",async()=>{
    const query=vi.fn().mockResolvedValue({rows:[]});await expect(activationCatalog({query} as never)).rejects.toThrow("manifest");
    query.mockResolvedValue({rows:[{digest:"invalid"}]});await expect(activationCatalog({query} as never)).rejects.toThrow("manifest");
  });
});
