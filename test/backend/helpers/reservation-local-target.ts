import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Duplex } from "node:stream";
import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { Pool, type PoolClient, type PoolConfig, type QueryResult } from "pg";
import type { guardRollbackQueries } from "./rollback-query-guard";

// Same reviewed pins as the unexecuted Task 001K maintenance launcher. This
// helper never invokes that launcher and has no remote/alternate-target option.
export const LOCAL_RESERVATION = Object.freeze({
  repository: "/Users/test/Desktop/internal-tool",
  docker: "/Applications/Docker.app/Contents/Resources/bin/docker",
  socket: "/Users/test/.docker/run/docker.sock",
  container: "supabase_db_internal-tool",
  containerId: "50416e38711a58257ad21846015cafe224a959ae6fc80c34eb45ccb94e5dc7ff",
  cluster: "7699375188763602981",
  pgBin: "/nix/store/axzw4y8zm4i1q6kay5rgkqavn2p1lzll-postgresql-17.6/bin",
  perl: "/nix/store/0gfsfmgbyy35akc4waha0cq3gf6xan1r-perl-5.42.0/bin/perl",
  socketDirectory: "/var/run/postgresql",
  dataDirectory: "/var/lib/postgresql/data",
  migrationCount: 142,
  latestMigration: "20261022150000",
  residue: "e27050dc-358a-466a-b734-0a5167d04979",
});
const hostEnvironment = Object.freeze({ PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" });
const containerEnvironment = ["PATH=/usr/bin:/bin", "LC_ALL=C", "TZ=UTC",
  "LOCALE_ARCHIVE=/nix/var/nix/profiles/default/lib/locale/locale-archive"];
const temporaryPattern = /^alfaev_fg_3b1_[a-f0-9]{32}$/;
const advisoryKey = "alfaev-fg-reservation-local-validation";
export type ReservationClonePhase = 142 | 146 | 147 | 148 | 149 | 150;
const phaseVersion = { 142: "20261022150000", 146: "20261023130000", 147: "20261023140000", 148: "20261026100000", 149: "20261026110000", 150: "20261026120000" } as const;

// Transport only: pg still owns the real protocol, parameters, roles and sessions.
// Existing container Perl forwards bytes to ONE fixed local Unix socket as OS postgres.
// No listener, password, shell, files, HBA change or remote address is involved.
const relay = `use strict; use warnings; use IO::Socket::UNIX; use IO::Select;
binmode STDIN; binmode STDOUT; $SIG{PIPE}='IGNORE';
my $s=IO::Socket::UNIX->new(Type=>SOCK_STREAM,Peer=>'/var/run/postgresql/.s.PGSQL.5432') or die 'local socket unavailable';
my $r=IO::Select->new(\\*STDIN,$s);
while(1){for my $h($r->can_read){my $n=sysread($h,my $b,65536); exit 0 if defined($n)&&$n==0; die 'read failed' unless defined $n;
my $out=fileno($h)==fileno(STDIN)?$s:\\*STDOUT; my $offset=0;
while($offset<$n){my $w=syswrite($out,$b,$n-$offset,$offset); die 'write failed' unless defined($w)&&$w>0; $offset+=$w;}}}`;
export class ContainerPeerStream extends Duplex {
  private child?: ChildProcessWithoutNullStreams;
  private watchdog?: ReturnType<typeof setTimeout>;
  setNoDelay() { return this; }
  setKeepAlive() { return this; }
  ref() { this.child?.ref(); return this; }
  unref() { this.child?.unref(); return this; }
  connect(path: string) {
    if (path!==`${LOCAL_RESERVATION.socketDirectory}/.s.PGSQL.5432` || this.child)
      throw new Error("Unexpected container-local socket connection");
    const args=containerArguments([LOCAL_RESERVATION.perl,"-e",relay],"postgres",true);
    args[args.indexOf("75")]="300"; // Bound the actual container-side session, not only docker.
    const child=this.child=spawn(LOCAL_RESERVATION.docker,args,
      {cwd:LOCAL_RESERVATION.repository,env:hostEnvironment,stdio:["pipe","pipe","pipe"]});
    child.once("spawn",()=>this.emit("connect"));
    child.stdout.on("data",chunk=>{if(!this.push(chunk)) child.stdout.pause();});
    child.stderr.resume(); // Never expose server/authentication output.
    child.stdin.on("error",()=>this.destroy(new Error("Pinned container transport input closed")));
    child.once("error",()=>this.destroy(new Error("Pinned container transport failed")));
    child.once("close",code=>{
      if(code && !this.destroyed) this.destroy(new Error(`Pinned container transport exited ${code}`));
      else {this.push(null);this.destroy();}
    });
    this.watchdog=setTimeout(()=>this.destroy(new Error("Pinned container transport timeout")),310_000);
    this.watchdog.unref();
    return this;
  }
  _read() { this.child?.stdout.resume(); }
  _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null)=>void) {
    if(!this.child) return callback(new Error("Local transport not connected"));
    this.child.stdin.write(chunk,encoding,callback);
  }
  _final(callback: (error?: Error | null)=>void) { this.child?.stdin.end(); callback(); }
  _destroy(error: Error | null, callback: (error?: Error | null)=>void) {
    if(this.watchdog) clearTimeout(this.watchdog);
    this.child?.stdin.destroy(); // EOF terminates relay and closes server socket/transaction.
    this.child?.stdout.destroy();
    callback(error);
  }
}

