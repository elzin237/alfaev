# Phase 3D3D — revised execution manifest (new authorization required)

The first authorized attempt failed in setup; all 20 cases were skipped. Its
generic catch discarded the originating error, so the exact setup cause is not
recoverable from that output. Independent read-only checks found source data and
sequences unchanged and the new clones/HTTP containers absent. That is not an
acceptance PASS. The second authorized attempt reached HTTP readiness, returned
PGRST002 on the pre-activation side, and skipped all 20 cases. Its cleanup was
independently verified complete; source table/sequence/security manifests matched.
The latest source correction and diagnostic-only mode have NOT been runtime-tested.
This document does not authorize another runtime execution.
No frontend/DEV/production activation is included. Obtain separate explicit approval
for the exact isolated local runtime scope below before using the runtime command.

## Exact entrypoint and proposed invocation

Entrypoint:
`/Users/test/Desktop/internal-tool/test/backend/finished-goods-reservation-activation.backend.ts`

Run from `/Users/test/Desktop/internal-tool` only, after approval:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin \
  FG_RESERVATION_ACTIVATION_LOCAL=1 \
  FG_RESERVATION_ACTIVATION_APPROVAL=isolated-clones-only \
  /usr/local/bin/node /Users/test/Desktop/internal-tool/node_modules/vitest/vitest.mjs run \
  --config /Users/test/Desktop/internal-tool/vitest.backend.config.ts \
  /Users/test/Desktop/internal-tool/test/backend/finished-goods-reservation-activation.backend.ts \
  --bail 1
```

These flags are an accidental-execution guard, not a substitute for user approval.
With the activation flag absent, the suite is skipped and creates no resources.
The runner accepts no alternate source, Docker context, HTTP endpoint or database.

## PGRST002 diagnosis and proposed narrow probe — NOT AUTHORIZED / NOT EXECUTED

Confirmed source-level defect: WHATWG URLSearchParams serialized the spaces in
the libpq `options` query value as `+`. PostgreSQL's URI parser percent-decodes
but preserves literal plus characters, so the startup options became
`-c+statement_timeout=15000+-c+lock_timeout=3000+...` rather than separate `-c`
arguments. Correct only query serialization to `%20`; preserve password bytes.
This is a deterministic malformed-startup-options defect consistent with the
observed PGRST002. The exact underlying server error from the removed containers
was not retained, so no observed SQLSTATE or exclusive historical cause is claimed.

PostgREST 14.5 binds its HTTP listener before its asynchronous database/cache
worker finishes. Running-container state is not readiness. PGRST002 is HTTP 503
with no underlying details. The old 30 x 200ms readiness loop could expire in
about six seconds; the corrected check has a 30-second wall-clock bound per side,
combines request/run deadlines, and still requires the exact authenticated profile.
No schema, role, JWT, RPC route or reservation authorization is relaxed.

Startup stderr is consumed only in bounded transient memory, extracting fixed
connection/cache/configuration/authentication/permission/target categories,
connection/cache-loaded booleans and allowlisted codes. Unknown/malformed or
oversized content is discarded and truncation is reported. Raw messages, hints,
details, query text and secrets are never forwarded or persisted. Keep Docker
logging disabled and discard stdout. No environment/file credential fallback.

Proposed next authorization: ONE readiness-only attempt on the pinned container.
It may create ONLY the approved PRE clone, restore the source into that new owned
clone, apply frozen 143–146 there, and start ONLY the owned PRE PostgREST instance
on 127.0.0.1:55471. No POST clone, migration 147, permission edits, business fixtures
or Reserve/Release/Fulfill requests. Read identity, private-146 ACL/security metadata
and source manifests only; clean up only positively owned resources and compare
source data/security/sequences plus database inventory independently afterward.
Do not reuse an existing clone/container or change any pinned connection guard.

Exact prepared invocation, requiring separate explicit user authorization:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin \
  FG_RESERVATION_ACTIVATION_LOCAL=1 \
  FG_RESERVATION_ACTIVATION_APPROVAL=isolated-clones-only \
  FG_RESERVATION_ACTIVATION_DIAGNOSTIC=readiness-only \
  /usr/local/bin/node /Users/test/Desktop/internal-tool/node_modules/vitest/vitest.mjs run \
  --config /Users/test/Desktop/internal-tool/vitest.backend.config.ts \
  /Users/test/Desktop/internal-tool/test/backend/finished-goods-reservation-activation.backend.ts \
  --testNamePattern 'diagnostic: pre-activation authenticated readiness only' \
  --bail 1
```

The exact diagnostic test must execute and pass; all-skipped output is NOT proof.
The mode independently suppresses all acceptance test bodies even without the
name filter. Default acceptance still requires both pre/post resources, with the
diagnostic case skipped. On failure report safe startup evidence and preservation;
do not retry, change credentials/permissions or restart the full campaign.

## Pinned environment assumptions

The pins were inspected in Stage 1; runtime must reverify them, not assume them.

