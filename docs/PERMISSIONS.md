# AlfaEV — PERMISSIONS.md

## Current Import from Test authorization checkpoint — 2026-10-30

DEV deployment through migration 170 was previously verified; the existing 41
permission definitions remain unchanged. The local import gate is ON only for
the approved DEV backend, not a permission grant or production activation.
Active Admin or all five Test/Calculator grants plus applicable source warehouse
authority remain mandatory server-side, including exact receipt replay.
Test history access alone never permits destination metadata/navigation or import.
Earlier local/OFF descriptions below are retained historical phase evidence.

## Phase 3 atomic Test import — local migration 169

The new authenticated-only import_test_calculation(uuid,uuid,text) requires active Admin
OR test_calculator.view/manage AND pcb.view/create/edit. FG view is always required for
non-Admins; ordinary component definitions additionally require Raw and Customs views.
The same current authority is checked on exact request replay. Shared-Test import is
allowed but receipt ownership remains the original importing profile AND Auth identity.
PUBLIC/anon/service_role remain denied; private conversion/release tables remain unreadable
and unwritable by application roles. No permission definitions, assignments, general
Inventory privileges or existing Calculator grants change. No frontend import is activated.

## Import from Test — approved authority; Phase 1 local only

Future import requires an active Admin OR all of test_calculator.view,
test_calculator.manage, pcb.view, pcb.create and pcb.edit. Preserve source-specific
warehouse view authorization: FG for linked finished inputs; Raw, Customs and FG for
ordinary inputs. Shared authorized Tests may be imported across creators, but request
receipt recovery remains bound to the importing profile AND authenticated identity.
Explicit employee confirmation is required. View-only history does not permit release.
No new permission definitions, assignments, general Inventory access or role expansion.

Migration 167 grants no table access and no RPC EXECUTE to PUBLIC, anon, authenticated
or service_role, including Admin JWTs. Its two consistency/immutability helpers are
SECURITY INVOKER with empty search_path and private EXECUTE. Authorization enforcement,
release-aware consumers and narrow authenticated import/read RPCs belong to later phases.

## Current authorization checkpoint — 2026-10-29

Previously verified DEV migration 166 retains the existing 41 permission definitions.
Local Test Calculator, Low Stock and three WO release switches are ON only for the
approved DEV origin; gates confer no permission and do not replace backend checks.
Older local/OFF rollout notes remain historical records.

Combined Dashboard/Sidebar badges use the same profile/permission-scoped authorized
query: active WO/Product episodes plus unread Project notifications. Recipient-owned
reads/dismissals and current module visibility remain mandatory. Active WO dismissal
is denied; resolved dismissal does not alter immutable notification history.

Dashboard Raw catalog verification additionally requires an active Admin or the Raw
warehouse view grant, within the existing authorized Dashboard section. It uses the
trusted warehouse listing RPC, never direct tables or inferred Product kinds. Denied
or uncertain membership hides catalog values; no extra Inventory grant is introduced.
Full non-Admin and resolved-alert browser acceptance is still outstanding; no new
permission assignment or fresh remote permission audit occurs in this correction.

## WO-04 recipient-owned Dashboard alerts

No new permission keys. Active Admins qualify; active non-Admins need BOTH
`dashboard.view` and `work_orders.view` for Work Order delivery/read/dismiss.
Project recipients continue to require existing Project permissions. Combined
reads omit currently unauthorized target types. Notifications belong to their
recipient; even an Admin cannot read/dismiss another recipient's notification.

## WO-03 private shortage event foundation

No new permission keys, assignments, table access or client EXECUTE grants are
introduced. Work Order mutations continue to require their existing backend
authorization. WO-04 must deliver opening/resolution intents only to active Admins
or active users with both Dashboard and Work Order view permissions, with recipient
ownership checks on reads; WO-03 does not expose an inbox or recipient records.

## WO-01 material availability

The narrow trusted read follows Work Order detail: authenticated active Admin OR
active profile with `work_orders.view`. Edit-Draft, Finish, PCB Produce or warehouse
permissions alone do not grant this read. No broader Product/Inventory table access,
permission assignment or permission definition is added. Only authenticated EXECUTE
is granted; private shared production helpers remain denied to browser/service roles.
Future WO notification delivery must preserve recipient ownership and current active
Dashboard + Work Order access, rather than inheriting Project recipient eligibility.

