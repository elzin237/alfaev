# AlfaEV — docs/BUILD_PLAN.md

Status: Canonical implementation plan v3  
Purpose: Maximize Codex reliability by using small, coherent, independently verifiable execution tasks.  
Execution model: **one numbered task = one Codex implementation prompt = one review gate**.  
Important: This plan intentionally has many tasks. The number of tasks is not a target; task boundaries follow architecture, security, data, and UI responsibilities.

---

# 0. How Codex Must Use This Plan

## Source-of-truth precedence

If canonical docs conflict, use this precedence:

1. `docs/SECURITY_RULES.md`
2. `docs/BUSINESS_RULES.md`
3. `docs/DATA_MODEL.md`
4. `docs/PERMISSIONS.md`
5. `docs/APP_FLOW.md`
6. `docs/ROUTES.md`
7. `docs/FEATURES.md`
8. `docs/UI_SPEC.md`
9. `docs/ARCHITECTURE_RULES.md`
10. `docs/TECH_STACK.md`
11. `docs/BUILD_PLAN.md`

If a requirement is genuinely ambiguous:

- stop
- report the ambiguity
- do not guess
- update the canonical docs before implementation continues

## Task execution rules

For every numbered task, Codex must:

1. Inspect the repository before editing.
2. Read the task plus only the canonical docs relevant to the work, while respecting precedence.
3. Implement **only** the numbered task.
4. Do not start the next task.
5. Preserve strict TypeScript.
6. Preserve the approved UI unless the task explicitly changes that UI.
7. Keep TSX files presentation-focused.
8. Keep trusted business logic in domain/backend/database layers.
9. Use versioned migrations for schema/RLS/function changes.
10. Add task-specific tests when logic/security is introduced.
11. Run the required validation.
12. Return a concise completion report.

## Permanent code rules

Never introduce:

- `any`
- `as any`
- `@ts-ignore`
- `@ts-nocheck`
- frontend-only security enforcement
- direct arbitrary Inventory balance writes
- giant all-purpose feature files
- unrelated refactors inside a feature task

## Default validation

Every task that changes application code:

```bash
npm run typecheck
npm run build
```

After automated tests are configured:

```bash
npm run test:run
```

Run only relevant backend/integration/E2E suites in addition to these; do not run the entire expensive suite after every tiny UI task unless needed.

## Review / commit rule

After each task:

- inspect diff
- accept or fix the task
- normally commit the accepted task before beginning the next task

Do not accumulate 10 unrelated Codex tasks into one giant unreviewed diff.

---

# PHASE A — Repository Baseline

## 001 — Add Canonical Docs to the Repository

Goal:
- place the approved AlfaEV canonical `.md` files in the repo

Include:
- FEATURES
- BUSINESS_RULES
- PERMISSIONS
- DATA_MODEL
- ROUTES
- APP_FLOW
- ARCHITECTURE_RULES
- TECH_STACK
- SECURITY_RULES
- UI_SPEC
- BUILD_PLAN
- OPEN_DECISIONS as historical context if retained

Do not change application behavior.

Validate:
- docs tracked
- `npm run typecheck`
- `npm run build`

---

## 002 — Remove Unapproved Placeholder Routes

Goal:
- remove obsolete route definitions for modules outside locked scope

Remove active routes such as:
- Documents
- Production
- Quality
- Reports
- Settings
- any other unapproved placeholder

Keep Dashboard.

Historical note after Task 085: this task removed the old unapproved Documents
placeholder. CEO change Task 085H later introduces a new, real, Admin-only
Dokumentacija module at `/documents`; do not restore the obsolete placeholder.

Do not redesign routing architecture beyond what is needed.

Validate:
- no dead route imports
- approved routes still load
- typecheck/build

---

## 003 — Remove Unapproved Placeholder Navigation

Goal:
- make Sidebar/navigation match the approved module list

Final order:
1. Dashboard
2. Projects
3. Nabavka
4. Dobavljači
5. Skladište
6. PCB Cards
7. Radni Nalozi
8. Calendar
9. Archive
10. Users

Historical note after Task 085: Tasks 085H and 085J extend this implemented order
with Dokumentacija and Osnovna sredstva between Radni Nalozi and Calendar, producing
the new 12-item canonical order without restoring placeholder navigation.

At this task, permission-aware hiding is not required yet.

Validate:
- shell appearance preserved
- mobile/desktop Sidebar still works

---

## 004 — Remove Dead Placeholder Source Files

Goal:
- delete source files that became unreachable after Tasks 002–003

Do not delete:
- shared UI used by approved modules
- Dashboard placeholder
- styles/config

Validate:
- search for dead imports
- typecheck/build
- inspect Git diff for accidental deletion

---

## 005 — Establish Feature-Oriented Folder Baseline

Goal:
- create the minimal scalable folder ownership needed for future modules

Do:
- establish `features/` and `shared/` conventions
- move only files whose ownership is obvious and low-risk
- preserve imports/behavior

Do not:
- reorganize the entire codebase mechanically
- create empty directory forests
- create giant `utils.ts`/`types.ts`

Validate:
- no visual/runtime regression
- typecheck/build

---

# PHASE B — Frontend Infrastructure

## 006 — Add TanStack Query

Goal:
- install/configure TanStack Query

Scope:
- dependency
- QueryClient
- provider at app root
- sensible defaults only

Do not migrate feature data yet.

Validate:
- app renders
- provider smoke test if test tooling already exists

---

## 007 — Add React Hook Form + Zod

Goal:
- install the form/validation foundation

Scope:
- dependencies
- no feature-form rewrite yet

Validate:
- typecheck/build

---

## 008 — Add Vitest + React Testing Library

Goal:
- establish unit/component test runner

Scope:
- configuration
- setup file
- one lightweight application/component smoke test
- `test` / `test:run` scripts

Validate:
- `npm run test:run`
- typecheck/build

---

## 009 — Add Playwright Test Foundation

Goal:
- configure E2E tooling without writing the full product suite

Scope:
- Playwright config
- base URL convention
- one minimal boot/smoke test if feasible

Do not build business E2E flows yet.

---

## 010 — Add Typed Environment Configuration

Goal:
- centralize frontend environment access

Scope:
- typed Vite environment definitions
- validation/fail-fast behavior for required values
- no direct scattered `import.meta.env` reads in feature code

Do not add secrets.

---

## 011 — Add Core Shared UI States

Goal:
- create small reusable shared primitives for:
  - loading
  - error
  - empty state

Keep visual language consistent with existing AlfaEV UI.

Do not build a generic component framework.

---

## 012 — Add Shared Page / Status / Confirmation Primitives

Goal:
- add only the shared primitives that will immediately recur

Create focused primitives such as:
- `PageHeader`
- `StatusBadge`
- `ConfirmDialog`

Do not add DataTable abstraction until real tables show the requirements.

---

# PHASE C — Supabase Security Foundation

## 013 — Wire the Supabase Browser Client

Goal:
- add official Supabase TypeScript client

Scope:
- browser-safe URL/key only
- typed client module
- development environment connection

Never expose service-role key.

Validate:
- dev connection succeeds
- typecheck/build

---

## 014 — Establish Migration Workflow

Goal:
- create the reproducible database migration structure

Scope:
- migration directory/conventions
- development application instructions
- no business tables yet

Done when:
- a baseline migration can be applied reproducibly

---

## 015 — Create UserProfile Schema + RLS

Goal:
- implement the canonical UserProfile table

Include:
- auth user mapping
- Full Name
- Email
- Birthday
- Active/Inactive
- Admin flag
- Created Date
- Last Login metadata

Add:
- constraints
- RLS baseline
- indexes required by known access patterns

Do not build Users UI.

---

## 016 — Add Active-User Security Helper

Goal:
- create trusted DB helper(s) for:
  - authenticated actor
  - active AlfaEV profile

Requirement:
- valid Auth session alone must not bypass `is_active = false`

Add backend tests for active/inactive behavior.

---

## 017 — Create PermissionDefinition + UserPermission Schema

Goal:
- create permission data model

Include:
- canonical delegable permission keys
- uniqueness constraints
- Admin bypass model
- non-delegable permission concept

Do not build permission UI.

---

## 018 — Add Trusted Permission Helper Functions

Goal:
- centralize backend permission checks

Support:
- Admin
- active user
- explicit permission key

Requirement:
- helper behavior usable from RLS and trusted RPCs
- no client-trusted permission flags

Add tests.

---

## 019 — Create AuditLog Schema + Immutability

Goal:
- create append-only audit storage

Include:
- actor
- action
- entity
- record
- before/after
- metadata
- timestamp

Protect:
- application users cannot update/delete
- actor cannot be forged by normal client write

---

## 020 — Add Trusted Audit Append Helper

Goal:
- create one centralized trusted mechanism used by later business mutations

Do not ask TSX components to assemble authoritative audit entries.

Test:
- actor comes from trusted authenticated context
- immutable behavior remains intact

---

## 021 — Add Backend Security Test Harness

Goal:
- establish repeatable Supabase integration/security tests

Support testing as:
- anonymous
- Admin
- non-admin with permission
- non-admin without permission
- inactive user

This harness will be reused throughout the build.

---

# PHASE D — Authentication, Route Authorization, Users

## 022 — Create Typed Auth Service

Goal:
- isolate Supabase Auth operations from TSX

Include:
- sign in
- sign out
- session lookup
- auth-state subscription

No UI changes yet.

---

## 023 — Replace Fake Login with Supabase Auth

Goal:
- replace LoginPage fake login with the Task 022 Supabase Auth service
- make the minimum compatibility update to the existing AuthGuard so protected
  routes recognize a real Supabase session after login

Remove localStorage `alfaev_auth` usage as authentication authority.

Preserve current visual design.

Do not:
- load UserProfile yet
- enforce `is_active` yet
- load permissions
- implement the final reusable/loading-aware authenticated route architecture;
  that remains Task 027

Validate:
- valid login
- invalid login error
- no public signup UI
- successful login can enter the existing protected application shell

---

## 024 — Add Session Restore + Profile Load

Goal:
- restore authenticated state on refresh

Load:
- UserProfile
- Admin status
- Active state

Do not load all permissions in scattered page code.

---

## 025 — Enforce Inactive Account Lockout

Goal:
- ensure inactive users cannot continue using the app

Cover:
- existing session
- refresh
- direct backend access

Add security test.

---

## 026 — Implement Logout

Goal:
- real sign out
- clear protected cached data
- redirect `/login`

Validate protected routes are unavailable afterward.

---

## 027 — Implement Authenticated Route Guard

Goal:
- replace/refine the minimal Task 023 session-compatible guard into the final
  reusable authenticated route boundary

Behavior:
- unauthenticated → `/login`
- authenticated active → continue
- session/profile loading state handled cleanly without redirect flicker

Do not add module permissions yet.

---

## 028 — Implement Permission Route Guard

Goal:
- reusable route guard based on canonical permission keys

Requirement:
- Admin bypass
- non-admin explicit permission
- clear unauthorized behavior

Backend remains authoritative.

---

## 029 — Implement Admin Route Guard

Goal:
- reusable Admin-only route boundary

Initial use:
- Users module

Do not duplicate Admin checks inside every page.

---

## 030 — Make Sidebar Permission-Aware

Goal:
- navigation visibility follows loaded user access

Rules:
- Users Admin-only
- Calendar visible to all active authenticated users
- other modules based on permission
- no hidden-route security assumption

---

## 031 — Build Admin Users List

Goal:
- create `/users` Admin-only list

Include:
- name
- email
- status
- Admin flag
- Created Date
- Last Login

Backend query must deny non-admin.

---

## 032 — Add Admin User Creation / Invite Backend

Goal:
- trusted Admin-only account creation/invite operation

Requirements:
- no public signup
- create Auth user/invite using safe server-side capability
- create UserProfile coherently
- audit creation

Do not expose Admin API secret to browser.

---

## 033 — Build Create User UI

Goal:
- Admin form for new user

Fields:
- Full Name
- Email
- Birthday
- Admin/non-admin

Keep form focused.

---

## 034 — Build User Detail / Profile Edit

Goal:
- Admin-only user detail and profile editing

Admin may edit:
- Full Name
- Email
- Birthday

Display:
- Active/Inactive
- Admin status
- Created Date
- Last Login

Email changes must:
- use a trusted server-side operation
- update the Supabase Auth email and `public.user_profiles.email` coherently
- require an active Admin
- keep service-role/secret credentials out of browser code
- create Audit history
- use a safe compensating rollback if a cross-system update partially fails, so Supabase Auth and UserProfile do not remain inconsistent

Do not add:
- activate/deactivate; that remains Task 035
- Admin status changes; that remains Task 036
- permission management; that remains Tasks 037+
- password management

---

## 035 — Add Activate / Deactivate User

Goal:
- trusted Admin-only account state mutation

Requirements:
- dual-layer synchronization between AlfaEV UserProfile state and Supabase Auth state
- deactivation sets `is_active = false`, `deactivated_at`, and `deactivated_by_user_id` to the acting Admin
- trusted server-side Auth Admin operation disables future Supabase Auth sign-in without deleting the Auth user
- `UserProfile.is_active` remains the authoritative AlfaEV access gate for already-issued sessions
- reactivation restores future Supabase Auth sign-in, sets `is_active = true`, and clears current `deactivated_at` / `deactivated_by_user_id`
- immutable AuditLog entries for every successful deactivate/reactivate operation
- historical actor references remain
- self-deactivation is forbidden
- deactivation of the last active Admin is forbidden
- safe compensating rollback if either side of the cross-system state change fails, so Auth and UserProfile do not remain knowingly inconsistent

Add backend/security tests covering authorized operations, inactive-session enforcement, self-deactivation, last-active-Admin protection, cross-system rollback, and direct bypass attempts.

Do not add Admin-status editing; that remains Task 036.

---

## 036 — Add Admin Status Change

Goal:
- trusted Admin-only promotion/demotion

Requirements:
- require a trusted active-Admin actor; browser/UI state is not authoritative
- forbid an Admin from changing their own `is_admin` status
- forbid demotion of the last active Admin
- make Admin-continuity protection concurrency-safe so simultaneous changes cannot leave AlfaEV with zero active Admins
- leave `is_active` unchanged for promotion and demotion, including when the target is inactive
- do not modify Supabase Auth state
- preserve all existing UserPermission rows across promotion/demotion
- create an immutable AuditLog entry for every meaningful promotion/demotion
- create no AuditLog noise for a no-op requested state

Add backend/security tests covering authorized changes, direct bypass attempts, self-change, last-active-Admin protection, inactive targets, UserPermission preservation, no-op behavior, and concurrent Admin-continuity enforcement.

Do not add permission grant/revoke behavior; that remains Task 037+.

---

## 037 — Add Permission Grant/Revoke Backend

Goal:
- trusted Admin-only mutation for UserPermission

Requirements:
- only delegable keys
- no self-escalation
- audit grants/revocations

Do not build UI in this task.

---

## 038 — Build Permission Matrix UI

Goal:
- grouped checkboxes for delegable permissions on non-admin User detail

Do not show permanently Admin-only capabilities as grantable.

Read-only for Admin users where matrix is irrelevant.

---

## 039 — Wire Permission Save + Runtime Refresh

Goal:
- connect permission UI to trusted mutation

After save:
- refresh current permission state
- navigation/actions update
- no stale authorization assumption

Add integration tests for two different non-admin permission sets.

---

# PHASE E — Brands, Suppliers, Products

## 040 — Create Brand Schema + Security

Goal:
- implement the backend-only Brand schema and security boundary

Implement:
- Brand table with required, trimmed, nonblank, case-insensitively unique names
- archive/deactivate state with no normal hard-delete workflow
- archived Brand immutability
- historical Brand reads while preventing archived Brand selection for newly created Products
- RLS/read policy allowing normal Brand reads to Admin or `inventory.view`
- trusted create/edit/archive operations allowing Admin or `inventory.brands.manage`
- immutable AuditLog entries for meaningful create/edit/archive changes
- audit-free no-op edits
- backend/security tests for constraints, authorization, direct bypass attempts, archive immutability, historical reads, and audit behavior

Brand reactivation/unarchive is not supported in the current scope. Do not add a restore operation.

Backend only. Do not build Brand UI; Task 041 owns the Brand management UI.

---

## 041 — Build Brand Management UI

Goal:
- small Inventory-admin Brand management experience

Support:
- list
- add
- edit
- archive

Respect permissions/Admin rules from canonical docs.

---

## 042 — Create Supplier Schema + Security

Goal:
- implement the backend-only Supplier schema and security boundary

Implement:
- Supplier table with active/archive metadata
- required, trimmed, nonblank, case-insensitively unique Name
- required, trimmed, nonblank Country
- optional Contact Person and Phone, trimmed and stored as `NULL` when blank, without aggressive database phone formatting
- optional Email, trimmed and lowercased when provided, stored as `NULL` when blank, subject to basic validation, and not unique
- Supplier identity based only on normalized Name
- RLS/read policy allowing Supplier reads to Admin or `suppliers.view`
- trusted create operation allowing Admin or `suppliers.create`
- trusted edit operation allowing Admin or `suppliers.edit`
- immutable AuditLog entries for meaningful create/edit changes
- audit-free normalized no-op edits
- backend/security tests for constraints, normalization, authorization, direct bypass attempts, lifecycle-state enforcement, and audit behavior

Backend only. Do not build Supplier UI, archive RPC/behavior, Supplier Product links, or procurement Supplier workflows in this task.

Task 043 owns Supplier list/search and Add Supplier UI. Task 044 owns Supplier detail/edit UI. Task 045 owns trusted Supplier archive behavior and archive UI.

---

## 043 — Build Suppliers List + Create

Goal:
- `/suppliers`
- list/search
- Add Supplier form

Keep create scope separate from detail editing.

---

## 044 — Build Supplier Detail / Edit

Goal:
- supplier detail
- edit contact data
- show active/archive state

Product links come later.

---

## 045 — Add Supplier Archive Behavior

Goal:
- implement the only normal Supplier removal workflow while preserving historical references

Include:
- trusted archive mutation
- archive UI confirmation
- immutable AuditLog entry
- archived Supplier lifecycle and immutability
- historical preservation

Do not hard-delete Suppliers through normal application workflows, regardless of whether they are currently referenced.

Supplier reactivation/unarchive is not supported in the current scope. Do not add a restore operation.

The canonical prohibition on using archived Suppliers for new ProductSupplier links and new procurement selections remains in force. The later trusted ProductSupplier and procurement workflows must enforce that rule when those workflows are implemented. Task 045 must not create those future workflows early.

---

## 046 — Create Product Schema + Product Kinds

Goal:
- implement Product schema, constraints, and read RLS only

Include:
- Name: required, trimmed, nonblank, not unique
- Category: required, trimmed, nonblank, not unique, free text
- nullable Brand reference
- Product kind restricted to `component` or `pcb_finished_good`
- immutable Product kind
- archive metadata
- required, unique Serial Number column constrained to exactly 7 digits
- Product reads for Admin or `inventory.view`
- deny direct client `INSERT`, `UPDATE`, and `DELETE`
- historical Products may retain archived Brand references
- archived Products remain historically readable and immutable
- no normal hard delete
- no reactivation/unarchive

Do not implement Serial Number allocation, trusted Product create/edit/archive operations, or UI in this task.

Active-Brand enforcement for new Product creation and Brand changes belongs to the later trusted Product create/edit operations.

---

## 047 — Add 7-Digit Serial Number Sequence

Goal:
- trusted concurrency-safe product Serial allocation

Rules:
- starts `0000001`
- exactly 7 digits publicly
- sequential
- unique
- never reused

Add concurrency/uniqueness tests.

Task 046 stores and constrains Serial Numbers; this task owns concurrency-safe sequential allocation.

---

## 048 — Add Trusted Product Creation Operation

Goal:
- create Product through trusted backend path

Requirements:
- actor authorized
- serial allocated server-side
- client cannot choose serial
- normal Product creation uses `component`
- selected Brand, when present, must be active
- audit

Initial stock remains separate from Product creation.

This is the first normal trusted Product creation path. `pcb_finished_good` creation remains reserved for a later trusted PCB workflow.

---

## 049 — Build Add Product UI

Goal:
- Inventory Add Component form

Fields:
- Name
- Category
- Brand

Serial:
- displayed as generated automatically

This form creates Components only and must not expose Product kind selection. A later trusted PCB workflow creates `pcb_finished_good` Products.

Supplier links added later.

---

## 050 — Build Product List

Goal:
- real Product/Inventory master list foundation

Show:
- Serial Number
- Name
- Category
- Brand
- Active/Archived

Quantity comes after InventoryBalance exists.

---

## 051 — Build Product Detail / Edit

Goal:
- Product detail master-data view/edit

Brand changes may select only active Brands. Product kind remains immutable.

Archived Products are read-only and have no restore/reactivate action.

Do not include Inventory adjustment yet.

---

## 052 — Add Product Archive Behavior

Goal:
- trusted archive/deactivate operation
- preserve referenced history
- UI confirmation
- audit

Authorization:
- active Admin OR `inventory.products.edit`
- `inventory.products.create` does not authorize archive
- `inventory.view` remains read-only
- do not add a new `inventory.products.archive` permission

