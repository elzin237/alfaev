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
- many-to-many Product↔Supplier

Include:
- supplier-specific Catalog Number
- Catalog Number non-unique
- relationship active state

Add correct uniqueness constraints only for duplicate relation prevention.

---

## 054 — Add ProductSupplier Backend Operations

Goal:
- authorized link/add/edit/archive operations

Requirements:
- Product and Supplier validity
- audit meaningful changes

---

## 055 — Add Supplier Links to Product UI

Goal:
- Product detail shows/manage:
  - Supplier
  - Catalog Number

Do not mix Inventory quantities into this task.

---

## 056 — Add Product Links to Supplier UI

Goal:
- Supplier detail shows linked Products and Catalog Numbers

Reuse ProductSupplier backend/query logic.

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
- Admin-only Add / Remove / Correction operation

Require:
- quantity
- reason

Atomically:
- balance
- movement
- audit

Add negative-stock and authorization tests.

---

## 061 — Build Manual Inventory Adjustment Dialog

Goal:
- Admin-only UI

Show:
- current
- adjustment
- resulting quantity
- reason

Block invalid negative result in UX, while backend remains authoritative.

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
- Product detail history table

Show:
- Date
- Type/source
- Delta
- Before
- After
- User
- Reason/context

Read-only.

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
- implement Project data model/security

Fields:
- Name
- Customer
- Status
- Start Date
- Delivery Date

Statuses:
- Planned
- In Progress
- On Hold
- Completed
- Cancelled

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
- authorized create form
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
- authorized edit
- allowed status values
- audit before/after

Do not implement Completed lock separately here.

---

## 073 — Enforce Completed Project Lock

Goal:
- backend prevents normal edits while Completed

UI:
- read-only completed state

Add tests proving direct update bypass fails.

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
- implement Nabavka model/security

Statuses:
- Active
- Partly Delivered
- Resolved

Support:
- optional Product link
- requested name snapshot
- Supplier
- requested quantity
- delivered quantity

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
- Supplier
- Quantity
- save Active request
- audit

No Inventory mutation.

---

## 079 — Build Brand-New Component Request Flow

Goal:
- no Product required
- Name
- Supplier
- Quantity
- clearly show `Serial Number not assigned`

Worker never enters Serial Number.

---

## 080 — Add Partly Delivered Backend Rules

Goal:
- validate/update:
  - delivered quantity
  - remaining
  - status

No Inventory mutation.

Add domain tests.

---

## 081 — Build Partly Delivered UI

Goal:
- update dialog/flow
- show Requested / Delivered / Remaining

Keep UI simple.

---

## 082 — Add Resolved Workflow

Goal:
- trusted status change to Resolved
- audit
- historical retention
- Sidebar badge decrements

No Inventory mutation.

---

## 083 — Add Admin Create-Product-from-Request RPC

Goal:
- Admin-only trusted transaction

Must:
- re-check request unlinked
- allocate Product Serial
- create Product
- create ProductSupplier relation
- link request
- audit

Collect missing Product fields as function input.

Add security tests.

---

## 084 — Build Create-Product-from-Request UI

Goal:
- Admin form prefilled from Nabavka

Fields:
- Name
- Category
- Brand
- Supplier
- Catalog Number

Serial:
- generated automatically

---

# PHASE I — PCB Definition and BOM

## 085 — Create PcbCard Schema + Output Product Link

Goal:
- implement PcbCard table/security

Rule:
- every PCB card has one stock-tracked `pcb_finished_good` Product

Do not create card UI yet.

---

## 086 — Add Trusted PCB Card Creation

Goal:
- create PCB card + output Product coherently

Requirements:
- output Product gets unique 7-digit Serial Number
- authorization
- audit

---

## 087 — Build PCB List + Create Card UI

Goal:
- `/pcb`
- list
- Add PCB Card
- show card name / Serial / active state

Stock appears once Inventory integration is queried.

---

## 088 — Create BOM Version + BOM Item Schema

Goal:
- PcbBomVersion
- PcbBomItem
- constraints

Rules:
- quantity > 0
- no duplicate component within version
- no self-consumption

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

