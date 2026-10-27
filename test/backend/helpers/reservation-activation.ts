// TEST ONLY. Importing this module performs no Docker, database or HTTP operation.
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { PoolClient } from "pg";
import { LOCAL_RESERVATION, dockerArguments, runPinnedDocker,
  type LocalReservationPool, type ReservationLocalTarget } from "./reservation-local-target";

export const ACTIVATION = Object.freeze({
  image: "sha256:b574528fe109c8343c1247155734d03df8c34b462f342dca0ccc20244fc36ef9",
  existingRestId: "a7ee80d6998c8a55727790b47ec5826bf1ccdc2c7fd3616a14e0c94df21ad41e",
  network: "supabase_network_internal-tool",
  networkId: "8ca46f147ecef1a7fc5dbe17eccb1713aa96f2459733b12ae7b17527c7cbf026",
  pre: { database: "alfaev_fg_3b1_28854f93ef3847d4b7efba3a6e651142", phase: 146,
    name: "alfaev-fg-3d3d-pre-28854f93", port: 55471 },
  post: { database: "alfaev_fg_3b1_0290f743d6b845f9be339387ae62e8fa", phase: 147,
    name: "alfaev-fg-3d3d-post-0290f743", port: 55472 },
} as const);
export type ActivationSide = "pre" | "post";
export type ActivationContext = { phase: "preflight" | "source" | "clone" | "migration" | "security" | "http" | "cleanup";
  operation: string; side?: ActivationSide };
const safeCodes = new Set(["EACCES", "ENOENT", "ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT", "ABORT_ERR",
  "42501", "42601", "42703", "42704", "42883", "42P01", "23505", "23503", "40P01", "40001", "57014", "53300", "57P01",
  "28P01", "28000", "3D000", "08001", "08006",
  "PGRST000", "PGRST001", "PGRST002", "PGRST003", "PGRST200", "PGRST202", "PGRST301", "PGRST302", "PGRST303"]);