Archive/deactivate must remain a trusted backend lifecycle mutation. This is the only normal Product removal workflow. Do not hard-delete Products or add restore/reactivation/unarchive.

---

## 053 — Create ProductSupplier Schema

Goal:
- create the ProductSupplier schema and read/RLS security baseline only

Include:
- many-to-many Product↔Supplier structure
- history-preserving Product and Supplier foreign keys
- eligibility-only relationship; Supplier is the final Catalog Number/Description authority
- at most one active relationship for a Product/Supplier pair
- canonical active/archive lifecycle and actor/timestamp metadata
- new relationships start active
- archived relationships remain historically readable and immutable
- Product or Supplier archive does not delete/cascade historical relationships
- RLS SELECT policy allowing an active Admin, `inventory.view`, or `suppliers.view`; either view permission is sufficient and both are not required

Do not add mutation RPCs, UI, hard delete, or restore/reactivation behavior in this task.

---

## 054 — Add ProductSupplier Backend Operations

Goal:
- trusted add/archive operations with immutable audit

Requirements:
- require an active Admin, `inventory.products.edit`, or `suppliers.edit`
- use one shared backend authority regardless of whether the operation originates from Product detail or Supplier detail
- require an active Product and active Supplier when creating a new relationship
- preserve existing historical relationships when a Product or Supplier is archived later
- accept only Product and Supplier identifiers; do not accept Catalog Number or Description metadata
- prevent duplicate active Product/Supplier relationships
- archive/deactivate rather than hard-delete
- archived relationships are immutable
- no restore/reactivation operation
- audit meaningful add/archive changes atomically

Do not add a ProductSupplier permission key or UI in this task.

---

## 055 — Add Supplier Links to Product UI

Goal:
- Product detail shows/manage:
  - Supplier
  - live Supplier Catalog Number and optional Supplier Description

Add the minimal trusted cross-domain read backend required by this Product-side UI:
- a ProductSupplier relationship read for an active Admin, `inventory.view`, or `suppliers.view`, returning only relationship data plus the related Supplier ID, Name, live Catalog Number, optional Description, and active/archive state required for display
- an active-Supplier choice lookup for an active Admin, `inventory.products.edit`, or `suppliers.edit`, returning only Supplier ID and Name
- do not expose Supplier Country, Contact Person, Phone, Email, or other Supplier details through either operation
- do not broaden normal Supplier RLS; general Supplier reads remain restricted to an active Admin or `suppliers.view`

Reuse the Task 054 trusted ProductSupplier backend operations. Do not duplicate authorization or mutation rules in the Product UI.

This cross-domain read correction belongs to Task 055 and is not Supplier-detail Product-link work from Task 056.

Do not mix Inventory quantities into this task.

---

## 056 — Add Product Links to Supplier UI

Goal:
- Supplier detail shows Supplier master Catalog Number/Description and linked Product eligibility

Add the minimal trusted cross-domain read backend required by this Supplier-side UI:
- a ProductSupplier relationship read for an active Admin, `inventory.view`, or `suppliers.view`, returning only relationship data plus the related Product ID, Serial Number, Name, and active/archive state required for display
- an active-Product choice lookup for an active Admin, `inventory.products.edit`, or `suppliers.edit`, returning only Product ID, Serial Number, and Name
- do not expose Product Category, Brand, lifecycle timestamps/actors, or other Product details through either operation
- do not broaden normal Product RLS; general Product reads remain restricted to an active Admin or `inventory.view`

Reuse the Task 054 trusted ProductSupplier mutation operations and shared ProductSupplier query/service logic where appropriate. Do not create a second Supplier-origin mutation authority.

---

# PHASE F — Inventory Ledger and Barcode

## 057 — Create InventoryBalance Schema

Goal:
- one current stock balance per Product

Constraint:
- quantity cannot be negative

Do not allow arbitrary direct client writes.

---

## 058 — Create InventoryMovement Schema + Immutability

Goal:
- immutable stock ledger

Include:
- delta
- before
- after
- reason
- source
- actor
- timestamp
- reversal reference

Protect update/delete.

---

## 059 — Add Trusted Inventory Mutation Primitive

Goal:
- central backend primitive for safe stock change

Must:
- lock/read balance safely
- validate non-negative result
- update balance
- insert movement
- support calling inside higher-level trusted transactions

This is infrastructure, not manual-adjustment UI.

---

## 060 — Add Admin Manual Inventory Adjustment RPC

Goal:
- permanently Admin-only Add / Remove / Correction operation

Require:
- target Product ID
- adjustment type
- quantity interpreted according to the selected adjustment type
- reason trimmed before use and required to be nonblank

Product lifecycle:
- the target Product must exist and be active
- re-check Product active state when the trusted operation executes
- archived Products remain historically readable and retain their InventoryBalance and InventoryMovement history
- archived Products cannot receive new manual Add, Remove, or Correction adjustments or movements

Semantics:
- Add accepts the positive amount to add; quantity must be greater than zero and `delta = +quantity`.
- Remove accepts the positive amount to remove; quantity must be greater than zero, `delta = -quantity`, and resulting stock cannot be negative.
- Correction accepts the desired final stock quantity, not a delta; target must be greater than or equal to zero and `delta = target_quantity - current_quantity`.
- Correction target zero is valid.
- Correction target equal to current stock is rejected as an invalid no-op, with no InventoryMovement or AuditLog.
- Use movement types exactly `manual_add`, `manual_remove`, and `manual_correction`.

Atomically:
- authorize the active Admin
- re-check that the target Product exists and is active
- call the Task 059 Inventory mutation primitive exactly once
- create exactly one InventoryMovement through that primitive
- append exactly one immutable AuditLog entry
- roll back the balance change, movement, and audit if any step fails

Add authorization, direct-bypass, active-Product execution-time validation, archived-Product rejection, input-semantics, required-reason, negative-stock, no-op, exact movement-type, single-movement, single-audit, and atomic-rollback tests.

---

## 061 — Build Manual Inventory Adjustment Dialog

Goal:
- Admin-only UI for the same Add / Remove / Correction semantics defined by Task 060
- UI only; call the Task 060 trusted operation and do not mutate Inventory directly

Show:
- current
- adjustment
- resulting quantity
- reason

Treat Add/Remove quantity as a positive amount and Correction quantity as the desired final stock. Allow Correction target zero, reject Add/Remove zero and Correction target equal to current stock, and block invalid negative results in UX while the backend remains authoritative.

---

## 062 — Integrate Current Quantity into Inventory List

Goal:
- Inventory list now shows real stock balance

Handle:
- zero stock
- archived items
- loading/error states

---

## 063 — Add Inventory Search

Goal:
- server-backed search/filter by:
  - Name
  - Serial Number / Šifra
  - Catalog Number

Keep query typed and indexed appropriately.

---

## 064 — Build Inventory Movement History UI

Goal:
- read-only Product detail Inventory Movement history table

Show:
- Date
- Type / Source
- Delta
- Before
- After
- User
- Reason / Context

Authorization:
- active Admin or `inventory.view`

Behavior:
- include movements for active and archived Products
- order newest movements first
- preserve existing InventoryMovement immutability
- add no UPDATE, DELETE, or reversal action

Task 064 may add the minimal trusted movement-history read RPC required to resolve the actor display name safely. That read may return only the InventoryMovement fields required by this UI, `actor_user_id`, and the actor's `full_name`. It must not expose actor email, birthday, Admin status, permissions, or other UserProfile fields, and it must not broaden UserProfile RLS.

---

## 065 — Add Code 128 Barcode Generator

Goal:
- deterministic barcode utility from 7-digit Serial Number

Add unit tests:
- exact encoded value
- invalid serial rejected

Do not persist images.

---

## 066 — Build Barcode Preview / Download UI

Goal:
- Product detail:
  - preview
  - open/view
  - download

Keep print-safe margin/readability.

---

## 067 — Inventory Security / Concurrency Test Pass

Goal:
- targeted backend tests only

Cover:
- direct balance write denied
- movement mutation denied
- non-admin manual adjustment denied
- negative stock rejected
- two competing adjustments cannot corrupt balance

Do not add new UI.

---

# PHASE G — Projects

## 068 — Create Project Schema + RLS

Goal:
- implement Project schema, constraints, and SELECT RLS/read baseline only

Fields:
- Name: required, trimmed, nonblank, not unique
- Customer: required, trimmed, nonblank, not unique
- Status: required, default `planned`
- Start Date: required SQL `date`
- Delivery Date: required SQL `date`, on or after Start Date
- canonical creation/update actor and timestamp metadata
- `completed_at`: non-null only while status is `completed`
- `cancelled_at`: non-null only while status is `cancelled`

Allowed database statuses exactly:
- `planned`
- `in_progress`
- `on_hold`
- `completed`
- `cancelled`

Lifecycle baseline:
- `cancelled` is the Project removal/archive state
- do not add separate `is_active`, `archived_at`, or archived-by fields
- no normal hard delete
- Cancelled Projects remain historically readable
- no Cancelled Project restore/reactivation in the current scope
- do not impose a rigid general status-transition graph beyond the explicitly locked lifecycle rules

Security:
- SELECT requires an active Admin or `projects.view`
- deny direct normal-client INSERT, UPDATE, and DELETE
- do not add trusted create, edit, status, cancel/archive, or reopen RPCs yet

Sequencing:
- Task 070 owns trusted Project creation and its UI
- Task 072 owns normal Project edits/status changes and the separate trusted cancellation operation/UI
- Task 073 owns the Completed Project normal-edit lock
- Task 074 owns the explicit Admin-only `completed` to `in_progress` reopen, including clearing current `completed_at` and auditing the historical transition

---

## 069 — Build Projects List

Goal:
- `/projects`
- list
- status display/filter
- permission-aware access

No create/edit in this task.

---

## 070 — Build Create Project

Goal:
- trusted authorized Project creation operation and create form
- validation
- audit creation

---

## 071 — Build Project Detail

Goal:
- detail read view

Include:
- core fields
- status
- dates
- placeholder sections for related data that are not yet built, without fake data

---

## 072 — Add Project Edit + Status Changes

Goal:
- trusted normal Project edit/status operation and edit UI
- explicit trusted Project cancellation operation and confirmation UI
- atomic AuditLog history for every meaningful edit, normal status change, and cancellation

Normal edit authorization:
- active Admin or `projects.edit`

Normal editable fields:
- Name
- Customer
- Start Date
- Delivery Date
- normal status where allowed

Normal edit status values:
- `planned`
- `in_progress`
- `on_hold`

CEO correction after Task 085:
- this task was implemented under the former rule that allowed normal edit to enter `completed`
- the new canonical rule removes `completed` from normal editable status targets
- Task 085A adds the corrective migration/UI change without rewriting this applied task's history

Normal edit rules:
- after Task 085A, never set `completed` or `cancelled`
- only the trusted final-Work-Order Finish flow sets `completed_at` while entering `completed`
- clients never provide lifecycle timestamps
- do not allow a normal edit/status operation to move a Project out of `completed`
- normalized no-op edit/status submissions create no update or audit noise
- do not introduce a broader rigid status-transition graph

Cancellation authorization:
- active Admin or `projects.archive`
- `projects.edit` alone is insufficient

Cancellation rules:
- allowed only from `planned`, `in_progress`, or `on_hold`
- set status to `cancelled`
- set `cancelled_at` server-side and leave `completed_at` `NULL`
- do not allow direct cancellation from `completed`
- Cancelled Projects remain historically readable and become immutable
- no hard delete and no restore/reactivation

Every meaningful mutation and its one AuditLog entry must be atomic. Denied or failed operations persist neither mutation nor audit.

Do not implement the full Completed Project normal-edit lock here; Task 073 owns that backend rule. Task 072 must still prevent a normal `projects.edit` operation from reopening Completed Projects. Do not implement the Admin reopen from Task 074.

---

## 073 — Enforce Completed Project Lock

Goal:
- backend prevents all ordinary field edits while a Project is already Completed

UI:
- read-only completed state

Add tests proving direct update bypass fails.

Task 073 does not broaden reopen authority; Task 074 remains the only explicit reopen path.

---

## 074 — Add Admin Reopen Project

Goal:
- explicit Admin-only transition:
  - Completed → In Progress

Require:
- confirmation
- audit

---

# PHASE H — Nabavka / Procurement

## 075 — Create ProcurementRequest Schema + RLS

Goal:
- implement the ProcurementRequest schema, constraints, history-preserving foreign keys, and SELECT RLS baseline only

Schema rules:
- `requested_quantity` is required whole-number pieces greater than 0
- `delivered_quantity` is required whole-number pieces, defaults to 0, and remains between 0 and `requested_quantity` inclusive
- `remaining_quantity = requested_quantity - delivered_quantity` is derived and is not persisted
- `requested_name` is a required request-time display/name snapshot; trim surrounding whitespace before persistence and reject blank values
- `product_id` is nullable and preserves historical Product references
- `supplier_id` is nullable, preserves historical Supplier references when present, and is `NULL` for newly created requests where Supplier is unknown
- statuses are exactly `active`, `partly_delivered`, and `resolved`
- every new row starts `active`, with Delivered Quantity 0 and both resolution metadata fields `NULL`
- while unresolved, zero delivered corresponds to `active` and positive delivered corresponds to `partly_delivered`
- full delivery does not silently resolve a request
- `resolved` is explicit, terminal in the current scope, historically readable, and may have any Delivered Quantity from 0 through Requested Quantity
- `status = 'resolved'` if and only if both `resolved_at` and `resolved_by_user_id` are non-null; non-Resolved states require both fields `NULL`
- no hard delete, reopen, or reactivation workflow

Security:
- SELECT requires an active Admin or `procurement.view`
- direct normal-client INSERT, UPDATE, and DELETE remain denied
- Task 075 adds no trusted create, edit, delivery, resolve, or Product-creation RPC

Later workflow ownership:
- Task 078 creates existing-Product requests without asking for Supplier, re-checks an active Product at execution time, and copies Product Name into the snapshot
- Task 079 creates brand-new component requests with `product_id = NULL`, a worker-supplied snapshot, and no required Supplier
- Task 080 owns trusted Delivered Quantity updates and Active/Partly Delivered synchronization without Inventory mutation
- Task 082 owns explicit resolution and its audit without requiring full delivery
- Task 083 may atomically populate `product_id` while creating a Product from an unlinked request

Do not create mutation RPCs or UI in this task.

---

## 076 — Add Nabavka Sidebar Badge Query

Goal:
- trusted/readable count:
  - Active
  - Partly Delivered

Exclude:
- Resolved

Count rows, not pieces.

---

## 077 — Build Nabavka List

Goal:
- `/procurement`
- columns/filters from UI_SPEC
- unresolved-first experience

Wire Sidebar badge refresh.

---

## 078 — Build Existing-Product Request Flow

Goal:
- select existing Product
- Serial/Name auto-fill
- Quantity
- Supplier is not requested and remains unassigned
- save Active request
- audit

No Inventory mutation.

---

## 079 — Build Brand-New Component Request Flow

Goal:
- no Product required
- Name
- Quantity
- Supplier is not requested and remains unassigned
- clearly show `Serial Number not assigned`

Worker never enters Serial Number.

---

## 080 — Add Partly Delivered Backend Rules

Goal:
- add a trusted Delivered Quantity mutation for unresolved Procurement requests

Authorization:
- active Admin or `procurement.change_status`
- do not require `procurement.view` inside the trusted mutation
- `procurement.edit` alone does not authorize Delivered Quantity or Active/Partly Delivered lifecycle changes

Inputs:
- request ID
- desired Delivered Quantity only
- client does not choose Active or Partly Delivered status

Rules:
- Delivered Quantity is whole-number pieces between 0 and Requested Quantity inclusive
- Requested Quantity is unchanged
- Remaining Quantity is derived as Requested Quantity minus Delivered Quantity and is never persisted
- backend atomically derives `active` when Delivered Quantity is 0
- backend atomically derives `partly_delivered` when Delivered Quantity is greater than 0
- full delivery remains valid as `partly_delivered`; do not auto-resolve
- Resolved requests cannot be modified, resolved, reopened, deleted, or reactivated by Task 080
- Task 082 remains the only explicit Resolve workflow and uses `procurement.resolve`

Audit:
- every meaningful update creates exactly one immutable AuditLog entry atomically
- normalized/no-op updates change no metadata and create no audit noise
- denied/failed operations persist neither mutation nor audit

No Inventory mutation.

Add backend authorization, lifecycle, quantity, no-op, audit, rollback, and direct-bypass tests.

---

## 081 — Build Partly Delivered UI

Goal:
- update dialog/flow
- show Requested / Delivered / Remaining

Keep UI simple.

---

## 082 — Add Resolved Workflow

Goal:
- add the trusted terminal Resolve mutation and its confirmed UI workflow

Authorization:
- active Admin or `procurement.resolve`
- do not require `procurement.view` inside the trusted mutation
- `procurement.change_status`, `procurement.edit`, `procurement.create`, and `procurement.view` alone do not authorize resolution
- keep Task 080 delivery/lifecycle updates owned by `procurement.change_status`

Allowed source states:
- `active`
- `partly_delivered`
- Delivered Quantity may be any valid value from 0 through Requested Quantity
- reject an already-Resolved request rather than treating it as a successful no-op

Trusted behavior:
- set `status = 'resolved'`
- set `resolved_at` and `updated_at` from server time
- set `resolved_by_user_id` and `updated_by_user_id` from the active caller
- do not change Requested Quantity, Delivered Quantity, Product relation, requested-name snapshot, Supplier relation, or creation metadata
- keep Remaining Quantity derived only

Terminal lifecycle:
- no normal modification or delivery update after resolution
- no second resolution, reopen, reactivation, hard delete, or restore workflow
- retain the request as readable history

Audit and failure behavior:
- append exactly one immutable AuditLog entry atomically with every successful resolution
- denied or invalid attempts persist neither mutation nor audit

UI and cache behavior:
- require explicit confirmation using the existing confirmation-dialog pattern
- clearly state that the request becomes Resolved and cannot currently be reopened
- after success, refresh the Procurement list and exact Sidebar badge query
- the request leaves the badge naturally because Task 076 counts only Active and Partly Delivered rows; add no special database badge mutation

No Inventory mutation.

---

## 083 — Add Admin Create-Product-from-Request RPC

Goal:
- add the permanently Admin-only trusted transaction that creates and links a Component from an unlinked Procurement request

Authorization and eligibility:
- active Admin only; no delegable permission substitute
- do not require `procurement.view` inside the trusted mutation
- lock and re-check the request is `active` or `partly_delivered` and still has `product_id = NULL`
- reject Resolved and already-linked requests

Inputs and validation:
- required Product Name: trim and reject blank; it may differ from immutable `requested_name`
- required free-text Category: trim and reject blank
- optional Brand: `NULL` allowed; otherwise require an existing active Brand
- do not accept Supplier or Serial Number as client choices

Atomic workflow:
- derive Supplier from the request; when non-null, require it still exists, is active, and owns a normalized nonblank Supplier Catalog Number
- allocate the next permanent 7-digit Serial Number server-side
- create exactly one active Product with `product_kind = 'component'`
- when Supplier is non-null, create exactly one active ProductSupplier relation to it; otherwise create none
- set only `ProcurementRequest.product_id`; preserve requested name, Supplier, quantities, Active/Partly Delivered status, resolution metadata, and creation metadata
- create immutable audit history for Product creation, any ProductSupplier creation, and Procurement linking using established domain conventions
- commit all mutations and audits atomically; required audit failure rolls everything back

Concurrency and Inventory:
- competing Admin attempts on one request must never create two linked Products
- consumed Serial values after rollback may remain gaps and are never reused
- rely on existing Product initialization for one zero InventoryBalance
- create no InventoryMovement and do not add Delivered Quantity to Inventory
- physical stock remains the separate Admin Inventory workflow

Add authorization, eligibility, validation, concurrency, atomic rollback, audit, Serial, ProductSupplier, request-preservation, and Inventory-separation backend tests.

Do not implement Task 084 UI in this task.

---

## 084 — Build Create-Product-from-Request UI

Goal:
- Admin form prefilled from Nabavka

Fields:
- editable required Name prefilled from `requested_name`
- required free-text Category
- optional active Brand
- read-only/prefilled request Supplier when assigned; otherwise show `Not assigned`
- read-only Supplier Catalog Number when Supplier is assigned; no Catalog/Description submission

Serial:
- generated automatically

---

# PHASE I — PCB Definition and BOM

## 085 — Create PcbCard Schema + Output Product Link

Goal:
- implement the PcbCard schema, relationship constraints, and read-security baseline only

Schema:
- canonical fields: `id`, `name`, `output_product_id`, `is_active`, creation/update timestamps and actors, and archive timestamp/actor
- Name is required, trimmed, nonblank, not unique, and is the human-facing card name/code
- `output_product_id` is required, unique across PcbCard rows, references Product with `ON DELETE RESTRICT`, and must identify a `pcb_finished_good`
- one Product may be the output of at most one PcbCard
- the output Product link is immutable after PcbCard creation
- Product archival must not invalidate the historical PcbCard relationship
- actor foreign keys preserve history with `ON DELETE RESTRICT`