type ContainerMetadata = {
  Id: string; Name: string; Running: boolean; Labels: Record<string,string>;
  Mounts: { Destination: string; Type: string; Name: string; RW: boolean }[];
  Ports: Record<string,{HostIp: string; HostPort: string}[] | null>;
};
type VolumeMetadata = { Name: string; Driver: string; Scope: string;
  Labels: Record<string,string>; Options: unknown };
type SqlClient = { query(text: string, values?: unknown[]): Promise<QueryResult> };
export type LocalIO = {
  cwd(): string;
  realpath(path: string): string;
  socketExists(path: string): boolean;
  command(args: string[], input?: Buffer): Buffer;
};
const realIO: LocalIO = {
  cwd: () => process.cwd(), realpath: realpathSync,
  socketExists: path => statSync(path).isSocket(),
  command: runPinnedDocker,
};

export function runPinnedDocker(args: string[], input?: Buffer): Buffer {
  if (args[0]!=="--host" || args[1]!==`unix://${LOCAL_RESERVATION.socket}`)
    throw new Error("Wrong Docker socket; external command denied");
  try {
    return execFileSync(LOCAL_RESERVATION.docker,args,{
      cwd: LOCAL_RESERVATION.repository, env: hostEnvironment, input,
      timeout: 100_000, maxBuffer: 128 * 1024 * 1024, stdio: ["pipe","pipe","pipe"],
    });
  } catch (error) {
    // Captured dumps, container environment and server messages never escape.
    const failure = error as {status?: number | null; signal?: string | null};
    throw new Error(`Pinned local Docker command failed (status ${failure.status ?? "unknown"}, signal ${failure.signal ?? "none"}); outcome unverified`);
  }
}

