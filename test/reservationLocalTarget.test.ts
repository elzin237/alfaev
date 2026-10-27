import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const external = vi.hoisted(()=>({run:vi.fn(),pool:vi.fn(),spawn:vi.fn()}));
// All external commands and all real Pool construction are blocked in this file.
vi.mock("node:child_process",()=>({default:{execFileSync:external.run,spawn:external.spawn},execFileSync:external.run,spawn:external.spawn}));
vi.mock("pg",()=>({default:{Pool:external.pool},Pool:external.pool}));
import { LOCAL_RESERVATION as pin, ReservationLocalTarget, assertDockerIdentity,
  assertLocalSocket, assertResolvedConnection, assertTemporaryDatabase,
  containerArguments, dockerArguments, localPoolOptions, reservationSnapshot,
  rollbackReservationTransactions, runPinnedDocker, ContainerPeerStream, type LocalIO } from "./backend/helpers/reservation-local-target";
import { guardRollbackQueries } from "./backend/helpers/rollback-query-guard";

const application = `alfaev_fg_${"a".repeat(32)}`;
const temporary = `alfaev_fg_3b1_${"b".repeat(32)}`;
const good = () => ({
  container:{Id:String(pin.containerId),Name:`/${pin.container}`,Running:true,
    Labels:{"com.supabase.cli.project":"internal-tool","com.supabase.cli.workdir":String(pin.repository)},
    Mounts:[{Destination:pin.dataDirectory,Type:"volume",Name:String(pin.container),RW:true}],
    Ports:{"5432/tcp":[{HostIp:"0.0.0.0",HostPort:"54322"},{HostIp:"::",HostPort:"54322"}]}},
  volume:{Name:pin.container,Driver:"local",Scope:"local",Labels:{"com.supabase.cli.project":"internal-tool"},Options:null},
  control:`Database system identifier: ${pin.cluster}\n`,
});
function memoryIO() {
  const {container,volume,control}=good();
  const command=vi.fn((args:string[])=>{
    const text=args.join(" ");
    let answer="";
    if (args.includes("inspect")) answer=JSON.stringify(args.includes("volume")?volume:container);
    else if (text.includes("/pg_controldata")) answer=control;
    else if (text.endsWith("/usr/bin/id -un")) answer="postgres";
    else if (text.endsWith("/usr/bin/id -u")) answer="100";
    else if (text.endsWith("/usr/bin/readlink -f /usr/bin/timeout")) answer="/bin/busybox";
    else if (text.includes("--version")) answer=`${text.includes("pg_dump")?"pg_dump":"pg_restore"} (PostgreSQL) 17.6`;
    else if (text.includes("sha256sum")) answer=text.includes("pg_hba")
      ?"a925911753f4975548eb4079177441c886aa22b6dd69f2b0cff98f779fb0b66a  file"
      :"479445a89591d0ed50a39d204f8bb4a6b87649bc7e46f62fe5d96cad5f674e96  file";
    else if (args.includes("-C")) answer=({hba_file:"/etc/postgresql/pg_hba.conf",ident_file:"/etc/postgresql/pg_ident.conf",
      unix_socket_directories:pin.socketDirectory,data_directory:pin.dataDirectory,port:"5432"} as Record<string,string>)[args[args.length-1]!] ?? "";
    else if (text.includes("/pg_dump")) answer="MOCK_ARCHIVE";
    return Buffer.from(answer);
  });
  const io:LocalIO={cwd:()=>pin.repository,realpath:path=>path,socketExists:()=>true,command};
  return {io,command};
}
function leasePool(unsafe=false, held=true) {
  const lease={query:vi.fn(async(sql:string)=>({rows:[sql.includes("pg_try_advisory_lock")?{held}:{unsafe}],rowCount:1})),release:vi.fn()};
  return {lease,pool:{database:"postgres",connect:vi.fn(async()=>lease)} as unknown as Parameters<ReservationLocalTarget["acquire"]>[0]};
}
function fakeSource(existing=false, oid="777") {
  const query=vi.fn(async(sql:string)=>{
    if(sql.startsWith("select oid from")) return {rows:existing?[{oid}]:[],rowCount:existing?1:0};
    if(sql.includes("owner_ok")) return {rows:[{oid,owner_ok:true}],rowCount:1};
    if(sql.startsWith("select oid::text")) return {rows:[{oid}],rowCount:1};
    return {rows:[],rowCount:0};
  });
  return {query,source:{database:"postgres",query} as unknown as Parameters<ReservationLocalTarget["createTemporary"]>[0]};
}