Lifecycle baseline:
- new cards default active with `archived_at = NULL` and `archived_by_user_id = NULL`
- active state requires both archive metadata fields null
- archived state requires both archive metadata fields non-null
- add no archive operation, hard-delete workflow, or reactivation workflow in Task 085
- preserve the existing rule that a card with production history is archived rather than hard-deleted

Security:
- SELECT requires an active Admin or `pcb.view`
- direct normal-client INSERT, UPDATE, and DELETE remain denied
- add no trusted create, edit, archive, BOM, or production function in Task 085

Do not create UI, BOM tables, or production tables in this task.

---

# CEO CHANGE CORRECTION BLOCK — AFTER COMPLETED TASK 085

The following lettered tasks are inserted before existing Task 086. They do not
renumber or replace Tasks 086 onward.

## 085A — Correct Normal Project Completion Authority

Goal:
- correct the already-built Project backend and UI so normal Project editing can no longer set `completed`

Requirements:
- add a corrective migration; do not rewrite applied Project migrations
- normal editable status values become only `planned`, `in_progress`, and `on_hold`
- preserve all existing Completed historical Projects
- preserve the existing Admin-only `completed` to `in_progress` reopen from Task 074
- preserve cancellation authority and behavior
- remove Completed from the normal edit UI
- add backend/UI regression coverage proving direct and UI attempts cannot manually complete a Project
- do not rewrite Project history

Future Work Order Finish is the only normal authority that may enter `completed`.

---

## 085B — Create ProjectProduct + ProjectProductComponent Schema/Security

Goal:
- add Project planning entities and direct-write-denial/read-security baseline

Include:
- ProjectProduct with required trimmed nonblank Project-specific Name
- no Product FK or Serial Number on ProjectProduct
- ProjectProductComponent with Product and positive whole-number required total quantity
- unique Product per ProjectProduct
- history-preserving Project/Product/actor references
- active Product validation boundary for later create/change operations
- SELECT for active Admin or `projects.view`
- deny direct normal-client mutations
- Completed/Cancelled Project planning-lock foundation

Do not mutate Inventory or create InventoryMovement.

---

## 085C — Add Trusted Project Product/Component Mutations

Goal:
- trusted create/edit/remove operations for Project Products and their component requirements

Authorization:
- active Admin or `projects.edit`

Requirements:
- reject Completed or Cancelled Projects
- require active Product when adding/changing a component requirement
- support `component` and `pcb_finished_good` Products
- enforce positive whole-number planned total quantities and duplicate prevention
- create immutable audit history for meaningful Project Product and requirement changes
- make mutations atomic and keep normalized no-ops audit-free
- never alter InventoryBalance or create InventoryMovement

---

## 085D — Build Project Products Planning UI

Goal:
- replace the Project detail planning placeholder with real Project Products/component management

Show/manage:
- Project Product Name
- required Product identity and Serial Number
- planned total Required Quantity
- safe loading/error/empty states

Use existing Project read/edit authorization. Completed and Cancelled Projects are
read-only. Do not present ProjectProduct as an Inventory Product or assign it a Serial.

---

## 085E — Add Project Commitment / Availability Read Model

Goal:
- expose trusted outstanding Project commitments without changing physical stock

Derive in this mandatory order:
- for each open Project P and Product X, sum planned ProjectProductComponent requirements as `planned_requirement(P, X)`
- for the same pair, derive only qualifying physical consumption as `actual_project_consumption(P, X)`
- calculate `outstanding_commitment(P, X) = max(planned_requirement(P, X) - actual_project_consumption(P, X), 0)`
- calculate `committed_to_projects(X)` by summing those per-Project outstanding values
- calculate Available after Commitments as InventoryBalance Physical Quantity minus `committed_to_projects(X)`, without clamping

Qualifying consumption includes finished Work Order deductions and, where applicable,
Project-linked PCB production input deductions for the same Project and Product. Exclude
Inventory additions/output movements, unrelated manual adjustments, and consumption
from another Project. Preserve PCB material-usage anti-double-counting. Completed and
Cancelled Projects contribute zero. A reopened `in_progress` Project contributes its
own still-outstanding requirement after subtracting its own prior consumption. Add
authorization, cross-Project isolation, anti-double-count, archived-history,
negative-shortage, and query/index tests. Do not create reservation movement rows.

---

## 085F — Show Physical / Committed / Available Inventory

Goal:
- integrate the trusted commitment read model into Skladište

Show per Product:
- Physical Quantity
- Committed to Projects
- Available after Commitments
- clear shortage warning when Available is negative
- relevant Project attribution where useful

Preserve physical-stock mutation boundaries. Planning UI must not adjust stock.

---

## 085G — Create Documentation Schema + Private PDF Security

Goal:
- add the permanently Admin-only Documentation backend and private Storage boundary

Include:
- DocumentationRecord fields and exact `uvoz`, `izvoz`, `nabavka`, `troskovi` category constraint
- required SQL date and exact non-negative numeric amount; no currency field
- normal historical archive metadata with no hard delete/current reactivation
- optional single private PDF Storage path/reference; no PostgreSQL PDF bytes
- private bucket/policies, PDF validation, no public URL, and authorized signed/private reads
- trusted Admin-only create/edit/archive/PDF upload/replace/remove operations
- immutable audit for meaningful record and PDF changes
- security tests proving non-admin/direct access denial and no browser secret exposure

Do not add a delegable permission key.

---

## 085H — Build Dokumentacija Admin UI + Route

Goal:
- add `/documents` and the permanent `Dokumentacija` Sidebar item

Requirements:
- AdminRoute protection and Admin-only data operations
- list/create/edit/archive Documentation records
- optional PDF upload/open/download/replace/remove using private authorized access
- fixed localized categories and exact decimal amount handling
- no hard delete, restore, currency selector, or multiple attachments
- place the Sidebar item after Radni Nalozi

---

## 085I — Create FixedAsset Schema + Security

Goal:
- add the permanently Admin-only Fixed Asset backend

Include:
- required trimmed nonblank Name
- exact `oprema`, `uredjaji`, `alati` category constraint
- required SQL Purchase Date
- positive whole-number Quantity
- normal historical archive metadata with no hard delete/current reactivation
- trusted Admin-only create/read/edit/archive operations
- immutable audit and direct-bypass security tests
- no Product, Procurement, InventoryBalance, or InventoryMovement synchronization

Do not add a delegable permission key.

---

## 085J — Build Osnovna Sredstva Admin UI + Route

Goal:
- add `/fixed-assets` and the permanent `Osnovna sredstva` Sidebar item

Requirements:
- AdminRoute protection and Admin-only data operations
- list/create/edit/archive Fixed Assets
- fixed localized categories and positive whole-number Quantity validation
- no Inventory controls, hard delete, or restore
- place the Sidebar item after Dokumentacija and before Calendar
- verify final 12-item canonical Sidebar order and direct-route denial for both new Admin modules

---

## 086 — Add Trusted PCB Card Creation

Goal:
- create the PCB card and its newly derived output Product through one trusted backend operation

Requirements:
- accept only the required, trimmed, nonblank human-facing PcbCard Name/Code; names are not unique
- do not accept client-selected Serial Number, Product Category, Brand, kind, Supplier, actor, or initial stock
- require an active Admin or `pcb.create`, without requiring `pcb.view` or Inventory Product permissions
- allocate the next unique 7-digit Serial Number through the existing trusted allocator; sequence gaps after rollback are acceptable and allocated values are never reused
- create exactly one new active Product with Name equal to the normalized PcbCard Name, Category exactly `PCB`, Brand `NULL`, and kind `pcb_finished_good`
- rely on normal Product initialization for exactly one zero InventoryBalance; do not create InventoryMovement, add finished-goods stock, or treat card creation as production
- create one new active PcbCard pointing to that Product, preserving the required unique and immutable output-Product relationship from Task 085
- append exactly one established `product.created` audit and one `pcb_card.created` audit, without duplicating the Product event; the card audit identifies card ID, Name, output Product ID, and generated Serial Number
- commit Product, zero balance, card, and both audits atomically; failure leaves none of those rows or audits
- create no Supplier, ProductSupplier relationship, or Catalog Number

Backend only. Do not create the PCB list or Add PCB Card UI in this task; Task 087 owns both.

---

## 087 — Build PCB List + Create Card UI

Goal:
- `/pcb`
- list
- Add PCB Card
- show card name / Serial / active state

Stock appears once Inventory integration is queried.

Task 087 owns the PCB list and Add PCB Card UI; it does not own BOM schema.

---

## 088 — Create BOM Version + BOM Item Schema

Goal:
- PcbBomVersion
- PcbBomItem
- constraints

Rules:
- quantity > 0
- no duplicate input Product within version
- BOM input Product must exist and be active when the item is added or changed; both `component` and `pcb_finished_good` are eligible stock-tracked kinds
- reject direct self-consumption of the PcbCard's own output Product
- later Product archival preserves existing BOM references and historical display

Task 088 owns PcbBomVersion and PcbBomItem only. Task 085 must not create these tables early.

---

## 089 — Add Initial BOM Save Backend

Goal:
- trusted create/update for unused initial BOM

Validate Product/component references.

Do not implement version rollover yet.

---

## 090 — Build BOM Editor UI

Goal:
- select component
- show Serial
- Qty per Card
- add/remove rows
- clear validation

---

## 091 — Create PcbProductionRun Schema + Security

Goal:
- create the production-history entity needed to determine whether a BOM version has ever been used

Include:
- `pcb_card_id`
- `bom_version_id`
- optional `project_id`
- `quantity_produced`
- `status`
- `produced_by_user_id`
- `completed_at`
- history-preserving foreign keys
- read/security baseline and direct normal-client write denial

Schema/security only. Do not add a separate used flag to PcbBomVersion, a production RPC or UI, Inventory mutation, InventoryMovement, or stock changes.

---

## 092 — Enforce Used BOM Immutability

Goal:
- once any PcbProductionRun references a BOM version, prevent changes to its `pcb_card_id`, `version_number`, `created_at`, and `created_by_user_id`, prevent deletion of the version, and prevent insertion, update, or deletion of its PcbBomItems

The only allowed used-version update is `is_active` true to false with every other field unchanged, reserved for Task 093's trusted rollover. Do not allow false-to-true reactivation, other updates, or item changes. Enforce this at the database boundary and add direct-bypass tests. Derive use from PcbProductionRun history, not a duplicate flag. An unused active BOM remains editable through the existing trusted initial-BOM save path.

Do not implement version rollover here.

---

## 093 — Add New BOM Version Creation

Goal:
- editing a used active BOM preserves the old used version and creates the next sequential version
- copy/replace the edited BOM contents as appropriate
- atomically lock the current card/active version, deactivate the old used version through its sole allowed true-to-false transition, and activate the new version
- preserve the old version's items and production history; never reactivate it
- audit version creation/change

Historical production stays linked to the exact version used; new production uses the latest active version.

---

## 094 — Build BOM Version History UI

Goal:
- show active and historical BOM versions
- show created date/by
- show a Production Used? indicator derived from PcbProductionRun history
- keep used historical versions read-only

Do not implement production execution.

---

# PHASE J — PCB Production

## 095 — Add Pure PCB Requirement Calculator

Goal:
- typed pure domain function

Input:
- BOM
- production quantity

Output:
- total required per component

Add strong unit tests.

---

## 096 — Build PCB Production Precheck UI

Goal:
- quantity
- optional Project
- Required / Available / Missing table

The `/pcb/:pcbCardId/produce` route and optional Project picker require an active Admin or `pcb.produce`, not `projects.view`. A narrow trusted Project-choice read may return only ID, Name, and Status for open Projects (`planned`, `in_progress`, `on_hold`); it grants no general Project access. Task 096 may filter those choices, but Task 097 must re-check Project existence and current status at execution time.

For each BOM input show Qty per Card, Required, Available as current physical `InventoryBalance.quantity` (not Available after Commitments), and Missing as `max(Required - Available, 0)`, using exact whole-number quantities.

Read-only frontend precheck; a minimal trusted choice read is permitted.

No stock mutation, InventoryMovement, PcbProductionRun, AuditLog, or production completion. Task 097 owns the trusted atomic re-check and mutation.

---

## 097 — Add Atomic PCB Production RPC

Goal:
- one trusted transaction boundary

Must re-check:
- actor permission
- PCB state
- active BOM/version
- quantity
- every Inventory balance

Atomically:
- create production run
- deduct BOM inputs
- input movements
- add finished PCB stock
- output movement
- optional Project link
- audit

No partial writes.

---

## 098 — Integrate Production UI with Atomic RPC

Goal:
- confirmation
- submit
- domain-safe errors
- invalidate affected Inventory/PCB queries
- success state

If backend reports insufficient stock:
- display exact failure
- no fake success

---

## 099 — Build PCB Production History UI

Goal:
- date
- quantity
- Project
- BOM version
- Produced By

Read-only.

---

## 100 — Add PCB Production Concurrency Tests

Goal:
- targeted backend test suite

Cover:
- sufficient success
- insufficient no-op
- simultaneous production cannot overspend
- correct BOM version
- correct input/output movements
- audit event

---

# CEO Extension — Inventory Excel Component Import

## 100A — Lock Inventory Excel Import Contract

Goal:
- canonicalize the `.xlsx` Name/Category/optional Brand template, Component-only creation, server-owned Serials, zero initial balance, authorization, all-or-nothing import, batch audit, file safety, and preview/confirmation UX

This documentation task satisfies 100A once committed. No application code or migration belongs to 100A.

---

## 100B — Add Trusted Bulk Component Import Backend

Goal:
- one atomic trusted bulk creation operation; the browser must not call normal Product creation row by row

Requirements:
- active Admin or `inventory.products.create`; no new permission key and `inventory.view` alone is read-only
- reject empty, malformed, or over-1000-row batches; the trusted backend enforces the 1000-row maximum independently of frontend limits
- revalidate the entire submitted row set and resolve all optional Brands as existing and active at execution time before creating any Product
- require/trim nonblank Name and free-text Category; blank Brand means no Brand; each valid row creates one distinct `component` even when rows look identical
- reject client authority over Serial, Product kind/ID, actor/timestamps, and initial quantity; allocate every unique 7-digit Serial server-side with the existing concurrency-safe allocator
- use normal zero InventoryBalance initialization; create no InventoryMovement, Supplier, ProductSupplier, or Catalog Number
- commit all Products, balances, and one immutable batch-level Product-creation audit identifying created Product IDs/count together, or roll back all of them; failed import creates no success audit and consumed Serial sequence values are never reused
- backend security, rollback, and concurrency tests

---

## 100C — Add Excel Parser + Preview Validation

Goal:
- maintainable `.xlsx` data-only parser, canonical three-column template, typed row model, local preview validation, and row-level errors; no database mutation

Review the parser dependency before adding it. Reject unsupported/empty files, do not execute scripts/macros, enforce the Task 100B maximum of 1000 rows, and choose a reasonable file-size limit at implementation time.

---

## 100D — Build Inventory Excel Import UI

Goal:
- Import Excel beside Add Component on `/inventory`, without a new Sidebar item or route
- template download, `.xlsx` upload, local preview with row number/Name/Category/Brand/status or error and total/ready/invalid summary
- enforce the same 1000-row maximum as the trusted Task 100B backend
- block final Import for any invalid row; require explicit confirmation and submit the complete batch through the single trusted bulk operation, never by per-row Product calls
- on success refresh Product/Inventory queries; never partially import or permanently store the workbook for MVP

---

## 100E — Excel Import Security / Atomicity Test Pass

Goal:
- final backend/frontend hardening before Task 101

Cover unauthorized and malformed imports, missing/archived Brand, no client-selected Serial or kind, duplicate-looking rows remaining distinct, all-or-nothing rollback, concurrent unique Serial allocation, `component` kind, zero balance, no InventoryMovement, correct single batch audit, no partial result, and blocked invalid preview.

After 100E, resume Task 101 unchanged.

---

## 100F — Route PCB Production Through Work Orders

Goal:
- replace browser immediate PCB completion with idempotent creation of a specialized frozen Draft Work Order
- defer every Inventory movement and PcbProductionRun until the existing trusted Work Order Finish boundary
- consume frozen BOM inputs from planned quantity, post finished PCB output from explicit actual-good quantity (`0..planned`), and show both values in the official PDF
- allow optional Project/General Stock, null Customer, and empty BOM without changing ordinary Work Order rules
- keep `pcb.produce` limited to specialized creation; normal Work Order view/finish/delete permissions apply afterward
- preserve historical runs, retire authenticated execution of legacy `produce_pcb`, prevent generic Draft edits/Project allocation, and enforce idempotent creation plus exactly-once output posting
- distinguish immutable BOM-derived WorkOrderItems from Draft-editable supplemental rows with an authoritative origin; allow supplemental editing only to Admin or `work_orders.edit_draft`, and aggregate both origins safely at Finish

No deployment belongs to this local implementation step; its forward migrations require separate SQL review and explicit dev authorization.

---

# PHASE K — Work Order Drafts

## 101 — Create WorkOrder Schema + Status Protection

Goal:
- Draft / Finished model
- Project
- customer snapshot
- description
- metadata
- one Project may own one or many Work Orders; do not add unique `project_id`
- preserve the relationship needed for Project-requirement synchronization

Do not create numbering in this task.

---

## 102 — Add Yearly Work Order Number Allocator

Goal:
- concurrency-safe `RN-YYYY-NNNN`

Rules:
- assigned once
- yearly reset using the authoritative IANA business timezone `Europe/Sarajevo`
- never reused
- database unique constraint

Add allocation/concurrency tests.

---

## 103 — Add Trusted Draft Work Order Creation

Goal:
- create an initially incomplete Draft with no Project, Customer snapshot, or Description
- allocate number
- authorize actor
- audit creation

Project selection, Customer snapshot derivation, and Description belong to the later
Draft detail/save flow (Tasks 107–108), not this creation operation.

No Inventory mutation.

---

## 104 — Build Work Orders List

Goal:
- `/work-orders`
- Draft/Finished filters
- search Work Order Number / Project / Customer

No create/edit detail yet.

---

## 105 — Build Create Draft Flow

Goal:
- UI action that creates Draft then navigates to detail

Display generated Work Order Number.

---

## 106 — Create WorkOrderItem Schema

Goal:
- Product
- Quantity
- Work Order relation
- Draft-editable / Finished-immutable foundation

Recommended duplicate prevention:
- one row per Product per Work Order

Design the relationship/allocation boundary needed to reconcile WorkOrderItem rows
with ProjectProductComponent requirements. Do not assume one Work Order per Project.

---

## 107 — Build Draft Work Order Detail Shell

Goal:
- header
- Draft status
- Project selector
- Customer auto-fill/read-only
- Description
- materials section placeholder

No scanner yet.

---

## 108 — Add Draft Save / Update Backend

Goal:
- trusted authorized Draft-only header updates for Project, derived Customer snapshot,
  and Description

Protect:
- Finished cannot be updated
- Customer snapshot derives from selected Project
- new/replacement Project must be open while an existing historical selection may remain
- stale `updated_at` is rejected under a Work Order row lock
- normalized no-op does not update metadata or create audit noise

Audit only meaningful saved changes according to audit policy.

Task 108 does not persist WorkOrderItems. Task 114A owns trusted atomic Draft header
and desired-state material persistence; Draft persistence does not reserve Inventory
or calculate Project commitments.

---

## 109 — Wire Draft Save-for-Later UI

Goal:
- Project
- Customer
- Description
- current items preserved

No Inventory mutation.

---

## 110 — Add Barcode Scan Input

Goal:
- dedicated HID keyboard scanner input

Behavior:
- collect 7-digit value
- Enter submits
- reset after scan
- keyboard friendly

Do not resolve Product yet.

---

## 111A — Add Trusted Barcode Product Resolution Backend

Goal:
- resolve scanned Serial Number to a valid active Product through a narrow trusted
  Draft Work Order read

Errors:
- invalid format
- Product not found
- archived/ineligible Product

Authorization:
- active Admin or `work_orders.edit_draft`
- no `inventory.view` requirement or general Product access

Return only Product ID, Serial Number, and Name. Both `component` and
`pcb_finished_good` are eligible. No WorkOrderItem, Inventory, Work Order, Product,
or AuditLog mutation.

---

## 111B — Wire Barcode Product Resolution UI

Goal:
- connect the Task 110 scanner to the trusted Task 111A resolver
- show resolved Product identity and safe resolver errors

No WorkOrderItem mutation yet.

---

## 112A — Add Trusted Work Order Material Current Inventory Read

Goal:
- expose only Product ID and physical InventoryBalance quantity for one eligible
  Product in an authorized Draft Work Order context
- preserve normal Product and InventoryBalance RLS boundaries
- keep the read informational: no reservation, commitment subtraction, mutation,
  or audit

---

## 112B — Build Work Order Materials Table

Goal:
- scanned Product row
- Serial
- Product Name
- Quantity input
- current Inventory display
- remove Draft row

Keep row component focused.

---

## 113 — Add Duplicate Scan / Focus Behavior

Goal:
- scanning same Product:
  - focuses existing row
  - does not add confusing duplicate

After successful new scan:
- focus Quantity input

Add component tests.

---

## 114A — Add Atomic Draft Persistence Backend + Trusted Material Read

Goal:
- atomically save the normalized Draft header and complete desired WorkOrderItem set
- reload persisted Draft materials through a narrow trusted read