- Repository: `/Users/test/Desktop/internal-tool`.
- Docker: `/Applications/Docker.app/Contents/Resources/bin/docker`.
- Socket: `unix:///Users/test/.docker/run/docker.sock`.
- Database container: `supabase_db_internal-tool`.
- Full container ID:
  `50416e38711a58257ad21846015cafe224a959ae6fc80c34eb45ccb94e5dc7ff`.
- Project labels: `internal-tool`; workdir must match the repository exactly.
- Named volume: `supabase_db_internal-tool`, local driver, mounted at
  `/var/lib/postgresql/data`; never delete/reset/unmount it.
- Cluster identifier: `7699375188763602981`.
- Protected source: `postgres`, migration 142, latest `20261022150000`.
- Expected source Docker bindings: `0.0.0.0:54322` and `[::]:54322`;
  this existing configuration is NOT a loopback-only API and is not changed.
- Owner setup/inspection transport: existing pinned container-local Unix socket,
  OS/database `postgres`, clean environment, no password/pgpass fallback.
- Existing local PostgREST credential source (read only): container
  `a7ee80d6998c8a55727790b47ec5826bf1ccdc2c7fd3616a14e0c94df21ad41e`,
  name `supabase_rest_internal-tool`, correct project/network/image. Read ONLY
  `PGRST_DB_URI` into memory; require local host, authenticator role, port 5432,
  database postgres and known URI options. Never retrieve its JWT secret.
- Already installed PostgREST image (no pull/download):
  `sha256:b574528fe109c8343c1247155734d03df8c34b462f342dca0ccc20244fc36ef9`.
- Existing network: `supabase_network_internal-tool`, ID
  `8ca46f147ecef1a7fc5dbe17eccb1713aa96f2459733b12ae7b17527c7cbf026`.

If any pin, authentication method, installed binary, image, port, quiet-state check
or active Admin/non-Admin fixture is unavailable/mismatched, STOP without fallback.
No credential value is supplied or invented in this manifest. Runtime approval
must include this narrow in-memory reuse of the existing LOCAL authenticator
credential; it does not authorize password changes, extraction from database
tables, remote credentials, or host credential-file creation.

## Exact proposed owned resources

| Side | New database | Phase | New HTTP container | Host API URL |
| --- | --- | --- | --- | --- |
| Pre | `alfaev_fg_3b1_28854f93ef3847d4b7efba3a6e651142` | 146 | `alfaev-fg-3d3d-pre-28854f93` | `http://127.0.0.1:55471` |
| Post | `alfaev_fg_3b1_0290f743d6b845f9be339387ae62e8fa` | 147 | `alfaev-fg-3d3d-post-0290f743` | `http://127.0.0.1:55472` |

Never adopt/reuse existing databases or containers, including a same-name
collision. Creation records the actual OID/container ID and a fresh run UUID.
Only those recorded identities are eligible for cleanup. The old retained clones
`alfaev_fg_3b1_80032a9fd0f84d94b9a34f0081ef5413` and
`alfaev_fg_3b1_e04f3cf198c5427d8cda148cbef55e9e` are never opened or removed.

Docker publishes ONLY `127.0.0.1:55471:3000` / `127.0.0.1:55472:3000`.
The service listens on the container interface internally; no wildcard host
publication, new network/volume, host networking, or source-container change.
The runner checks configured AND actual live published bindings before requests.
An occupied port fails startup; no process is stopped to free it.

## Execution order and expected disposable mutations

1. Require explicit flags, clean environment and all five frozen SQL hashes.
2. Verify source identity/parity, acquire the existing test lease and require quiet
   relevant sessions. Capture a repeatable-read/read-only source manifest plus
   complete existing database name/OID/owner inventory.
3. Create each new database with template0 and record its creation OID. Dump source
   in memory and restore only to the owned clone. No dump file is written.
4. Apply 143–146 and bookkeeping atomically in each clone; validate the 146 phase
   before any new checkout can use it. Protected source remains exactly 142.
5. Prove private mutation ACLs at 146. In POST ONLY apply frozen migration 147 and
   its history row atomically; validate 147, exactly three authenticated grants,
   185 trusted application functions and all negative helper/table security checks.
   Compare data/sequence and normalized catalog manifests across this activation.
6. Create two separately owned containers with NO credential-bearing environment.
   Clone DB URIs reuse only the existing local authenticator credential. A fresh
   random test-only HS256 secret signs short-lived JWTs for copied fixture profiles;
   no existing local/DEV/production session token or JWT secret is used. Authenticator
   is not a superuser/BYPASSRLS role. Requests actually SET ROLE through PostgREST.
   Start each by non-TTY `docker start --attach --interactive <recorded full ID>`
   and deliver a configuration buffer over attached stdin to `postgrest /dev/stdin`.
   No credential enters Docker Config.Env, command arguments, labels, mounts or
   persistent files. Docker logging is disabled; stdout is discarded and stderr
   is classified in bounded memory, exporting no raw text. Core dumps are disabled. Erase the owned
   buffer after delivery or on cleanup; JS/runtime/kernel memory is not a secure
   erasure guarantee against a privileged host, swap or crash/hypervisor capture.
   PostgREST v14.5's config reader accepts a file path via configurator-pg's byte
   reader. Disable in-database config and LISTEN-driven reloads in these disposable
   clients, avoiding re-reading a consumed pipe or overriding the pinned config.
   This changes no database roles, credentials or authentication configuration.
   Config parser/pipe compatibility in the pinned image still needs runtime proof;
   do not substitute environment delivery or a credential file if it fails.