const knownGuards = new Map([
  ["Local migration parity must be exactly 142 before fixtures", "source-migration-parity"],
  ["Local migration parity must be exactly 146 before fixtures", "clone-146-parity"],
  ["Local migration parity must be exactly 147 before fixtures", "clone-147-parity"],
  ["Unexpected trusted-function security inventory", "trusted-function-inventory"],
  ["Unexpected mutation wrapper ACL/signature", "wrapper-acl-signature"],
  ["Private reservation helper exposed or ambiguous", "private-helper-acl"],
  ["Reservation RLS/table boundary changed", "reservation-table-boundary"],
  ["Reviewed Unix-socket authentication configuration changed", "peer-authentication-config"],
  ["Concurrent unsafe local database activity; stop without fixtures", "quiet-local-target"],
  ["Owned PostgREST identity/loopback/clone mismatch; no cleanup permitted", "owned-http-identity"],
  ["Invalid watchdog", "watchdog-handshake"],
  ["Container watchdog unavailable", "watchdog-startup"],
]);
// No raw message, cause, stack, stderr, query, argv or environment is retained.
// Context is authored by this runner, never derived from a server/container error.
export class ActivationFailure extends Error {
  constructor(readonly diagnostic: string) { super(diagnostic); this.name = "ActivationFailure"; }
}
export function activationFailure(context: ActivationContext, error: unknown): ActivationFailure {
  if (error instanceof ActivationFailure) return error;
  const value = error as { code?: unknown; name?: unknown; message?: unknown } | null;
  const docker = typeof value?.message === "string" ? value.message.match(
    /^Pinned local Docker command failed \(status (unknown|-?\d{1,3}), signal (none|SIGTERM|SIGKILL|SIGABRT)\); outcome unverified$/) : null;
  const code = typeof value?.code === "string" && safeCodes.has(value.code) ? value.code :
    docker ? `DOCKER_EXIT_${docker[1]}_${docker[2]}` : "unavailable";
  const guard = typeof value?.message === "string" ? knownGuards.get(value.message) : undefined;
  const category = guard ? "guard" : code !== "unavailable" ? "coded-operation" :
    value?.name === "AssertionError" ? "assertion" : value?.name === "AbortError" ? "interrupted" : "operation";
  const resource = context.side ? `${ACTIVATION[context.side].database}/${ACTIVATION[context.side].name}` : "pinned-local-source";
  return new ActivationFailure(`phase=${context.phase}; operation=${context.operation}; resource=${resource}; category=${category}; code=${code}; guard=${guard ?? "unclassified"}`);
}
export async function activationStep<T>(context: ActivationContext, action: () => T | Promise<T>): Promise<T> {
  try { return await action(); } catch (error) { throw activationFailure(context, error); }
}
export async function rollbackActivationFailure(db: Pick<PoolClient,"query">, context: ActivationContext, original: unknown): Promise<never> {
  const primary=activationFailure(context,original);
  try { await db.query("rollback"); }
  catch(error) { throw new ActivationFailure(`${primary.message}; rollback-status=UNVERIFIED; ${activationFailure(
    {phase:"cleanup",operation:"rollback-failed-setup-transaction",side:context.side},error).message}`); }
  throw primary;
}
export type ActivationCleanup = { status: "COMPLETE" | "FAILED" | "UNVERIFIED"; diagnostics: string[] };
export function cleanupVerdict(remaining: boolean, verified: boolean, diagnostics: string[]): ActivationCleanup {
  return { status: remaining ? "FAILED" : verified ? "COMPLETE" : "UNVERIFIED", diagnostics };
}
export const activationMigrations = [
  ["20261023100000_add_finished_goods_project_reservation_foundation.sql", "2ebc25516dd399a1bf340ee38cb9c242ef0d82666d4c6f858516afb5c10cbcd8"],
  ["20261023110000_protect_finished_goods_hard_reservations.sql", "f5e6f68a2df0692f0e2827baefe29d33d7da6b267a125e5b723eab46317e324b"],
  ["20261023120000_add_finished_goods_reservation_fulfillment.sql", "3504ef24ca9f3863934d782c43780f32153b610c037de02330e26291d4b87173"],
  ["20261023130000_add_project_finished_goods_reservation_context.sql", "e74f6bb184e06c999c72a6f2e141fb77fcc82a6d5da0d69194189cc09ba6bdba"],
  ["20261023140000_activate_finished_goods_project_reservation_mutations.sql", "b406f25f49e4e434b61e50aba85adcbd093686f089624a730ad6841b76a7d660"],
] as const;
export function checkedActivationSql() {
  return activationMigrations.map(([name, hash]) => {
    const bytes = readFileSync(`${LOCAL_RESERVATION.repository}/supabase/migrations/${name}`);
    if (createHash("sha256").update(bytes).digest("hex") !== hash) throw new Error("Frozen reservation SQL changed");
    return bytes.toString("utf8");
  });
}
export function requireActivationAuthorization(environment: NodeJS.ProcessEnv) {
  if (environment.FG_RESERVATION_ACTIVATION_LOCAL !== "1" ||
      environment.FG_RESERVATION_ACTIVATION_APPROVAL !== "isolated-clones-only")
    throw new Error("Separate isolated activation runtime authorization required");
  if (environment.FG_RESERVATION_ACTIVATION_DIAGNOSTIC !== undefined &&
      environment.FG_RESERVATION_ACTIVATION_DIAGNOSTIC !== "readiness-only")
    throw new Error("Unexpected activation diagnostic mode");
  if (Object.keys(environment).some(k => k.startsWith("PG") ||
      ["DATABASE_URL", "SUPABASE_DB_URL", "LOCAL_SUPABASE_DB_PASSWORD", "DOCKER_HOST", "DOCKER_CONTEXT"].includes(k)))
    throw new Error("Ambient connection configuration forbidden; use the documented clean invocation");
}
export async function waitForActivationClients(target: ReservationLocalTarget, source: LocalReservationPool, database: string,
  now: () => number = Date.now, pause: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve,100))) {
  if (source.database !== "postgres") throw new Error("Client drain requires the protected source control session");
  target.assertOwnedClone(database);
  const deadline=now()+8000;
  while(now()<deadline) {
    const row=(await source.query("select count(*)::int clients from pg_stat_activity where datname=$1",[database])).rows[0];
    // A delayed query must not authorize a late DROP after the polling deadline.
    if(now()>=deadline || !Number.isInteger(row?.clients) || row.clients<0) break;
    if(row.clients===0)return;
    await pause();
  }
  throw new Error("Owned clone clients did not drain; retain clone without termination or forced drop");
}
export const mutationSignatures = [
  "public.reserve_finished_goods_for_project(uuid,uuid,bigint,bigint,uuid)",
  "public.release_finished_goods_project_reservation(uuid,uuid,bigint,bigint,uuid)",
  "public.fulfill_finished_goods_project_reservation(uuid,uuid,uuid,bigint,bigint,uuid)",
] as const;
const privateNames = ["change_finished_goods_project_reservation", "calculate_project_product_demand",
  "calculate_open_project_commitments", "protect_finished_goods_reserved_stock", "protect_finished_goods_reservation_demand",
  "protect_finished_goods_reservation_project_lifecycle", "validate_finished_goods_fulfillment_link",
  "apply_inventory_delta_in_warehouse", "enforce_finished_goods_reservation_history",
  "get_production_eligible_quantity", "get_work_order_warehouse_source_allocation_plan"];