Rules:
- quantities are positive whole `bigint` values transported as decimal strings
- diff desired state so unchanged rows retain identity and add metadata
- newly referenced Products are revalidated as active eligible stock-tracked kinds
- existing persisted references remain historical after later Product archival
- Finished parent rejected
- exact `updated_at` protects the unified header/material Draft version
- normalized full no-op performs no mutation and creates no audit
- one meaningful save creates one atomic `work_order.updated` audit
- no Inventory mutation
- no Inventory sufficiency check or physical reservation
- treat Project requirements as planning/reference data, not a whitelist or quantity
  cap for generic WorkOrderItems
- permit eligible generic Draft materials outside or above the selected Project plan
- preserve Project lifecycle/selection serialization; lock old/new Projects in
  deterministic order when switching
- preserve normal Product/Inventory RLS and direct WorkOrderItem write denial

Backend only. Keep the existing header-only compatibility RPC unchanged.

---

## 114B — Integrate Persisted Draft Materials in the Frontend

Goal:
- load persisted Draft materials through the Task 114A trusted read
- switch Save for Later to the Task 114A atomic header/material RPC
- refresh the local authoritative Draft version from the returned exact `updated_at`

Do not add Inventory mutation or Finish behavior.

---

## 115A — Add Trusted Draft Work Order Deletion Backend

Goal:
- trusted active Admin / `work_orders.delete_draft` operation
- parent Draft lock and exact optimistic `updated_at` check
- atomic WorkOrderItem then Draft deletion
- exactly one immutable `work_order.deleted` audit
- Work Order number never reused
- no Inventory, Project, Product, PCB, PDF, or Storage mutation

Finished delete remains impossible.

Backend only. Direct browser writes remain denied.

---

## 115B — Add Delete Draft Work Order Confirmation + Frontend Integration

Goal:
- permission-aware Draft-only Delete action
- explicit destructive confirmation
- call only the Task 115A trusted operation
- safe stale/lifecycle/access feedback and deterministic success navigation

Do not add another deletion authority or reclaim Work Order numbers.

---

## 116 — Work Order Draft Security Tests

Goal:
- targeted tests

Cover:
- number uniqueness/non-reuse
- Draft edit permissions
- Finished update rejection foundation
- barcode Product validation
- Draft operations never alter Inventory
- multiple Work Orders may belong to one Project
- planned requirements remain reference data and do not cap generic Draft materials

---

# PHASE L — Work Order Finish and PDF

## 117 — Add Work Order Finish Preflight Rules

Goal:
- typed backend/domain validation reusable by finalization

Validate:
- Draft state
- actor permission
- Project
- item quantities
- Product validity
- Inventory sufficiency
- expected Draft version/timestamp
- Project lifecycle/traceability consistency
- Drafts have caused no physical Inventory deduction; physical consumption occurs only during successful Finish finalization
- other unfinished Work Orders for the same Project
- qualifying Project/Product physical-consumption attribution
- per-Project/Product outstanding-commitment effects and cross-Project isolation
- final unfinished Work Order detection and automatic Project-completion preconditions

No mutation yet.

Concrete trusted boundary:
- `preflight_finish_work_order(work_order_id, expected_updated_at)` requires active
  Admin or `work_orders.finish`; no view/edit/Inventory/Project permission substitute
- Work Order, actor authority, Project planning/lifecycle, Product lifecycle, and
  InventoryBalance rows are locked/rechecked in the canonical order
- InventoryBalance rows use deterministic `FOR UPDATE`; Task 121 may reuse those
  held locks only when it calls validation inside the same finalization transaction,
  while any earlier standalone preflight result remains advisory
- incomplete Finish content fails with `WOR07`; an unavailable Project fails with
  `WOR08`; Project requirements do not block generic Work Order Finish
- insufficient physical stock returns typed per-item available/missing quantities
  with `inventory_sufficient = false`; it does not reserve or mutate stock
- the RPC is read-only apart from transient row locks and is reusable by the later
  finalization transaction

---

## 118 — Create Private Work Order PDF Storage + Policies

Goal:
- private `work-order-pdfs` Supabase Storage bucket and immutable `WorkOrderPdf`
  metadata foundation

Rules:
- bucket is private, PDF-only, and limited to 10 MiB
- trusted service-role code exclusively owns temporary/final object writes
- temporary paths are `_tmp/<work_order_id>/<object_uuid>.pdf` and are never
  browser-readable or valid permanent references
- final paths are `final/<work_order_id>/<object_uuid>.pdf`
- authenticated read requires an exact immutable `WorkOrderPdf` reference to the
  final object, a Finished Work Order, and active Admin or `work_orders.view`
- uploading a final candidate alone never exposes it
- direct browser metadata/object writes, replacements, and deletes remain denied
- one version-1 canonical PDF row per Work Order; database immutability prevents
  UPDATE/DELETE

No PDF generation yet.

---

## MANUAL PRODUCT GATE — PDF Layout Approved

The printable Radni Nalog layout is approved from the supplied Alfa Proteh document
reference: A4 portrait, industrial/formal treatment, branded title/header, Work Order
identity and Project/Customer/date block, work-description/report sections, materials
table, and completion/signature/stamp area. Only authoritative Work Order data is
populated; unsupported report, person, unit, price, total, completion, signature, and
stamp values remain blank.

---

## 119 — Build Trusted Work Order PDF Snapshot Model

Goal:
- define exactly what trusted database data is rendered into the PDF

Include approved:
- Work Order Number
- Project
- trusted Customer snapshot
- persisted materials with Product Serial Number, Product Name, and exact Quantity
- description
- authoritative Work Order creation date
- blank report, completion, signature, and stamp areas

Keep this renderer input independent of React page state.

---

## 120 — Build Server-Side PDF Generator

Goal:
- Supabase Edge Function/server-side PDF bytes from trusted snapshot

Requirements:
- A4 portrait Alfa Proteh Radni Nalog layout
- deterministic
- escaped/safe text
- repeating material-table headers and clean multi-page flow
- unsupported price/total fields remain blank
- no client-generated canonical PDF

Unit/integration test basic PDF generation.

---

## 121 — Add Atomic `finish_work_order` RPC

Goal:
- trusted DB final stock/state transaction

Inputs include:
- expected Draft version
- prepared valid PDF storage reference

Re-check:
- actor permission
- Draft state
- no stale edit
- Inventory

Atomically:
- deduct every item
- create InventoryMovement rows
- mark Finished
- preserve Project linkage on physical consumption
- create qualifying Project-linked physical-consumption records so the derived read model reduces only the same Project/Product outstanding commitment
- check for other unfinished Work Orders on the same Project
- when none remain, set Project to `completed`, set server-owned lifecycle/update metadata, and audit automatic completion
- release all remaining unused commitment when Project completes without deducting it
- link PDF reference
- set finisher/time
- create all required Work Order, Inventory, and Project AuditLog entries

No partial DB state.

Physical Inventory deduction occurs only in this successful Finish transaction.
Do not separately deduct ProjectProductComponent requirements; Work Order consumption
is the single physical deduction.

---

## 122 — Build Safe Edge Finalization Orchestrator

Goal:
- implement the trusted sequence:
  1. authorize
  2. read Draft snapshot
  3. generate temporary PDF
  4. call final RPC
  5. delete temp PDF if RPC fails
  6. expose successful final document only after success

Prevent Finished-without-PDF and stale-PDF finalization.

Do not report success unless Inventory, Work Order, automatic final-Work-Order Project
completion, commitment release, PDF linkage, and required audits are coherent.

---

## 123 — Build Finish Confirmation UI

Goal:
- clear irreversible confirmation

Show:
- Work Order Number
- Project
- item count
- consequence:
  - Inventory deducted
  - Work Order locked
  - Project completed when this is its final unfinished Work Order

Do not call finalization until confirmed.

---

## 124 — Integrate Finish UI + Domain Errors

Goal:
- call safe finalization orchestrator
- blocking submit state
- handle:
  - insufficient Inventory
  - stale Draft
  - unauthorized
  - PDF failure
  - already Finished

On failure:
- Draft data remains usable

---

## 125 — Build Finished Work Order Read-Only View

Goal:
- immutable finished display

Show:
- fields
- materials
- Finished By/Date
- linked movements
- PDF action

No:
- Edit
- Reopen
- Delete

---

## 126 — Add Authorized PDF Open / Print Flow

Goal:
- obtain controlled/signed access
- open PDF
- print through normal PDF/browser flow

Test unauthorized access denial.

---

## 127 — Add Correction / Reversal Data Foundation

Goal:
- support explicit stock reversal/correction without editing Finished Work Order

Include:
- reversal movement reference
- required reason
- actor/time
- audit

Do not invent a large correction UI beyond current requirement.

---

## 128 — Work Order Finalization Security / Concurrency Tests

Goal:
- targeted high-value tests

Cover:
- insufficient Inventory no-op
- two simultaneous Finish attempts
- stale Draft
- Finished immutable
- correct movement ledger
- valid PDF required
- unauthorized PDF denied
- audit
- failure leaves no partial finalized state
- multiple Work Orders per Project
- exactly the final unfinished Work Order completes the Project
- simultaneous finishes cannot complete the Project early or twice
- actual consumption reduces outstanding commitment without double deduction
- consumption from one Project cannot reduce another Project's commitment
- additions/output movements and unrelated manual adjustments do not reduce commitment
- Project-linked PCB input consumption follows the existing raw-input/finished-PCB anti-double-count rule
- unused commitment releases on completion without an Inventory movement

---

# PHASE M — Project Material Usage Integration

## 129 — Add Work Order Source Links to Project Usage

Goal:
- Project read model includes actual Finished Work Order consumption

Show traceability:
- Product
- Quantity
- source Work Order
- date
- planned ProjectProductComponent requirement
- outstanding commitment after qualifying consumption for that same Project/Product pair

Drafts excluded.

Support one or many Work Orders per Project without double-counting completed physical
consumption.

---

## 130 — Add Project-Linked PCB Usage + Anti-Double-Count

Goal:
- merge Project-linked PCB raw input consumption into Project usage

Rules:
- Project-linked PCB production raw inputs count
- later Work Order use of that finished PCB must not re-expand the same frozen BOM or
  supplemental production inputs
- general-stock PCB produced without Project remains general stock

Add explicit integration tests.

---

# PHASE N — Calendar

## 131 — Create CalendarEntry Schema + RLS

Goal:
- Business Trip
- Event
- Vacation

Read:
- all active authenticated users

Write:
- Admin only

No approvals.

---

## 132 — Add Derived Birthday Calendar Query

Goal:
- birthdays come from UserProfile

Return only Calendar-safe profile data.

Do not expose Users-module security fields.

---

## 133 — Build Calendar View + Category Filters

Goal:
- actual calendar
- multi-select:
  - Birthdays
  - Business Trips
  - Events
  - Vacations

All active users can view.

---

## 134 — Build Admin Calendar Management

Goal:
- Add/Edit/Remove:
  - Business Trip
  - Event
  - Vacation

Admin-only backend + UI.

Audit meaningful changes.

---

# PHASE O — Archive

## 135 — Build Audit Query + Pagination

Goal:
- permission-aware backend read model for Archive

Admin:
- full

Non-admin:
- requires `archive.view`

Support scalable pagination from day one.

---

## 136 — Build Archive List UI

Goal:
- Date/Time
- User
- Module
- Action
- Record
- Summary

Read-only.

---

## 137 — Add Archive Filters / Search

Goal:
- date range
- user
- module/entity
- action
- text search

Make filters clearable and server-backed.

---

## 138 — Add Archive Detail / Context Links

Goal:
- view before/after/metadata where useful
- navigate to affected record when permitted

Do not leak target-record data user cannot access.

---

## 139 — Audit Coverage Review

Goal:
- inspect all implemented meaningful mutations

Verify audit exists for:
- users/permissions
- products/brands/suppliers
- inventory adjustments
- projects
- procurement
- PCB definitions/production
- Work Orders
- Calendar

Add missing trusted audit hooks/tests.

Do not log meaningless UI actions.

---

# PHASE P — Final Dashboard

## 140 — Create Permission-Aware Dashboard Read Model

Goal:
- backend aggregation foundation

Requirement:
- backend returns only data from modules actor may view
- Admin gets full scope
- Calendar/global data may be company-wide

No UI yet.

---

## 141 — Build Dashboard Project / Work Order Widgets

Goal:
- real Projects summary
- recent Work Orders

Respect permissions and empty states.

---

## 142 — Build Dashboard Nabavka / Inventory Widgets

Goal:
- unresolved Nabavka
- recent/important Inventory/Product information

Do not duplicate entire module pages.

---

## 143 — Build Dashboard Activity / Calendar Widgets

Goal:
- recent authorized business activity
- upcoming Calendar/company info

Archive activity here means AuditLog business events and must respect Archive/module
visibility rules. It is distinct from the human-authored Project Activity and alert
inbox defined in the staged Project Activity/Alerts phase below.

---

## 144 — Dashboard Authorization Leak Tests

Goal:
- multiple permission profiles

Prove:
- no unauthorized module data leaves backend
- hidden widgets are not merely client-hidden
- Admin sees full view

---

# PHASE P1 — Project Activity + Alerts

## Task A — Freeze Canonical Business / Security Rules

Goal:
- align all canonical documents on the append-only human Project Activity model
- freeze Activity/alert permissions, recipients, atomicity, idempotency, pagination,
  private image, Dashboard placement, deep-link, and AuditLog boundaries

Documentation/contract only. Do not create schema, Storage, backend, or UI.

---

## Task B — Permission Definitions + Schema / RLS / Storage Foundation

Goal:
- add delegable `projects.alerts.send` and `projects.alerts.receive`
- create Activity, optional attachment, alert event, and recipient tables
- add only the locked constraints and indexes
- enable RLS with no broad browser writes
- create the private image bucket and restrictive policies

Preserve the locked rule that every active Admin is automatically included in each new
Project Activity alert recipient snapshot, while non-admin recipients require explicit
`projects.alerts.receive` plus effective Dashboard and Project access.

---

## Task C — Trusted Activity / Alert Write + Bounded Activity Reads

Goal:
- implement authoritative post/send authorization and Project-status locking
- implement title/description validation and original-author-bound request-UUID
  idempotency
- return exact same-author historical retries without new fanout/audit/attachment
  mutation; retain `PAC01` for that author's conflicting reuse and return generic
  `42501` to every other actor before payload comparison
- atomically insert Activity, alert, recipient snapshot,
  and narrow `project_activity.created` / `project_activity.alert_sent` AuditLog events
- fail the complete alert-intent request when there are zero eligible recipients
- add newest-first Activity page and authorized by-ID reads

Do not copy full Activity description/image into AuditLog or notification rows.

---

## Task D — Trusted Attachment Upload / Signing Edge Boundary

Goal:
- validate JPEG/PNG/WebP bytes and decoded image where supported, maximum 5 MiB
- use server-generated random private object paths and service-role-only mutation
- provide exact referenced-object authorized signing
- implement best-effort definitive-orphan cleanup and indeterminate-outcome
  idempotency reconciliation
- run the image upload/attachment only after the Activity post transaction succeeds,
  using the same original-author-bound request UUID

Do not expose service-role credentials, public URLs, caller-selected paths, SVG, or
animated formats.

---

## Task E — Project Activity Composer / Timeline UI

Goal:
- add the open-Project composer with Title, Description, optional image,
  `Post update`, and permission-aware `Post & send alert`
- use a collapsible composer and keep the post-success confirmation plus
  `Recent activity` heading outside the timeline scroll region
- render append-only Activity newest first, 20 initially, in a keyboard-accessible
  populated timeline with a 42rem maximum height, natural small-list height, compact
  empty states, and keyset `Load more` inside the scrolling region
- after posting, scroll only the internal timeline to the newest authoritative row;
  keep compact image thumbnails in cards and the image viewer at viewport level
- show author, absolute timestamp, optional image, and Alert sent badge
- keep Completed/Cancelled history readable without posting controls

Do not add edit/delete/resend or Project Activity title search.

---

## Task F — Notification Inbox / Read-State Backend

Goal:
- add bounded newest-first recipient inbox reads with current active/Dashboard/Project
  authorization rechecks
- add unread count and per-recipient click-to-read mutation
- preserve immutable send-time membership while hiding rows when current access is lost

Default 20, allowed 1–50, keyset `(created_at, recipient_row_id)`; no OFFSET,
unbounded read, Mark all as read, polling, or Realtime.

---

## Task G — Dashboard Heading Alerts Control / Panel

Goal:
- place Alerts/unread count on the right side of the Dashboard content-heading row
- add bounded panel loading, empty, error/retry, keyboard, Escape, outside-click, and
  read/unread behavior
- show Project name, Activity title, author, and timestamp only

Keep the global Topbar unchanged.

The completed V1 navigation follow-up mounts the existing profile-scoped Project
Activity unread-count hook in the persistent Sidebar and renders a positive Dashboard
badge (`99+` cap) using the Nabavka badge treatment. Mark-read/dismissal share the same
React Query cache. No second RPC, polling, or Realtime lifecycle is introduced. Task
003A adds shortage opening/resolution notifications to this count and extends the
trusted unified inbox with Product display identity, exact global shortage snapshot,
event kind, and baseline indication. Task 003B renders that trusted projection in the
existing Alerts panel, labels the quantity as a shared global deficit, and uses safe
Project-level navigation without an Activity fragment. It does not infer shortage
context from titles or untrusted text. Task 002A adds the
Issue-resolution notification foundation.

---

## Task H — Deep Link + E2E / Security Hardening

Goal:
- navigate alert clicks to `/projects/<projectId>#activity-<activityId>`
- use authorized by-ID loading, scroll, and focus when outside the first page
- prove RLS/direct-call resistance, recipient snapshot/current-access behavior,
  eligible-sender inclusion, zero-recipient rollback, idempotent retry/conflict, Storage cleanup,
  pagination, inactive-user denial, and Completed/Cancelled behavior

H2 implements strict Activity-fragment parsing, a profile-scoped authorized by-ID
target query, safe target errors, separately rendered `Linked activity`, and
pagination-preserving deduplication. H3 adds one-shot nested positioning, stable target
DOM identity, temporary highlight, programmatic focus, reduced-motion behavior, and
React Router history-entry handling without changing retrieval or pagination. H4/H5
retain real-browser acceptance and final independent E2E/security review.

---

## Notification Dismissal D1 — Canonical Docs + Schema/Immutability Foundation

Goal:
- add nullable `dismissed_at` to retained recipient history
- enforce valid, independent one-way read and dismissal transitions
- preserve direct-table denial, RLS, and trigger-helper security

D1 does not make dismissal callable or visible. D2 extends the same undeployed forward
migration with the trusted owner-only mutation, active-inbox/count filtering, and index
changes. D5 adds the Dashboard three-dot menu and required confirmation dialog. V1 has
no undo or dismissed-notification archive.

## Task 001C1 — Private Realtime Alert Invalidation Database Foundation

Goal:
- call `realtime.send` with `{}` and emit only private event `invalidate` on the exact
  `project-alert-notifications:<profile-uuid>` topic after recipient insert, initial
  read, or initial dismissal
- accept only Supabase's generated `{ "id": "<transport-uuid>" }` delivery payload;
  treat it solely as transport metadata and ignore it in the frontend
- authorize topic SELECT only for its active owner with effective Dashboard and
  Project access; grant browsers no send policy and no recipient-table read
- retain the trusted inbox/count RPCs as the only notification-data authority

Task 001C1 adds no frontend subscription, polling, recipient publication, or RPC
change. Task 001C2 owns the profile-scoped subscription lifecycle and authorized cache
refetch behavior.

## Task 001C2 — Persistent Dashboard Notification Realtime Subscription

Goal:
- mount one private per-profile Broadcast subscription in the authenticated AppLayout
- ignore the transport payload and invalidate only the captured profile's trusted
  inbox/unread-count queries on `invalidate` and every successful subscribe/reconnect
- coalesce signal bursts without losing the final authoritative reconciliation
- remove the exact channel and protected cache on logout, profile/access loss, inactive
  transition, or unmount; ignore callbacks from stale generations
- preserve Task 001B own-post invalidation and prohibit polling, optimistic counts,
  direct recipient-table reads, or browser Broadcast sends

Frontend implementation and DEV migration 132 deployment are complete. Positive
multi-user real-browser Realtime acceptance remains separately gated.

---

# PHASE P2 — Project Issues + Resolution

## Task 002A — Database Foundation

Goal:
- add immutable General/Issue Activity classification with historical General default
- add one immutable text resolution per Issue with resolver-bound idempotency
- allow authorized resolution across all Project lifecycle states without status mutation
- generalize retained notification events for manual Activity, Issue resolution, and a
  strict shortage target shape reserved for the later Task 003A implementation
- atomically fan out resolution notifications to active Admins and active
  Dashboard+Project viewers without alert send/receive permissions
- preserve legacy posting/reads, manual alert behavior, recipient state, and Realtime

Backend only. No Issue UI or resolution-image Storage boundary.

## Task 002B — Issue / Resolution UI

Implemented locally: adopt the Issue-aware trusted reads, add General/Issue composer
choice, resolution confirmation/description, resolved-state presentation, and
notification kind presentation without changing backend authority.