## Low Stock V1 — LS-02 read authorization

Inventory stock-health read requires an active authenticated Admin or the selected
warehouse's view permission; no edit or combined Raw+Customs permission is needed
because quantities are strictly warehouse-physical. Dashboard stock-health requires
active Admin or dashboard.view, and includes only warehouses for which that actor
has the applicable warehouse view. Unauthorized warehouses are omitted entirely,
not represented by zero counts. An authorized warehouse with no active members has
real zero counts. Dashboard-only users can receive empty arrays. Private helpers and
configuration tables have no direct browser grants; only the two trusted read RPCs
grant authenticated EXECUTE. No permission definitions or assignments are changed.

## Low Stock V1 — LS-01 configuration authorization

Set/clear requires an authenticated active profile and either active Admin status,
or BOTH `inventory.products.edit` and the selected warehouse's `.view` permission:
`inventory.raw_materials.view`, `inventory.customs.view`, or
`inventory.finished_goods.view`. No new permission keys/grants are added. Stock
adjust permission alone does not authorize minimum configuration. Configuration
does not confer adjustment, reservation, Test, procurement or notification authority.
Actor/grants are revalidated after Product-lock waits. The configuration table has
no direct browser access; only the trusted configuration RPC grants authenticated
EXECUTE. Anonymous, inactive and service-role callers receive no new access.

Status: Canonical authorization model v1.1  
Purpose: Define the permission architecture and the initial per-user permission checklist.

---

## 1. Authorization Model

AlfaEV has two account classes:

### Admin
Admin always has full access.

Admin permissions are not controlled by per-user toggles.

### Non-admin
A non-admin user's capabilities are controlled by explicit per-user permissions configured by Admin.

There is no fixed Worker role permission matrix.

Different non-admin users may have different capabilities.

---

## 2. Enforcement Rules

Permissions must be enforced in trusted backend/database authorization.

The frontend may:

- hide buttons
- disable actions
- hide navigation items

But frontend behavior is only UX.

Unauthorized backend/database operations must fail even if a user manually attempts them.

All permission changes must create Archive/Audit events.

---

## 3. Permanently Admin-only Capabilities

These capabilities are not delegable:

- Manage User Permissions
- Change Admin status
- Create user accounts
- Activate/deactivate user accounts
- Manually adjust Inventory quantity
- Create/edit/modify Calendar entries
- Manage Dokumentacija records and private PDF attachments
- Manage Osnovna sredstva

A non-admin user must never be able to:

- grant permissions
- revoke permissions
- change another user's access
- change their own access
- promote themselves to Admin

Admin always has access to all other actions in the system.

Admin users do not need UserPermission rows for access because Admin bypass applies. Existing UserPermission rows are not deleted merely because a user is promoted to Admin; they remain stored, are ignored for access while Admin bypass applies, and become relevant again if the user is later demoted.

Changing Admin status remains permanently Admin-only and is never delegable.

---

## 4. Initial Delegable Permission Checklist

The Admin user-management UI should expose a clear checkbox/toggle matrix for non-admin users.

### Dashboard

- View Dashboard

### Projects

- View Projects
- Create Projects
- Edit Projects
- Delete/Archive Projects
- Send Project Activity Alerts
- Receive Project Activity Alerts

Project reads require an active Admin or View Projects (`projects.view`). Create uses `projects.create`. Normal field edits and normal status changes use `projects.edit` and handle only `planned`, `in_progress`, and `on_hold`; normal edit can no longer set `completed` or `cancelled`. Project completion is performed atomically by the trusted final-Work-Order Finish flow. Delete/Archive Projects (`projects.archive`) authorizes the separate trusted cancellation transition from `planned`, `in_progress`, or `on_hold` to `cancelled`; it does not authorize hard deletion, Completed Project cancellation, or restoration/reactivation. The only Completed Project reopen is the explicit Admin-only `completed` to `in_progress` operation. No separate cancel/status permission and no additional Project permission key are added.

Project Product and Project component-requirement reads use the same active Admin or `projects.view` authority. Their trusted mutations require an active Admin or `projects.edit`. Completed and Cancelled Projects reject normal planning mutations.