// Separate from the existing pre-activation general security suite. No old
// assertion is weakened or switched globally by an activation environment flag.
export async function assertActivationSecurity(db: Pick<PoolClient, "query">, active: boolean) {
  const roles = (await db.query(`select rolname,rolsuper,rolbypassrls,rolinherit,rolcanlogin from pg_roles
    where rolname=any(array['authenticator','authenticated','anon']) order by rolname`)).rows;
  if (roles.length !== 3 || roles.some(r => r.rolsuper || r.rolbypassrls ||
      r.rolinherit !== (r.rolname !== "authenticator") || r.rolcanlogin !== (r.rolname === "authenticator")))
    throw new Error("Application database roles are unexpectedly privileged");
  const memberships = (await db.query(`select r.rolname from pg_auth_members m join pg_roles r on r.oid=m.roleid
    where m.member='authenticator'::regrole order by r.rolname`)).rows.map(r => r.rolname);
  if (JSON.stringify(memberships) !== '["anon","authenticated","service_role"]')
    throw new Error("Unexpected authenticator role membership");
  const rows = (await db.query(`select p.oid::text oid,n.nspname,p.proname,p.prosecdef,p.provolatile,p.proconfig,
    p.oid::regprocedure::text signature,
    has_function_privilege('authenticated',p.oid,'execute') browser,
    has_function_privilege('anon',p.oid,'execute') anon,
    has_function_privilege('service_role',p.oid,'execute') service,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.grantee='authenticated'::regrole and a.is_grantable) browser_grantable,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.grantee=0 and a.privilege_type='EXECUTE') public
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`)).rows;
  const trusted = rows.filter(r => r.prosecdef && r.proname !== "rls_auto_enable");
  if (trusted.length !== 185 || trusted.some(r => r.public || r.anon || JSON.stringify(r.proconfig) !== '["search_path=\\"\\""]'))
    throw new Error("Unexpected trusted-function security inventory");
  for (const signature of mutationSignatures) {
    const name = signature.split(".")[1]!.split("(")[0]!;
    const matches = rows.filter(r => r.proname === name);
    const oid = (await db.query("select $1::regprocedure::oid::text oid", [signature])).rows[0]?.oid;
    if (matches.length !== 1 || matches[0]?.oid !== oid || !matches[0]?.prosecdef || matches[0]?.provolatile !== "v" ||
        matches[0]?.browser !== active || matches[0]?.browser_grantable || matches[0]?.anon || matches[0]?.service || matches[0]?.public)
      throw new Error("Unexpected mutation wrapper ACL/signature");
  }
  for (const name of privateNames) {
    const matches = rows.filter(r => r.proname === name);
    if (matches.length !== 1 || matches.some(r => r.browser || r.anon || r.service || r.public))
      throw new Error("Private reservation helper exposed or ambiguous");
  }
  for (const table of ["finished_goods_project_reservations", "finished_goods_project_reservation_events"]) {
    const row = (await db.query(`select c.relrowsecurity rls,
      exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee=0) public,
      exists(select 1 from unnest(array['anon','authenticated','service_role']) role
        where has_table_privilege(role,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) exposed
      from pg_class c where c.oid=$1::regclass`, [`public.${table}`])).rows[0];
    if (!row?.rls || row.public || row.exposed) throw new Error("Reservation RLS/table boundary changed");
  }
}

// Compare *all* catalog/function/security metadata while ignoring ONLY the
// approved authenticated EXECUTE edges. Table/data manifests are compared separately.
export async function activationCatalog(db: Pick<PoolClient, "query">) {
  const digest = (await db.query(`select md5(jsonb_build_object(
    'functions',(select jsonb_agg((to_jsonb(p)-'proacl') || jsonb_build_object('acl',(
      select jsonb_agg(to_jsonb(a) order by a.grantor,a.grantee,a.privilege_type,a.is_grantable)
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where not (
        p.oid=any($1::regprocedure[]) and a.grantee='authenticated'::regrole and a.privilege_type='EXECUTE' and not a.is_grantable)))
      order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
    'tables',(select jsonb_agg(jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl,
      'rls',c.relrowsecurity,'force',c.relforcerowsecurity) order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','auth','storage','realtime','supabase_migrations')),
    'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t),
    'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p),
    'roles',(select jsonb_agg(to_jsonb(r) order by r.oid) from pg_roles r),
    'memberships',(select jsonb_agg(to_jsonb(m) order by m.oid) from pg_auth_members m),
    'schemas',(select jsonb_agg(to_jsonb(n) order by n.oid) from pg_namespace n
      where n.nspname in ('public','auth','storage','realtime','supabase_migrations')),
    'constraints',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_constraint c),
    'event_triggers',(select jsonb_agg(to_jsonb(e) order by e.oid) from pg_event_trigger e),
    'defaults',(select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d))::text) digest`, [mutationSignatures])).rows[0]?.digest;
  if (typeof digest !== "string" || !/^[a-f0-9]{32}$/.test(digest)) throw new Error("Catalog manifest could not be verified");
  return digest;
}

type DockerCommand = (args: string[], input?: Buffer) => Buffer;
export type RestMetadata = { Id: string; Name: string; Image: string; State: { Running: boolean };
  Config: { Env: string[]; Labels: Record<string, string>; Cmd?: string[]; OpenStdin?: boolean; Tty?: boolean };
  Mounts: unknown[]; HostConfig: { PortBindings: Record<string, { HostIp: string; HostPort: string }[]>; NetworkMode: string };
  NetworkSettings: { Networks: Record<string, { NetworkID: string }>; Ports: Record<string, { HostIp: string; HostPort: string }[] | null> } };