7. Start the independent watchdog before starting HTTP containers. Verify listener
   readiness through an authenticated identity RPC on each isolated endpoint.
8. Create fixtures ONLY in owned clones using existing Supplier/Inventory fixture
   helpers and explicit Product/Project demand. Copied delegated permissions/active
   state may be changed ONLY inside the disposable post clone. Never select the
   accepted leftover Product as a fixture. No global database roles are changed.
9. Run real SDK + unchanged application services against real HTTP. The test-only
   fetch adapter validates the exact loopback origin, strips ONLY `/rest/v1`, rejects
   redirects/other routes and forwards actual responses. No production client edit.
10. Test pre-denial; Admin/delegated success; each missing permission; inactive,
    anonymous/expired JWT; private helper/table denial; ownership/conflict/version
    errors; partial/full operations; stock protection/FIFO/audit/demand accounting;
    concurrent identical requests and competing Project reservations; response loss
    or malformed response AFTER actual commit; exact replay and authoritative reads;
    valid quantities above 2^53 and exact stale large-version rejection.

New clone data includes Suppliers, Products/Cards, source lots, Project requirements,
reservation state/events, movements/allocations, audits and normal deferred shortage
and notification effects. These are committed HTTP effects in DISPOSABLE databases,
not rollback-only source tests. No source business records may change.

No real-browser durability PASS is implied. Existing storage/Web Locks unit tests
remain simulations; reload, browser restart and cross-tab browser acceptance require
a separate browser test stage against a properly isolated frontend.

## Timeouts, interruption and cleanup

- SQL/connect/lock/idle limits remain enforced by the existing local harness.
- Setup aborts at 170 seconds before its 180-second Vitest hook limit.
- HTTP deadline is at most 10 seconds, combined with application, run and remaining
  readiness-budget abort signals. Authenticated readiness has a 30-second wall-clock
  bound per side; timeout reports safe status, attempts and startup evidence.
- PostgREST DB statement/lock/idle limits are explicitly bounded in its clone URI.
- An independent Node watchdog has no credentials and no SQL/database-drop path.
  Owner stdin EOF or 20-minute deadline stops only recorded, label/image-verified
  HTTP container IDs using Docker stop (5-second grace). It is not merely a timeout
  on the host Docker CLI. SIGINT/SIGTERM and test timeouts block further dispatch.
- Success OR failure: close HTTP resources, then owner pools; verify protected source
  again in a fresh connection; drop only recorded clone name/OID/owner identities
  with zero remaining clients. Never force-drop or terminate unrelated sessions.
- Natural client shutdown gets an 8-second read-only polling window (individual
  reads remain subject to the existing bounded SQL/connect timeouts). Missing/late
  drain evidence retains the clone; DROP is never retried. Verify source again after
  cleanup as well as before it.
- If interruption has already triggered the watchdog, join it BEFORE normal
  removal to avoid racing its inspection. Otherwise keep it armed throughout
  resource removal (owner death must still stop remaining clients), then disarm/join.
  Revalidate ownership, command,
  secret-free environment, non-TTY stdin and loopback/network configuration first.
  Join attached clients after stopping containers. A separate fresh ID/name inventory
  distinguishes FAILED (resources confirmed remaining), UNVERIFIED (missing evidence,
  uncertain CREATE or unjoined client), and COMPLETE (absence independently verified).
  A failed operation with independently verified COMPLETE cleanup is still reported
  separately and fails the run. Never adopt an unknown ID, retry or broaden cleanup.
- Setup failures report the authored phase/operation, fixed local resource identity,
  recognized guard and allowlisted error code/category. Never retain raw errors,
  causes, query text, stdout/stderr, secrets or environment values. Per-migration and
  security steps retain their inner context instead of masking it in the outer catch.
- Compare final database inventory and protected source table/security/sequence
  manifests. Retain evidence/resources if safe cleanup cannot be proven.
- SIGKILL/host/Docker failure may prevent cleanup; no PASS is possible and remaining
  resources need separately reviewed disposition. The watchdog can stop clients but
  cannot guarantee cleanup if the Docker daemon itself is unavailable.

The source manifest includes public/auth/storage/supabase_migrations/realtime data,
security metadata and sequences, including accepted local residue. It is a new
current-state baseline, NOT reconstruction of the missing 41 historical digests.
Shared-cluster WAL/OID/catalog allocation and volume bytes necessarily change when
clones are created. No byte-identical cluster/volume guarantee is made.

Do not run maintenance SQL, reset the source, contact DEV/production, deploy,
activate the persistent application, commit or push. Stop and report after runtime
results; no subsequent deployment or browser mutation is implicitly authorized.