Project Activity reads use the same active Admin or View Projects (`projects.view`)
authority; no separate Activity-read permission exists. Posting an update requires an
active Admin or Edit Projects (`projects.edit`) and is allowed only for `planned`,
`in_progress`, or `on_hold` Projects. Historical Activity on Completed/Cancelled
Projects remains readable.

Issue resolution introduces no new permission key. An active Admin or Edit Projects
(`projects.edit`) may resolve an existing Issue on any Project lifecycle state. The
automatic resolution notification includes active Admins and active non-Admins with
effective `dashboard.view` plus `projects.view`; neither Project Activity alert send nor
receive permission is required. Manual Activity alert permissions remain unchanged.

Resolution-image upload introduces no new permission. It requires the exact original
active resolver plus current Admin or `projects.edit`, including on Completed/Cancelled
Projects. Viewing resolution evidence follows Project Activity reads: active Admin or
`projects.view`. Neither boundary grants direct table or Storage access.

`Post & send alert` requires both Activity-post authority and Send Project Activity
Alerts (`projects.alerts.send`), with Admin bypass applying independently to those
action checks. Edit Projects alone never authorizes alert sending.

Receive Project Activity Alerts (`projects.alerts.receive`) is an explicit operational
subscription assignment for non-admin users. Non-admin send-time eligibility also
requires active state plus effective `dashboard.view` and `projects.view` access.
Every active Admin is included automatically without an explicit receive assignment.
An alert sender is included in the recipient snapshot whenever that sender satisfies
the same Admin or non-admin eligibility rules as every other recipient.
Historical recipient membership remains stored, but current active state plus current
effective Dashboard and Project read access still governs notification visibility.
Per-recipient dismissal adds no permission key. The trusted mutation requires
the same current active `dashboard.view` and `projects.view` access and strict ownership;
Admin bypass applies to the access permissions only and never to recipient ownership.
Current `projects.alerts.receive` is not required to dismiss a historically delivered
notification.

### Nabavka / Procurement

- View Nabavka
- Create Nabavka Request
- Edit Nabavka Request
- Change Nabavka Status
- Resolve/Remove Nabavka Request

ProcurementRequest reads require an active Admin or View Nabavka (`procurement.view`). Task 075 adds only SELECT access under that rule and keeps direct normal-client INSERT, UPDATE, and DELETE denied.

Task 080 trusted Delivered Quantity updates and the derived Active/Partly Delivered lifecycle synchronization require an active Admin or Change Nabavka Status (`procurement.change_status`). The trusted mutation does not require `procurement.view`. Edit Nabavka Request (`procurement.edit`) alone does not authorize Delivered Quantity or lifecycle changes.

Task 082 terminal resolution requires an active Admin or Resolve/Remove Nabavka Request (`procurement.resolve`). The trusted mutation does not require `procurement.view`. `procurement.change_status`, `procurement.edit`, `procurement.create`, and `procurement.view` alone do not authorize resolution. Task 080 remains exclusively owned by `procurement.change_status`, while Task 082 resolution remains exclusively owned by `procurement.resolve`. The existing `procurement.view`, `procurement.create`, `procurement.edit`, `procurement.change_status`, and `procurement.resolve` keys remain separate; no additional Procurement permission key is introduced.

### Dobavljači / Suppliers

- View Suppliers
- Create Suppliers
- Edit Suppliers
- Delete/Archive Suppliers

Supplier reads require Admin access or View Suppliers (`suppliers.view`).

Supplier creation requires Admin access or Create Suppliers (`suppliers.create`).

Supplier editing requires Admin access or Edit Suppliers (`suppliers.edit`).

Supplier archive requires Admin access or Delete/Archive Suppliers (`suppliers.archive`). This permission does not authorize hard deletion or Supplier reactivation/unarchive.

Frontend visibility is UX only. Trusted backend/database operations remain authoritative and must re-check the actor's permission and the Supplier's lifecycle state.

### Skladište / Inventory

- View Inventory
- Add Products/Components
- Edit Product/Component Data
- Manage Brands
- Generate/Download Barcodes

Manual Inventory quantity adjustment is Admin-only and is therefore not a delegable checkbox.

Barcode scanning itself does not require a separate global permission if it is only used to select a product inside an already-authorized workflow.