## Task 002C — Resolution Image Boundary

Implemented locally: one optional immutable private resolution image through trusted
resolver-owned upload, attachment, reconciliation, and signed-read boundaries. The
text resolution commits first; failed image attachment remains safely retryable without
duplicating resolution, notification, or audit history. Do not reuse or mutate the
original Activity image. Task 002D retains DEV/real-browser acceptance.

---

# PHASE Q — Hardening and Production

## 145 — Full RLS Policy Matrix Audit

Goal:
- systematically review every exposed table

Check:
- anonymous
- inactive
- Admin
- permitted non-admin
- unpermitted non-admin

Fix gaps only; no feature expansion.

---

## 146 — Permission Escalation Attack Tests

Goal:
- direct backend attempts to:
  - self-grant permission
  - grant others permission
  - set Admin
  - reactivate account
  - access Users

All must fail for non-admin.

---

## 147 — Identifier Concurrency Audit

Goal:
- stress:
  - Product Serial sequence
  - Work Order yearly numbering

Prove:
- no duplicates
- no reuse
- expected formatting

---

## 148 — Inventory Concurrency Audit

Goal:
- stress stock mutation paths

Cover:
- manual adjustment
- PCB production
- Work Order Finish

Prove:
- stock never negative
- movement/balance remain consistent

---

## 149 — Historical Immutability Audit

Goal:
- attempt forbidden writes to:
  - AuditLog
  - InventoryMovement
  - Finished Work Order
  - used BOM version/items
  - permanent PDF link/state

Fix any backend gap.

---

## 150 — Cross-Module Integration E2E: Nabavka → Product → Inventory

Goal:
- realistic flow:
  - worker adds new-component request
  - Admin creates Product
  - Supplier/Catalog link exists
  - Admin manually adds received stock
  - history/audit correct

---

## 151 — Cross-Module Integration E2E: Inventory → PCB → Project

Goal:
- create component stock
- produce PCB
- verify raw deductions
- finished-goods increase
- optional Project usage
- audit/history

---

## 152 — Cross-Module Integration E2E: Project → Work Order → PDF

Goal:
- create Project
- add Project Products and planned component requirements
- create multiple Draft Work Orders with Project requirements kept as reference data
- create Draft
- scan/add materials
- Save
- Finish
- verify stock
- verify Work Order-linked actual consumption reduces only the same Project/Product commitment
- verify consumption from one Project cannot reduce another Project's commitment
- verify the final unfinished Work Order automatically completes the Project
- verify unused commitment releases without another stock deduction
- PDF
- immutability
- audit

---

## 153 — User Deactivation / Permission Runtime E2E

Goal:
- active user logged in
- Admin changes permission/deactivates
- stale frontend cannot keep protected backend access

Verify navigation/read/write refresh behavior.

---

## 154 — Architecture / File-Size Review

Goal:
- inspect feature structure after implementation

Fix:
- giant multi-responsibility TSX files
- duplicated domain types
- duplicated permission logic
- raw DB calls scattered through pages
- cross-feature coupling
- catch-all utilities

Do not perform cosmetic refactoring without architectural reason.

---

## 155 — Query / Index / Pagination Review

Goal:
- inspect real query patterns

Focus:
- Inventory search
- Supplier/Product links
- Work Order list
- PCB history
- Archive
- Dashboard

Add only justified indexes/pagination improvements.

---

## 156 — UX State / Accessibility Pass

Goal:
- verify:
  - loading
  - error
  - empty
  - confirmation
  - keyboard behavior
  - focus states
  - mobile Sidebar
  - table overflow
  - barcode scanner keyboard flow

Preserve visual language.

---

## 157 — Dependency / Secret / Logging Review

Goal:
- verify:
  - no service-role in browser
  - no committed secrets
  - logs do not contain tokens/passwords
  - dependencies are intentional
  - no obsolete prototype dependencies remain

---

## 158 — Create Production Supabase Environment

Goal:
- separate production project/environment

Do not point local development at production.

Prepare:
- production config
- secrets plan
- bootstrap procedure

No user data migration unless explicitly required.

---

## 159 — Apply Production Database / RLS / Storage / Functions

Goal:
- apply reviewed versioned migrations to production

Include:
- schema
- constraints
- RLS
- sequences
- trusted RPCs
- Storage policies
- Edge Functions

Verify exact production state after deployment.

---

## 159A — Supplier Catalog Provenance + Lot-Aware Inventory

Before production frontend deployment:

- require Catalog Number and add optional Description on active Supplier master records
- backfill existing positive aggregate stock as explicit legacy/unknown source lots without inventing Supplier history
- add immutable Supplier, legacy, and internal-production source lots plus immutable outbound allocations
- keep InventoryBalance canonical and enforce transaction-end lot/balance reconciliation
- require exact ProductSupplier eligibility for manual Add/upward Correction, snapshot the Supplier master Catalog/Description, and consume FIFO for every outbound mutation
- apply FIFO to generic Work Order and PCB input Finish; create internal-production lots for PCB output
- bind trusted PDF snapshot allocations to Finish with a revalidated fingerprint
- render frozen Catalog Number in `KAT. BROJ`, `—` for legacy/internal, and split mixed-source quantities into separate PDF rows
- update Supplier master and Product/Supplier relationship UI plus Product Supplier Stock History
- extend security, immutability, migration, and committed concurrency coverage

Do not deploy while any active Supplier lacks an authoritative Catalog Number. Do not invent values or rewrite historical InventoryMovement, source-lot snapshots, Finished Work Order, PDF, or AuditLog records.

### Supplier-level Catalog authority correction

The final authority is Supplier master data: every active Supplier owns one required normalized `catalog_number` and an optional normalized `description`. ProductSupplier remains an eligibility/traceability relation only and exposes no Catalog/Description input. Current relationship screens read live Supplier values; trusted Add/upward-Correction operations validate the active ProductSupplier link, then read and freeze Supplier Catalog Number/Description into immutable source lots. Procurement Product creation links the existing Supplier without accepting Catalog metadata. Existing source-lot snapshots, allocations, Finished Work Orders, PDFs, movements, and audits are never recomputed or rewritten after Supplier edits.

## 160 — Configure Production Frontend Deployment

PAUSED until Task 159A is reviewed, deployed, and validated.

Goal:
- Vercel production configuration
- production public Supabase variables
- HTTPS
- correct build command
- no server secret exposure

Smoke-test deployed login shell.

---

## 161 — Bootstrap Initial Admin Safely

Goal:
- create/verify first real AlfaEV Admin using documented trusted procedure

Verify:
- UserProfile
- Admin flag
- active state
- login
- Users access

Do not leave temporary bootstrap bypasses behind.

---

## 162 — Backup / Recovery Readiness Check

Goal:
- verify production recovery plan for:
  - PostgreSQL business data
  - Work Order PDFs
  - DocumentationRecord PDFs

Document:
- backup capability
- restore expectations
- who owns recovery procedure

---

## 163 — Final Automated Gate

Required:

```bash
npm run typecheck
npm run test:run
npm run build
npm run test:e2e
```

Also run:
- backend/RLS integration suite
- concurrency suites
- security tests

Zero known critical/high failures.

---

## 164 — Final Manual Acceptance

Manually verify real production-like flow:

### Auth / Users
- login/logout
- inactive account
- Admin Users
- permission combinations

### Projects
- create/edit
- normal editing cannot manually Complete
- Project Products/component planning
- per-Project/Product commitment aggregation and cross-Project isolation
- Physical / Committed / Available values and negative shortage display
- Work Order-linked actual consumption reduces only its own Project/Product commitment
- final Work Order automatic completion
- Admin-only Completed to In Progress reopen

### Nabavka
- existing request
- new component
- Partly Delivered
- Resolved
- Sidebar badge

### Suppliers / Inventory
- supplier
- product
- Catalog links
- Serial
- stock adjustment
- barcode
- movement history

### PCB
- BOM
- versioning
- insufficient stock
- successful production
- finished stock
- Project link

### Work Orders
- number
- Project/customer
- scan
- Draft
- Finish
- Inventory
- PDF
- immutable state
- multiple Work Orders per Project
- Project requirements remain planning/reference data rather than a generic material cap
- physical deduction occurs only on Finish
- Project-linked consumption reduces only the matching Project/Product commitment
- final Work Order completes Project atomically

### Dokumentacija
- Admin-only navigation/route/data
- create/edit/archive
- private optional PDF upload/open/download/replace/remove

### Osnovna sredstva
- Admin-only navigation/route/data
- create/edit/archive
- no Inventory synchronization

### Calendar
- filters
- birthdays
- Admin edits

### Archive
- filters
- immutable history

### Dashboard
- Admin
- multiple non-admin permission profiles

Record results; do not infer success from automated tests alone.

---

## 165 — Production Release Sign-Off

Goal:
- final go/no-go task

Confirm:
- canonical docs reflect shipped system
- no unresolved blocker
- production migrations reproducible
- security gates passed
- backups/recovery understood
- final manual acceptance passed
- no debug/bootstrap bypass
- repository clean
- release commit/tag documented

Only after this task is AlfaEV considered ready for normal internal production use.

---

# Codex Prompt Template

Use one task at a time.

Example:

```text
Implement BUILD_PLAN Task 097 only: Atomic PCB Production RPC.

Before editing:
1. Inspect the repository and existing related migrations/services/tests.
2. Read the relevant canonical docs, respecting precedence:
   docs/SECURITY_RULES.md
   docs/BUSINESS_RULES.md
   docs/DATA_MODEL.md
   docs/PERMISSIONS.md
   docs/ARCHITECTURE_RULES.md
   docs/TECH_STACK.md
   docs/BUILD_PLAN.md
3. Do not implement Task 098 or unrelated UI/refactors.

Implement the task completely, including the task-specific tests.

Required validation:
npm run typecheck
npm run test:run
npm run build
plus the relevant backend/integration tests for this task.

Return only:
- summary of implementation
- files changed
- migrations/functions changed
- tests added/updated
- exact validation results
- blockers or follow-up strictly belonging to this task
```

---

# Why This Plan Is Intentionally Granular

This plan has **165 numbered execution tasks plus the staged Project Activity/Alerts
Tasks A–H**, grouped into coherent phases.

The task count is not a sign that AlfaEV is overengineered. It separates work that Codex performs better when it does not have to reason about five unrelated boundaries at once.

Examples of good task boundaries:

- `047 — Add 7-Digit Serial Number Sequence`
- `060 — Add Admin Manual Inventory Adjustment RPC`
- `083 — Add Admin Create-Product-from-Request RPC`
- `097 — Add Atomic PCB Production RPC`
- `110 — Add Barcode Scan Input`
- `121 — Add Atomic finish_work_order RPC`

These are individually reviewable and testable.

Important rule:

> **Do not split one atomic security/business transaction merely to make the prompt shorter.**

For example, PCB production remains one trusted transaction task because splitting stock deduction, movement creation, output creation, and audit across separate implementation prompts would create unsafe intermediate states.

Similarly, tiny one-file cosmetic changes should not become standalone BUILD_PLAN tasks unless there is a real review boundary.

This plan aims for maximum Codex performance by keeping each prompt focused without destroying architectural coherence.

## Task 003A — Automatic Project shortage alerts backend

- Add forward-only episode/event schema and trusted deferred reconciliation.
- Cover InventoryBalance, Project requirement, and Project status mutation sources.
- Reuse global availability and per-Project outstanding commitment calculations.
- Notify once on opening and once on resolution; retain quantity changes as immutable
  event history without extra fanout.
- Run an idempotent existing-shortage baseline only when the migration is explicitly
  deployed. Migration 135 and its approved baseline are deployed to DEV; later
  warehouse migrations do not rerun that initialization.

## Task 003B — Automatic Project shortage alerts frontend

- Extend the exact unified notification parser with Product identity/display,
  `opened`/`resolved`, exact shortage text, and baseline indication.
- Render opening and resolution rows in the existing Dashboard Alerts panel; identify
  baseline openings and describe quantity as the shared global Product deficit.
- Reuse existing mark-read, dismissal, pagination, Sidebar badge, profile-scoped cache,
  and private Realtime behavior.
- Navigate shortage rows to `/projects/<projectId>` only; do not invent Activity IDs or
  row-level Product targeting.
- Keep DEV/browser acceptance as a separate deployment step.

# PHASE R — Three Warehouses + Finished Product Calculator

These slices implement the approved contract recorded by Task 001A. Each task records
its current implementation/deployment state below.

Current checkpoint: migrations 136–142 are deployed to alfaev-dev (142/142), and DEV
`finish-work-order` v6 is ACTIVE. The warehouse frontend is implemented locally and
read-only browser acceptance is complete. Controlled Stage 2 mutation acceptance is
pending and non-Admin browser acceptance is incomplete. No frontend production
deployment or warehouse production database rollout has occurred; production remains
at its previously verified migration state. Finished Goods Project reservation and
fulfillment backend code is local in undeployed migrations 143–145, with the local
migration-146 read model. Phase 3D2 implements the read-only Project frontend locally;
reservation mutation controls and application activation remain pending.

## 001B — Warehouse schema and historical backfill

- Add fixed Raw Materials, Finished Goods, and Customs Warehouse identities.
- Scope balances, movements, and source lots to a warehouse in one shared ledger.
- Backfill all existing stock/history to Raw Materials without duplication or immutable
  history rewrite; do not retrospectively move PCB output.
- Atomically preserve every existing Inventory, Work Order, PCB, Dashboard, Project
  planning, and shortage operation as explicitly Raw Materials-only. Finished Goods and
  Customs begin at zero and are not enabled for legacy reads or mutations.

## 001C — Warehouse permissions and trusted reads/adjustments/transfers

- Implemented by forward migration 137, deployed to DEV.
- Add the six independent warehouse view/adjust permissions and explicit legacy
  `inventory.view` → Raw Materials view grants.
- Enforce warehouse isolation in trusted reads and Add/Remove/Correction operations.
- Complete the trusted warehouse Product-detail projection and provide a narrow active
  Supplier-source choice read for Admins or matching warehouse adjusters, without
  broadening Product, Brand, Supplier, or ProductSupplier table grants.
- Transfer atomically between distinct warehouses with adjustment authority at both
  ends, paired movements, FIFO provenance, stable locks, and no stock creation/loss.
- Keep Task 001D tabs and Task 001F multi-warehouse production out of this slice.

## 001D — Three Inventory tabs and UI

- Implemented locally: permission-aware Raw Materials, Finished Goods, and Customs
  Warehouse tabs on the existing Inventory route, trusted warehouse list/detail,
  movement/source history, matching adjustment sources, and atomic transfers.
- Profile/warehouse/Product query isolation, permission-revocation fallback, accessible
  keyboard tabs, and responsive horizontal overflow are covered by focused tests.
- Database migrations 136–142 are deployed to DEV. The frontend remains local and
  read-only browser acceptance is complete; controlled Stage 2 mutation acceptance is
  pending and non-Admin browser acceptance is incomplete.

## 001E — Finished Product Calculator and three-digit serial creation

- Forward migration 138 is deployed to DEV; frontend changes are implemented locally.
- Rename only user-visible PCB Cards text; retain `/pcb`, schemas, identifiers, and
  historical audit data.
- Add concurrency-safe atomic creation using trimmed case-insensitively unique
  Name/Code and globally unique exact three-digit Serial Number text.
- Preflight historical PCB names for normalized duplicates before adding uniqueness.
- Preserve ordinary seven-digit allocation and accept exact three- or seven-digit text
  in trusted Product identity lookup/scanning. Warehouse-aware production is Task 001F.

## 001F — Produce simplification and warehouse-aware Work Order Finish

- Remove the new-production Project selector and always create calculator Work Orders
  without a Project while retaining historical Project-linked records.
- Consume actual warehouse sources and credit actual-good output to Finished Goods in
  one idempotent atomic Finish with warehouse-aware fingerprint/PDF provenance.
- Use exact Raw Materials FIFO → Customs FIFO → Finished Goods FIFO priority.
- Preserve migration-138 Raw Materials-only shortage behavior until Task 001G applies
  the forward-only Raw Materials plus Customs definition.

## 001G — Project commitment/shortage compatibility

- Implemented locally in migration 140: canonical V1 availability is Raw Materials plus
  Customs, excluding Finished Goods, while preserving shared global deficit semantics.
- Combined availability is visible only with both eligible-warehouse view permissions.
- Deferred reconciliation makes eligible-warehouse transfers neutral and evaluates
  eligible/Finished Goods boundary transfers from final transaction state.
- Existing shortage episodes/events and notification history are retained without
  baseline rerun or migration-time rewrite. Migration 140 is deployed to DEV.

## 001H — Final local/security verification, controlled DEV deployment, and browser acceptance

- Run migration, authorization, concurrency, ledger/provenance, barcode, Work Order,
  shortage, UI, and historical-preservation gates on disposable/local infrastructure.
- Deploy to DEV only after independent review and explicit authorization, then complete
  browser acceptance before any separately authorized production rollout.

## 001K / Phase 3A — Finished Goods reservation foundation

- Local migration 143 reuses explicit Project requirement Product IDs and exact
  quantities; group names alone never become finished-product demand.
- Add retained Project/Product/FG current state, immutable request-owned event
  receipts, a dedicated permission and authenticated Project-scoped trusted reads.
- Keep reserve/release algorithms non-executable by application/service roles. Local
  database-owner rollback proofs are not browser mutation authorization.
- DEV remains 142/142. Migration 143 is undeployed; no reservation UI or fulfillment
  is implemented. Existing production and shortage contracts are unchanged.
- Phase 3B must implement all debit and planning/lifecycle guards, cancellation release,
  explicit completion resolution and non-reclaiming reopen behavior before activation.
- Phase 3C must integrate atomic physical fulfillment and its provenance; frontend
  work and any deployment require their own reviewed scope and authorization.

## 001K / Phase 3B1 — Local hard-reservation safeguards

- Local migration 144 adds a universal FG debit guard under the stock-row lock,
  reservation-aware production quantity/FIFO/fingerprint planning, immediate explicit
  demand checks and cancellation/completion/reopening safeguards.
- Migration 143 remains unchanged and all reservation mutation APIs remain private.
- Rollback-only trusted-RPC concurrency proofs use a temporary local database copy;
  the existing local database must not be reset. Test queries are invalidated before
  cleanup so timed-out async continuations cannot write outside their transaction.
- Authorized residue disposition: retain local test Product
  `e27050dc-358a-466a-b734-0a5167d04979` and its three zero-quantity warehouse
  balances as known local testing artifacts. No cleanup or deletion is required for
  reservation acceptance; preservation baselines must include these records.
- The 41 unavailable historical baseline digests remain a documented evidence
  limitation, not proof of historical preservation. Fresh current-state comparisons
  do not reconstruct that missing evidence.
- The Task 001K rollback-only maintenance SQL and Python launcher remain unexecuted;
  their preparation is not a reservation runtime PASS or a prerequisite to acceptance.
- Local Phase 3A/3B1 backend acceptance passed on 23 October 2026: 34 runtime
  tests cover foundation/protection, fresh application-schema 0→144 (retaining
  platform schemas), upgrade 142→143→144, and rollback/committed-winner races.
  All migrations and fixtures ran only in uniquely owned disposable local clones;
  source table/security/sequence manifests matched before/after, residue included.
- The existing Node pg harness now supports the pinned container's Unix-socket
  authentication through a bounded byte transport, with no password/HBA/network
  changes. Connection-free checks passed 90/90; full unit passed 2205/2205,
  typecheck/build and whitespace checks passed (existing bundle-size warning).
- Migrations 143/144 remain unchanged and unapplied to the source database/DEV.
  This is a backend acceptance PASS, not application activation or a complete
  reservation feature. At the Phase 3B1 checkpoint, physical fulfillment and UI were
  unfinished; Phase 3C follows below. Activation/deployment require separate review.
- No remote rollout, fulfillment or reservation frontend is included.

## 001K / Phase 3C — Atomic Finished Goods reservation fulfillment

- Additive local migration 145 reuses the existing FG balance/FIFO ledger and explicit
  Project/Product demand; migrations 136–144 remain unchanged. Fulfillment references
  an exact reservation, Project, Product, quantity, expected version and request UUID.
- Atomically reduce the matching reservation and FG stock, append FIFO allocations,
  immutable `fulfilled` receipt/movement linkage and authorized AuditLog history.
  Preserve other Projects' reserved stock; no guard bypass or parallel ledger.
- Qualify `finished_goods_reservation_fulfillment` in canonical consumption and the
  existing movement-demand/shortage triggers. Keep Raw plus Customs eligibility,
  deferred queue deduplication, notification rules and unrelated production unchanged.
- Local runtime acceptance passed: fulfillment tests, foundation/protection
  regressions and committed-winner concurrency run only on owned disposable clones.
  Fulfillment passed 13/13, foundation/protection regression 21/21 and concurrency
  23/23 (including ten fulfillment committed-winner races). Fresh application-schema
  0→145 and upgrade 142→143→144→145 passed, including unchanged pre-145 reserve/release
  receipts and fulfillment of that existing reservation. Full unit passed 2211/2211;
  typecheck/build and whitespace checks passed (existing bundle-size warning).
  Source local stays at 142 with unchanged data/security/sequence manifests;
  DEV is not contacted and its last verified baseline remains 142.
