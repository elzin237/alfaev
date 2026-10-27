import { readFileSync, readdirSync } from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { APPROVED_DATA, BATCH_SHA256, DEV_REF, DEV_CA_FILE, DEV_CA_FINGERPRINT, PSQL, createDevAdapter, devHttpIO, executeHostPsql, psqlInvocation, reviewedBatch, sessionIdentitySql, validateDevCa, verifiedDevCa,
  type AdapterIO, type Snapshot } from "../scripts/deployment/test-calculator-dev-adapter";

const versions = readdirSync("supabase/migrations").filter(f => f.endsWith(".sql")).sort().map(f => f.slice(0, 14));
const request = { target: DEV_REF, approval: "151-158-atomic-once", localVersions: versions };
const secret = "MOCK_SECRET_NEVER_LOG";
vi.mock("node:child_process",async importOriginal=>{
  const actual=await importOriginal<typeof import("node:child_process")>(),mockSpawn=vi.fn();
  return {...actual,default:{...actual,spawn:mockSpawn},spawn:mockSpawn};
});
function before(): Snapshot {
  return { migrations: versions.slice(0,150), data: Object.fromEntries(Object.entries(APPROVED_DATA).map(([k,v])=>[`public.${k}`,[...v]])),
    stock:["4189","13","0"],negative:0,overreserved:0,definers:191,permissions:39,platform:true,testRows:null,
    privateTables:false,rpcGrants:false,publicTables:43,rlsTables:43,functions:{"public.rls_auto_enable()":{name:"rls_auto_enable",body:"immutable",privileges:"postgres"}},security:{roles:"same",rls:"same"} };
}
function after(): Snapshot { return {...before(),migrations:versions,definers:198,permissions:41,testRows:0,privateTables:true,rpcGrants:true,publicTables:46,rlsTables:46}; }
function mocks() {
  const io: AdapterIO = { project:vi.fn(async()=>({id:DEV_REF,name:"alfaev-dev",status:"ACTIVE_HEALTHY"})),
    login:vi.fn(async()=>({role:"cli_login_postgres",password:secret})),
    snapshot:vi.fn().mockResolvedValueOnce(before()).mockResolvedValueOnce(before()).mockResolvedValue(after()),
    execute:vi.fn(async()=>{}),settled:vi.fn(async()=>true) };
  return io;
}
describe("DEV-only atomic deployment adapter, no live authentication",()=>{
  it("verifies the pinned official CA and rejects malformed or mixed certificate content", () => {
    const ca=verifiedDevCa(); expect(ca.fingerprint256.replace(/:/g, "")).toBe(DEV_CA_FINGERPRINT);
    expect(ca.subject).toContain("CN=Supabase Root 2021 CA"); expect(ca.ca).toBe(true); expect(ca.verify(ca.publicKey)).toBe(true);
    expect(()=>validateDevCa("not a certificate")).toThrow("INVALID_DEV_CA");
    const pem=readFileSync(DEV_CA_FILE,"utf8");
    expect(()=>validateDevCa(pem+pem)).toThrow("INVALID_DEV_CA");
    expect(()=>validateDevCa(pem+"PRIVATE KEY")).toThrow("INVALID_DEV_CA");
  });
  it("uses the approved unchanged batch and fixed non-secret invocation",()=>{
    const body=reviewedBatch(),p=psqlInvocation({role:"cli_login_postgres",password:secret},body);
    expect(BATCH_SHA256).toBe("983a56d1f50d38c7db9a2cc55b6cca5e9b7a2815db5d8ddfc533e1880326538c");
    expect(p.executable).toBe(PSQL);expect(p.input).toBe(body);
    expect(p.args).toEqual(expect.arrayContaining(["-X","--no-password","--set=ON_ERROR_STOP=1","--single-transaction","--file=-"]));
    expect(p.args.join(" ")).toContain("SET SESSION ROLE postgres");
    expect(p.args.join(" ")).toContain("session_user<>'cli_login_postgres'");
    expect(p.args.join(" ")+p.input).not.toContain(secret);
    expect(p.env).toMatchObject({PGHOST:"aws-0-eu-central-1.pooler.supabase.com",PGPORT:"5432",PGDATABASE:"postgres",
      PGUSER:`cli_login_postgres.${DEV_REF}`,PGPASSWORD:secret,PGSSLMODE:"verify-full",PGSSLROOTCERT:DEV_CA_FILE,PGPASSFILE:"/dev/null"});
    expect(p.env).not.toHaveProperty("PGSERVICE");expect(p.env).not.toHaveProperty("SUPABASE_ACCESS_TOKEN");
  });
  it("binds and verifies a backend-local transaction tag before the unchanged batch",()=>{
    const p=psqlInvocation({role:"cli_login_postgres",password:secret},reviewedBatch());
    const sql=sessionIdentitySql(p.env.PGAPPNAME!);
    expect(p.args).toContain(`--command=${sql}`);
    expect(sql.indexOf("SET LOCAL application_name=")).toBeLessThan(sql.indexOf("DO $identity$"));
    expect(sql).toContain("pid=pg_backend_pid() AND datname=current_database() AND usename=session_user");
    expect(sql).toContain(`application_name='${p.env.PGAPPNAME}'`);
    expect(sql).toContain("current_user<>'postgres'");expect(sql).toContain("session_user<>'cli_login_postgres'");
    expect(sql).not.toMatch(/\b(?:COMMIT|ROLLBACK)\b/);expect(p.args).toContain("--single-transaction");
    expect(p.args.indexOf(`--command=${sql}`)).toBeLessThan(p.args.indexOf("--file=-"));
    expect(p.input).toBe(reviewedBatch());
  });
  it.each(["", "other", "alfaev_tc_deploy_"+"0".repeat(31), "alfaev_tc_deploy_"+"0".repeat(32)+"';COMMIT;"])("rejects invalid session tag %s",tag=>{
    expect(()=>sessionIdentitySql(tag)).toThrow("INVALID_SESSION_TAG");
  });
  it("independently rejects an active tagged backend and accepts its completed transaction",async()=>{
    vi.useFakeTimers();
    const transport=vi.fn(async()=>new Response(JSON.stringify([{settled:false}]),{status:200}));
    const io=devHttpIO("sbp_MOCK_ONLY",transport as typeof fetch);
    const plan=psqlInvocation({role:"cli_login_postgres",password:secret},reviewedBatch());plan.backendPid=12345;
    try {
      const active=io.settled(plan);await vi.advanceTimersByTimeAsync(5000);expect(await active).toBe(false);
      const [,init]=transport.mock.calls[0] as unknown as [string,RequestInit];
      const body=JSON.parse(init.body as string);expect(body.read_only).toBe(true);
      expect(body.query).toContain("pid=12345");expect(body.query).toContain(plan.env.PGAPPNAME);
      transport.mockImplementation(async()=>new Response(JSON.stringify([{settled:true}]),{status:200}));
      expect(await io.settled(plan)).toBe(true);
      delete plan.backendPid;transport.mockClear();expect(await io.settled(plan)).toBe(false);expect(transport).not.toHaveBeenCalled();
    } finally {vi.useRealTimers();}
  });
  it("executes once and independently verifies data/security after authentication and commit",async()=>{
    const io=mocks(),run=createDevAdapter(io);expect((await run(request)).verdict).toBe("PASS");
    expect(io.login).toHaveBeenCalledTimes(1);expect(io.execute).toHaveBeenCalledTimes(1);expect(io.snapshot).toHaveBeenCalledTimes(3);
    const plan=vi.mocked(io.execute).mock.calls[0]![0];expect(plan.env).not.toHaveProperty("PGPASSWORD");
    await expect(run(request)).rejects.toThrow("ATTEMPT_ALREADY_USED");expect(io.execute).toHaveBeenCalledTimes(1);
  });
  it.each(["production","",DEV_REF+"x"])("rejects non-pinned target %s before authentication",async target=>{
    const io=mocks();await expect(createDevAdapter(io)({...request,target})).rejects.toThrow("DEV_AUTHORIZATION_REQUIRED");expect(io.project).not.toHaveBeenCalled();expect(io.login).not.toHaveBeenCalled();
  });
  it("requires explicit authorization and exact local migration scope",async()=>{
    const io=mocks();await expect(createDevAdapter(io)({...request,approval:""})).rejects.toThrow("DEV_AUTHORIZATION_REQUIRED");
    await expect(createDevAdapter(io)({...request,localVersions:versions.slice(1)})).rejects.toThrow("LOCAL_MIGRATION_SCOPE_MISMATCH");expect(io.login).not.toHaveBeenCalled();
  });
  it.each(["id","name","status"])("rejects incorrect project %s",async key=>{
    const io=mocks();vi.mocked(io.project).mockResolvedValue({id:DEV_REF,name:"alfaev-dev",status:"ACTIVE_HEALTHY",[key]:"wrong"});
    await expect(createDevAdapter(io)(request)).rejects.toThrow("DEV_IDENTITY_MISMATCH");expect(io.login).not.toHaveBeenCalled();
  });
  it.each(["migrations","data","stock","definers","platform"])("fails closed on baseline %s drift",async key=>{
    const io=mocks(),s=before();Object.assign(s,{[key]:key==="platform"?false:key==="definers"?192:[]});vi.mocked(io.snapshot).mockReset().mockResolvedValue(s);
    await expect(createDevAdapter(io)(request)).rejects.toThrow(/BASELINE_MISMATCH/);expect(io.login).not.toHaveBeenCalled();expect(io.execute).not.toHaveBeenCalled();
  });
  it("redacts authentication failures and never executes or retries",async()=>{
    const io=mocks(),log=vi.spyOn(console,"log").mockImplementation(()=>{}),error=vi.spyOn(console,"error").mockImplementation(()=>{});
    vi.mocked(io.login).mockRejectedValue(new Error(`password=${secret}`));
    try{await expect(createDevAdapter(io)(request)).rejects.toThrow("TEMPORARY_LOGIN_FAILED");expect(io.execute).not.toHaveBeenCalled();expect(log).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();}
    finally{log.mockRestore();error.mockRestore();}
  });
  it.each([{role:"postgres",password:secret},{role:"cli_login_postgres",password:""},{role:"cli_login_postgres",password:"bad\nvalue"}])("rejects invalid temporary credentials",login=>{
    expect(()=>psqlInvocation(login,reviewedBatch())).toThrow("INVALID_TEMPORARY_LOGIN");
  });
  it("rejects altered SQL without running it",()=>expect(()=>psqlInvocation({role:"cli_login_postgres",password:secret},reviewedBatch()+"\n")).toThrow("BATCH_HASH_MISMATCH"));
  it("rechecks baseline after authentication and stops on concurrent drift",async()=>{
    const io=mocks(),ready=before();ready.security.roles="changed";vi.mocked(io.snapshot).mockReset().mockResolvedValueOnce(before()).mockResolvedValue(ready);
    await expect(createDevAdapter(io)(request)).rejects.toThrow("SECURITY_CHANGED_DURING_AUTHENTICATION");expect(io.execute).not.toHaveBeenCalled();
  });
  it("reports SQL failure separately from verified restoration, never PASS or retry",async()=>{
    const io=mocks();vi.mocked(io.execute).mockRejectedValue(new Error(secret));vi.mocked(io.snapshot).mockReset().mockResolvedValue(before());
    await expect(createDevAdapter(io)(request)).rejects.toThrow("EXECUTION_FAILED_RESTORATION_VERIFIED");expect(io.execute).toHaveBeenCalledTimes(1);expect(io.snapshot).toHaveBeenCalledTimes(3);
  });
  it("does not claim success after a lost response even if the migration committed",async()=>{
    const io=mocks();vi.mocked(io.execute).mockRejectedValue(new Error(secret));
    await expect(createDevAdapter(io)(request)).rejects.toThrow("EXECUTION_FAILED_OUTCOME_REQUIRES_REVIEW");expect(io.execute).toHaveBeenCalledTimes(1);
  });
  it("reports unverified outcome when the independent post-check cannot connect",async()=>{
    const io=mocks();vi.mocked(io.snapshot).mockReset().mockResolvedValueOnce(before()).mockResolvedValueOnce(before()).mockRejectedValue(new Error(secret));
    await expect(createDevAdapter(io)(request)).rejects.toThrow("DEPLOYMENT_OUTCOME_UNVERIFIED");expect(io.execute).toHaveBeenCalledTimes(1);
  });
  it("cannot report restoration or success while the previous backend is unverified",async()=>{
    const io=mocks();vi.mocked(io.settled).mockResolvedValue(false);
    await expect(createDevAdapter(io)(request)).rejects.toThrow("DEPLOYMENT_BACKEND_UNVERIFIED");
    expect(io.snapshot).toHaveBeenCalledTimes(3);expect(io.execute).toHaveBeenCalledTimes(1);
  });
  it.each(["data","rpcGrants","privateTables","definers","functions"])("rejects post-deployment %s drift",async key=>{
    const io=mocks(),s=after();Object.assign(s,{[key]:key==="data"?{}:key==="functions"?{}:key==="definers"?197:false});
    vi.mocked(io.snapshot).mockReset().mockResolvedValueOnce(before()).mockResolvedValueOnce(before()).mockResolvedValue(s);
    await expect(createDevAdapter(io)(request)).rejects.toThrow();expect(io.execute).toHaveBeenCalledTimes(1);
  });
  it("pins existing CLI login transport, disables redirects/retries and never writes credentials",()=>{
    const source=readFileSync("scripts/deployment/test-calculator-dev-adapter.ts","utf8");
    expect(source).toContain('api("/cli/login-role", { read_only: false })');expect(source).toContain('redirect: "error"');
    expect(source).toContain('SET SESSION ROLE postgres');expect(source).not.toMatch(/writeFile|appendFile|network-bans|setInterval/);
    expect(source).toContain('delete plan.env.PGPASSWORD');expect(source).toContain('liveAuthentication: false');
  });
  it("uses the exact CLI login endpoint with in-memory bearer auth and no credentials in the URL",async()=>{
    const transport=vi.fn(async()=>new Response(JSON.stringify({role:"cli_login_postgres",password:secret}),{status:201}));
    const io=devHttpIO("sbp_MOCK_ONLY",transport as typeof fetch);await io.login();
    const [url,init]=transport.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe(`https://api.supabase.com/v1/projects/${DEV_REF}/cli/login-role`);expect(url).not.toContain(secret);
    expect(init).toMatchObject({method:"POST",redirect:"error",body:'{"read_only":false}'});
    expect(init.headers).toMatchObject({Authorization:"Bearer sbp_MOCK_ONLY"});expect(transport).toHaveBeenCalledTimes(1);
  });
  it("does not retry failed login transport",async()=>{
    const transport=vi.fn(async()=>new Response("redacted",{status:403}));
    await expect(devHttpIO("sbp_MOCK_ONLY",transport as typeof fetch).login()).rejects.toThrow("API_HTTP_403");expect(transport).toHaveBeenCalledTimes(1);
  });
  it("bounds the real psql client, discards output and never retries a timeout",async()=>{
    vi.useFakeTimers();
    const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn(()=>true)});
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const plan=psqlInvocation({role:"cli_login_postgres",password:secret},reviewedBatch());
    const work=executeHostPsql(plan),rejected=expect(work).rejects.toThrow("PSQL_EXECUTION_UNCERTAIN");
    try {await vi.advanceTimersByTimeAsync(95_000);expect(child.kill.mock.calls).toEqual([["SIGTERM"],["SIGKILL"]]);
      child.stdout.write("TC_DEPLOY_PID=12345\n");child.stdout.write(secret);child.stderr.write(secret);child.emit("close",0);await rejected;
      expect(plan.backendPid).toBe(12345);
      expect(spawn).toHaveBeenCalledTimes(1);expect(plan.env).not.toHaveProperty("PGPASSWORD");
    }finally{vi.useRealTimers();vi.mocked(spawn).mockReset();}
  });
});