Normal Brand reads within Inventory require Admin access or View Inventory (`inventory.view`).

Creating, editing, or archiving Brands requires Admin access or Manage Brands (`inventory.brands.manage`). This permission does not authorize hard deletion or Brand reactivation/unarchive.

Product reads require Admin access or View Inventory (`inventory.view`).

Inventory Movement history reads require an active Admin or View Inventory (`inventory.view`). A trusted history read may expose the InventoryMovement fields required by the UI plus only the actor's `actor_user_id` and Full Name. It does not grant general UserProfile access or expose actor email, birthday, Admin status, permissions, or other profile fields.

Product creation and editing use the existing Add Products/Components (`inventory.products.create`) and Edit Product/Component Data (`inventory.products.edit`) permissions respectively. Trusted backend/database operations remain authoritative; direct client Product mutation is not permitted.

Confirmed `.xlsx` Component bulk import uses the same active Admin or `inventory.products.create` authority as Add Component. `inventory.view` alone does not authorize import. Preview visibility/validation is UX only; the one trusted import operation rechecks authority and all rows. No separate import permission key is added.

Product archive/deactivate requires an active Admin or Edit Product/Component Data (`inventory.products.edit`). Add Products/Components (`inventory.products.create`) does not authorize archive, View Inventory (`inventory.view`) remains read-only, and no separate `inventory.products.archive` permission is added. Archive remains a trusted backend lifecycle mutation and does not authorize hard deletion or reactivation/unarchive.

ProductSupplier add/archive requires an active Admin or either existing capability: Edit Product/Component Data (`inventory.products.edit`) or Edit Suppliers (`suppliers.edit`). Catalog Number and Description are edited on Supplier through the normal `suppliers.edit` boundary; ProductSupplier has no live per-link metadata editor. The same trusted backend authority applies whether relationship management originates from Product detail or Supplier detail. No separate ProductSupplier permission key is added, and direct client mutation is not authoritative authorization.

ProductSupplier reads require an active Admin, View Inventory (`inventory.view`), or View Suppliers (`suppliers.view`). Either view permission is sufficient; a user does not need both. A trusted Product-side ProductSupplier read may expose only the related Supplier ID, Supplier Name, live Supplier Catalog Number, optional Supplier Description, and Supplier active/archive state needed to display the relationship. A trusted Supplier-side ProductSupplier read may expose only the related Product ID, Serial Number, Name, and active/archive state needed to display the relationship. This allows authorized Inventory readers to see Supplier links from Product detail and authorized Supplier readers to see Product links from Supplier detail without granting general cross-domain table access.

A trusted minimal Supplier-choice lookup used to create ProductSupplier relationships may return only active Supplier IDs and Names. It requires an active Admin, Edit Product/Component Data (`inventory.products.edit`), or Edit Suppliers (`suppliers.edit`). General Supplier reads remain restricted to an active Admin or View Suppliers (`suppliers.view`).

A trusted minimal Product-choice lookup used to create ProductSupplier relationships may return only active Product IDs, Serial Numbers, and Names. It requires an active Admin, Edit Product/Component Data (`inventory.products.edit`), or Edit Suppliers (`suppliers.edit`). General Product reads remain restricted to an active Admin or View Inventory (`inventory.view`); the lookup does not expose Product Category, Brand, lifecycle timestamps/actors, or other Product details.

### Finished Product Calculator

- View Finished Product Calculator (`pcb.view`)
- Create Finished Product Calculator/BOM (`pcb.create`)
- Edit Finished Product Calculator/BOM (`pcb.edit`)
- Produce Finished Products (`pcb.produce`)
- Delete/Archive PCB Definitions (`pcb.archive`)

PcbCard reads require an active Admin or View Finished Product Calculator (`pcb.view`). Trusted PcbCard creation, editing, production, and archive operations enforce the corresponding existing permission or Admin status at the backend; no new PCB permission key is introduced and technical `pcb_*` identities remain unchanged.

The PCB production route requires an active Admin or `pcb.produce`; new Calculator
production has no Project picker and always submits a null Project. Historical
Project-linked production remains readable under its existing module permissions.
Finishing production continues to require active Admin or `work_orders.finish`; it does
not require or confer any warehouse `adjust` permission.