- Keep all reservation/fulfillment mutations private. No fulfillment frontend,
  application activation, deployment, source reset, residue cleanup or commit included.

## 001K / Phase 3D1 — Trusted Finished Goods reservation read model

- Local migration 146 adds `get_project_finished_goods_reservation_context(uuid)`:
  one authorized row per explicitly required Calculator output Product, including
  zero-stock and archived Products and completed/cancelled Project history.
- Return Product identity/name/serial, exact planned/consumed/outstanding demand,
  actual FG physical stock, globally reserved and available FG quantities, and only
  this Project's reservation identity/quantity/version. An absent reservation has
  NULL identity and version zero; retained zero reservations keep their real version.
- A single private demand helper now shares the existing consumption formula with
  open-Project commitments; closed history remains excluded from open commitments.
  All stock/demand/reservation fields are read in one consistent statement snapshot.
- Require active Admin or both Project view and FG view. No Raw/Customs, adjustment,
  production or reservation capability substitutes for those views. No browser table
  access or mutation EXECUTE is added. Existing state/history reads remain unchanged.
- Read model implemented locally; frontend pending, mutation activation pending,
  DEV deployment pending. Persistent local remains at its verified 142 baseline;
  DEV last verified 142 and production are not contacted.
- Local read acceptance passed 11/11, including fresh application-schema 0→146
  (retaining platform schemas), populated 145→146 upgrade, closed/archived history,
  exact quantities above 2^53, permission/ACL checks and concurrent read consistency.
  Foundation/protection passed 21/21 and fulfillment 13/13 with 146 present.
  Of 23 concurrency cases, 21 passed in the combined run; two failed only at the
  fail-closed client-drain cleanup guard and both passed on an isolated rerun.
  The first combined run also caught a missing required `product_kind` in the new
  ordinary-Product fixture; that fixture was corrected before the 11/11 rerun.
- Focused static/mock checks passed 103/103; full unit passed 2218/2218;
  typecheck/build and whitespace checks passed (existing bundle-size warning).
  Source table/security/sequence manifests matched, including retained residue.
  Two clones from the first cleanup-guard failure remain retained, with zero clients
  at read-only inspection; their removal awaits separate explicit approval:
  `alfaev_fg_3b1_80032a9fd0f84d94b9a34f0081ef5413` (OID 204468) and
  `alfaev_fg_3b1_e04f3cf198c5427d8cda148cbef55e9e` (OID 207526).
  No persistent database reset, maintenance cleanup, activation or deployment occurred.

## 001K / Phase 3D2 — Project Finished Goods frontend read integration

- Add a read-only Finished Goods requirements section below Project Products on
  Project detail. Show explicit planned/consumed/outstanding demand, current FG
  physical/global reserved/available quantities and this Project's reserved quantity.
  Explain that available stock is not a reservation. Show absent reservations and
  retained zero-quantity states distinctly; preserve archived output rows and closed
  Project history without inventing archive metadata absent from the RPC.
- Use only `get_project_finished_goods_reservation_context(p_project_id uuid)`.
  Request every quantity/version as a PostgREST response `::text` projection before
  JSON decoding, then validate canonical decimal strings, exact bigint arithmetic,
  identities/versions and the narrow response. No global JSON/client replacement,
  database contract change, floating-point conversion or accounting change is needed.
- Follow existing service/query/section conventions, shared loading/error/empty UI,
  active Admin or both Project/FG view permission checks and profile/Project-scoped
  caches. Do not render cached rows after access loss/uncertainty. Existing Project
  planning/lifecycle successes invalidate the FG read cache; mount/focus/reconnect
  and explicit refresh re-read the trusted RPC. No polling or Realtime is added.
- Missing Projects remain owned by the Project detail boundary; backend denial,
  transport/malformed response and undeployed-RPC states are safe visible errors,
  not empty stock. The new section is read-only even on open Projects.
- Implemented locally only. Migration 146 and browser acceptance require separately
  authorized deployment/validation. Mutation controls/activation remain pending;
  Phase 3D3 scope must separately review permission/version/idempotency-aware actions
  before exposing any private mutation. No database access or clone cleanup belongs
  to this frontend task.
- Validation passed: 341 focused Project/warehouse-permission/commitment/static
  tests, full unit 2275/2275 across 240 files, typecheck, build and whitespace checks.
  Only the existing bundle-size warning remains. Tests include mocked HTTP through
  the real Supabase SDK; no live PostgREST/DEV/browser acceptance is claimed.

## 001K / Phase 3D3B — Reservation mutation UI and activation preparation

- Reserve, Release and Fulfill controls are implemented locally in the existing
  Project Finished Goods section. New operations require an open Project and active
  Admin or Project view/edit plus FG view/reserve. Existing warehouse-authorized
  Product detail supplies archive eligibility; Release remains valid for archived
  outputs. Fulfillment does not require globally available stock to be positive.
- Mutation quantities are positive deltas. Every bigint request is a decimal string;
  every receipt quantity/version is projected as text before JSON decoding. No
  inventory/context quantity is optimistically replaced with a historical receipt.
- One immutable request UUID/payload is retained across uncertain retries, with a
  synchronous duplicate-submit lock. Profile/auth-user/Project-scoped QueryClient
  state retains unresolved operations across section remounts in the current app
  session. At the Phase 3D3B checkpoint a full browser restart did not provide
  durable request recovery; Phase 3D3C below closes that gap.
- Confirmed outcomes invalidate authoritative FG, Inventory, planning and relevant
  movement/material-use caches for the captured profile. Stale versions require a
  refreshed, explicit new decision, never an automatic new version or UUID.
- Migration 147 is prepared only: authenticated EXECUTE on the exact three public
  wrappers, with positive wrapper and negative helper/table ACL validation. It is
  NOT applied anywhere. Migrations 143–146 remain frozen; no accounting, permission
  assignment, Material Usage RPC, source database or retained clone is changed.
- Finished Goods fulfillment is not part of `list_project_material_usage`; detailed
  fulfillment-history presentation is deferred. Existing authorized reservation
  events and warehouse movement reads remain authoritative sources.
- Backend-role activation runtime proof, independent migration review, separately
  authorized deployment and real-browser mutation acceptance remain pending. No
  DEV, live acceptance or complete feature rollout PASS is implied by local UI tests.

## 001K / Phase 3D3C — Durable Finished Goods mutation recovery

- A minimal localStorage intent journal is scoped to backend origin, authenticated
  Auth user, verified profile and Project. Persist and read back the original UUID,
  operation, exact RPC parameters (bigint decimal strings), creation/update times and
  resolution state before dispatch. Store no session secrets, names or stock snapshots.
- Validate the complete untrusted schema, identity, Project, UUIDs and bigint bounds.
  Web Locks serialize dispatch and journal changes across same-origin tabs. Missing
  Web Locks, storage denial, corruption, write loss or conflicting payloads fail closed;
  no fallback UUID, silent deletion or automatic repair is allowed.
- Recovery survives reload/restart and QueryClient clearing on sign-out. Only the
  current authenticated identity can see/replay its saved request, with an explicit
  click and original immutable payload. Capture the current identity's access token
  in memory for the HTTP header; never persist it or let a client session switch
  re-attribute an operation. Permissions/backend authorization remain authoritative.
- Prepared/uncertain/confirmed-success/definite-failure labels are persisted but are
  not backend proof. After restart, explicitly replay even a saved success label.
  In the same session, a verified result with failed reconciliation retries only
  the authorized read. Clear only after a conclusive backend result and a new
  successful authoritative context read/cache reconciliation, never from receipts'
  historical quantities. Permission/contract denial or UUID conflict keeps recovery
  pending because it cannot resolve an earlier uncertain outcome.
- Browser data clearing/eviction and malicious same-origin code cannot be made
  tamper-proof by client persistence. Do not clear recovery data while unresolved;
  corrupted records require owner/Admin reconciliation, not a reset button. No
  confidentiality against a browser/device owner or XSS is claimed by key scoping.
- Implemented locally only. Migration 147 remains unchanged/unapplied. Independent
  activation review, authenticated-role backend proofs, authorized deployment and
  real-browser acceptance remain pending. No database access belongs to this task.

## 001L — Automatic Finished Goods Project reservations (local implementation)

- Forward migration 149 adds one request-aware requirement RPC and immutable,
  owner-bound operation receipts, including zero-allocation and deleted-row results.
- Genuine additions/increases cover all uncovered Project/Product demand from free
  FG; reductions/removals only release excess. Unchanged saves, retries, manual
  releases, stock arrivals, production and reopening never trigger auto-allocation.
- Requirement edits and reservation events/audits share one transaction. Existing
  stock/demand/lifecycle guards and FG-only FIFO fulfillment remain in force.
- FG changes require active Admin or all four Project view/edit and FG view/reserve
  permissions. Legacy FG writes cannot bypass the integrated operation; ordinary
  material planning retains its existing authority and Raw + Customs formulas.
- The existing editor uses durable, identity-scoped request recovery and decimal
  strings. FG shortage is outstanding demand minus this Project's reservation;
  Inventory aggregate invalidation includes nested FG query keys.
- Final local validation: 25/25 isolated runtime/security tests, including nine
  committed-winner races, passed. The final explicit seven-function ACL and duplicate
  event assertions also passed (2/2 focused rerun). Application SECURITY DEFINER
  inventory is 190. Full unit: 2570/2570 across 252 files; typecheck, build and
  git diff --check passed. Build retains the existing large-bundle warning.
- Successful runs compared full public/Auth/Storage/security/migration/sequence
  source manifests, including retained residue, and removed only their owned clones.
  One earlier run timed out during post-test verification and its transport lease
  expired; cleanup was refused. Its clone cleanup remains unverified and it was not
  adopted/deleted by subsequent runs. No source-data mismatch was reported. This
  resource limitation is not a claim that all earlier test resources were removed.
- Migration 149: `20261026110000_auto_reserve_finished_goods_project_requirements.sql`,
  20176 bytes, SHA-256 `d4442ccc921054b2f72e0a270ab239f0b6779e050bda6ad9927e2f7588c5ae23`.
- LOCAL ONLY: migration 149 is undeployed. Independent review, separate DEV
  authorization and real-browser acceptance remain required. DEV/production were
  not contacted in this task; no maintenance cleanup, reset, deployment or commit.

Task 001L file scope (all preceding uncommitted work retained):

- `supabase/migrations/20261026110000_auto_reserve_finished_goods_project_requirements.sql`
- `features/projects/services/projectRequirementMutationService.ts`
- `features/projects/services/projectRequirementMutationService.test.ts`
- `features/projects/services/projectRequirementRecoveryStore.ts`
- `features/projects/services/projectRequirementRecoveryStore.test.ts`
- `features/projects/services/projectPlanningService.ts`
- `features/projects/services/finishedGoodsRecoveryStore.ts`
- `features/projects/hooks/useProjectRequirementMutations.ts`
- `features/projects/hooks/useProjectRequirementMutations.test.tsx`
- `features/projects/hooks/useProjectPlanning.ts`
- `features/projects/hooks/useProjectPlanning.test.tsx`
- `features/projects/hooks/useProjectFinishedGoodsMutations.ts`
- `features/projects/components/ProjectPlanningSection.tsx`
- `features/projects/components/ProjectPlanningSection.test.tsx`
- `features/projects/components/ProjectFinishedGoodsSection.tsx`
- `features/projects/components/ProjectFinishedGoodsSection.test.tsx`
- `test/automaticFinishedGoodsRequirementsMigration.test.ts`
- `test/backend/automatic-finished-goods-requirements.backend.ts`
- `test/backend/helpers/reservation-local-target.ts`
- `test/backend/rls-policy-matrix.suite.ts`
- `docs/BUILD_PLAN.md`
- `docs/BUSINESS_RULES.md`
- `docs/DATA_MODEL.md`
- `docs/PERMISSIONS.md`
- `docs/SECURITY_RULES.md`

## 001K — Finished Goods accounting and Inventory UI correction

- One focused local task; existing reservation implementation and retained residue
  are preserved. Migrations 136–147 remain frozen. The reported DEV baseline is 147;
  this task does not contact DEV/production or claim new deployment/browser acceptance.
- Forward migration 148 restricts Calculator-linked finished manufacturing inputs to
  unreserved FG FIFO only. Ordinary inputs retain Raw → Customs → unreserved FG FIFO.
  Shared precheck/allocation definitions keep Finish and PDF fingerprints consistent;
  manufacturing consumes saved inputs once, actual-good output credits FG, and later
  fulfillment deducts only the finished Product. No historical stock relocation.
- A narrow warehouse-authorized aggregate read supplies FG Physical / Committed /
  Available without Project identity disclosure. Raw labels distinguish Raw physical
  from eligible Raw + Customs and outstanding planning commitments. Quantity transport
  is lossless; profile-scoped reservation invalidations refresh the aggregate cache.
- Local validation PASS: 7/7 accounting/production/permission runtime cases and
  23/23 rollback-only/committed-winner concurrency cases with migration 148; final
  full unit 2530/2530 across 248 files, typecheck, build and git diff --check passed.
  Focused frontend/production/security selection passed 1414 tests; the later
  cache/drain checks also passed. Build retains the existing large-bundle warning.
- Owned clone upgrade through 147→148 preserves business/sequence manifests and
  table/RLS/policy/trigger metadata. SECURITY DEFINER inventory is exactly 186;
  active FG-view-only aggregate access succeeds, Project context still requires
  Project access, and inactive/anonymous callers and direct table access are denied.
- Persistent source database manifests (public/Auth/Storage/migration/security and
  sequences), retained residue and pre-existing clones remain untouched. Final
  campaign resources were removed through positive ownership guards. An earlier run
  refused one clone's deletion while a naturally closing client was still visible;
  that clone was left untouched and may remain. A bounded 2-second natural drain,
  ownership recheck and fail-closed refusal now handle this race; no forced backend
  termination/drop or old-clone cleanup was performed. No persistent reset or
  maintenance script was executed.
- Migration 148: `20261026100000_correct_finished_goods_input_sourcing_and_inventory_reads.sql`,
  8327 bytes, SHA-256 `ef14848ad3cba6ea13d1d79066383aefc0f7fc4f2ac89e971ea2f65bf8094f2d`.
- Remaining release gates: independent migration review, separate DEV authorization,
  then real-browser acceptance (including the existing pending reservation scenarios).

Files changed by this correction only (repository-relative; all pre-existing work preserved):

- `features/inventory/InventoryPage.tsx`
- `features/inventory/InventoryPage.test.tsx`
- `features/inventory/components/ProductList.tsx`
- `features/inventory/components/ProductList.test.tsx`
- `features/inventory/hooks/useInventoryBalance.ts`
- `features/inventory/hooks/useInventoryBalance.test.tsx`
- `features/inventory/hooks/useInventoryCommitments.ts`
- `features/inventory/hooks/useInventoryCommitments.test.tsx`
- `features/inventory/services/inventoryCommitmentService.ts`
- `features/inventory/services/inventoryCommitmentService.test.ts`
- `features/inventory/services/productService.ts`
- `features/inventory/services/productService.test.ts`
- `features/pcb/hooks/usePcbCreation.ts`
- `features/pcb/hooks/usePcbCreation.test.tsx`
- `features/work-orders/hooks/useWorkOrderDetail.ts`
- `features/work-orders/hooks/useWorkOrderDetail.test.tsx`
- `features/projects/hooks/useProjectFinishedGoodsMutations.test.tsx`
- `supabase/migrations/20261026100000_correct_finished_goods_input_sourcing_and_inventory_reads.sql`
- `test/backend/finished-goods-accounting.backend.ts`
- `test/backend/finished-goods-reservation-concurrency.backend.ts`
- `test/backend/helpers/reservation-local-target.ts`
- `test/backend/rls-policy-matrix.suite.ts`
- `test/finishedGoodsAccountingMigration.test.ts`
- `test/reservationLocalTarget.test.ts`
- `docs/APP_FLOW.md`
- `docs/ARCHITECTURE_RULES.md`
- `docs/BUILD_PLAN.md`
- `docs/BUSINESS_RULES.md`
- `docs/DATA_MODEL.md`
- `docs/FEATURES.md`
- `docs/PERMISSIONS.md`
- `docs/SECURITY_RULES.md`
- `docs/UI_SPEC.md`

# PHASE S — Test Calculator V1 (approved specification; implementation pending)

This phase is separate from the Normal Calculator at `/pcb` and preserves existing
warehouse, Project/FG accounting and history. BUSINESS_RULES section 17, DATA_MODEL's
Test contract and PERMISSIONS section 10 define the approved rules. Test features are
not implemented/deployed/activated by these documentation changes. Earlier task-status
snapshots remain historical, not evidence of Test implementation or current remote state.

Execution rule for EVERY TC task: maximum 15 minutes, stop safely and report partial
progress if unfinished; do not silently expand scope/start the next task. Each has one
deliverable/review gate. Use focused tests for the touched boundary, typecheck/build
when applicable, and diff-check; no repeated broad audit/full regression after every
small task. Consolidate wider regression at the explicit final test/review gates.

## TC-01 — Lock Test Calculator V1 specification

- Deliverable: canonical rules/contracts and this bounded plan (documentation only).
- Acceptance: immutable partial/zero Save, ordinary Project priority, warehouse holds,
  Sarajevo-date expiry/history, permissions and no physical consumption are explicit.
- Dependencies: approved Task 1 requirements. Budget: maximum 15 minutes.
- Status: specification recorded by Task 1; no runtime or feature PASS is implied.

## TC-02 — Private database foundation and permissions

- Deliverable: forward-only schema/permission foundation with no application Save activation.
- Acceptance: separate immutable calculations/items/warehouse holds/receipt, exact
  quantities, creator/deadline/expiry, RLS/private helpers, dedicated view/manage,
  no implicit grants, no existing data/history rewrite. Receipt may share the header.
- Dependencies: TC-01. Budget: maximum 15 minutes.

- Implemented locally in migration 151: three private immutable Test tables, exact
  quantities and composite/deferred consistency constraints, Sarajevo deadline/expiry,
  restricted history references/indexes, and singular `test_calculator.view/manage`
  database definitions. No Save/Preview/read RPC, stock protection, expiry job,
  permission assignment or deployment. Typed frontend keys remain on the deployed
  contract until coordinated frontend/rollout work to avoid breaking the Admin parser.
  Focused local/static validation is recorded in the Task 2 report; this is not a
  complete Test feature or activation/DEV acceptance PASS.
- Foundation validation: 7/7 isolated local backend tests and 14/14 focused
  static/permission-parser tests passed; typecheck and diff-check passed. Runtime
  applied migration 151 only inside rollback transactions on newly owned local
  clones upgraded through 150; source table/security/sequence manifests matched.
  Each run's owned clone was removed; the final run independently confirmed its absence. Persistent
  source migration 142, retained residue and old clones were not changed.
- Migration: `20261027100000_add_test_calculator_foundation.sql`, 7671 bytes,
  SHA-256 `e8d7b802a4b828cc685ddaaafc33371fa6d8c79ca76cf454fdcc80c6fb603684`.

## TC-03 — Authorized Product picker and proof read

- Deliverable: narrow trusted read for selectable inputs and authoritative preview.
- Acceptance: correct Product linkage/sourcing, Project demand deducted once, exact
  Required/Eligible/Reservable/Missing, correct warehouse permissions, zero writes.
- Dependencies: TC-02. Budget: maximum 15 minutes.

- Implemented locally in migration 152: `search_test_calculator_products(text,integer)`
  and `preview_test_calculation(jsonb)`, active Test/warehouse authorization, exact
  decimal-string quantities, active-hold/Project-priority arithmetic and provisional
  warehouse ordering. No context can exclude existing holds; Save must recalculate.
- Focused validation: 9/9 isolated local runtime/security cases and 11/11 combined
  foundation/preview static tests passed, plus typecheck and diff-check. Search/preview
  preserved table/security/sequence manifests; the newly owned clone was removed and
  absence checked, persistent source/residue and existing clones remained unchanged.
  No Save, stock protection, deadline mutation, UI, remote access or deployment.
- Migration: `20261027110000_add_test_calculator_search_and_preview.sql`, 9803 bytes,
  SHA-256 `1a11b4e6a66c860be33f4fbc526fc38c488b0adc46d94359d0bf98ea00e990d7`.

## TC-04 — Atomic idempotent Save (local foundation; operational activation pending)

- Deliverable: one Save transaction with immutable actor/request/payload receipt.
- Acceptance: current recalculation, mandatory future expiry, deterministic locks,
  partial/zero Save, one audit, original-actor exact replay, rollback on any failure;
  no movement/FIFO/output/Work Order. No application activation yet.
- Dependencies: TC-02, TC-03. Budget: maximum 15 minutes.
- Local implementation: migration 153 adds `save_test_calculation(uuid,text,jsonb,date)`
  with the explicitly requested authenticated EXECUTE boundary, active Test/warehouse
  authorization, canonical original-actor receipts, deterministic Product/balance
  locks and fresh post-wait availability/expiry checks. Quantities remain strings.
  Private deferred hold checks are drained inside Save, without granting table reads.
  No DEV deployment or operational Test protection is implied: TC-05 through TC-07
  remain required before activation.