export function dockerArguments(args: string[]) {
  return ["--host",`unix://${LOCAL_RESERVATION.socket}`,...args];
}
export function containerArguments(args: string[], user = "postgres", stdin = false) {
  if (!["postgres","supabase_admin"].includes(user)) throw new Error("Unexpected container OS identity");
  // Always execute as OS postgres. supabase_admin is ONLY a libpq role used by
  // the existing local HBA rule during restoration, never an OS/user override.
  return dockerArguments(["exec",...(stdin ? ["-i"] : []),"--user","postgres",
    LOCAL_RESERVATION.containerId,"/usr/bin/env","-i",...containerEnvironment,
    "/usr/bin/timeout","-s","TERM","-k","5","75",...args]);
}
export function assertLocalSocket(cwd: string, socket: string, isSocket: boolean) {
  if (cwd !== LOCAL_RESERVATION.repository || socket !== LOCAL_RESERVATION.socket || !isSocket)
    throw new Error("Pinned repository/Docker socket mismatch");
}
export function assertDockerIdentity(row: ContainerMetadata, volume: VolumeMetadata, control: string) {
  const pin = LOCAL_RESERVATION;
  if (row.Id !== pin.containerId || row.Name !== `/${pin.container}` || !row.Running
      || row.Labels?.["com.supabase.cli.project"] !== "internal-tool"
      || row.Labels?.["com.supabase.cli.workdir"] !== pin.repository)
    throw new Error("Pinned local container/project identity mismatch");
  const mounts = row.Mounts.filter(m=>m.Destination===pin.dataDirectory);
  if (mounts.length!==1 || mounts[0]?.Type!=="volume" || mounts[0]?.Name!==pin.container || !mounts[0]?.RW)
    throw new Error("Pinned local database mount mismatch");
  // Existing approved Docker Desktop bindings; do not change network settings.
  const bindings = (row.Ports["5432/tcp"] ?? []).map(p=>`${p.HostIp}:${p.HostPort}`).sort();
  if (JSON.stringify(bindings)!==JSON.stringify(["0.0.0.0:54322",":::54322"].sort()))
    throw new Error("Pinned PostgreSQL port mapping mismatch");
  if (volume.Name!==pin.container || volume.Driver!=="local" || volume.Scope!=="local"
      || volume.Labels?.["com.supabase.cli.project"]!=="internal-tool"
      || (volume.Options!==null && JSON.stringify(volume.Options)!=="{}"))
    throw new Error("Pinned local volume identity mismatch");
  if (control.match(/^Database system identifier:\s+(\d+)\s*$/m)?.[1]!==pin.cluster)
    throw new Error("Pinned PostgreSQL cluster mismatch");
}
export function assertTemporaryDatabase(name: string) {
  if (!temporaryPattern.test(name)) throw new Error("Unsafe temporary database identity");
}
export function localPoolOptions(database: string, application: string,
                                 environment: NodeJS.ProcessEnv = process.env): PoolConfig {
  if (database!=="postgres") assertTemporaryDatabase(database);
  if (!/^alfaev_fg_[a-f0-9]{32}$/.test(application)) throw new Error("Unsafe test application identity");
  if (Object.keys(environment).some(key=>key.startsWith("PG") || ["DATABASE_URL","SUPABASE_DB_URL"].includes(key)))
    throw new Error("Ambient PostgreSQL connection configuration is forbidden");
  const password = environment.LOCAL_SUPABASE_DB_PASSWORD;
  return Object.freeze({ host:password?"127.0.0.1":LOCAL_RESERVATION.socketDirectory,
    port:password?54322:5432, database, user:"postgres",
    password:password ?? (()=>{throw new Error("Peer authentication required; password authentication forbidden");}),
    ...(!password?{stream:()=>new ContainerPeerStream()}:{}),
    ssl:false, sslnegotiation:"postgres", max:4, connectionTimeoutMillis:5000,
    application_name:application, client_encoding:"UTF8", options:"-c search_path=pg_catalog,public -c timezone=UTC",
    statement_timeout:60_000, query_timeout:65_000, lock_timeout:3000, idle_in_transaction_session_timeout:15_000 });
}
export function assertResolvedConnection(row: Record<string,unknown>, database: string, application: string) {
  const tcp=row.host==="127.0.0.1" && row.port===54322 && typeof row.password==="string" && !!row.password;
  const peer=row.host===LOCAL_RESERVATION.socketDirectory && row.port===5432 && typeof row.password==="function";
  if ((!tcp && !peer) || row.database!==database || row.user!=="postgres"
      || row.ssl!==false || row.sslnegotiation!=="postgres" || row.application_name!==application
      || row.options!=="-c search_path=pg_catalog,public -c timezone=UTC" || row.replication)
    throw new Error("Unexpected PostgreSQL connection configuration");
}