export function cloneDatabaseUri(original: string, database: string, application: string) {
  if (![ACTIVATION.pre.database, ACTIVATION.post.database].includes(database as typeof ACTIVATION.pre.database) ||
      !/^alfaev_fg_[a-f0-9]{32}$/.test(application)) throw new Error("Unexpected HTTP clone target");
  let source: URL;
  try { source = new URL(original); } catch { throw new Error("Invalid local authenticator configuration"); }
  if (source.protocol !== "postgresql:" || source.hostname !== LOCAL_RESERVATION.container ||
      !["", "5432"].includes(source.port) || source.pathname !== "/postgres" || source.username !== "authenticator" ||
      !source.password || source.hash || source.search !== "" && source.search !== "?sslmode=disable")
    throw new Error("Unverified local authenticator configuration");
  // Reconstruct rather than forwarding arbitrary options/fallback hosts.
  const result = new URL(`postgresql://authenticator@${LOCAL_RESERVATION.container}:5432/${database}`);
  result.password = source.password;
  result.searchParams.set("application_name", application);
  result.searchParams.set("connect_timeout", "5");
  result.searchParams.set("sslmode", "disable");
  result.searchParams.set("options", "-c statement_timeout=15000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=15000");
  // URLSearchParams uses form encoding (+ for spaces); libpq URI decoding only
  // percent-decodes and preserves literal +. Fix ONLY the query, never a password.
  result.search = result.search.replace(/\+/g, "%20");
  return result.toString();
}

