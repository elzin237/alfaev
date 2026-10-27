import { spawn } from "node:child_process";
import { createHash, randomUUID, X509Certificate } from "node:crypto";
import { constants, closeSync, fstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Explicit native-Node TS loading without changing the application's TS config.
const { buildTestCalculatorAtomicBatch, TEST_CALCULATOR_MIGRATIONS } =
  createRequire(import.meta.url)("./test-calculator-atomic-batch.ts") as typeof import("./test-calculator-atomic-batch");
export const DEV_REF = "yzysgbrpbhiapalgetau";
export const BATCH_SHA256 = "983a56d1f50d38c7db9a2cc55b6cca5e9b7a2815db5d8ddfc533e1880326538c";
const repository = "/Users/test/Desktop/internal-tool";
export const PSQL = "/Users/test/Applications/Postgres.app/Contents/Versions/17/bin/psql";
export const DEV_CA_FILE = `${repository}/scripts/deployment/certificates/supabase-root-2021.crt`;
export const DEV_CA_FINGERPRINT = "807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA";
// Public CA from the exact HTTPS URL in Supabase's official dashboard config:
// apps/studio/hooks/custom-content/custom-content.json (supabase/supabase).
// https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
// "prod" is the vendor's hosted-platform CA label, not an AlfaEV production target.
export function validateDevCa(pem: string) {
  try {
    requireGuard((pem.match(/BEGIN CERTIFICATE/g) ?? []).length === 1 && !/PRIVATE KEY/.test(pem), "INVALID_DEV_CA");
    const ca = new X509Certificate(pem);
    requireGuard(ca.fingerprint256.replace(/:/g, "") === DEV_CA_FINGERPRINT && ca.ca
      && ca.subject === ca.issuer && ca.verify(ca.publicKey)
      && Date.parse(ca.validFrom) <= Date.now() && Date.parse(ca.validTo) > Date.now(), "INVALID_DEV_CA");
    return ca;
  } catch { throw new DeploymentFailure("INVALID_DEV_CA"); }
}
export function verifiedDevCa() {
  const fd = openSync(DEV_CA_FILE, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { requireGuard(fstatSync(fd).isFile(), "INVALID_DEV_CA_FILE"); return validateDevCa(readFileSync(fd, "utf8")); }
  finally { closeSync(fd); }
}
const approval = "151-158-atomic-once";
// Last independently verified DEV baseline. Drift requires review, not recapture-and-accept.
export const APPROVED_DATA: Record<string, [string, string]> = {
  products: ["64", "7330832b16162d3e012ad5e8ee608de0"],
  inventory_balances: ["192", "4032d46f877f8d2da875ac358dde702d"],
  inventory_movements: ["83", "f87440ecb1779f8eee621e33d0b1224b"],
  inventory_source_lots: ["37", "9da70a1da12c2e82adb5d8b90d78118c"],
  inventory_source_allocations: ["24", "0101260187ebcda18137f956de0dcdf0"],
  finished_goods_project_reservations: ["2", "c9be6b8b88f6e8b096be6a7c78943fdd"],
  finished_goods_project_reservation_events: ["4", "250a2853c5aa2afbcbbb31841ca78bff"],
  projects: ["11", "e753dda79ef0411261aaac8d4fb15830"],
  project_products: ["22", "fb2a6689363897d0e323a307e7dac15e"],
  project_product_components: ["18", "eca751ba75efd378f5f9f7e76d112b15"],
  work_orders: ["46", "78dfe3a3810b0d60a48251306d566b1c"],
  pcb_production_runs: ["12", "a9943fb02226afd525acdd99fbe90a37"],
  audit_logs: ["385", "12d0f8d97e9a53fd47b2ddb07d97a600"],
  project_shortage_episodes: ["7", "86048750735ad6be17999ae32ba7988d"],
  project_shortage_events: ["8", "9aca3f7e746e021079cf031736d12fb9"],
};
type Data = Record<string, [string, string]>;
type FunctionState = { name: string; body: string; privileges: string };
export type Snapshot = {
  migrations: string[]; data: Data; stock: string[]; negative: number; overreserved: number;
  definers: number; permissions: number; platform: boolean; testRows: number | null;
  privateTables: boolean; rpcGrants: boolean; functions: Record<string, FunctionState>;
  publicTables: number; rlsTables: number;
  security: Record<string, string>;
};
export type TemporaryLogin = { role: string; password: string };
export type PsqlInvocation = { executable: string; args: string[]; env: Record<string, string>; input: string; backendPid?: number };
export type AdapterIO = {
  project(): Promise<{ id: string; name: string; status: string }>;
  snapshot(): Promise<Snapshot>;
  login(): Promise<TemporaryLogin>;
  execute(plan: PsqlInvocation): Promise<void>;
  settled(plan: PsqlInvocation): Promise<boolean>;
};
export class DeploymentFailure extends Error {
  readonly safeCode: string;
  constructor(safeCode: string) { super(safeCode); this.name = "DeploymentFailure"; this.safeCode = safeCode; }
}
function requireGuard(condition: unknown, code: string): asserts condition {
  if (!condition) throw new DeploymentFailure(code);
}
export function reviewedBatch() {
  verifiedDevCa();
  const body = buildTestCalculatorAtomicBatch();
  requireGuard(createHash("sha256").update(body).digest("hex") === BATCH_SHA256, "BATCH_HASH_MISMATCH");
  return body;
}
export function sessionIdentitySql(applicationName: string) {
  requireGuard(/^alfaev_tc_deploy_[a-f0-9]{32}$/.test(applicationName), "INVALID_SESSION_TAG");
  // Supavisor need not forward PGAPPNAME. Bind the unique tag on the actual
  // backend, transaction-locally, then verify both session identity and the
  // pg_stat_activity identity used by independent settlement checks. psql -1
  // encloses this bootstrap AND the unchanged batch in the same transaction.
  // Commit/rollback automatically restores the pooler's previous tag.
  return `SET SESSION ROLE postgres; SET LOCAL application_name='${applicationName}'; DO $identity$ BEGIN IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'cli_login_postgres' OR current_setting('application_name')<>'${applicationName}' OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity WHERE pid=pg_backend_pid() AND datname=current_database() AND usename=session_user AND application_name='${applicationName}') THEN RAISE EXCEPTION 'DEV session identity mismatch'; END IF; END $identity$; SELECT 'TC_DEPLOY_PID='||pg_backend_pid();`;
}
export function psqlInvocation(login: TemporaryLogin, body: string): PsqlInvocation {
  verifiedDevCa();
  requireGuard(login.role === "cli_login_postgres" && typeof login.password === "string"
    && login.password.length > 0 && login.password.length <= 512 && !/[\x00-\x20\x7f]/.test(login.password), "INVALID_TEMPORARY_LOGIN");
  requireGuard(createHash("sha256").update(body).digest("hex") === BATCH_SHA256, "BATCH_HASH_MISMATCH");
  const applicationName = `alfaev_tc_deploy_${randomUUID().replace(/-/g, "")}`;
  return { executable: PSQL, args: ["-X", "--no-password", "--set=ON_ERROR_STOP=1", "--single-transaction", "--tuples-only", "--no-align",
    `--command=${sessionIdentitySql(applicationName)}`,
    "--file=-"], input: body,
    // Child-only, in-memory libpq credential handoff. Never mutate process.env,
    // serialize this object, log it, use Docker env config or persist a passfile.
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC", PGHOST: "aws-0-eu-central-1.pooler.supabase.com",
      PGPORT: "5432", PGDATABASE: "postgres", PGUSER: `${login.role}.${DEV_REF}`, PGPASSWORD: login.password,
      PGCONNECT_TIMEOUT: "10", PGSSLMODE: "verify-full", PGSSLROOTCERT: DEV_CA_FILE, PGPASSFILE: "/dev/null",
      PGAPPNAME: applicationName } };
}
function verifyPreflight(s: Snapshot, localVersions: string[]) {
  requireGuard(JSON.stringify(s.migrations) === JSON.stringify(localVersions.slice(0, 150)), "MIGRATION_BASELINE_MISMATCH");
  for (const [table, value] of Object.entries(APPROVED_DATA))
    requireGuard(JSON.stringify(s.data[`public.${table}`]) === JSON.stringify(value), "BUSINESS_BASELINE_MISMATCH");
  requireGuard(JSON.stringify(s.stock) === JSON.stringify(["4189", "13", "0"]) && s.negative === 0 && s.overreserved === 0, "STOCK_BASELINE_MISMATCH");
  requireGuard(s.definers === 191 && s.permissions === 39 && s.platform && s.testRows === null
    && s.publicTables === 43 && s.rlsTables === 43, "SECURITY_BASELINE_MISMATCH");
}
function sameExistingData(before: Snapshot, after: Snapshot) {
  for (const [table, value] of Object.entries(before.data))
    requireGuard(JSON.stringify(after.data[table]) === JSON.stringify(value), "DATA_PRESERVATION_FAILED");
  requireGuard(JSON.stringify(before.stock) === JSON.stringify(after.stock) && after.negative === 0 && after.overreserved === 0, "STOCK_PRESERVATION_FAILED");
}
export function createDevAdapter(io: AdapterIO) {
  let attempted = false;
  return async (request: { target: string; approval: string; localVersions: string[] }) => {
    requireGuard(!attempted, "ATTEMPT_ALREADY_USED"); attempted = true;
    requireGuard(request.target === DEV_REF && request.approval === approval, "DEV_AUTHORIZATION_REQUIRED");
    const body = reviewedBatch();
    requireGuard(request.localVersions.length === 158 && request.localVersions.slice(150).every((v, i) => v === TEST_CALCULATOR_MIGRATIONS[i]?.[0].slice(0, 14)), "LOCAL_MIGRATION_SCOPE_MISMATCH");
    try {
      const project = await io.project();
      requireGuard(project.id === DEV_REF && project.name === "alfaev-dev" && project.status === "ACTIVE_HEALTHY", "DEV_IDENTITY_MISMATCH");
      const before = await io.snapshot(); verifyPreflight(before, request.localVersions);
      let login: TemporaryLogin;
      try { login = await io.login(); } catch { throw new DeploymentFailure("TEMPORARY_LOGIN_FAILED"); }
      // The existing CLI flow may renew only its operational login role. Capture
      // metadata after that expected authentication step, never accept business drift.
      const ready = await io.snapshot(); verifyPreflight(ready, request.localVersions); sameExistingData(before, ready);
      for (const [key, value] of Object.entries(before.security))
        requireGuard(ready.security[key] === value, "SECURITY_CHANGED_DURING_AUTHENTICATION");
      requireGuard(JSON.stringify(ready.functions) === JSON.stringify(before.functions), "FUNCTIONS_CHANGED_DURING_AUTHENTICATION");
      const plan = psqlInvocation(login, body);
      let executionFailed = false;
      try { await io.execute(plan); } catch { executionFailed = true; }
      delete plan.env.PGPASSWORD;
      login.password = "";
      let settled = false;
      try { settled = await io.settled(plan); } catch { /* Independent read below still runs; never claim restoration. */ }
      let after: Snapshot;
      try { after = await io.snapshot(); } catch { throw new DeploymentFailure("DEPLOYMENT_OUTCOME_UNVERIFIED"); }
      requireGuard(settled, "DEPLOYMENT_BACKEND_UNVERIFIED");
      sameExistingData(before, after);
      if (executionFailed) {
        const restored = JSON.stringify(after.migrations) === JSON.stringify(before.migrations)
          && JSON.stringify(after.functions) === JSON.stringify(before.functions)
          && JSON.stringify(after.security) === JSON.stringify(before.security);
        throw new DeploymentFailure(restored ? "EXECUTION_FAILED_RESTORATION_VERIFIED" : "EXECUTION_FAILED_OUTCOME_REQUIRES_REVIEW");
      }
      requireGuard(JSON.stringify(after.migrations) === JSON.stringify(request.localVersions)
        && after.definers === 198 && after.permissions === 41 && after.platform && after.testRows === 0
        && after.privateTables && after.rpcGrants && after.publicTables === 46 && after.rlsTables === 46, "POST_DEPLOYMENT_VERIFICATION_FAILED");
      const changed = new Set(["get_production_eligible_quantity", "get_work_order_warehouse_source_allocation_plan",
        "change_finished_goods_project_reservation", "mutate_project_requirement"]);
      for (const [id, fn] of Object.entries(before.functions)) {
        const next = after.functions[id];
        requireGuard(next && next.privileges === fn.privileges && (changed.has(fn.name) || next.body === fn.body), "UNEXPECTED_FUNCTION_CHANGE");
      }
      for (const [key, value] of Object.entries(before.security))
        requireGuard(after.security[key] === value, "UNEXPECTED_SECURITY_CHANGE");
      return { verdict: "PASS", target: DEV_REF, migrations: 158, applicationDefiners: 197, platformDefiners: 1, dataPreserved: true } as const;
    } catch (error) {
      if (error instanceof DeploymentFailure) throw error;
      // Never expose raw API/driver/process errors or their causes (may contain secrets).
      throw new DeploymentFailure("PREFLIGHT_OR_VERIFICATION_FAILED");
    }
  };
}

const sixRpcs = ["search_test_calculator_products", "preview_test_calculation", "save_test_calculation",
  "get_inventory_test_commitments", "list_test_calculations", "get_test_calculation"];
function quote(value: string) { return `'${value.replace(/'/g, "''")}'`; }
function digest(query: string) { return `(select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb)::text) from (${query}) x)`; }
export function realDevIO(): AdapterIO {
  const fd = openSync("/Users/test/.supabase/access-token", constants.O_RDONLY | constants.O_NOFOLLOW);
  let token: string;
  try { const s = fstatSync(fd); requireGuard(s.isFile() && s.uid === process.getuid?.() && (s.mode & 0o077) === 0, "UNSAFE_TOKEN_FILE"); token = readFileSync(fd, "utf8").trim(); }
  finally { closeSync(fd); }
  requireGuard(/^sbp_[A-Za-z0-9_]+$/.test(token), "INVALID_ACCESS_TOKEN");
  return devHttpIO(token);
}
// Dependency injection is for connection-free/local tests only; the executable
// entrypoint always uses the native fetch and the owner-controlled token file.
export function devHttpIO(token: string, fetcher: typeof fetch = fetch): AdapterIO {
  async function api(path: "" | "/database/query" | "/cli/login-role", body?: object, timeout = 20_000) {
    const response = await fetcher(`https://api.supabase.com/v1/projects/${DEV_REF}${path}`, {
      method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(timeout),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    requireGuard(response.ok, `API_HTTP_${response.status}`); return response.json();
  }
  async function read(query: string, timeout = 20_000) { return api("/database/query", { query, read_only: true }, timeout); }
  return {
    project: () => api(""),
    login: () => api("/cli/login-role", { read_only: false }), // EXACT existing CLI flow, no reset/unban/retry.
    snapshot: async () => {
      const tables = await read("select n.nspname||'.'||c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage') and c.relkind in ('r','p') order by 1") as { name: string }[];
      requireGuard(tables.length > 40 && tables.every(t => /^(public|auth|storage)\.[a-z_][a-z_0-9]*$/.test(t.name)), "INVALID_BASELINE_TABLES");
      const datasets = tables.filter(t => !["public.permission_definitions"].includes(t.name)).map(t =>
        `select ${quote(t.name)} name,count(*)::text n,md5(coalesce(string_agg(to_jsonb(t)::text,chr(10) order by to_jsonb(t)::text),'')) hash from ${t.name} t`).join(" union all ");
      const meta = `select jsonb_build_object(
        'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
        'data',(select jsonb_object_agg(name,jsonb_build_array(n,hash)) from (${datasets}) d),
        'stock',(select jsonb_agg(q order by sort_order) from (select w.sort_order,coalesce(sum(b.quantity),0)::text q from public.inventory_warehouses w left join public.inventory_balances b on b.warehouse_id=w.id group by w.sort_order) w),
        'negative',(select count(*) from public.inventory_balances where quantity<0),
        'overreserved',(select count(*) from (select r.product_id,sum(r.reserved_quantity) q from public.finished_goods_project_reservations r group by r.product_id) r where r.q>coalesce((select quantity from public.inventory_balances b where b.product_id=r.product_id and b.warehouse_id='10000000-0000-4000-8000-000000000002'),0)),
        'definers',(select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef),
        'permissions',(select count(*) from public.permission_definitions),
        'publicTables',(select count(*) from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p')),
        'rlsTables',(select count(*) from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p') and relrowsecurity),
        'platform',exists(select 1 from pg_proc p join pg_event_trigger e on e.evtfoid=p.oid where p.oid=to_regprocedure('public.rls_auto_enable()') and p.proowner='postgres'::regrole and p.prorettype='event_trigger'::regtype and p.prosecdef and p.proconfig=array['search_path=pg_catalog'] and p.proacl is null and e.evtname='ensure_rls' and e.evtenabled='O'),
        'functions',(select jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_object('name',p.proname,'body',md5(pg_get_functiondef(p.oid)),'privileges',jsonb_build_array(p.proowner,p.proacl,p.prosecdef,p.proconfig)::text)) from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f'),
        'security',jsonb_build_object('memberships',${digest("select * from pg_auth_members")},'roles',${digest("select case when rolname='cli_login_postgres' then to_jsonb(r)-'rolvaliduntil' else to_jsonb(r) end role from pg_roles r")},'existing_tables',${digest("select c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p') and c.relname not like 'test_calculation%'")},'event_triggers',${digest("select * from pg_event_trigger")},'existing_permissions',${digest("select * from public.permission_definitions where key not in ('test_calculator.view','test_calculator.manage')")},'user_permissions',${digest("select * from public.user_permissions")})) result`;
      const s = (await read(meta))[0].result as Snapshot;
      s.testRows = null; s.privateTables = false; s.rpcGrants = false;
      if (tables.some(t => t.name === "public.test_calculations")) {
        const result = (await read(`select (select count(*) from public.test_calculations)+(select count(*) from public.test_calculation_items)+(select count(*) from public.test_calculation_holds) rows,
          (select count(*)=3 and bool_and(c.relrowsecurity and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE')) from pg_class c where c.oid in ('public.test_calculations'::regclass,'public.test_calculation_items'::regclass,'public.test_calculation_holds'::regclass)) private,
          (select count(*)=6 and bool_and(has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('service_role',p.oid,'EXECUTE') and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in (${sixRpcs.map(quote).join(",")})) grants`))[0];
        s.testRows = Number(result.rows); s.privateTables = result.private; s.rpcGrants = result.grants;
      }
      return s;
    },
    execute: executeHostPsql,
    settled: async plan => {
      if (!Number.isSafeInteger(plan.backendPid) || !/^alfaev_tc_deploy_[a-f0-9]{32}$/.test(plan.env.PGAPPNAME ?? "")) return false;
      const deadline = Date.now() + 5_000;
      do {
        // Session poolers may retain/reuse an idle physical backend. Require that
        // THIS uniquely named client's transaction is gone, not that the pool dies.
        const rows = await read(`select not exists(select 1 from pg_stat_activity where pid=${plan.backendPid}
          and application_name=${quote(plan.env.PGAPPNAME!)} and (state is distinct from 'idle' or xact_start is not null)) settled`, Math.max(1, deadline - Date.now()));
        if (rows[0]?.settled === true) return true;
        await new Promise(resolve => setTimeout(resolve, 250));
      } while (Date.now() < deadline);
      return false;
    },
  };
}
export async function executeHostPsql(plan: PsqlInvocation): Promise<void> {
  requireGuard(plan.executable === PSQL && realpathSync(process.cwd()) === repository, "INVALID_EXECUTION_CONTEXT");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(PSQL, plan.args, { cwd: repository, env: plan.env, stdio: ["pipe", "pipe", "pipe"] });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, 90_000);
    const kill = setTimeout(() => { child.kill("SIGKILL"); }, 95_000);
    let pending = "";
    child.stdout.on("data", (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      const lines = pending.split("\n"); pending = (lines.pop() ?? "").slice(-256);
      for (const line of lines) { const pid = /^TC_DEPLOY_PID=(\d+)$/.exec(line.trim());
        if (pid && Number.isSafeInteger(Number(pid[1]))) plan.backendPid = Number(pid[1]); }
    });
    child.stderr.resume(); // Never print raw libpq/server output.
    child.stdin.on("error", () => { /* close/error below determines uncertain outcome */ });
    child.on("error", () => { clearTimeout(timer); clearTimeout(kill); reject(new DeploymentFailure("PSQL_PROCESS_FAILED")); });
    child.on("close", code => { clearTimeout(timer); clearTimeout(kill); delete plan.env.PGPASSWORD;
      if (code === 0 && !timedOut) resolve(); else reject(new DeploymentFailure("PSQL_EXECUTION_UNCERTAIN")); });
    child.stdin.end(plan.input);
  });
}
// Importing this module cannot authenticate or deploy. Default invocation is check-only.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try {
    const args = process.argv.slice(2); reviewedBatch();
    if (args.length === 0 || JSON.stringify(args) === JSON.stringify(["--check-only"])) {
      console.log(JSON.stringify({ verdict: "CHECK_ONLY", target: DEV_REF, batch: BATCH_SHA256, liveAuthentication: false }));
    } else {
      requireGuard(JSON.stringify(args) === JSON.stringify(["--execute-dev", `--approval=${approval}`]), "DEV_AUTHORIZATION_REQUIRED");
      const { readdirSync } = await import("node:fs");
      const versions = readdirSync("supabase/migrations").filter(f => f.endsWith(".sql")).sort().map(f => f.slice(0, 14));
      console.log(JSON.stringify(await createDevAdapter(realDevIO())({ target: DEV_REF, approval, localVersions: versions })));
    }
  } catch (error) { console.error(JSON.stringify({ verdict: "BLOCKED", code: error instanceof DeploymentFailure ? error.safeCode : "ADAPTER_FAILED" })); process.exitCode = 1; }
}