`pcb.produce` authorizes creation of the specialized PCB-production Draft Work Order without `work_orders.create`. It does not grant general Work Order view/edit/finish/delete access. After creation, the existing Work Order permissions apply, and Finish specifically requires active Admin or `work_orders.finish`.

### Radni Nalozi / Work Orders

- View Work Orders
- Create Work Orders
- Edit Draft Work Orders
- Finish Work Orders
- Delete Draft Work Orders

PDF generation is part of Finish Work Order and does not need a separate permission.

### Calendar

All authenticated users may view Calendar.

Calendar modification is Admin-only.

Therefore Calendar does not require delegable view/manage checkboxes in the initial permission matrix.

### Dokumentacija

Dokumentacija is permanently Admin-only, including record create/read/edit/archive
and private PDF upload/read/download/replace/remove operations. It has no delegable
permission key and must not appear in the permission matrix.

### Osnovna sredstva

Osnovna sredstva is permanently Admin-only for create/read/edit/archive. It has no
delegable permission key and must not appear in the permission matrix.

### Archive

- View Archive

Non-admin users may view Archive only when this permission is enabled.

Archive remains read-only.

### Users

The Users module is completely Admin-only.

Non-admin users:

- do not see the Users navigation item
- cannot access the Users page
- cannot view a read-only user/employee directory
- cannot create users
- cannot edit user profiles
- cannot activate/deactivate users
- cannot change Admin status
- cannot manage permissions

No Users-related permissions are delegable.

---

## 5. Permission UI Behavior

When Admin opens a non-admin user account:

- show the user's current delegable permission checklist
- allow Admin to enable/disable allowed permissions
- save changes explicitly
- record permission changes in Archive

Example audit event:

`Admin enabled "Change Nabavka Status" for Marko Petrović.`

Permission changes should take effect consistently across:

- navigation visibility
- page access
- actions/buttons
- backend/database authorization

---

## 6. Account State

Each user has:

- Full Name
- Email
- Birthday
- Active/Inactive status
- Admin flag
- per-user permissions
- Created Date
- Last Login

Only Admin may:

- create users
- deactivate/reactivate accounts
- change Admin status
- change user permissions

Inactive users cannot authenticate or perform new actions.

Historical audit records must continue to reference inactive users correctly.

---

## 7. Archive Visibility

Admin:
- always has Archive access

Non-admin:
- may view Archive only if `View Archive` is enabled

Archive:
- read-only
- never editable
- never deletable through normal application workflows

## 8. Automatic shortage notification recipients

Automatic Project shortage and resolution notifications require no send/receive
permission. Delivery is snapshotted to all active Admins and active non-Admins who have
both effective `dashboard.view` and `projects.view`. Inactive users are excluded. This
does not grant direct access to shortage tables, Inventory, Projects, or other users'
notification records.

## Task 001L requirement mutation permission boundary (local migration 149)

Any FG-affecting requirement create/update/replace/remove requires active Admin or
all four `projects.view`, `projects.edit`, `inventory.finished_goods.view`, and
`inventory.finished_goods.reserve` permissions. `projects.edit` alone never implies
reservation authority. Ordinary-material requirement CRUD retains its existing
authorization. The request-aware RPC is authenticated-facing with internal checks;
receipt tables and calculation/write helpers remain private. No permission grants
are assigned automatically. Deployment and browser acceptance are separate gates.

## Finished Goods reservation capability — local Phase 3A

`inventory.finished_goods.reserve` is independent of warehouse adjustment, Work Order
Finish and production permissions. Migration 143 defines it as delegable but assigns
no users automatically. The typed permission registry recognizes it; no reservation
controls are implemented. Admin permission management remains read-only for Admins.

Internal reservation mutations require active Admin or all of `projects.view`,
`projects.edit`, `inventory.finished_goods.view`, and `inventory.finished_goods.reserve`.
However, application/service EXECUTE is revoked for every mutation in Phase 3A, so
even these permissions do not yet make reservations executable. Project-scoped reads
require active Admin or Project view plus FG view. Neither adjustment nor reservation
permission alone authorizes Project attribution reads.

Migrations 143–145 are local/undeployed. Phase 3B1 supplies locally accepted
debit/demand/lifecycle guards without changing mutation grants. Cancellation uses existing Admin or
`projects.archive` authority for its atomic release side effect, not a general right
to reserve stock.