- Verification: 13/13 focused owned-clone runtime tests and 14/14 foundation,
  preview and Save static tests passed; typecheck and diff-check passed. Includes
  authenticated committed duplicate/competing Saves, audit-failure rollback,
  full/partial/zero quantities, Project/FG/Test coexistence at Save admission,
  expired original replay, permissions, bigint, canonical payloads and Sarajevo DST.
  Fixed-snapshot isolation is rejected: Save requires READ COMMITTED for fresh
  post-wait state. The source manifest/residue remained unchanged; each newly owned
  clone was removed and absence verified. No persistent reset or remote access.
- Migration: `20261027120000_add_atomic_test_calculator_save.sql`, 14800 bytes,
  SHA-256 `f1edf06661223a294e5a25002320000a7d065fca3ba19c463ee130b9f8dcc18d`.

## TC-05 — Universal warehouse debit protection

- Deliverable: shared active-Test physical-stock invariant on every eligible warehouse debit.
- Acceptance: removal/correction/transfer cannot consume held stock; existing FG hard
  protection retained, no bypass/relocation, expiry effective without jobs, provenance intact.
- Dependencies: TC-04. Budget: maximum 15 minutes.
- Local implementation: migration 154 adds one private wall-clock active-Test
  warehouse sum and one private SECURITY DEFINER balance-decrease trigger.
  Raw/Customs must retain active Test quantities; FG must retain Test plus hard
  Project quantities. Existing FG protection, warehouse permissions and FIFO paths
  remain intact. No holds move, expire by mutation, or get consumed by unrelated debits.
  The guard uses the already-held balance lock, takes no reverse-order Product/Project
  locks and rejects fixed-snapshot isolation (READ COMMITTED required).
- Focused final validation: 14/14 isolated runtime cases and 17/17 Test Calculator
  static cases passed, plus typecheck and diff-check. Controlled lock-wait cases cover
  Save-first, debit-first and a direct balance UPDATE waiting behind Save. Transfers,
  corrections, combined FG protection, expired history, bigint, FIFO and denial pass.
  The successful run verified unchanged persistent-source manifests and removal/
  absence of its own clone. An earlier runner context error leaked an unregistered
  test client and timed out teardown; its clone cleanup is UNVERIFIED. That clone
  was not adopted/deleted by the successful rerun. The new harness registers clients
  before transaction setup; no prior databases/clones or retained residue were cleaned.
- Migration: `20261027130000_protect_test_calculator_warehouse_holds.sql`, 2714 bytes,
  SHA-256 `2372dbf1bcf5956eb7c5a38fb1f74425af4a7a3339287be0581ef4549f10efd3`.
- Operational activation remains blocked on TC-06 production eligibility/fingerprint
  agreement and TC-07 Project reservation admission/coexistence; neither is changed here.

## TC-06 — Production eligibility and FIFO agreement

- Deliverable: consistent Test-aware precheck, source plan, Finish and PDF fingerprint.
- Acceptance: ordinary source priority unchanged, Calculator-linked FG-only, active
  holds excluded, expired holds reusable, no recursive BOM/historical PDF rewrite.
- Dependencies: TC-05. Budget: maximum 15 minutes.
- Local implementation: migration 155 adds one private production warehouse-capacity
  helper and replaces only production eligible quantity / warehouse source planning.
  Free capacity excludes active Test holds everywhere and hard Project reservations
  in FG. Ordinary Raw -> Customs -> FG priority and linked-output FG-only sourcing
  remain unchanged; soft ordinary Project demand is not deducted from production.
  Product/balance/lot locks precede wall-clock capacity reads, and per-plan warehouse
  capacities cap the original FIFO prefix. Existing precheck, Finish and PDF/source
  fingerprint callers reuse these functions; no accounting/UI/history rewrite.
- Verification: 11/11 focused owned-clone backend tests and 20/20 Test Calculator
  static tests passed; typecheck and diff-check passed. Covers active/expired holds
  in all warehouses, Raw -> Customs -> FG fallback, linked FG-only inputs, hard FG
  coexistence, unchanged soft demand, FIFO, precheck/PDF/Finish agreement, stale
  fingerprints, planned input consumption once and actual-good FG credit. Controlled
  Calculator Finish/Save races prove both committed orders preserve stock bounds.
  Persistent-source manifests matched and every clone created by TC-06 was removed
  with absence checked. The TC-05 uncertain prior clone was not adopted or deleted.
- Migration: `20261027140000_protect_test_holds_in_production_plans.sql`, 6835 bytes,
  SHA-256 `85ec4decbd570a7e5784617caec96a341ee94a230d1b13044007d8ae77b679c7`.
  Migrations 1–154 remain unchanged. No deployment or operational activation;
  TC-07 Project/Test admission coexistence and later V1 gates remain required.

## TC-07 — Project reservation and planning coexistence

- Deliverable: Test-aware manual/automatic FG reservation admission and demand serialization.
- Acceptance: Project/Test races cannot double-reserve; existing hard reservations and
  fulfillment remain valid, ordinary demand has priority for new Tests without globally
  becoming hard; existing Project lifecycle/planning/shortage formulas remain unchanged.
- Dependencies: TC-05, TC-06. Budget: maximum 15 minutes.
- Local implementation: migration 156 changes only the existing manual and automatic
  FG admission checks, using current free capacity = physical FG - Project hard
  reservations - active FG Test holds, floored at zero. Source-text assertions fail
  closed on unexpected definitions; owners, ACLs, security settings and all existing
  actor-bound replay, version, permission, Project/Product/balance/state lock paths
  remain intact. READ COMMITTED is required for new admission, not historical replay.
  The private wall-clock Test helper is evaluated after existing stock/state waits.
- Existing requirement Product locks remain compatible with Save's Product UPDATE
  locks. Ordinary Project demand remains soft and its formulas are unchanged. Release,
  fulfillment, cancellation and completion/reopening policies are not rewritten;
  neither expiry, release nor new stock automatically tops up reservations.
- Verification: 16/16 focused owned-clone runtime and 22/22 Test Calculator static
  tests passed, plus typecheck and diff-check. Six committed lock-wait races cover
  both orders of Save versus manual Reserve, automatic requirement reservation and
  fulfillment. Includes full/partial/zero admission, retries/actor mismatch/stale
  versions, expiry, bigint, reduction, FG-only FIFO fulfillment, Raw/Customs behavior
  and no original BOM consumption. Existing function security metadata was compared
  before/after. Persistent-source manifests matched; all TC-07 clones were removed
  and absence verified. Uncertain/pre-existing clones and retained residue untouched.
- Migration: `20261027150000_protect_test_holds_in_project_reservation_admission.sql`,
  2413 bytes, SHA-256 `0b689ad1c11fb93f4e79861d240beb4df0a44406f86b52deab2fe74e2597fe05`.
  Migrations 1–155 remain unchanged. No deployment or application activation; TC-08
  onward (history/aggregates/UI/recovery/final acceptance gates) remains pending.

## TC-08 — Expiry-aware history and Inventory aggregates

- Deliverable: authorized retained Test history and consistent aggregate read contracts.
- Acceptance: exact original vs active/Expired quantities, server time/next expiry,
  no background release dependency, all eligible warehouses, correct combined Raw+Customs
  scope, no identity leaks/permission-redacted zeros or broken existing RPC contracts.
- Dependencies: TC-07. Budget: maximum 15 minutes.
- Inventory read slice: local migration 157 adds only
  `get_inventory_test_commitments(uuid,text default null)`. It reuses existing
  warehouse membership/search/order and returns exact TEXT quantities, one database
  as-of time and next positive active expiry. Raw combines Raw+Customs Test holds
  and requires both views; FG uses hard Project reservations; Customs deducts only
  its own Test holds. Existing Inventory RPCs/columns and accounting remain unchanged.
  The user explicitly confirmed preserving existing Raw planning Product/lifecycle
  scope (including linked-output rows), not replacing it with Test-Save admission D.
- Inventory permission alone suffices; Test view/manage does not grant Inventory
  access. Active Admin or the matching warehouse views are mandatory. No calculation,
  creator, receipt or foreign profile identity is returned; private tables stay private.
- At the TC-08 Inventory checkpoint only aggregates were implemented. The retained
  list/detail history slice is completed locally by the separately requested Task
  9/16 below; the TC-09 editor and TC-10 recovery/history frontend remain pending.
- Validation: 10/10 focused owned-clone runtime and 24/24 Test Calculator static
  tests passed, plus typecheck and diff-check. Includes overlapping mixed holds,
  hard FG reservations, signed Raw planning, next relevant expiry, missing/expired
  holds, all warehouse permission combinations, inactive/anonymous denial, archived
  membership/search/order and exact aggregates beyond bigint. Before/after read
  manifests confirm no data/security/sequence writes. PostgreSQL deterministic
  boundary checks verify exclusive midnight and Sarajevo 23/25-hour DST days;
  live reads test future-active and past-expired holds without changing server time.
  Persistent-source manifests matched; all TC-08 clones were removed and absence
  verified. Uncertain/prior clones, retained residue and maintenance scripts untouched.
- Migration: `20261027160000_add_expiry_aware_inventory_test_commitments.sql`,
  5238 bytes, SHA-256 `c6562a7c14d48c7752709c8c0e3a748dd1c064721c20c31f3f538ebbe1bf80fc`.
  Migrations 1–156 remain unchanged. No frontend, accounting change, deployment or
  application activation. TC-09 onward frontend/acceptance gates stay open.

### Task 9/16 — Saved-calculation history reads (TC-08 history slice)

- Local migration 158 adds `list_test_calculations(integer,timestamptz,uuid)` and
  `get_test_calculation(uuid)`. List uses bounded newest-first keyset pagination;
  detail returns immutable Product snapshots, required/held/missing decimal strings
  and saved per-warehouse allocations. Expired history retains saved quantities.
- Both require active Admin or `test_calculator.view`, share authorized history
  across creators and do not require Inventory views for historical saved values.
  Creator display is current Full Name only, not a frozen creator-name snapshot.
  No request UUID, payload, receipt, auth identity or unrelated profile data escapes.
- One database as-of time per call classifies active strictly by expires_at > as_of.
  Reads never renew holds, allocate stock, create movements, audit or notifications.
  Current active Inventory commitments remain the separate migration-157 contract.
- Validation: 8/8 focused isolated-clone runtime tests and 30/30 focused static tests
  passed, including shared view-only access, inactive/anonymous denial, exact bigint
  and saved snapshots, keyset validation, private-field exclusion and unchanged
  data/security/sequence manifests. Source preservation and owned-clone removal
  were verified. Typecheck and diff-check passed; no broad regression suite run.
- Migration `20261027170000_add_test_calculation_history_reads.sql`: 4488 bytes,
  SHA-256 `a901832f3f1424b3aad3a19f232c5fb836e453028e924585a29fe0f68dfb4533`.
  Migrations 1–157 unchanged. No Save/Preview/accounting changes, frontend,
  deployment, DEV/production access, persistent reset or application activation.
  This history-read task does not complete the separately numbered TC-09 editor.

## TC-09 — Blue Test editor and proof/deadline UI

- Deliverable: separate Test page/editor under Product Calculator Normal / Test navigation.
- Acceptance: normal `/pcb` unchanged, exact input/preview quantities, mandatory Sarajevo
  date, stale-proof invalidation, loading/permission/empty/error/accessibility states.
- Dependencies: TC-03, TC-08. Budget: maximum 15 minutes.

### Task 10/16 checkpoint — navigation and page foundation only

- Implemented locally: sidebar label Product Calculator, Normal `/pcb` and separate
  Test `/pcb/test` navigation, responsive blue Test presentation foundation with
  disabled Create Test Calculation action and an explicitly unconnected history
  placeholder. Normal titles, forms, production and definition routes are unchanged.
- The Test route is closed for every identity, including Admin; active session and
  profile checks fail closed. No Test RPC or new permission check runs. The strict
  deployed 39-key registry/module/parser contract is unchanged. Before opening the
  gate, coordinate the `test_calculator.view` / `test_calculator.manage` frontend
  registry, permission editor/runtime invalidation and backend deployment: active
  Admin or Test view for access, manage plus warehouse authority for creation.
  Existing `pcb.view` only controls the current sidebar/Normal entry and is not
  Test authorization; Test-only navigation must be integrated at that rollout.
- Validation: 66/66 focused frontend tests, typecheck and whitespace checks passed.
  Includes sidebar label, both destinations, unchanged Normal route boundaries,
  Admin/non-Admin activation denial, invalid/loading identities, no Test RPCs,
  current 39-permission response parsing and responsive wrapping/full-width classes.
  These are component/router checks, not real-browser or DEV acceptance.
- No editor, Preview/Save calls, history read integration, backend change, deployment
  or activation. TC-09 editor and TC-10 durable Save/history UI remain unfinished;
  this Task 10/16 checkpoint does not complete the planned TC-10 deliverable.

### Task 11/16 checkpoint — reusable Test Calculation editor only

- Added `TestCalculationEditor` with required name, 1–100 distinct eligible Product
  rows, exact positive decimal-string quantities through SQL bigint max, required
  Sarajevo deadline, add/remove controls and draft-only Prove boundary. Every draft
  edit clears the prior-proof boundary through `onPreviewInvalidated`; search text
  itself is not a draft edit. Save is always disabled and no intent is persisted.
- Today is a valid deadline while its exclusive next Sarajevo midnight is future,
  consistent with migration 153. Real calendar dates and the current Sarajevo date
  are checked locally; client time/validation is advisory, never backend authority.
- Typed `searchTestCalculatorProducts` uses only the existing authorized search RPC,
  rejects malformed/duplicate/extra-field responses, preserves exact serial text and
  authoritative source policy, and reports denied/unavailable results without zeros.
  Its hook defaults disabled, debounces 200ms, hides unsettled/stale results and scopes
  caches to authenticated user/profile. No direct tables or stock computations.
- The reusable editor is tested independently, with its service mocked; it is not
  mounted through the current disabled Create action. `/pcb/test` remains closed,
  including for Admins, and the deployed 39-key permission contract is unchanged.
  No Test search was sent to DEV. Coordinated activation/authorization is still required.
- Focused editor/service/hook/draft/router/parser checks and typecheck/whitespace
  checks passed. Preview integration, Save/recovery, history, Inventory columns and
  browser acceptance remain pending. This user-numbered Task 11 does not implement
  the separately planned TC-11 Inventory columns or complete TC-09 proof integration.
  No migrations, database access, accounting changes, deployment, commit or push.

### Task 12/16 checkpoint — trusted Prove Calculation preview integration

- The reusable editor's Prove action now calls the typed migration-152 Preview
  service through an imperative, explicit-opt-in hook. The default stays disabled;
  `/pcb/test` and the page's Create action remain closed/disabled pending rollout.
  Focused frontend tests mock services/RPC transport; no Test RPC was sent to DEV.
- Sends only `p_items` Product IDs and exact positive bigint decimal strings. The
  parser checks the exact response Product set, required quantities, numeric-string
  arithmetic, provisional warehouse IDs/codes/allocations and one common server
  timestamp. Denied, malformed and failed reads never become fabricated zero stock.
  Aggregate numeric quantities beyond bigint remain lossless.
- The blue responsive table shows Product identity, Quantity per calculation,
  Required, Available, Reservable and Missing. V1 quantities are totals for one
  calculation, so Quantity per calculation equals Required; there is no manufacturing
  multiplier/BOM expansion. Available uses authoritative eligible_availability after
  Project priority. Details preserve the provisional warehouse allocation breakdown.
  These are allocations, not invented per-warehouse physical/free stock figures.
- The exact server as_of timestamp and save_will_recalculate flag are preserved.
  Migration 152 supplies no expiry/next-expiry timestamp: none is fabricated. The
  Sarajevo deadline explanation remains separate and Save remains authoritative.
  Copy explicitly says availability is provisional and recalculated on Save.
- Actor/profile/draft-scoped reads never auto-run or retry. Pending submission is
  single-flight; every draft edit invalidates proof. Generation checks discard late
  responses after edits, reverting edits, identity changes or unmount. Errors clear
  previous success. Save remains disabled even after a valid preview; no intent is
  persisted and no stock, hold, movement, Work Order or notification is created.
- 96/96 focused service/hook/editor/router/Normal/permission regressions, typecheck and
  whitespace validation passed. Full suites and real-browser/DEV acceptance were not
  run. Remaining: page/editor rollout wiring, coordinated Test permissions/database
  activation, durable Save/recovery and saved-history integration. No deployment,
  migrations, database access, commit or push; prior implementation remains intact.

## TC-10 — Save recovery and retained history UI

- Deliverable: Save/result/history flow with durable exact-request recovery.
- Acceptance: persist before dispatch, original UUID/payload across restart, identity
  and cross-tab isolation, partial/zero/uncertain states, fresh reconciliation, no V1
  edit/extend/cancel/consume/renew/top-up. Use mocked services until activation review.
- Dependencies: TC-04, TC-08, TC-09. Budget: maximum 15 minutes.

### Task 13/16 checkpoint — atomic Save and durable recovery integration

- Added typed migration-153 Save and migration-158 detail-reconciliation services.
  Quantities stay canonical decimal strings through request, receipt and rendering;
  full/partial/zero saved allocations need not match provisional Preview capacity.
  Strict receipt checks bind request UUID/name/deadline/Product quantities, validate
  allocation sums and exclude malformed/private-extra projections. Unknown/lost or
  malformed responses remain uncertain, never proof of failure or permission for
  a replacement UUID. Actor Authorization headers are captured in memory only.
- Follows existing AlfaEV localStorage + exclusive Web Locks recovery patterns.
  One backend-origin/Auth-user/profile-scoped journal stores only schema-validated
  immutable intent, creation time and outcome state. Persist and exact read-back
  precede dispatch. Missing/corrupt/unavailable storage, conflicting payloads or
  unsupported locks fail closed; journals are not silently cleared on account change.
  Web storage is not tamper-proof against owners/XSS/eviction; no stronger claim.
- Save requires an exact current-preview draft fingerprint, valid future Sarajevo
  expiry, active matching identity, explicit activation opt-in and no pending intent.
  Duplicate clicks and conflicting tabs cannot mint another request. Draft/deadline
  validity is rechecked after acquiring the lock. Form editing freezes once Save
  begins; saved confirmation remains frozen rather than allowing accidental resave.
- Restart never trusts stored confirmed-success state: explicit recovery replays the
  same UUID and immutable payload, including expired deadlines. Within a live session
  a verified receipt with failed refresh retries only reconciliation. A fresh bounded
  authorized detail read must match saved snapshots/positive holds, then scoped
  history/Inventory-Test cache invalidations must finish before only that matching
  journal is cleared. Receipt quantities never replace live Inventory quantities.
- Rejected/authorization-failed attempts retain the original journal too: a later
  denial cannot prove an earlier uncertain attempt never committed. No automatic
  discard/new UUID or repair is offered; unresolved rejected intent may require
  authorized support reconciliation. Actor switches hide other identities' records;
  old responses preserve their original journal without poisoning current state.
- Exported shared cache prefixes `testCalculationHistoryPrefix(identity)` and
  `inventoryTestCommitmentsPrefix(identity)` include backend, Auth user and profile.
  Future history/Inventory hooks must reuse them. No history UI or Inventory Test
  read hook exists yet; currently only the detail reconciliation read is integrated.
- 158/158 focused mocked service/store/hook/editor and existing recovery/route/permission
  regressions, typecheck and whitespace checks passed. These are connection-free
  checks, not live browser/backend acceptance. `/pcb/test`, the page Create entry and
  all service opt-ins remain closed/off by default; the 39-key registry is unchanged.
  Remaining: saved-history UI, Inventory columns/reads, coordinated activation and
  real-browser acceptance. No migrations, database access, stock movements, deployment,
  persistent reset, maintenance execution, commit or push.

### Task 14/16 checkpoint — saved history UI (TC-10 history slice)

- Implemented typed migration-158 list/detail services and identity-scoped React
  Query hooks. List uses exact (created_at,id) newest-first cursors, bounded pages,
  explicit Load More, refresh/retry/loading/empty/error states and shared authorized
  history across creators. No creator or expired-record filter is introduced.
- Cursor timestamps retain PostgreSQL microseconds, including exact ordering and
  exclusive-expiry comparisons. Quantities remain decimal strings and allocation
  sums are checked with bigint; malformed, redacted or private-extra fields fail
  closed. Reads pin the current actor token in memory and accept query cancellation.
- The blue responsive list shows only name, authorized creator display, created
  timestamp, Sarajevo deadline and server-snapshot Active/Expired status. Migration
  158 does not return list totals, so no Required/Reserved/Missing totals are invented.
  Selecting a row opens read-only saved Product snapshots and required/held/missing
  quantities with warehouse allocations. Archived/current Product data is not read.
  Expired allocations remain historical and are explicitly not active commitments.
- Uses Task 13's backend/Auth-user/profile history prefix for both list and detail,
  allowing confirmed-Save invalidation to refetch both. Identity changes hide cached
  rows and do not automatically open the previous identity's selected calculation.
  No journal read/write/clear, Save, cancellation, extension, renewal or delete occurs.
- Status remains server-authoritative. Focus/reconnect/manual refresh and one-shot
  server-expiry refresh obtain new reads; no worker, browser-clock reclassification
  or historical deletion. Error states suspend automatic expiry retries.