// Consume stderr in bounded process memory; export ONLY fixed categories/codes.
// Raw parser/connection errors may contain credentials and must never escape.
export class ActivationStartupEvidence {
  #pending = "";
  #discardLine = false;
  #truncated = false;
  #total = 0;
  #connected = false;
  #cacheLoaded = false;
  #categories = new Set<string>();
  #codes = new Set<string>();
  feed(chunk: Buffer | string) {
    const text = chunk.toString();
    this.#total += Buffer.byteLength(text);
    if(this.#total>262144){this.#pending="";this.#truncated=true;return;}
    for(const part of text.split(/(?<=\n)/)) {
      if(!this.#discardLine) this.#pending+=part;
      if(this.#pending.length>16384){this.#pending="";this.#discardLine=true;this.#truncated=true;}
      if(part.endsWith("\n")) {
        if(!this.#discardLine)this.#consume(this.#pending);
        this.#pending="";this.#discardLine=false;
      }
    }
  }
  end() { if(!this.#discardLine)this.#consume(this.#pending);this.#pending=""; }
  #consume(line: string) {
    // PostgREST 14.5 Observation prefixes, plus libpq's startup diagnostics.
    if(line.includes("Successfully connected to "))this.#connected=true;
    if(line.includes("Schema cache loaded"))this.#cacheLoaded=true;
    const categories: [RegExp,string][]=[
      [/password authentication failed|no password supplied|no pg_hba.conf entry/i,"database-authentication"],
      [/unrecognized configuration parameter|invalid connection option|invalid percent-encoded|Error in config|Failed reloading config/i,"configuration"],
      [/could not translate host name|could not resolve|Name or service not known/i,"database-dns"],
      [/Connection refused|connection timed out|Network is unreachable/i,"database-transport"],
      [/database .* does not exist/i,"database-target"],
      [/permission denied|must be owner|must be superuser/i,"database-permission"],
      [/Failed to load the schema cache/i,"schema-cache-query"],
      [/Failed to query the PostgreSQL version/i,"database-version-query"],
      [/Attempting to reconnect to the database/i,"database-retry"],
    ];
    for(const [pattern,category] of categories)if(pattern.test(line))this.#categories.add(category);
    // Never return JSON messages/details/hints or unknown error codes.
    const start=line.indexOf("{");
    if(start>=0)try{
      const parsed=JSON.parse(line.slice(start)) as {code?:unknown};
      if(typeof parsed.code==="string" && safeCodes.has(parsed.code))this.#codes.add(parsed.code);
    }catch{/* Non-JSON diagnostics are discarded, not logged. */}
  }
  snapshot() {return {connected:this.#connected,cacheLoaded:this.#cacheLoaded,
    categories:[...this.#categories].sort(),codes:[...this.#codes].sort(),truncated:this.#truncated};}
}

export async function waitForActivationIdentity(side: ActivationSide, expectedProfile: string, signal: AbortSignal,
  read: (signal: AbortSignal) => PromiseLike<{data:unknown;error:unknown;status?:number}>,
  evidence: () => ReturnType<ActivationStartupEvidence["snapshot"]>,
  now: () => number = () => performance.now(), pause: () => Promise<void> = () => new Promise(resolve=>setTimeout(resolve,200))) {
  const deadline=now()+30_000, context:ActivationContext={phase:"http",operation:"authenticated-identity-readiness",side};
  let attempts=0,status:number|undefined,failure=activationFailure(context,new Error("Identity not verified"));
  while(now()<deadline) {
    if(signal.aborted)throw activationFailure(context,{name:"AbortError"});
    const remaining=deadline-now();if(remaining<=0)break;
    attempts++;
    try {
      const response=await read(AbortSignal.any([signal,AbortSignal.timeout(Math.max(1,Math.min(10_000,remaining)))]));
      status=response.status;
      if(signal.aborted)throw {name:"AbortError"};
      if(now()<deadline && response.status===200 && !response.error && response.data===expectedProfile)return;
      failure=activationFailure(context,response.error ?? new Error("Identity mismatch"));
    }catch(error){failure=activationFailure(context,error);}
    if(signal.aborted)throw failure;
    if(now()<deadline)await pause();
  }
  throw new ActivationFailure(`${failure.message}; http_status=${Number.isInteger(status)&&status!>=100&&status!<=599?status:"unavailable"}; attempts=${attempts}; startup=${JSON.stringify(evidence())}`);
}
// PostgREST v14.5 reads its config argument with configurator-pg/BS.readFile.
// /dev/stdin is a pipe, not a mounted/written file. Percent-encode $ to prevent
// configurator interpolation. Only credentials in process/pipe memory are used.
export function activationStdinConfig(uri: string, secret: string): Buffer {
  if (!/^[A-Za-z0-9_-]{64}$/.test(secret)) throw new Error("Invalid ephemeral test signing key");
  return Buffer.from([`db-uri = ${JSON.stringify(uri.replace(/\$/g, "%24"))}`, `jwt-secret = "${secret}"`,
    'db-schemas = "public"', 'db-anon-role = "anon"', 'server-host = "0.0.0.0"', "server-port = 3000",
    "db-pool = 2", "db-pool-acquisition-timeout = 5", 'log-level = "crit"', "log-query = false",
    "db-config = false", "db-channel-enabled = false"].join("\n") + "\n");
}
function environment(row: RestMetadata) { return Object.fromEntries(row.Config.Env.map(v => { const i=v.indexOf("="); return [v.slice(0,i),v.slice(i+1)]; })); }
export function assertRestOwnership(row: RestMetadata, side: ActivationSide, id: string, run: string) {
  const config = ACTIVATION[side];
  const bindings = row.HostConfig.PortBindings;
  if (row.Id !== id || !/^[a-f0-9]{64}$/.test(id) || row.Name !== `/${config.name}` || row.Image !== ACTIVATION.image ||
      row.Config.Labels["alfaev.fg-activation.run"] !== run || row.Mounts.length ||
      row.HostConfig.NetworkMode !== ACTIVATION.network || Object.keys(bindings).length !== 1 ||
      JSON.stringify(bindings["3000/tcp"]) !== JSON.stringify([{ HostIp: "127.0.0.1", HostPort: String(config.port) }]) ||
      JSON.stringify(row.Config.Cmd) !== '["postgrest","/dev/stdin"]' || !row.Config.OpenStdin || row.Config.Tty !== false ||
      row.Config.Env.some(v => /^(PGRST_|PG)/.test(v)))
    throw new Error("Owned PostgREST identity/loopback/clone mismatch; no cleanup permitted");
  if (row.State.Running && (Object.keys(row.NetworkSettings.Networks).length !== 1 ||
      row.NetworkSettings.Networks[ACTIVATION.network]?.NetworkID !== ACTIVATION.networkId ||
      JSON.stringify(row.NetworkSettings.Ports["3000/tcp"]) !== JSON.stringify(bindings["3000/tcp"])))
    throw new Error("Unexpected live PostgREST network/binding");
}

// Independent owner-death/deadline watchdog. It receives no DB/JWT credentials,
// never executes SQL, never drops a database, and stops ONLY recorded owned IDs.
export const restWatchdogSource = `import {execFileSync} from 'node:child_process';
const [docker,socket,image,run,...ids]=process.argv.slice(1);
const command=(args)=>execFileSync(docker,['--host',socket,...args],{env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},timeout:15000,stdio:['ignore','pipe','ignore']});
let ended=false;
function stop(){if(ended)return;ended=true;clearTimeout(timer);let failed=false;
for(const id of ids){try{const r=JSON.parse(command(['inspect',id,'--format','{"Id":{{json .Id}},"Image":{{json .Image}},"Name":{{json .Name}},"Config":{"Labels":{{json .Config.Labels}}},"State":{"Running":{{json .State.Running}}}}']).toString());
if(r.Id!==id||r.Image!==image||r.Config.Labels['alfaev.fg-activation.run']!==run||!r.Name.startsWith('/alfaev-fg-3d3d-')){failed=true;continue;}
if(r.State.Running)command(['stop','--time','5',id]);}catch{failed=true;}}
process.exit(failed?1:0);}
const timer=setTimeout(stop,1200000);process.stdin.resume();process.stdin.on('data',data=>{if(data.toString()==='disarm\\n'&&!ended){ended=true;clearTimeout(timer);process.exit(0);}});process.stdin.on('end',stop);process.on('SIGTERM',stop);process.stdout.write('ready\\n');`;

export class ActivationRestResources {
  readonly runId = randomUUID();
  private readonly secret = randomBytes(48).toString("base64url");
  private readonly owned = new Map<ActivationSide, string>();
  private readonly attempted = new Set<ActivationSide>();
  private readonly configurations = new Map<ActivationSide, Buffer>();
  private readonly startup = new Map<ActivationSide, ActivationStartupEvidence>();
  private readonly attachments: { child: ChildProcessWithoutNullStreams; exit: Promise<number | null> }[] = [];
  private watchdog?: ChildProcessWithoutNullStreams;
  private watchdogExit?: Promise<number | null>;
  private watchdogStopping = false;
  private closed = false;
  constructor(private readonly target: ReservationLocalTarget, private readonly command: DockerCommand = runPinnedDocker,
    private readonly mode: "acceptance" | "readiness-only" = "acceptance") {
    if(mode!=="acceptance" && mode!=="readiness-only")throw new Error("Unexpected activation resource mode");
  }
  startupEvidence(side: ActivationSide) { return this.startup.get(side)?.snapshot() ?? new ActivationStartupEvidence().snapshot(); }
  private inspect(id: string): RestMetadata {
    return JSON.parse(this.command(dockerArguments(["inspect", id, "--format", "{{json .}}"])).toString());
  }
  token(subject: string | null, role: "authenticated" | "anon" | "service_role" = "authenticated", expired = false) {
    if (!["authenticated","anon","service_role"].includes(role) ||
        subject !== null && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(subject))
      throw new Error("Invalid test subject/role");
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role, ...(subject ? { sub: subject } : {}),
      aud: "authenticated", exp: Math.floor(Date.now()/1000) + (expired ? -60 : 300) })}`;
    return `${body}.${createHmac("sha256", this.secret).update(body).digest("base64url")}`;
  }
  create(side: ActivationSide, signal: AbortSignal) {
    if(this.mode==="readiness-only" && side!=="pre")throw new Error("Diagnostic resources are pre-activation only");
    if (signal.aborted || this.closed || this.attempted.has(side)) throw new Error("Activation run closed or repeated create");
    this.target.verifyDocker(); this.target.assertOwnedClone(ACTIVATION[side].database, ACTIVATION[side].phase);
    const network = JSON.parse(this.command(dockerArguments(["network", "inspect", ACTIVATION.network, "--format", "{{json .}}"])).toString());
    const image = this.command(dockerArguments(["image", "inspect", ACTIVATION.image, "--format", "{{.Id}}"])).toString().trim();
    if (network.Id !== ACTIVATION.networkId || network.Name !== ACTIVATION.network || image !== ACTIVATION.image)
      throw new Error("Pinned local PostgREST image/network unavailable");
    // Whitelist the one required local credential, NOT the existing JWT secret.
    const existing = JSON.parse(this.command(dockerArguments(["inspect", ACTIVATION.existingRestId, "--format",
      '{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},"State":{"Running":{{json .State.Running}}},"Config":{"Labels":{{json .Config.Labels}},"Env":[{{range .Config.Env}}{{if eq (index (split . "=") 0) "PGRST_DB_URI"}}{{json .}}{{end}}{{end}}]},"NetworkSettings":{"Networks":{{json .NetworkSettings.Networks}}}}'
    ])).toString()) as RestMetadata;
    if (existing.Id !== ACTIVATION.existingRestId || existing.Name !== "/supabase_rest_internal-tool" ||
        existing.Image !== ACTIVATION.image || !existing.State.Running ||
        existing.Config.Labels["com.supabase.cli.project"] !== "internal-tool" ||
        existing.NetworkSettings.Networks[ACTIVATION.network]?.NetworkID !== ACTIVATION.networkId)
      throw new Error("Existing local authenticator source identity changed");
    const config = ACTIVATION[side];
    // Never put credentials in Docker Config.Env (even --env-file stdin persists
    // there). Attach a config pipe only AFTER creation and ownership verification.
    const uri = cloneDatabaseUri(environment(existing).PGRST_DB_URI!, config.database, this.target.application);
    const configuration = activationStdinConfig(uri, this.secret);
    if (signal.aborted) { configuration.fill(0); throw new Error("Activation interrupted before container creation"); }
    this.attempted.add(side);
    // Docker itself rejects a name collision atomically. Never inspect/adopt a
    // pre-existing same-name container after CREATE failure or ambiguous output.
    let id: string;
    try { id = this.command(dockerArguments(["create", "--interactive", "--pull", "never", "--name", config.name,
      "--label", `alfaev.fg-activation.run=${this.runId}`, "--network", ACTIVATION.network,
      "--publish", `127.0.0.1:${config.port}:3000`, "--read-only", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges", "--restart", "no", "--log-driver", "none", "--ulimit", "core=0:0",
      ACTIVATION.image, "postgrest", "/dev/stdin"])).toString().trim(); }
    catch (error) { configuration.fill(0); throw activationFailure({phase:"http",operation:"create-container",side}, error); }
    if (!/^[a-f0-9]{64}$/.test(id)) { configuration.fill(0); throw new Error("Container creation outcome unverified; do not retry/adopt"); }
    this.owned.set(side, id);
    this.configurations.set(side, configuration);
    this.startup.set(side,new ActivationStartupEvidence());
    assertRestOwnership(this.inspect(id), side, id, this.runId);
  }
  async start(signal: AbortSignal, abort: () => void) {
    if (signal.aborted || this.closed || this.owned.size !== (this.mode==="readiness-only"?1:2) ||
        !this.owned.has("pre") || this.mode==="acceptance" && !this.owned.has("post") || this.watchdog)
      throw new Error("Incomplete activation ownership");
    const child = this.watchdog = spawn(process.execPath, ["--input-type=module", "-e", restWatchdogSource,
      LOCAL_RESERVATION.docker, `unix://${LOCAL_RESERVATION.socket}`, ACTIVATION.image, this.runId, ...this.owned.values()],
    { cwd: LOCAL_RESERVATION.repository, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, stdio: ["pipe", "pipe", "pipe"] });
    child.stderr.resume(); child.stdin.on("error", abort);
    this.watchdogExit = new Promise(resolve => { child.once("close", code => { if (!this.closed) abort(); resolve(code); }); });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Container watchdog unavailable")), 5000);
      child.once("error", () => { clearTimeout(timer); reject(new Error("Container watchdog unavailable")); });
      child.stdout.once("data", data => { clearTimeout(timer); data.toString() === "ready\n" ? resolve() : reject(new Error("Invalid watchdog")); });
    });
    const stopWatchdog = () => { this.watchdogStopping=true; if (!child.stdin.writableEnded) child.stdin.end(); };
    signal.addEventListener("abort", stopWatchdog, { once: true });
    if (signal.aborted) stopWatchdog();
    for (const [side,id] of this.owned) {
      if (signal.aborted) throw new Error("Activation interrupted before start");
      this.target.verifyDocker(); this.target.assertOwnedClone(ACTIVATION[side].database, ACTIVATION[side].phase);
      assertRestOwnership(this.inspect(id), side, id, this.runId);
      const configuration = this.configurations.get(side);
      if (!configuration) throw new Error("Missing in-memory PostgREST configuration");
      // No shell, TTY, env-file, mount, secret argv or output capture. Docker's
      // attached stdin transports bytes to /dev/stdin without storing Config.Env.
      const attached = spawn(LOCAL_RESERVATION.docker, dockerArguments(["start", "--attach", "--interactive", id]),
        { cwd: LOCAL_RESERVATION.repository, env: { PATH:"/usr/bin:/bin", LC_ALL:"C" }, stdio:["pipe","pipe","pipe"] });
      attached.stdout.resume(); // No access/query output is retained.
      const evidence=this.startup.get(side)!;
      attached.stderr.on("data",chunk=>evidence.feed(chunk));
      attached.stderr.once("end",()=>evidence.end()); // Raw stderr never goes to console, files or error causes.
      const exit = new Promise<number | null>(resolve => {
        attached.once("error", () => { if (!this.closed) abort(); resolve(null); });
        attached.once("close", code => { if (!this.closed) abort(); resolve(code); });
      });
      this.attachments.push({child:attached,exit});
      attached.stdin.on("error", () => { if (!this.closed) abort(); });
      try {
        await new Promise<void>((resolve,reject) => {
          const timer = setTimeout(() => reject(new Error("Config pipe delivery timeout")),5000);
          const failure = () => { clearTimeout(timer); reject(new Error("Config pipe delivery failed")); };
          attached.once("error",failure); attached.stdin.once("error",failure);
          attached.stdin.end(configuration, () => { clearTimeout(timer); resolve(); });
        });
      } finally { configuration.fill(0); this.configurations.delete(side); }
      let running=false;
      for(let attempt=0;attempt<30;attempt++) {
        if(signal.aborted)throw new Error("Activation interrupted during HTTP startup");
        const row = this.inspect(id);
        assertRestOwnership(row, side, id, this.runId);
        if(row.State.Running){running=true;break;}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if (!running) throw new Error("Owned PostgREST did not start");
    }
  }
  async close(): Promise<ActivationCleanup> {
    this.closed = true;
    if (!this.attempted.size && !this.watchdog) return cleanupVerdict(false,true,[]);
    const diagnostics: string[] = [];
    const recorded = [...this.owned];
    let terminated = true, remaining = false, verified = true;
    for (const bytes of this.configurations.values()) bytes.fill(0);
    this.configurations.clear();
    for(const evidence of this.startup.values())evidence.end();
    const joinWatchdog = async (disarm: boolean) => {
      if (!this.watchdog || !this.watchdogExit) return;
      if (disarm && !this.watchdog.stdin.destroyed && !this.watchdog.stdin.writableEnded) this.watchdog.stdin.end("disarm\n");
      const code = await Promise.race([this.watchdogExit, new Promise<"timeout">(resolve => {
        const timer=setTimeout(()=>resolve("timeout"),40_000);timer.unref();
      })]);
      if (code !== 0) diagnostics.push(`phase=cleanup; operation=watchdog-stop; resource=owned-http-watchdog; category=${code === "timeout" ? "uncertain" : "nonzero-exit"}; code=${typeof code === "number" ? code : "unavailable"}`);
      if (code === "timeout") terminated = false;
    };
    // An already-triggered abort watchdog must finish before normal removal.
    // Otherwise KEEP IT ARMED during cleanup: owner death must still stop any
    // remaining container. Do not disarm the owner-death safeguard prematurely.
    if (this.watchdogStopping) await joinWatchdog(false);
    // Stop authenticated clients before database draining/drop. No force removal,
    // volume deletion, name lookup, or removal of the existing REST container.
    for (const [side,id] of this.owned) {
      try {
        this.target.verifyDocker();
        let row = this.inspect(id);
        assertRestOwnership(row, side, id, this.runId);
        if (row.State.Running) this.command(dockerArguments(["stop", "--time", "5", id]));
        row = this.inspect(id); assertRestOwnership(row, side, id, this.runId);
        if (row.State.Running) throw new Error("Owned HTTP client still running");
        this.command(dockerArguments(["rm", id])); this.owned.delete(side);
      } catch (error) { diagnostics.push(activationFailure({phase:"cleanup",operation:"stop-remove-owned-container",side},error).message); }
    }
    if (!this.watchdogStopping) {
      if (this.owned.size && this.watchdog) {
        // Cleanup failure retains the original watchdog's positive-ID stop
        // protection. EOF invokes that protection; it never removes/adopts.
        this.watchdogStopping=true;
        if (!this.watchdog.stdin.writableEnded) this.watchdog.stdin.end();
        await joinWatchdog(false);
      } else await joinWatchdog(true);
    }
    for (const {exit} of this.attachments) {
      const code = await Promise.race([exit, new Promise<"timeout">(resolve => {
        const timer=setTimeout(()=>resolve("timeout"),10_000);timer.unref();
      })]);
      if (code === "timeout") { terminated=false; diagnostics.push("phase=cleanup; operation=attach-client-termination; category=uncertain"); }
    }
    // Fresh independent metadata read. A failed rm is not proof of presence OR
    // absence. List only IDs/names: no secret-bearing environment is inspected.
    try {
      this.target.verifyDocker();
      const listing=this.command(dockerArguments(["ps","--all","--no-trunc","--format","{{json .}}"])).toString().trim();
      const rows=listing ? listing.split("\n").map(line => JSON.parse(line) as {ID:string;Names:string}) : [];
      if (rows.some(r=>!/^[a-f0-9]{64}$/.test(r.ID) || typeof r.Names!=="string")) throw new Error("Invalid container inventory");
      remaining=recorded.some(([side,id])=>rows.some(r=>r.ID===id || r.Names===ACTIVATION[side].name));
      // A CREATE without a returned recorded ID remains uncertain, never adopted.
      if ([...this.attempted].some(side=>!recorded.some(([ownedSide])=>side===ownedSide))) verified=false;
    } catch(error) { verified=false; diagnostics.push(activationFailure({phase:"cleanup",operation:"independent-container-inventory"},error).message); }
    return cleanupVerdict(remaining,verified && terminated,diagnostics);
  }
}

export function activationUrl(side: ActivationSide) { return `http://127.0.0.1:${ACTIVATION[side].port}`; }
export function routeActivationUrl(input: string, side: ActivationSide) {
  const url = new URL(input);
  if (url.origin !== activationUrl(side) || url.username || url.password || url.hash ||
      !/^\/rest\/v1\/(rpc\/[a-z_]+|finished_goods_project_reservations|finished_goods_project_reservation_events)$/.test(url.pathname))
    throw new Error("Non-loopback or unexpected activation HTTP endpoint denied");
  url.pathname = url.pathname.slice("/rest/v1".length);
  return url.toString();
}
export function activationHttp(side: ActivationSide, signal: AbortSignal, fetcher: typeof fetch = globalThis.fetch) {
  const requests: { path: string; payload: unknown; status?: number }[] = [];
  let loss: "none" | "drop" | "malformed" = "none";
  const sdk = createClient(activationUrl(side), "local-activation-test-only", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      if (signal.aborted) throw new Error("Activation run interrupted");
      const url = routeActivationUrl(String(input), side);
      const request = { path: new URL(url).pathname, payload: init?.body ? JSON.parse(String(init.body)) as unknown : null,
        status: undefined as number | undefined };
      requests.push(request); // Never retain Authorization headers or tokens.
      const response = await fetcher(url, { ...init, redirect: "error", credentials: "omit", cache: "no-store",
        signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10_000)]) });
      request.status = response.status;
      if (loss !== "none" && init?.method === "POST" && request.path.startsWith("/rpc/") && response.ok) {
        const mode = loss; loss = "none";
        await response.arrayBuffer(); // HTTP transaction completed BEFORE response loss.
        if (mode === "drop") throw new Error("Deliberate committed-response loss");
        return new Response("[{}]", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return response;
    } },
  });
  return { sdk, requests, loseNextSuccess: (mode: "drop" | "malformed") => { loss = mode; } };
}