Private Phase 3C fulfillment requires an active Admin or all four of `projects.view`,
`projects.edit`, `inventory.finished_goods.view` and `inventory.finished_goods.reserve`.
Adjustment, Work Order Finish or Calculator production authority alone is insufficient.
It rechecks authority after lock waits, locks the actor/current delegated permissions,
and checks original request ownership before comparing replay payloads. Fulfillment
and its provenance trigger helper deny PUBLIC/anon/authenticated/service_role EXECUTE;
Admin JWTs do not bypass those ACLs. No new permission or automatic grant is added.
Reservation UI and application activation remain absent.

Local migration 148 adds `get_finished_goods_inventory_commitments()` for active Admin
or effective `inventory.finished_goods.view` only. This warehouse aggregate does not
require `projects.view` and exposes no Project identities; PUBLIC/anon/service_role
EXECUTE and direct private-table access remain denied. It is not yet deployed.

Phase 3D1's local `get_project_finished_goods_reservation_context(uuid)` requires an
active Admin or BOTH `projects.view` and `inventory.finished_goods.view`. It does not
require Raw Materials/Customs view. Warehouse adjustment, Work Order Finish,
Calculator production or reservation permission alone cannot authorize this read.
Product name/serial are included only under this trusted Project/FG boundary;
foreign reservations are represented only by their aggregate quantity. PUBLIC/anon
and service_role EXECUTE are revoked; authenticated EXECUTE is granted only for the
new read, not for its private calculation helpers or reservation mutations.
Historical Phase 3D1 checkpoint: read model implemented locally; frontend pending, mutation activation pending,
DEV deployment pending. No additional permission key or automatic grant is added.

Phase 3D3B implements local Reserve/Release/Fulfill controls under active Admin or
all four Project view/edit and FG view/reserve permissions. Read authority alone
never activates controls. Migration 147 is prepared, not applied: authenticated
EXECUTE on only the three public mutation wrappers; helpers and tables stay private.
No permission assignments, Admin permission editing or remote activation are added.

## 9. Warehouse permissions

Task 001C implements six independently delegable warehouse capabilities while legacy
`inventory.view` reads remain restricted to Raw Materials:

- `inventory.raw_materials.view`
- `inventory.raw_materials.adjust`
- `inventory.finished_goods.view`
- `inventory.finished_goods.adjust`
- `inventory.customs.view`
- `inventory.customs.adjust`

Active Admin bypass remains canonical. A non-Admin receives only explicitly delegated
warehouse access; view or adjustment access to one warehouse does not reveal or mutate
another. Trusted database operations re-check every boundary, and UI tab visibility is
only presentation.

During migration, each existing non-Admin `inventory.view` holder receives an explicit
`inventory.raw_materials.view` grant. The legacy permission does not become an implicit
all-warehouse grant. Existing Product creation/edit, Brand, barcode, PCB, and Work Order
permissions remain separate. Warehouse Add, Remove, and Correction require the matching
warehouse `adjust` permission, and transfers require adjustment authority in both source
and destination warehouses. Task 001D owns the permission-aware Inventory tabs.

## 10. Test Calculator V1 permissions — private foundation only