- Replaced the disconnected page placeholder with the gated history module. Its
  default is disabled and mounts no Auth/query hooks; `/pcb/test` stays closed even
  for Admins. No undeployed Test RPC was sent to DEV. Normal and the 39-key registry
  remain unchanged. This checkpoint does not complete planned TC-14 security review.
- 73/73 focused mocked history/recovery/route/Normal/permission tests, typecheck and
  whitespace checks passed. No live browser/database acceptance or full suite run.
  Remaining: Inventory Test columns/reads, coordinated deployment/permission/route
  activation, page/editor entry wiring and browser acceptance. No database/migration
  changes, DEV/production access, deployment, reset, clone cleanup, commit or push.

## TC-11 — Inventory Test columns

- Deliverable: blue Committed to Tests and additional availability across source warehouses.
- Acceptance: existing fields preserved, formulas/scopes exact, no double demand
  subtraction, lossless quantities, permission isolation, Save/expiry refetch and responsive UI.
- Dependencies: TC-08, TC-10. Budget: maximum 15 minutes.

### Task 15/16 checkpoint — gated Inventory Test columns (TC-11)

- Local frontend integration uses only `get_inventory_test_commitments(uuid,text)`;
  the two additive columns are **Committed to Tests** (blue) and **Available After
  Projects and Tests**. Existing Inventory fields, source formulas, Product order,
  warehouse membership and search remain unchanged.
- RPC quantities remain exact decimal strings, including negative Raw planning
  availability. Raw Test quantities cover Raw + Customs using the existing planning
  scope; FG and Customs use their own warehouse scopes. No browser aggregation,
  accounting substitution or fabricated zero values.
- Reads require the active authenticated actor/profile and existing warehouse view
  access (both Raw + Customs for Raw). Query keys reuse Task 13's backend/actor/profile
  invalidation prefix and include warehouse and search. No private Test table reads.
- Server `as_of` and the earliest relevant `next_expiry` drive conservative one-shot
  revalidation. Old Test figures are unavailable while fetching, after expiry, on
  read failure, and in hidden/inactive views; visibility/focus return requires a fresh
  read. Confirmed Save uses the existing scoped cache invalidation.
- Integration remains disabled by default at the Inventory page boundary, including
  for Admins; the application router does not enable it. No undeployed Test RPC calls
  are added to existing DEV Inventory. `/pcb/test` and Test permissions remain closed.
- Validation: 99/99 focused frontend tests across 11 files, TypeScript typecheck,
  and whitespace checks passed. Coverage includes existing Inventory/warehouse access,
  scoped Save invalidation, route gating, expiry refresh and unavailable-state handling.
- Mocked frontend verification only; coordinated backend/permission activation,
  local acceptance gates and real-browser verification remain pending. This checkpoint
  does not complete TC-15 (DEV rollout) or claim deployment/browser acceptance.

## Task 16A — local activation readiness (not DEV rollout)

- Verified the frozen, ordered migration 151–158 manifest against all eight recorded
  SHA-256 identities. No database connection or current remote-state claim is made.
- Prepared the strict 39/41-key permission compatibility layer and Test permission
  matrix group; complete legacy responses stay usable, partial/unknown/duplicate sets
  fail closed, and edits preserve the new keys. No grants are assigned remotely.
- Single release-controlled switch: `app/config/testCalculatorActivation.ts`,
  `TEST_CALCULATOR_RELEASE.enabled = false`. It is pinned to the alfaev-dev backend
  origin and requires the reviewed 158 endpoint state; this metadata is not a live
  migration probe. No URL, storage or environment switch opens it. The router feeds
  the same activation result into the Test page and Inventory, and the route checks
  it before mounting Test permission/data hooks. Admin cannot bypass the OFF switch.
- When separately enabled, active Admin or Test view accesses shared history/detail.
  Creation additionally requires Test manage; applicable warehouse permissions remain
  authoritative in the backend. Create mounts the existing editor with search,
  preview and durable Save enabled together. Confirmed Save retains its existing
  history/Inventory invalidation and reconciliation; only then may the user explicitly
  start another draft. Uncertain journals are never cleared to start a new request.
  Actor/profile changes remount the workspace; view-only users never mount the editor.
- Normal Calculator and existing Inventory remain usable while the gate is OFF;
  `/pcb/test` is closed and makes no Test RPC calls. Local mocked validation is not
  browser or deployed acceptance. Consolidated TC-12/13 and independent TC-14 gates
  are not marked complete by this wiring task.
- Validation: 131/131 targeted connection-free tests across 18 files passed,
  including the eight frozen migration hashes/order, complete 39/41-key contracts,
  Test-grant preservation, denied/view-only/Admin routing, Create/search/Preview/
  durable Save/history/detail/Inventory refresh, original-request recovery and the
  unchanged default-closed entrypoints. Typecheck and whitespace checks passed.
  No database/runtime campaign or real-browser acceptance was executed here.

Future deployment sequence — requires separate review and explicit authorization:

1. Complete/approve remaining focused local security/concurrency acceptance and final
   SQL/ACL review. Reverify DEV identity, current parity, all hashes and preservation
   baselines read-only; do not assume the last reported remote state remains current.
2. Run the current 39/41-compatible frontend locally with the switch OFF first,
   so migration 151's new definitions cannot break the old strict Admin parser.
   Confirm Normal/Inventory and legacy permission loads. Online frontend hosting
   is deferred and is not a prerequisite for this localhost DEV acceptance.
3. Apply only 151 → 158 through a reviewed coordinated deployment that does not
   expose an intermediate Save-capable schema. Migration 153 grants authenticated
   Save before 154–156 install all protection: use an atomic reviewed batch including
   migration history, or a separately reviewed backend execution gate maintained
   until all protections are installed. Frontend hiding is not that gate. The exact
   deployment method must be approved before execution; no ad-hoc SQL is authorized.
4. Read-only verify parity 158/158, expected function ACLs/RLS/security inventory,
   no unexpected history/Inventory changes and no automatic Test records. Through
   existing authorized Admin operations, assign Test view/manage and required
   warehouse views only to approved acceptance identities; Admin needs no new grant.
5. Only after these gates pass, explicitly authorize a release opening the single
   backend-pinned switch and verify Test/Inventory entrypoints together. No Edge
   deployment is implied. All other backends remain closed by the origin check.
6. Separately authorize bounded real-browser fixtures/Save/replay/history/Inventory,
   view-only/denied accounts, reload/restart/cross-tab recovery, partial/zero and
   no-physical-stock-change checks. Natural Sarajevo expiry may require a later
   timed observation; never change clocks/deadlines to force acceptance.

Disable/rollback: release `enabled = false` to close new UI reads/actions; retain
durable journals for later explicit recovery. This does not revoke backend EXECUTE,
cancel saved holds or reverse migrations. An emergency backend Save revocation needs
its own reviewed authorization. Keep all protection functions and immutable history
intact until natural expiry; do not roll back schema or delete holds as a UI rollback.

## Task 16B — final local acceptance and concrete atomic deployment proof

- Local final-schema acceptance passed: 11 integrated RPC/security cases, 11
  production cases and 16 Project/Test coexistence cases (38 distinct runtime cases).
  Each campaign used only a new positively owned clone upgraded through migration
  158, with exact 158-row ledger verification. No source/remote migration was applied.
  Search, Preview, full/partial/zero Save, shared history/detail, Inventory aggregates,
  authorization, signed/bigint transport, expired history and FG coexistence agree.
- Production proof covers FIFO/source plans, PDF fingerprints, actual-good FG output,
  FG-only linked inputs, no recursive BOM consumption and both committed Save/Finish
  orders. Six committed Project/Test races cover manual/automatic admission and
  fulfillment. Test Save creates no physical movement, lot rewrite or allocation;
  additional demand cannot reclaim Test-held stock. Existing historical datasets and
  sequence state match before/after the successful migration batch, except expected
  schema/security, two permission definitions and eight migration-history rows.
- One new combined test initially expected the stock error while its fixture had
  already exhausted Project demand; the backend correctly returned FGR06. The fixture
  was corrected to leave demand available, retaining the FGR07 capacity assertion.
  Only that acceptance file was rerun; its final 11/11 cases passed. No business SQL
  or accounting implementation was changed.
- Connection-free validation: 173/173 focused tests passed across 12 files, including
  legacy 39/new 41 permission matrices, permission preservation, release-OFF behavior,
  Normal navigation, durable recovery, Inventory expiry/isolation, target guards and
  atomic batch structure. Typecheck and whitespace checks passed.
- Every owned clone's teardown verified source manifests and clone absence. A fresh
  independent container-local read confirmed source cluster 7699375188763602981,
  migration 142, 118 Products, 354 balances, physical stock 603 and the retained three
  zero balances. All five clones created in this task are absent. No prior/uncertain
  clone, retained residue or maintenance script was adopted, changed or deleted.

Concrete deployment method (future authorization required):

- `scripts/deployment/test-calculator-atomic-batch.ts` is a pure preparation module,
  not a network-enabled launcher. It validates all eight frozen hashes/order and
  prepares the unchanged 151–158 SQL plus their exact migration-ledger rows. Its
  precondition requires 150/150 with latest 20261026120000 and no existing Save RPC;
  final guards require 158/158, 197 application SECURITY DEFINER functions, expected Save
  role grants and no automatic Test calculations. Bounded local settings and an
  advisory transaction lock fail closed on drift or contention.
- Freeze/review the generated body before connecting. At this checkpoint: 111338 UTF-8
  bytes; SHA-256 `bed2647c7b227f0fdf8958f73af0602f5f0f5deb1870d77b8881a4685a6a37c4`.
  This earlier body is superseded by the platform-aware guard checkpoint below.
  Execute that body only through `psql -X --no-password --set=ON_ERROR_STOP=1
  --single-transaction --file=<reviewed-batch-file>` using a separately verified,
  explicitly authorized DEV-only connection. The body deliberately has no outer
  BEGIN/COMMIT: the required psql option encloses DDL, grants, ledger and final guards
  in ONE transaction. Do not substitute ordinary per-migration CLI push/autocommit.
- PostgreSQL 17's installed client confirms support for `--single-transaction`.
  Real server proof forced a batch failure after 153: all schema/ledger/data/security
  changes rolled back. In a successful batch, an independent authenticated session
  observed no Save function after uncommitted 153 and received 42883 when calling it.
  Only after 158 and the final checks committed did Save become visible. Thus no
  external authenticated client can use the intermediate 153–156 schema.
- This closes the exposure-window design blocker locally; no backend gate needs to
  be bypassed and no frozen migration needs rewriting. Any failure/uncertain DEV
  outcome requires read-only inspection, never automatic retry or schema rollback.

Release order remains A: compatible frontend with switch OFF; B: this atomic backend
batch; C: read-only schema/ACL/RLS/history/Inventory preservation checks; D: separately
authorized permission assignments; E: separately authorized DEV-pinned switch opening;
F: bounded real-browser acceptance. Reverify current DEV identity/parity/baselines
before B; no remote facts were refreshed here. The switch remains OFF.

Disabling the UI does not revoke Save EXECUTE or release saved holds. If required,
separately authorize revoking only authenticated Save EXECUTE; preserve history reads,
all debit/admission protections, recovery journals and existing immutable holds until
natural expiry. Do not down-migrate, delete holds or rewrite deadlines. Browser/HTTP
acceptance and a natural midnight-crossing observation remain separate pending gates;
local expiry proof uses real database time with past/future immutable fixtures and
the previously recorded Sarajevo/DST boundary checks, not altered clocks.

## Final DEV preparation — platform-aware atomic inventory guard

- Corrected the batch guard without changing migrations 151–158. Application
  SECURITY DEFINER counts remain 190 before the batch and 197 after. The exact
  pre-existing `public.rls_auto_enable()` identity is excluded only after verifying
  its postgres owner, zero-argument event_trigger return, plpgsql language, definer
  status, pg_catalog search_path, default ACL and the enabled postgres-owned
  `ensure_rls` ddl_command_end event with its three approved CREATE tags. A changed
  identity, wiring or an additional definer fails closed. Source-only local schemas
  may have no platform helper; an orphaned `ensure_rls` trigger is rejected.
- Expected DEV inventory after commit is **197 application + 1 verified platform
  event-trigger function = 198 public SECURITY DEFINER functions**, not a blindly
  increased application count. No platform function, grant or event trigger is
  modified by the prepared deployment body.
- Current reviewed body: 114288 UTF-8 bytes; SHA-256
  `983a56d1f50d38c7db9a2cc55b6cca5e9b7a2815db5d8ddfc533e1880326538c`.
  The existing mandatory `psql -X --no-password --set=ON_ERROR_STOP=1
  --single-transaction --file=<reviewed-batch-file>` execution contract is unchanged.
- Validation: 101 focused connection-free tests and 11 integrated runtime tests
  passed, plus typecheck and whitespace checks. One new positively owned local
  clone reproduced the platform identity/wiring; security-setting drift, disabled
  event wiring, ACL drift and an extra same-name overload were rejected. The forced
  SQL failure rolled back the complete batch, the authenticated observer could not
  see/call Save before commit, and the final inventory was 197 + 1. Platform metadata,
  existing business datasets and sequences remained unchanged. Source manifests and
  owned-clone removal were verified; existing databases, residue and clones retained.
- Existing Vite serves HTTP 200 on `http://127.0.0.1:5174`; its served configuration
  points to `https://yzysgbrpbhiapalgetau.supabase.co` and the served release switch
  remains OFF. Startup is `npm run dev` (127.0.0.1, port 5174, strictPort).
  No DEV query/deployment, activation or real-browser mutation was performed here.

Remaining separately authorized localhost DEV sequence:

1. Reverify alfaev-dev / yzysgbrpbhiapalgetau, ACTIVE_HEALTHY, exact 150/150 parity,
   pending 151–158, frozen hashes, verified platform identity and current data/security
   baselines. Regenerate and compare the reviewed body fingerprint above.
2. Apply that body ONCE using the verified DEV-only connection and the required
   single-transaction client options. Never use ordinary per-migration autocommit.
   On an error or uncertain result, stop and inspect read-only; do not blindly retry.
3. Read-only verify 158/158, 197 application + the unchanged platform function,
   narrow RPC grants/private helpers, RLS, 41 permission definitions, empty Test
   tables and unchanged existing stock, history, identities, roles and business data.
4. Separately authorize required Test view/manage and warehouse permissions only
   for approved non-Admin acceptance profiles; active Admin uses existing authority.
5. Separately authorize changing only the existing DEV-pinned release switch to ON;
   restart Vite if necessary and open `http://127.0.0.1:5174/pcb/test`. No online
   frontend hosting or Edge deployment is required for this local frontend.
6. Separately authorize bounded real-browser acceptance fixtures and mutations.
   Verify history, recovery, Inventory expiry and denied/view-only identities.

Disable remains the existing switch OFF, retaining recovery journals and immutable
holds/history. UI disable does not revoke backend Save or release holds. Any emergency
backend revocation needs separate approval; retain all protection through natural expiry.

## DEV atomic deployment adapter — local preparation only

- `scripts/deployment/test-calculator-dev-adapter.ts` reuses the installed CLI's
  existing `/v1/projects/yzysgbrpbhiapalgetau/cli/login-role` flow with the existing
  owner-controlled Supabase access token. There is no password reset, new owner
  password requirement, network-unban operation or credential fallback. Live login
  issuance is a separately authorized operational authentication change, not a
  read-only probe, and was NOT requested during this preparation.
- Default/native Node invocation is check-only. Actual execution requires exactly
  `--execute-dev --approval=151-158-atomic-once`; there is no target/URL option.
  Before authentication it verifies the exact healthy DEV identity, complete ordered
  150 baseline/pending scope, eight frozen hashes, approved batch hash, 15 approved
  business digests, warehouse totals and security inventory. It then checks fresh
  business/security snapshots again after temporary-login initialization.
- The temporary password is passed only through an isolated, in-memory child libpq
  environment (never argv, a passfile, Docker configuration, logs or process.env).
  Host/database/project-scoped user, TLS verify-full/system roots, connect timeout,
  client path and clean environment are fixed. The postgres session-role transition
  and database/session-user guard precede the unchanged reviewed body in the SAME
  `psql -X --no-password --set=ON_ERROR_STOP=1 --single-transaction --file=-`
  invocation. SQL is supplied on stdin; no credential or SQL file is persisted.
- Client execution is bounded with TERM/KILL deadlines; raw API/libpq errors/output
  are never printed. No automatic retry exists. Independent post-attempt reads run
  even on execution failure; a failed/lost response never yields PASS. Verified
  rollback, unverified outcome and completed-but-client-failed states are distinct.
  A captured backend PID and unique application name identify the deployment
  transaction; bounded independent checks must establish it is inactive/closed
  before success or restoration can be claimed (a pooler's idle backend may remain).
  No automatic repair, rollback deployment, Test Save or feature activation occurs.
- Snapshots cover public/auth/storage table counts/digests, stock/over-reservation,
  function definitions and ACLs, existing RLS/table ACLs, role memberships, event
  triggers and permission assignments. Only the CLI login role's expected credential
  expiry renewal is excluded from role-attribute comparison; ordinary roles and
  memberships remain protected. Expected migration-driven definition changes and
  two permission definitions are distinguished from unrelated changes.
- Local validation: 33 adapter mock/static cases plus seven existing manifest/gate
  cases passed (40 total); 11 integrated backend cases passed in newly owned
  clone. Real container-local psql proved complete rollback after a forced failure
  following the whole batch, then a separate successful atomic install. Independent
  authenticated observation proved Save unavailable before commit. The production
  read-only snapshot SQL ran against the local clone; only DEV identity/authentication
  and DEV-specific business baseline values were mocked. No global database role
  was created. Source manifests and owned-clone removal were verified.
- Current reviewed batch hash remains
  `983a56d1f50d38c7db9a2cc55b6cca5e9b7a2815db5d8ddfc533e1880326538c`;
  migrations 151–158 and the existing batch module remain unchanged. The release
  switch remains OFF; live TLS/temporary-login issuance is deliberately untested.

Future execution (NEW explicit DEV authorization required, not performed here):

```sh
cd /Users/test/Desktop/internal-tool
/usr/local/bin/node scripts/deployment/test-calculator-dev-adapter.ts --check-only
/usr/local/bin/node scripts/deployment/test-calculator-dev-adapter.ts --execute-dev --approval=151-158-atomic-once
```

Authorization must include the established temporary CLI login initialization and
one atomic 151–158 batch. Stop on any guard failure, authentication/TLS problem or
uncertain client outcome; do not weaken TLS, recapture changed baselines as accepted,
retry automatically or fall back to ordinary per-file push. Opening the release
switch, permission assignment and browser mutation acceptance remain separate gates.

## TC-12 — Focused isolated security and expiry acceptance

- Deliverable: local proof of authorization, immutable Save/replay, expiry and rollback.
- Acceptance: anonymous/inactive/unauthorized/direct-write denial, bigint bounds,
  zero/partial results, DST/lock-wait expiry, source-history preservation; report actual
  results only. Mutating clone lifecycle requires separate explicit authorization.
- Dependencies: TC-07, TC-08, TC-10, TC-11. Budget: maximum 15 minutes.

## TC-13 — Focused stock/concurrency regression

- Deliverable: isolated committed-winner race and existing accounting compatibility proof.
- Acceptance: Test/Test, Test/Project requirement-reservation-lifecycle, Test/Finish,
  adjustment/transfer and expiry races; no overspend, false replay success or deadlock;
  FIFO/PDF/Project/notification preservation. Preserve persistent data/residue/old clones.
- Dependencies: TC-12; separate authorization for owned runtime resources.
  Budget: maximum 15 minutes.

## TC-14 — Independent review and DEV deployment preflight

- Deliverable: reviewed final SQL/ACL/activation manifest and read-only DEV impact report.
- Acceptance: TC-12/13 passed or genuine blockers reported, frozen migration identities,
  exact grants/security inventory, no historical backfill/auto-Test holds/notifications;
  necessary focused regression recorded. Do not deploy under preflight authorization.
- Dependencies: TC-13. Budget: maximum 15 minutes.

## TC-15 — Separately authorized DEV rollout

- Deliverable: apply only reviewed migrations/activation grants to the exact DEV target.
- Acceptance: explicit fresh deployment approval, exact dry run/hashes, one execution,
  read-only parity/security/business-data preservation, stop on uncertain outcome.
  No frontend/Edge/production deployment is implied.
- Dependencies: TC-14 and explicit DEV execution authorization. Budget: maximum 15 minutes.

## TC-16 — Separately authorized real-browser acceptance

- Deliverable: bounded browser proof against DEV with exact approved retained test fixtures.
- Acceptance: Normal unchanged; Test proof/Save/partial/zero/recovery/expiry/history and
  Inventory values agree; physical stock/provenance unchanged by Save, permissions and
  no-job expiry verified. No existing business-record changes or cleanup assumption.
  Observe natural calendar-date expiry only if it occurs within the budget; otherwise
  report that browser observation pending a separately authorized timed check. Do not
  change server/browser clocks or shorten the approved deadline semantics to force a PASS.
- Dependencies: TC-15 and separate fixture/browser mutation authorization.
  Budget: maximum 15 minutes.