## 091 — Enforce Used BOM Immutability

Goal:
- once used by production, version/items cannot be edited/deleted

Backend-enforced.

Add direct-bypass tests.

---

## 092 — Add New BOM Version Creation

Goal:
- editing a used BOM creates next version
- old version remains historical
- new version becomes active

Audit version creation.

---

## 093 — Build BOM Version History UI

Goal:
- active/historical versions
- created date/by
- used-in-production indicator

No editing of historical used version.

---

# PHASE J — PCB Production

## 094 — Create PcbProductionRun Schema + Security

Goal:
- production history entity
- PCB
- BOM version
- optional Project
- quantity
- actor/time

No stock mutation yet.

---

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

Frontend precheck only.

No stock mutation.

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

# PHASE K — Work Order Drafts

## 101 — Create WorkOrder Schema + Status Protection

Goal:
- Draft / Finished model
- Project
- customer snapshot
- description
- metadata

Do not create numbering in this task.

---

## 102 — Add Yearly Work Order Number Allocator

Goal:
- concurrency-safe `RN-YYYY-NNNN`

Rules:
- assigned once
- yearly reset
- never reused
- database unique constraint

Add allocation/concurrency tests.

---

## 103 — Add Trusted Draft Work Order Creation

Goal:
- create Draft
- allocate number
- authorize actor
- audit creation

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
- authorized Draft-only updates

Protect:
- Finished cannot be updated
- Customer snapshot derives from selected Project

Audit only meaningful saved changes according to audit policy.

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

## 111 — Add Barcode Product Resolution

Goal:
- resolve scanned Serial Number to valid Product

Errors:
- invalid format
- Product not found
- archived/ineligible Product

No WorkOrderItem mutation yet.

---

## 112 — Build Work Order Materials Table

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

## 114 — Add Draft Item Persistence

Goal:
- add/update/remove WorkOrderItem rows through authorized Draft backend path

Rules:
- quantity > 0
- Finished parent rejected
- no Inventory mutation

---

## 115 — Add Delete Draft Work Order

Goal:
- authorized delete
- confirmation
- Work Order number never reused
- audit deletion as required

Finished delete remains impossible.

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

No mutation yet.

---

## 118 — Create Private Work Order PDF Storage + Policies

Goal:
- private Supabase Storage bucket/policies

Rules:
- no anonymous access
- authorized read only
- no arbitrary client overwrite
- temporary/final object convention

No PDF generation yet.

---

## MANUAL PRODUCT GATE — Approve PDF Layout

Before Task 119, finalize the visual content/layout of the printable Radni Nalog PDF with the user/CEO.

This is not a Codex implementation task.

Do not let Codex invent the official document layout.

---

## 119 — Build Trusted Work Order PDF Snapshot Model

Goal:
- define exactly what trusted database data is rendered into the PDF

Include approved:
- Work Order Number
- Project
- Customer
- materials
- description
- date
- signature area
- other approved document fields

Keep this renderer input independent of React page state.

---

## 120 — Build Server-Side PDF Generator

Goal:
- Supabase Edge Function/server-side PDF bytes from trusted snapshot

Requirements:
- deterministic
- escaped/safe text
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
- link PDF reference
- set finisher/time
- audit

No partial DB state.

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

Drafts excluded.

---

## 130 — Add Project-Linked PCB Usage + Anti-Double-Count

Goal:
- merge Project-linked PCB raw input consumption into Project usage

Rules:
- Project-linked PCB production raw inputs count
- later Work Order use of that finished PCB must not re-expand the same raw BOM
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

Archive activity must respect Archive/module visibility rules.

---

## 144 — Dashboard Authorization Leak Tests

Goal:
- multiple permission profiles

Prove:
- no unauthorized module data leaves backend
- hidden widgets are not merely client-hidden
- Admin sees full view

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
- create Draft
- scan/add materials
- Save
- Finish
- verify stock
- Project usage
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

## 160 — Configure Production Frontend Deployment

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
- Complete
- reopen

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

This plan has **165 execution tasks**, but they are grouped into coherent phases.

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