beforeEach(()=>{
  external.run.mockReset().mockImplementation(()=>{throw new Error("External command forbidden in connection-free tests");});
  external.spawn.mockReset().mockImplementation(()=>{throw new Error("External spawn forbidden in connection-free tests");});
  external.pool.mockReset().mockImplementation(()=>{throw new Error("Real Pool forbidden in connection-free tests");});
  for(const key of Object.keys(process.env)) if(key.startsWith("PG") || ["DATABASE_URL","SUPABASE_DB_URL"].includes(key)) vi.stubEnv(key,undefined);
  vi.stubEnv("LOCAL_SUPABASE_DB_PASSWORD","mock-only-not-a-real-credential");
});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});

describe("pinned reservation target — connection-free identity checks",()=>{
  it("accepts the complete correct identity",()=>{
    const state=good(); assertDockerIdentity(state.container,state.volume,state.control);
    const {io,command}=memoryIO(); new ReservationLocalTarget(io).verifyDocker();
    expect(command).toHaveBeenCalled(); expect(external.run).not.toHaveBeenCalled();
  });
  it.each(["container ID","container name","project","repository","volume","volume project","volume driver","cluster","port","binding"])("rejects wrong %s",kind=>{
    const s=good();
    if(kind==="container ID") s.container.Id="0".repeat(64);
    if(kind==="container name") s.container.Name="/unrelated";
    if(kind==="project") s.container.Labels["com.supabase.cli.project"]="other";
    if(kind==="repository") s.container.Labels["com.supabase.cli.workdir"]="/other";
    if(kind==="volume") s.container.Mounts[0]!.Name="other";
    if(kind==="volume project") s.volume.Labels["com.supabase.cli.project"]="other";
    if(kind==="volume driver") s.volume.Driver="nfs";
    if(kind==="cluster") s.control="Database system identifier: 1";
    if(kind==="port") s.container.Ports["5432/tcp"][0]!.HostPort="54323";
    if(kind==="binding") s.container.Ports["5432/tcp"][0]!.HostIp="192.0.2.1";
    expect(()=>assertDockerIdentity(s.container,s.volume,s.control)).toThrow();
  });
  it.each([["/other/socket",true],[pin.socket,false]] as const)("rejects Docker socket %s (%s)",(socket,isSocket)=>{
    expect(()=>assertLocalSocket(pin.repository,socket,isSocket)).toThrow();
  });
  it("fails closed if metadata cannot be read",()=>{
    const {io}=memoryIO(); io.command=()=>{throw new Error("metadata unavailable");};
    expect(()=>new ReservationLocalTarget(io).verifyDocker()).toThrow("metadata unavailable");
  });
  it("rejects changed Unix authentication configuration",()=>{
    const {io,command}=memoryIO(); io.command=args=>args.includes("/usr/bin/sha256sum")?Buffer.from("wrong"):command(args);
    expect(()=>new ReservationLocalTarget(io).verifyDocker()).toThrow("authentication configuration changed");
  });
  it("pins the socket, ID, clean environment, absolute tools and container-side timeout",()=>{
    const args=containerArguments([`${pin.pgBin}/pg_dump`,"--version"]);
    expect(args.slice(0,2)).toEqual(["--host",`unix://${pin.socket}`]);
    expect(args).toContain(pin.containerId);expect(args).not.toContain(pin.container);
    expect(args).toContain("/usr/bin/env");expect(args).toContain("-i");
    expect(args.indexOf("/usr/bin/timeout")).toBeLessThan(args.indexOf(`${pin.pgBin}/pg_dump`));
    expect(dockerArguments(["inspect",pin.containerId])).not.toContain("--context");
  });
  it("ignores ambient remote Docker variables rather than forwarding them",()=>{
    vi.stubEnv("DOCKER_HOST","tcp://untrusted.example:2376");vi.stubEnv("DOCKER_CONTEXT","remote");
    const {io,command}=memoryIO();new ReservationLocalTarget(io).verifyDocker();
    expect(command.mock.calls.every(([args])=>args[1]===`unix://${pin.socket}`)).toBe(true);
    expect(command.mock.calls.some(([args])=>args.join(" ").includes("untrusted"))).toBe(false);
  });
  it("clears the actual host process environment and bounds execution",()=>{
    external.run.mockReturnValueOnce(Buffer.from("MOCK"));
    runPinnedDocker(dockerArguments(["inspect",pin.containerId]));
    const [binary,args,options]=external.run.mock.calls[0]!;
    expect(binary).toBe(pin.docker);expect(args[1]).toBe(`unix://${pin.socket}`);
    expect(options.env).toEqual({PATH:"/usr/bin:/bin",LC_ALL:"C",TZ:"UTC"});
    expect(options.timeout).toBe(100000);expect(options.cwd).toBe(pin.repository);
  });
  it("rejects a wrong Docker socket before starting any process",()=>{
    expect(()=>runPinnedDocker(["--host","tcp://untrusted:2376","inspect",pin.containerId])).toThrow("Wrong Docker socket");
    expect(external.run).not.toHaveBeenCalled();
  });
  it("reports process timeout/failure as uncertain, without secrets or retry",()=>{
    external.run.mockImplementationOnce(()=>{throw Object.assign(new Error("SECRET_MOCK_ONLY"),{status:143,signal:"SIGTERM",stderr:Buffer.from("SECRET_MOCK_ONLY")});});
    let failure="";try {runPinnedDocker(dockerArguments(["inspect",pin.containerId]));}catch(error){failure=String(error);}
    expect(failure).toContain("outcome unverified");expect(failure).toContain("143");
    expect(failure).not.toContain("SECRET_MOCK_ONLY");expect(external.run).toHaveBeenCalledTimes(1);
  });
});