// A narrow wrapper verifies each newly checked-out TCP session before exposing
// it to fixtures. No query is forwarded to an unverified session.
export class LocalReservationPool {
  private readonly pool: Pool;
  constructor(private readonly target: ReservationLocalTarget, readonly database: string) {
    target.verifyDocker();
    target.assertDatabaseAllowed(database);
    const options = localPoolOptions(database,target.application);
    this.pool = new Pool(options);
  }
  async connect(): Promise<PoolClient> {
    this.target.assertDatabaseAllowed(this.database);
    const client = await this.pool.connect();
    try {
      assertResolvedConnection((client as unknown as {connectionParameters: Record<string,unknown>}).connectionParameters,
        this.database,this.target.application);
      await this.target.verifySession(client,this.database);
      this.target.assertDatabaseAllowed(this.database);
      return client;
    } catch (error) { client.release(true); throw error; }
  }
  async query(text: string, values?: unknown[]): Promise<QueryResult> {
    const client = await this.connect();
    let failed=false;
    try { this.target.assertDatabaseAllowed(this.database); return await client.query(text,values); }
    catch (error) { failed=true; throw error; }
    finally { client.release(failed); }
  }
  async end() { await this.pool.end(); }
}

export class ReservationLocalTarget {
  readonly application = `alfaev_fg_${randomUUID().replace(/-/g,"")}`;
  private readonly owned = new Map<string,string>();
  private readonly attempted = new Set<string>();
  private readonly phases = new Map<string, ReservationClonePhase>();
  private lease?: PoolClient;
  private closed = false;
  constructor(private readonly io: LocalIO = realIO) {}
  private command(args: string[], input?: Buffer) { return this.io.command(args,input); }
  verifyDocker() {
    if (this.closed) throw new Error("Local validation target is closed; late work denied");
    const pin = LOCAL_RESERVATION;
    assertLocalSocket(this.io.realpath(this.io.cwd()),this.io.realpath(pin.socket),this.io.socketExists(pin.socket));
    const row = JSON.parse(this.command(dockerArguments(["inspect",pin.containerId,"--format",
      '{"Id":{{json .Id}},"Name":{{json .Name}},"Running":{{json .State.Running}},"Labels":{{json .Config.Labels}},"Mounts":{{json .Mounts}},"Ports":{{json .NetworkSettings.Ports}}}'])).toString()) as ContainerMetadata;
    const volume = JSON.parse(this.command(dockerArguments(["volume","inspect",pin.container,"--format",
      '{"Name":{{json .Name}},"Driver":{{json .Driver}},"Scope":{{json .Scope}},"Labels":{{json .Labels}},"Options":{{json .Options}}}'])).toString()) as VolumeMetadata;
    const control = this.command(containerArguments([`${pin.pgBin}/pg_controldata`,pin.dataDirectory])).toString();
    assertDockerIdentity(row,volume,control);
    const read = (args: string[]) => this.command(containerArguments(args)).toString().trim();
    if (read(["/usr/bin/id","-un"])!=="postgres" || read(["/usr/bin/id","-u"])!=="100"
        || read(["/usr/bin/readlink","-f","/usr/bin/timeout"])!=="/bin/busybox")
      throw new Error("Container user/watchdog identity changed");
    for (const program of ["pg_dump","pg_restore"]) {
      if (read([`${pin.pgBin}/${program}`,"--version"])!==`${program} (PostgreSQL) 17.6`)
        throw new Error("Pinned PostgreSQL client version unavailable");
    }
    for (const [file,hash] of [
      ["/etc/postgresql/pg_hba.conf","a925911753f4975548eb4079177441c886aa22b6dd69f2b0cff98f779fb0b66a"],
      ["/etc/postgresql/pg_ident.conf","479445a89591d0ed50a39d204f8bb4a6b87649bc7e46f62fe5d96cad5f674e96"],
    ] as const) {
      if (read(["/usr/bin/sha256sum",file]).split(/\s/)[0]!==hash)
        throw new Error("Reviewed Unix-socket authentication configuration changed");
    }
    for (const [setting,value] of Object.entries({hba_file:"/etc/postgresql/pg_hba.conf",
      ident_file:"/etc/postgresql/pg_ident.conf",unix_socket_directories:pin.socketDirectory,
      data_directory:pin.dataDirectory,port:"5432"})) {
      if (read([`${pin.pgBin}/postgres`,"-D","/etc/postgresql","-C",setting])!==value)
        throw new Error("Pinned local PostgreSQL configuration mismatch");
    }
    read(["/bin/busybox","test","-S",`${pin.socketDirectory}/.s.PGSQL.5432`]);
  }
  assertDatabaseAllowed(name: string) {
    if (this.closed) throw new Error("Local validation target is closed; late work denied");
    if (name!=="postgres" && !this.owned.has(name)) throw new Error("Unowned temporary database connection denied");
  }
  pool(database = "postgres") { return new LocalReservationPool(this,database); }
  assertOwnedClone(database: string, phase?: ReservationClonePhase) {
    assertTemporaryDatabase(database);
    this.assertDatabaseAllowed(database);
    if (!this.owned.has(database) || phase !== undefined && (this.phases.get(database) ?? 142) !== phase)
      throw new Error("Owned clone phase mismatch");
  }
  // Only newly owned clones may advance, after COMMIT and a fresh identity/parity
  // check on the setup session. Source postgres ALWAYS retains its 142 guard.
  async acceptClonePhase(client: SqlClient, database: string, phase: 146 | 147 | 148 | 149 | 150) {
    if (phase !== 146 && phase !== 147 && phase !== 148 && phase !== 149 && phase !== 150) throw new Error("Unexpected clone migration phase");
    this.verifyDocker();
    this.assertOwnedClone(database, phase === 146 ? 142 : phase === 147 ? 146 : phase === 148 ? 147 : phase === 149 ? 148 : 149);
    await this.checkSession(client, database, phase);
    this.phases.set(database, phase);
  }
  async verifySession(client: SqlClient, database: string) {
    return this.checkSession(client, database, database === "postgres" ? 142 : this.phases.get(database) ?? 142);
  }
  private async checkSession(client: SqlClient, database: string, phase: ReservationClonePhase) {
    this.assertDatabaseAllowed(database);
    const row = (await client.query(`select current_database() db,current_user role,session_user session_role,
      inet_server_port() port,inet_server_addr() address,current_setting('data_directory') directory,
      (select system_identifier::text from pg_control_system()) cluster,
      (select oid::text from pg_database where datname=current_database()) oid,
      (select datdba='postgres'::regrole from pg_database where datname=current_database()) owner_ok`)).rows[0];
    const expectedPort=process.env.LOCAL_SUPABASE_DB_PASSWORD?5432:null;
    if (row?.db!==database || row.role!=="postgres" || row.session_role!=="postgres" || row.port!==expectedPort
        || (expectedPort===null && row.address!==null)
        || row.directory!==LOCAL_RESERVATION.dataDirectory || row.cluster!==LOCAL_RESERVATION.cluster
        || (database!=="postgres" && (this.owned.get(database)!==row.oid || row.owner_ok!==true)))
      throw new Error("Pinned local database/cluster/session mismatch");
    const migration = (await client.query(`select count(*)::int n,max(version) latest from supabase_migrations.schema_migrations`)).rows[0];
    if (migration?.n!==phase || migration.latest!==phaseVersion[phase])
      throw new Error(`Local migration parity must be exactly ${phase} before fixtures`);
  }
  async acquire(pool: LocalReservationPool) {
    this.verifyDocker();
    if (pool.database!=="postgres") throw new Error("Validation lease requires the pinned postgres database");
    if (this.lease) throw new Error("Local validation lease already acquired");
    const client = await pool.connect();
    try {
      const row = (await client.query("select pg_try_advisory_lock(hashtextextended($1,0)) held",[advisoryKey])).rows[0];
      if (!row?.held) throw new Error("Another local reservation validation is running");
      this.lease = client;
      await this.assertQuiet();
    } catch (error) { this.lease=undefined; client.release(true); throw error; }
  }
  async assertQuiet() {
    this.verifyDocker();
    if (!this.lease) throw new Error("Missing exclusive local test lease");
    const row = (await this.lease.query(`select exists(select 1 from pg_stat_activity
      where backend_type='client backend' and datname=any($1::text[])
        and pid<>pg_backend_pid() and application_name is distinct from $2 and state is distinct from 'idle') unsafe`,
      [["postgres",...this.owned.keys()],this.application])).rows[0];
    if (!row || row.unsafe!==false) throw new Error("Concurrent unsafe local database activity; stop without fixtures");
  }
  async release() {
    this.closed=true;
    const lease=this.lease; this.lease=undefined;
    if (lease) lease.release(true); // Session close releases the advisory lock even on SQL failure.
  }
  async createTemporary(source: LocalReservationPool, name: string) {
    if (source.database!=="postgres") throw new Error("Temporary creation requires the pinned postgres control database");
    assertTemporaryDatabase(name); await this.assertQuiet();
    if (this.attempted.has(name)) throw new Error("Temporary creation must never retry");
    if ((await source.query("select oid from pg_database where datname=$1",[name])).rowCount!==0)
      throw new Error("Temporary database already exists; never adopt or remove it");
    // A timed-out setup continuation must not dispatch CREATE after teardown.
    this.assertDatabaseAllowed("postgres");
    if (!this.lease) throw new Error("Local test lease ended before creation");
    this.attempted.add(name);
    await source.query(`create database "${name}" template template0 owner postgres`);
    const row=(await source.query("select oid::text oid from pg_database where datname=$1 and datdba=(select oid from pg_roles where rolname='postgres')",[name])).rows[0];
    if (!row?.oid) throw new Error("Temporary creation outcome unverified; no automatic deletion");
    this.owned.set(name,row.oid);
    this.phases.set(name,142);
  }
  private libpq(database: string, role: string) {
    return `host=${LOCAL_RESERVATION.socketDirectory} port=5432 dbname=${database} user=${role} passfile=/dev/null connect_timeout=5 sslmode=disable gssencmode=disable application_name=${this.application} options='-c statement_timeout=60000 -c lock_timeout=3000'`;
  }
  copyIntoTemporary(name: string) {
    assertTemporaryDatabase(name); this.assertDatabaseAllowed(name); this.verifyDocker();
    const archive = this.command(containerArguments([`${LOCAL_RESERVATION.pgBin}/pg_dump`,
      "--no-password","--dbname",this.libpq("postgres","postgres"),"-Fc"]));
    this.verifyDocker();
    this.command(containerArguments([`${LOCAL_RESERVATION.pgBin}/pg_restore`,"--no-password",
      "--exit-on-error","--dbname",this.libpq(name,"supabase_admin")],"supabase_admin",true),archive);
  }
  async dropTemporary(source: LocalReservationPool, name: string) {
    if (source.database!=="postgres") throw new Error("Temporary cleanup requires the pinned postgres control database");
    assertTemporaryDatabase(name); await this.assertQuiet();
    const oid=this.owned.get(name);
    if (!oid) throw new Error("Cleanup denied: this run does not own this database");
    const rows=(await source.query(`select oid::text oid,datdba=(select oid from pg_roles where rolname='postgres') owner_ok
      from pg_database where datname=$1`,[name])).rows;
    if (rows.length!==1 || rows[0]?.oid!==oid || rows[0]?.owner_ok!==true)
      throw new Error("Cleanup denied: temporary database identity changed");
    // pg Pool.end() closes the transport before the peer relay/backend necessarily
    // disappears from pg_stat_activity. Wait only for natural disconnects; never
    // terminate a backend or force-drop, and never retry a DROP after uncertainty.
    const deadline=Date.now()+2000;
    while ((await source.query("select 1 from pg_stat_activity where datname=$1",[name])).rowCount!==0) {
      if(Date.now()>=deadline) throw new Error(`Cleanup denied: owned clone ${name} still has clients; no forced termination`);
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    const final=(await source.query(`select oid::text oid,datdba=(select oid from pg_roles where rolname='postgres') owner_ok
      from pg_database where datname=$1`,[name])).rows;
    if(final.length!==1 || final[0]?.oid!==oid || final[0]?.owner_ok!==true)
      throw new Error("Cleanup denied: temporary database identity changed while draining");
    await source.query(`drop database "${name}"`);
    this.owned.delete(name);
    this.phases.delete(name);
  }
}

export async function rollbackReservationTransactions(transactions: ReturnType<typeof guardRollbackQueries>[]) {
  transactions.forEach(t=>t.close());
  const errors: unknown[]=[];
  for (const transaction of transactions) {
    try { await transaction.raw.query("rollback"); }
    catch (error) { errors.push(error); }
    finally { transaction.raw.release(true); }
  }
  if (errors.length) throw new Error(`Rollback failed for ${errors.length} connection(s); outcome unverified; no retry`);
}

export async function reservationSnapshot(client: SqlClient, includeRealtime = false) {
  const schemaPredicate = includeRealtime
    ? "n.nspname in ('public','auth','storage','supabase_migrations','realtime')"
    : "n.nspname in ('public','auth','storage','supabase_migrations')";
  const safeName = includeRealtime ? /^(public|auth|storage|supabase_migrations|realtime)\.[a-z_][a-z0-9_]*$/
    : /^(public|auth|storage|supabase_migrations)\.[a-z_][a-z0-9_]*$/;
  const state: Record<string,unknown>={};
  const tables=(await client.query(`select format('%I.%I',n.nspname,c.relname) name from pg_class c
    join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and ${schemaPredicate} order by 1`)).rows;
  for (const {name} of tables) {
    if (!safeName.test(name)) throw new Error("Unsafe snapshot table");
    state[name]=(await client.query(`select count(*)::text n,
      md5(coalesce(string_agg(to_jsonb(t)::text,chr(10) order by to_jsonb(t)::text),'')) digest from ${name} t`)).rows;
  }
  state.security=(await client.query(`select md5(jsonb_build_object(
    'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${schemaPredicate}),
    'tables',(select jsonb_agg(jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity) order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace where ${schemaPredicate}),
    'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where ${schemaPredicate}),
    'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p),
    'constraints',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_constraint c),
    'roles',(select jsonb_agg(to_jsonb(r) order by r.oid) from pg_roles r),
    'memberships',(select jsonb_agg(to_jsonb(m) order by m.oid) from pg_auth_members m),
    'schemas',(select jsonb_agg(to_jsonb(n) order by n.oid) from pg_namespace n where ${schemaPredicate}),
    'defaults',(select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d),
    'event_triggers',(select jsonb_agg(to_jsonb(e) order by e.oid) from pg_event_trigger e)
    )::text) digest`)).rows;
  // Preserve sequence state too; never call nextval/setval or reset counters.
  for (const {name} of (await client.query(`select format('%I.%I',n.nspname,c.relname) name
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='S' and ${schemaPredicate} order by 1`)).rows) {
    if (!safeName.test(name)) throw new Error("Unsafe sequence snapshot");
    state[`sequence:${name}`]=(await client.query(`select last_value::text,is_called from ${name}`)).rows;
  }
  return state;
}
