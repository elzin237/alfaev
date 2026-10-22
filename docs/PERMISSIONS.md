# AlfaEV — PERMISSIONS.md

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