describe("explicit connection configuration",()=>{
  it("pins peer transport to the exact container, Unix socket, clean environment and remote watchdog",()=>{
    const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),ref:vi.fn(),unref:vi.fn()});
    external.spawn.mockReturnValue(child);
    const stream=new ContainerPeerStream();
    stream.connect(`${pin.socketDirectory}/.s.PGSQL.5432`);
    const [binary,args,options]=external.spawn.mock.calls[0]!;
    expect(binary).toBe(pin.docker);
    expect(args.slice(0,2)).toEqual(["--host",`unix://${pin.socket}`]);
    expect(args).toContain(pin.containerId);expect(args).toContain("--user");
    expect(args).toContain("-i");expect(args).toContain(pin.perl);
    expect(args).toContain("/usr/bin/timeout");expect(args).toContain("300");
    expect(args.at(-1)).toContain("Peer=>'/var/run/postgresql/.s.PGSQL.5432'");
    expect(options.env).toEqual({PATH:"/usr/bin:/bin",LC_ALL:"C",TZ:"UTC"});
    stream.destroy();
    expect(child.stdin.destroyed).toBe(true);expect(child.stdout.destroyed).toBe(true);
  });
  it("rejects any alternative peer target before starting a process",()=>{
    const stream=new ContainerPeerStream();
    expect(()=>stream.connect("127.0.0.1:54322")).toThrow("Unexpected");
    expect(external.spawn).not.toHaveBeenCalled();stream.destroy();
  });
  it("verifies a peer-authenticated session is actually Unix-local before exposing it",async()=>{
    vi.stubEnv("LOCAL_SUPABASE_DB_PASSWORD",undefined);
    const query=vi.fn().mockResolvedValueOnce({rows:[{db:"postgres",role:"postgres",session_role:"postgres",port:null,address:null,directory:pin.dataDirectory,cluster:pin.cluster}]})
      .mockResolvedValueOnce({rows:[{n:142,latest:pin.latestMigration}]});
    await new ReservationLocalTarget(memoryIO().io).verifySession({query},"postgres");
    expect(query).toHaveBeenCalledTimes(2);
    query.mockResolvedValueOnce({rows:[{db:"postgres",role:"postgres",session_role:"postgres",port:5432,address:"127.0.0.1",directory:pin.dataDirectory,cluster:pin.cluster}]});
    await expect(new ReservationLocalTarget(memoryIO().io).verifySession({query},"postgres")).rejects.toThrow("session mismatch");
  });
  it("constructs only pinned local options with an explicit credential",()=>{
    const options=localPoolOptions("postgres",application,{LOCAL_SUPABASE_DB_PASSWORD:"mock"});
    expect(options).toMatchObject({host:"127.0.0.1",port:54322,database:"postgres",user:"postgres",ssl:false});
    expect(options.connectionString).toBeUndefined();expect(Object.isFrozen(options)).toBe(true);
    assertResolvedConnection({...options},"postgres",application);
  });
  it.each(["PGHOST","PGPORT","PGDATABASE","PGSERVICE","PGPASSWORD","PGOPTIONS","DATABASE_URL","SUPABASE_DB_URL"])("rejects ambient %s",key=>{
    expect(()=>localPoolOptions("postgres",application,{LOCAL_SUPABASE_DB_PASSWORD:"mock",[key]:"untrusted"})).toThrow("Ambient");
  });
  it("uses only the container peer socket without a password or pgpass fallback",()=>{
    const options=localPoolOptions("postgres",application,{});
    expect(options).toMatchObject({host:pin.socketDirectory,port:5432,user:"postgres",database:"postgres"});
    expect(typeof options.password).toBe("function");
    expect(()=> (options.password as ()=>string)()).toThrow("Peer authentication required");
    expect(typeof (options as unknown as {stream:unknown}).stream).toBe("function");
    assertResolvedConnection({...options},"postgres",application);
  });
  it.each(["host","port","database","user","ssl","options","replication","application_name"])("rejects unexpected resolved %s",key=>{
    const options={...localPoolOptions("postgres",application,{LOCAL_SUPABASE_DB_PASSWORD:"mock"}),[key]:"untrusted"};
    expect(()=>assertResolvedConnection(options,"postgres",application)).toThrow("Unexpected");
  });
  it("checks live database identity before migration state, without fixture SQL",async()=>{
    const target=new ReservationLocalTarget(memoryIO().io);
    const query=vi.fn(async()=>({rows:[{db:"wrong",role:"postgres",session_role:"postgres",port:5432,directory:pin.dataDirectory,cluster:pin.cluster}]}));
    await expect(target.verifySession({query} as never,"postgres")).rejects.toThrow("session mismatch");
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("rejects the wrong migration before exposing the session",async()=>{
    const query=vi.fn().mockResolvedValueOnce({rows:[{db:"postgres",role:"postgres",session_role:"postgres",port:5432,directory:pin.dataDirectory,cluster:pin.cluster}]})
      .mockResolvedValueOnce({rows:[{n:143,latest:"unapproved"}]});
    await expect(new ReservationLocalTarget(memoryIO().io).verifySession({query},"postgres")).rejects.toThrow("exactly 142");
  });
  it("accepts the exact database/cluster/migration identity",async()=>{
    const query=vi.fn().mockResolvedValueOnce({rows:[{db:"postgres",role:"postgres",session_role:"postgres",port:5432,directory:pin.dataDirectory,cluster:pin.cluster}]})
      .mockResolvedValueOnce({rows:[{n:142,latest:pin.latestMigration}]});
    await new ReservationLocalTarget(memoryIO().io).verifySession({query},"postgres");
    expect(query).toHaveBeenCalledTimes(2);
  });
  it.each(["cluster","directory","port","role","session_role"])("rejects a wrong server-side %s",async key=>{
    const query=vi.fn().mockResolvedValue({rows:[{db:"postgres",role:"postgres",session_role:"postgres",port:5432,directory:pin.dataDirectory,cluster:pin.cluster,[key]:"wrong"}]});
    await expect(new ReservationLocalTarget(memoryIO().io).verifySession({query},"postgres")).rejects.toThrow("session mismatch");
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("destroys a client with unexpected resolved settings before any SQL",async()=>{
    const target=new ReservationLocalTarget(memoryIO().io);
    const client={connectionParameters:{...localPoolOptions("postgres",target.application),host:"untrusted.example"},query:vi.fn(),release:vi.fn()};
    external.pool.mockImplementation(function(){return {connect:async()=>client};});
    await expect(target.pool().connect()).rejects.toThrow("Unexpected PostgreSQL");
    expect(client.query).not.toHaveBeenCalled();expect(client.release).toHaveBeenCalledWith(true);
  });
  it("destroys timed-out query clients without retrying fixture SQL",async()=>{
    const target=new ReservationLocalTarget(memoryIO().io);
    const query=vi.fn().mockResolvedValueOnce({rows:[{db:"postgres",role:"postgres",session_role:"postgres",port:5432,directory:pin.dataDirectory,cluster:pin.cluster}]})
      .mockResolvedValueOnce({rows:[{n:142,latest:pin.latestMigration}]})
      .mockRejectedValueOnce(new Error("MOCK query timeout"));
    const client={connectionParameters:localPoolOptions("postgres",target.application),query,release:vi.fn()};
    external.pool.mockImplementation(function(){return {connect:async()=>client};});
    await expect(target.pool().query("MOCK_FIXTURE")).rejects.toThrow("query timeout");
    expect(query.mock.calls.filter(([sql])=>sql==="MOCK_FIXTURE")).toHaveLength(1);
    expect(client.release).toHaveBeenCalledWith(true);
  });
});

describe("temporary database ownership and quiet-session gates",()=>{
  it.each(["postgres","template0","template1","existing","alfaev_fg_3b1_123",`${temporary};drop database postgres`,temporary.toUpperCase()])("rejects unsafe name %s",name=>{
    expect(()=>assertTemporaryDatabase(name)).toThrow();
  });
  it("never allows connection to an unowned valid-looking database",()=>{
    expect(()=>new ReservationLocalTarget(memoryIO().io).assertDatabaseAllowed(temporary)).toThrow("Unowned");
  });
  it("does not construct a Pool when Docker identity is wrong",()=>{
    const {io,command}=memoryIO();
    io.command=args=>{
      const value=command(args);
      if(args.includes("inspect")&&!args.includes("volume")) {
        const row=JSON.parse(value.toString());row.Id="wrong";return Buffer.from(JSON.stringify(row));
      }
      return value;
    };
    expect(()=>new ReservationLocalTarget(io).pool()).toThrow("container/project");
    expect(external.pool).not.toHaveBeenCalled();
  });
  it("rejects a non-postgres control database before any query",async()=>{
    const target=new ReservationLocalTarget(memoryIO().io),query=vi.fn();
    const wrong={database:temporary,query} as unknown as Parameters<ReservationLocalTarget["createTemporary"]>[0];
    await expect(target.createTemporary(wrong,temporary)).rejects.toThrow("postgres control");
    await expect(target.dropTemporary(wrong,temporary)).rejects.toThrow("postgres control");
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects an already-existing database without creation/deletion",async()=>{
    const target=new ReservationLocalTarget(memoryIO().io), {pool}=leasePool(), {source,query}=fakeSource(true);
    await target.acquire(pool);
    await expect(target.createTemporary(source,temporary)).rejects.toThrow("already exists");
    expect(query.mock.calls.some(([sql])=>/create database|drop database/.test(sql))).toBe(false);
  });
  it("creates, restores, and drops only this run's exact owned identity",async()=>{
    const {io,command}=memoryIO(), target=new ReservationLocalTarget(io), {pool}=leasePool(), {source,query}=fakeSource();
    await target.acquire(pool);await target.createTemporary(source,temporary);
    target.copyIntoTemporary(temporary);
    const dump=command.mock.calls.find(([args])=>args.includes(`${pin.pgBin}/pg_dump`) && args.includes("-Fc"))?.[0];
    const restore=command.mock.calls.find(([args])=>args.includes(`${pin.pgBin}/pg_restore`) && args.includes("--exit-on-error"))?.[0];
    for(const args of [dump,restore]) {
      expect(args).toContain("--no-password");expect(args?.join(" ")).toContain(`host=${pin.socketDirectory}`);
      expect(args?.join(" ")).toContain("passfile=/dev/null");expect(args?.join(" ")).not.toContain("PGPASSWORD");
    }
    await target.dropTemporary(source,temporary);
    expect(query.mock.calls.filter(([sql])=>sql.startsWith("drop database"))).toEqual([[`drop database "${temporary}"`]]);
    expect(()=>target.assertDatabaseAllowed(temporary)).toThrow();
  });
  it("does not delete an unowned database, even with a valid name",async()=>{
    const target=new ReservationLocalTarget(memoryIO().io),{pool}=leasePool(),{source,query}=fakeSource();await target.acquire(pool);
    await expect(target.dropTemporary(source,temporary)).rejects.toThrow("does not own");expect(query).not.toHaveBeenCalled();
  });
  it("rejects replaced database OIDs during cleanup",async()=>{
    const target=new ReservationLocalTarget(memoryIO().io),{pool}=leasePool(),{source,query}=fakeSource();await target.acquire(pool);await target.createTemporary(source,temporary);
    query.mockImplementation(async()=>({rows:[{oid:"888",owner_ok:true}],rowCount:1}));
    await expect(target.dropTemporary(source,temporary)).rejects.toThrow("identity changed");
    expect(query.mock.calls.some(([sql])=>sql.startsWith("drop database"))).toBe(false);
  });
  it("does not force-drop a clone with remaining sessions",async()=>{
    const target=new ReservationLocalTarget(memoryIO().io),{pool}=leasePool(),{source,query}=fakeSource();await target.acquire(pool);await target.createTemporary(source,temporary);
    const previous=query.getMockImplementation()!;
    query.mockImplementation(async(sql)=>sql.includes("select 1 from pg_stat_activity")?{rows:[{oid:"777"}],rowCount:1}:previous(sql));
    await expect(target.dropTemporary(source,temporary)).rejects.toThrow("still has clients");
    expect(query.mock.calls.some(([sql])=>sql.startsWith("drop database"))).toBe(false);
  });
  it("waits for naturally closing peer backends, then rechecks clone ownership before dropping",async()=>{
    const target=new ReservationLocalTarget(memoryIO().io),{pool}=leasePool(),{source,query}=fakeSource();
    await target.acquire(pool);await target.createTemporary(source,temporary);
    const previous=query.getMockImplementation()!;let sessions=1;
    query.mockImplementation(async(sql)=>sql.includes("select 1 from pg_stat_activity")
      ?{rows:sessions-- > 0 ? [{oid:"777"}] : [],rowCount:sessions>=0?1:0}:previous(sql));
    await target.dropTemporary(source,temporary);
    expect(query.mock.calls.filter(([sql])=>sql.startsWith("drop database"))).toHaveLength(1);
    expect(query.mock.calls.filter(([sql])=>sql.includes("owner_ok"))).toHaveLength(2);
    expect(query.mock.calls.some(([sql])=>/pg_terminate_backend|force/.test(sql))).toBe(false);
  });
  it("never retries an uncertain creation or deletes an unconfirmed result",async()=>{
    const target=new ReservationLocalTarget(memoryIO().io),{pool}=leasePool(),{source,query}=fakeSource();await target.acquire(pool);
    query.mockImplementation(async(sql)=>{if(sql.startsWith("create database"))throw new Error("MOCK timeout");return {rows:[],rowCount:0};});
    await expect(target.createTemporary(source,temporary)).rejects.toThrow("timeout");
    await expect(target.createTemporary(source,temporary)).rejects.toThrow("never retry");
    await expect(target.dropTemporary(source,temporary)).rejects.toThrow("does not own");
  });
  it("refuses concurrent unsafe activity and releases the lease",async()=>{
    const target=new ReservationLocalTarget(memoryIO().io),{pool,lease}=leasePool(true);
    await expect(target.acquire(pool)).rejects.toThrow("Concurrent unsafe");expect(lease.release).toHaveBeenCalledWith(true);
    expect(lease.query.mock.calls.some(([sql])=>sql.includes("application_name is distinct from"))).toBe(true);
  });
  it("refuses a competing reservation validation lease",async()=>{
    const target=new ReservationLocalTarget(memoryIO().io),{pool,lease}=leasePool(false,false);
    await expect(target.acquire(pool)).rejects.toThrow("Another local");expect(lease.release).toHaveBeenCalledWith(true);
  });
  it("denies late setup continuations after lease teardown",async()=>{
    const target=new ReservationLocalTarget(memoryIO().io),{pool}=leasePool(),{source,query}=fakeSource();
    await target.acquire(pool);await target.release();
    await expect(target.createTemporary(source,temporary)).rejects.toThrow("closed");
    expect(query).not.toHaveBeenCalled();expect(()=>target.pool()).toThrow("closed");
  });
});

describe("rollback and preservation",()=>{
  it("advances only a positively owned clone through 150 then atomic 158; source remains exactly 142",async()=>{
    const target=new ReservationLocalTarget(memoryIO().io),{pool}=leasePool(),{source}=fakeSource();
    await target.acquire(pool);await target.createTemporary(source,temporary);
    const session=(n:number,oid="777",db=temporary)=>({query:vi.fn()
      .mockResolvedValueOnce({rows:[{db,oid,owner_ok:true,role:"postgres",session_role:"postgres",port:5432,directory:pin.dataDirectory,cluster:pin.cluster}]})
      .mockResolvedValueOnce({rows:[{n,latest:n===146?"20261023130000":n===147?"20261023140000":n===148?"20261026100000":n===149?"20261026110000":n===150?"20261026120000":n===158?"20261027170000":pin.latestMigration}]})});
    await expect(target.acceptClonePhase(session(158),temporary,158)).rejects.toThrow("phase mismatch");
    await expect(target.acceptClonePhase(session(147),temporary,147)).rejects.toThrow("phase mismatch");
    await expect(target.acceptClonePhase(session(146),temporary,999 as 146)).rejects.toThrow("Unexpected clone");
    const wrongOwner=session(146);wrongOwner.query.mockReset().mockResolvedValueOnce({rows:[{db:temporary,oid:"777",owner_ok:false,
      role:"postgres",session_role:"postgres",port:5432,directory:pin.dataDirectory,cluster:pin.cluster}]});
    await expect(target.acceptClonePhase(wrongOwner,temporary,146)).rejects.toThrow("session mismatch");
    await expect(target.acceptClonePhase(session(146,"wrong"),temporary,146)).rejects.toThrow("session mismatch");
    await expect(target.acceptClonePhase(session(147),temporary,146)).rejects.toThrow("exactly 146");
    await target.acceptClonePhase(session(146),temporary,146);
    await target.verifySession(session(146),temporary);
    await expect(target.verifySession(session(142),temporary)).rejects.toThrow("exactly 146");
    await target.acceptClonePhase(session(147),temporary,147);
    await target.verifySession(session(147),temporary);
    await target.acceptClonePhase(session(148),temporary,148);
    await target.verifySession(session(148),temporary);
    await expect(target.verifySession(session(147),temporary)).rejects.toThrow("exactly 148");
    await expect(target.acceptClonePhase(session(150),temporary,150)).rejects.toThrow("phase mismatch");
    await target.acceptClonePhase(session(149),temporary,149);
    await target.verifySession(session(149),temporary);
    await expect(target.acceptClonePhase(session(149),temporary,150)).rejects.toThrow("exactly 150");
    await target.acceptClonePhase(session(150),temporary,150);
    await target.verifySession(session(150),temporary);
    await expect(target.verifySession(session(149),temporary)).rejects.toThrow("exactly 150");
    await target.acceptClonePhase(session(158),temporary,158);
    await target.verifySession(session(158),temporary);
    await expect(target.verifySession(session(150),temporary)).rejects.toThrow("exactly 158");
    await expect(target.acceptClonePhase(session(158,"5","postgres"),"postgres",158)).rejects.toThrow("Unsafe temporary");
    await expect(target.acceptClonePhase(session(146,"5","postgres"),"postgres",146)).rejects.toThrow("Unsafe temporary");
    await expect(target.verifySession(session(147,"5","postgres"),"postgres")).rejects.toThrow("exactly 142");
    await target.verifySession(session(142,"5","postgres"),"postgres");
  });
  it("does not register an unowned clone or accept an ambiguous phase",async()=>{
    const target=new ReservationLocalTarget(memoryIO().io),query=vi.fn();
    await expect(target.acceptClonePhase({query},temporary,146)).rejects.toThrow("Unowned");
    expect(query).not.toHaveBeenCalled();
  });
  it("invalidates every facade and closes every client even if rollback fails",async()=>{
    const failed={query:vi.fn().mockRejectedValue(new Error("MOCK rollback failure")),release:vi.fn()};
    const good={query:vi.fn().mockResolvedValue({rows:[]}),release:vi.fn()};
    const a=guardRollbackQueries(failed as unknown as PoolClient),b=guardRollbackQueries(good as unknown as PoolClient);
    await expect(rollbackReservationTransactions([a,b])).rejects.toThrow("outcome unverified; no retry");
    expect(failed.query).toHaveBeenCalledTimes(1);expect(good.query).toHaveBeenCalledTimes(1);
    expect(failed.release).toHaveBeenCalledWith(true);expect(good.release).toHaveBeenCalledWith(true);
    await expect(a.client.query("insert late")).rejects.toThrow("closed or aborted");
    await expect(b.client.query("insert late")).rejects.toThrow("closed or aborted");
  });
  it("rejects a timed-out continuation without contacting its client",async()=>{
    const controller=new AbortController(),raw={query:vi.fn(),release:vi.fn()},t=guardRollbackQueries(raw as unknown as PoolClient,controller.signal);
    controller.abort();await expect(t.client.query("insert late")).rejects.toThrow();expect(raw.query).not.toHaveBeenCalled();
  });
  it("snapshots retain residue and cover Auth/Storage, security metadata and sequences",async()=>{
    const query=vi.fn(async(sql:string)=>{
      if(sql.includes("c.relkind in"))return {rows:[{name:"public.products"},{name:"public.inventory_balances"},{name:"auth.users"},{name:"storage.objects"},{name:"storage.s3_multipart_uploads"}]};
      if(sql.includes("c.relkind='S'"))return {rows:[{name:"public.example_sequence"}]};
      return {rows:[{digest:"covered"}]};
    });
    const snapshot=await reservationSnapshot({query} as never);
    for(const key of ["public.products","public.inventory_balances","auth.users","storage.objects","storage.s3_multipart_uploads","security","sequence:public.example_sequence"])
      expect(Object.keys(snapshot)).toContain(key);
    expect(query.mock.calls.some(([sql])=>sql.includes(pin.residue)||sql.includes("where t.id"))).toBe(false);
  });
  it("optionally covers Realtime data and sequence state for activation source preservation",async()=>{
    const query=vi.fn(async(sql:string)=>sql.includes("c.relkind in")?{rows:[{name:"realtime.messages"}]}
      :sql.includes("c.relkind='S'")?{rows:[{name:"realtime.messages_id_seq"}]}:{rows:[{digest:"covered"}]});
    const snapshot=await reservationSnapshot({query} as never,true);
    expect(Object.keys(snapshot)).toContain("realtime.messages");expect(Object.keys(snapshot)).toContain("sequence:realtime.messages_id_seq");
    expect(query.mock.calls.some(([sql])=>sql.includes("'realtime'"))).toBe(true);
  });
  it("keeps guard usage and original assertions in both harnesses",()=>{
    for(const file of ["foundation","concurrency"]) {
      const source=readFileSync(`test/backend/finished-goods-reservation-${file}.backend.ts`,"utf8");
      expect(source).toContain("guardRollbackQueries(");expect(source).toContain("rollbackReservationTransactions(");
      expect(source).toContain("target.assertQuiet()");expect(source).toContain("LOCAL_RESERVATION.residue");
      expect(source).not.toContain('?? "postgres"');expect(source).not.toContain("execFileSync");
    }
  });
});