Task 2's local, undeployed migration 151 registers dedicated delegable definitions
`test_calculator.view` and `test_calculator.manage` (singular keys supersede the
specification's proposed plural spelling). No user assignments, application RPC
grants or Test UI are added. All three new tables remain private even to an Admin JWT;
the following authorized read/Save behavior belongs to later trusted operations.

At the TC-02 checkpoint, typed frontend registration was deferred to coordinated
frontend/rollout work: the strict Admin parser expected the deployed 39-key contract.
It must not require 41 while DEV is unchanged. The database foundation can register
definitions without activating a frontend capability; the compatibility update below
supports both complete contracts without granting new authority.

Task 16A local coordination checkpoint: that frontend compatibility layer is now
prepared, not activated. `PERMISSION_KEYS` retains the complete legacy 39-key set;
`SUPPORTED_PERMISSION_KEYS` adds only the two Test keys (41 total), and `PermissionKey`
includes both. The Admin matrix parser accepts exactly complete 39- or 41-key sets,
independent of row order, rejecting partial upgrades, duplicates and unknown keys.
It never fabricates missing Test permission rows/grants on legacy DEV. Matrix grouping
and draft edits preserve Test grants when the backend actually returns those rows.
No permission assignments or remote activation have been performed.

- Active Admin: view/history and Save, retaining existing read-only Admin permission UI.
- Non-Admin history/list/detail: effective `test_calculator.view`. Saved calculations
  are shared among authorized viewers, not restricted to the original creator.
- Non-Admin preview/Save: BOTH Test view/manage plus the view permissions for every
  eligible source pool read by that operation. Ordinary inputs require Raw Materials,
  Customs and FG view; Calculator-linked finished-only inputs require FG view.
  Do not silently select a different source policy based on hidden warehouses.
- View alone cannot Save. `pcb.*`, `projects.*`, warehouse adjust, Work Order Finish
  or existing FG reserve authority never substitutes for Test manage/view, and Test
  authority never grants those existing mutation capabilities. Save deducts no stock.
- History exposes saved Test items/results under Test view; current warehouse totals
  still require their warehouse views. Combined Raw+Customs planning values require
  both existing views. Warehouse Test aggregates need only their corresponding
  Inventory read boundary, reveal no Test identities/creators, and grant no Test access.
- Trusted RPCs recheck active identity and relevant permissions after waits and on
  replay. Original actor ownership is required to replay a Save, even for a different
  Admin; shared history read authority does not transfer request ownership.
- Inactive/anonymous callers are denied. New tables have RLS and no direct application
  writes; private helpers/receipts have no PUBLIC/anon/application EXECUTE/access.
  Only reviewed public wrappers receive authenticated EXECUTE. No service-role or
  Admin-JWT ACL bypass is introduced and no permissions are assigned automatically.

No V1 edit, cancellation, deadline-extension, renewal or physical Test-consumption
permission/operation exists. Separate authorization is required for later additions.

TC-03 local migration 152 grants authenticated EXECUTE only on
`search_test_calculator_products(text,integer)` and `preview_test_calculation(jsonb)`.
Both require active Admin or Test view AND manage. A non-Admin additionally needs FG
view for linked-FG selections, and Raw/Customs/FG views for ordinary selections.
An FG-only caller's search cannot expose ordinary candidates, and a mixed unauthorized
preview is denied as a whole. `pcb.edit` is not a substitute. No Project identities,
Test receipts, table access, user permission assignments or Save capability are added.
Deployment is pending; the typed frontend permission contract remains unchanged.

TC-04 local migration 153 adds only authenticated EXECUTE on
`save_test_calculation(uuid,text,jsonb,date)`. It requires an active Admin or Test
view AND manage with FG view for linked outputs, all three warehouse views for
ordinary inputs. Authority is rechecked after waits and on exact replay; only the
original profile AND authenticated user may replay a request. Another Admin cannot
retrieve its private receipt. PUBLIC/anon/service_role remain denied and private
tables receive no grants. No user assignments or DEV activation are performed.

TC-08 local migration 157 grants authenticated EXECUTE on
`get_inventory_test_commitments(uuid,text)` only. It requires active Admin or the
requested warehouse's view permission; Raw's combined Raw+Customs aggregate additionally
requires Customs view. FG-only/Customs-only viewers cannot read another warehouse;
Raw-only viewers must use existing Raw physical reads, not the combined new aggregate.
`test_calculator.view/manage` is neither required nor sufficient for Inventory reads.
No calculation/creator/receipt/profile identities are exposed. PUBLIC/anon/service_role
are denied EXECUTE and all Test tables retain their existing RLS/ACL isolation.

Task 9/16 local migration 158 grants authenticated EXECUTE only on
`list_test_calculations(integer,timestamptz,uuid)` and `get_test_calculation(uuid)`.
Both require active Admin or effective `test_calculator.view`; manage alone does not
authorize history. Authorized viewers share saved history across creators, including
expired calculations, without needing Inventory view for saved results. This grants
neither current hidden-warehouse stock access nor another actor's retry receipt.
Only current creator Full Name is exposed; unrelated UserProfile fields remain private.
PUBLIC/anon/service_role remain denied; no assignments, table grants or DEV activation.
