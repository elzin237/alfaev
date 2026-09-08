# AlfaEV — BUSINESS_RULES.md

Status: Canonical business rules v1  
Purpose: Define business invariants that implementation must preserve.

---

## 1. General Principles

1. Meaningful business changes must be attributable to an authenticated user.
2. Important mutations must create immutable audit history.
3. Historical records must not be silently rewritten.
4. Inventory must never become negative.
5. Backend/database logic is authoritative for permissions and critical mutations.
6. UI hiding alone is never sufficient authorization.
7. Records with business history should be preserved rather than hard-deleted.

---

## 2. Dashboard Rules

Dashboard inherits module permissions.

- Admin sees the full Dashboard.
- Non-admin users may only see widgets/data backed by modules they are authorized to view.
- Explicitly company-wide information may be shown to all authenticated users.
- Calendar information may be treated as company-wide because Calendar viewing is available to all authenticated users.
- Dashboard must not expose unauthorized module data indirectly.

---

## 3. Project Rules

### Statuses

Allowed statuses:

- Planned
- In Progress
- On Hold
- Completed
- Cancelled

### Material usage

Project material usage is derived automatically from completed linked operations.

Contributors:
- Finished Work Orders linked to the Project
- PCB production linked to the Project

Draft Work Orders do not count.

Material totals must remain traceable to the originating operations.

### Completed Projects

When status becomes Completed:

- normal business fields become read-only
- historical material usage remains preserved
- Project cannot be hard-deleted if it has linked history

Admin may explicitly reopen a Completed Project by changing it back to In Progress.

Reopening must create an audit event.

---

## 4. Nabavka / Procurement Rules

### Existing vs brand-new component requests

If the requested component already exists:

- Nabavka references the existing Product/Component
- Serial Number / Šifra and Name come from that Product/Component
- Supplier and Quantity are selected/entered for the request

If the requested component does not yet exist:

- the Nabavka request may exist temporarily without an AlfaEV Serial Number / Šifra
- worker enters Name, Supplier and Quantity
- the request must be distinguishable as not yet linked to a Product/Component

Only Admin may create the actual Product/Component from that request.

When Admin uses `Create component from request`:

- create the Product/Component
- generate the next unique 7-digit Serial Number / Šifra through trusted backend/database logic
- link the Product/Component back to the original Nabavka request

Workers never manually assign Serial Number / Šifra values.

### Statuses

Allowed statuses:

- Active
- Partly Delivered
- Resolved

### Partly Delivered

Store/display:

- Requested Quantity
- Delivered So Far
- Remaining Quantity

Remaining Quantity = Requested Quantity - Delivered So Far.

This information is informational only.

### Inventory relationship

Nabavka status changes do not automatically change Inventory.

Inventory receipts are entered manually by Admin/CEO through Inventory.

### Sidebar badge

Badge count = number of requests where status is:

- Active
- Partly Delivered

Resolved requests are excluded.

The badge counts rows/requests, not piece quantities.

---

## 5. Inventory Identity Rules

### Brands

- AlfaEV supports reusable Brand records for products/components.
- Brand name is required and must be trimmed before persistence.
- Empty or blank Brand names are invalid.
- Brand names are case-insensitively unique; values such as `Bosch`, `bosch`, and `BOSCH` represent the same Brand identity.
- AlfaEV does not hard-delete Brand records through normal application workflows, whether or not they are currently referenced.
- Archive/deactivate is the only normal Brand removal workflow, and historical references remain intact.
- Archived Brands are immutable through normal Brand editing.
- Archived Brands remain readable where historical Product data requires them but cannot be selected for newly created Products.
- Brand reactivation/unarchive is not supported in the current scope.
- Meaningful Brand create/edit/archive changes create immutable AuditLog history.
- No-op Brand edits do not create audit noise.

### Suppliers

- Supplier name is required and must be trimmed before persistence.
- Empty or blank Supplier names are invalid.
- Supplier names are case-insensitively unique; values such as `Bosch`, `bosch`, and `BOSCH` represent the same Supplier identity.
- Country and contact details do not define Supplier identity.
- Country is required, trimmed before persistence, and must not be empty or blank.
- Contact Person and Phone are optional, trimmed when provided, and stored as `NULL` when blank.
- Phone values do not require aggressive formatting at the database boundary.
- Email is optional, trimmed and lowercased when provided, stored as `NULL` when blank, and subject to basic email validation.
- Supplier email is not unique.
- AlfaEV does not hard-delete Suppliers through normal application workflows.
- Archive/deactivate is the normal Supplier removal workflow, and historical references remain intact.
- Archived Suppliers remain readable wherever historical records require them and are immutable through normal Supplier editing.
- Archived Suppliers cannot be selected for new ProductSupplier links or new procurement selections.
- Supplier reactivation/unarchive is not supported in the current scope.
- Meaningful Supplier create/edit/archive changes create immutable AuditLog history.
- Normalized no-op Supplier edits do not create audit noise.

### Serial Number / Šifra

- unique
- generated automatically by AlfaEV
- 7 digits
- starts at `0000001`
- sequentially increments
- never reused
- used as barcode value

The sequence must be generated safely by trusted backend/database logic to prevent duplicates under concurrent creation.

### Catalog Number

- separate from Serial Number
- supplier-related
- belongs to the Product–Supplier relationship
- one product/component may have multiple Suppliers
- each Supplier may have its own Catalog Number for the same product/component
- not unique
- may be shared by multiple different products/components
- must not be used as primary identifier

---

## 6. Inventory Quantity Rules

Inventory quantity must never go below zero.

Inventory mutations come from:

- manual Admin adjustment
- Finished Work Order
- completed PCB production

Draft Work Orders never affect Inventory.

Incomplete/failed PCB production never affects Inventory.

### Manual adjustment

Only Admin may manually adjust Inventory.

Required fields:

- adjustment type:
  - Add
  - Remove
  - Correction
- quantity
- required reason/note

Record:

- previous quantity
- delta
- new quantity
- reason
- actor
- timestamp

Every manual adjustment creates an audit event.

Work Order and PCB changes are recorded under their own source event rather than pretending to be manual adjustments.

---

## 7. Barcode Rules

Barcode value is the product/component Serial Number / Šifra.

For a product/component, AlfaEV must support:

- barcode generation
- barcode viewing
- barcode image download

Physical warehouse boxes use the same barcode value.

Scanning the barcode must resolve the matching AlfaEV product by Serial Number / Šifra.

---

## 8. PCB Production Rules

### BOM calculation

For each BOM row:

Required Quantity = Quantity Per Card × Production Quantity

Before production completes, AlfaEV must compare all required quantities with current Inventory.

### Insufficient stock

If any component is insufficient:

- production does not complete
- no Inventory deductions occur
- show required, available and missing quantities

### Successful production

If all components are sufficient:

- record the production run
- record the exact BOM version used
- deduct all required component quantities
- add the produced PCB quantity to finished-goods Inventory
- record Inventory movements for both consumed inputs and produced output
- record actor and timestamp
- record audit event

The operation must be atomic: no partial state is allowed. Component deductions, production record creation, and finished-goods stock increase either all succeed or none do.

Produced PCB cards are stock-tracked finished goods.

### Project link

Project is optional.

If Project is set:
- the production run is linked to that Project
- its underlying BOM component consumption may contribute to the Project's derived material usage

If Project is empty:
- production remains valid and still affects Inventory

Project reporting must not double-count the same material consumption if produced PCB finished goods are later issued through a Work Order. The final DATA_MODEL/reporting design must preserve one traceable source of consumption per physical material movement.

### BOM versioning

If a PCB definition has never been used in production:
- Admin may edit the BOM in place

If production history exists:
- any BOM change creates a new version
- old production remains linked to the old version
- new production uses the latest active version

Historical BOM versions are immutable.

---

## 9. Work Order Rules

### Required content

A Work Order contains at minimum:

- Work Order Number
- Project
- Customer
- consumed materials table
- short description

### Work Order number generation

AlfaEV generates Work Order numbers automatically.

Human-readable format:

`RN-YYYY-NNNN`

Examples:

- `RN-2026-0001`
- `RN-2026-0002`

Rules:

- numbering sequence resets each calendar year
- number is assigned at Work Order creation, including Draft
- number is immutable
- number is never reused after deletion of a Draft
- trusted backend/database logic must allocate numbers safely under concurrency
- internal database UUID and human-facing Work Order number are separate identifiers

### Project/customer

User manually selects Project.

Customer is auto-filled from the selected Project.

### Barcode scanning

When a product barcode is scanned while editing a Work Order:

- resolve product by Serial Number / Šifra
- add product to materials table
- populate product data automatically
- user manually enters consumed quantity

### Draft

Saving as draft:

- preserves current data
- allows later editing
- does not affect Inventory

### Finish

Finishing:

- validates required data
- validates Inventory availability
- deducts consumed quantities
- records Inventory movements
- records actor and timestamp
- creates audit history
- generates PDF
- changes Work Order to Finished

Inventory changes happen only on Finish.

### Finished Work Order

Finished Work Orders:

- are immutable
- cannot be edited
- cannot be reopened
- cannot be deleted

If a mistake must be corrected later:
- use a separate explicit correction/reversal process
- never silently rewrite the Finished record

---

## 10. Calendar Rules

Categories:

- Birthdays
- Business Trips
- Events
- Vacations

Birthdays come from User profile Birthday.

Business Trips and Vacations are informational only.

No approval workflow is required.

All users may view Calendar.

Only Admin may modify Calendar entries.

---

## 11. User and Permission Rules

Admin has full access.

Non-admin capabilities are controlled by explicit per-user permissions.

Permission checks must be enforced by trusted backend authorization.

`Manage user permissions` is permanently Admin-only.

A non-admin user can never:

- grant permissions
- revoke permissions
- modify another user's access
- elevate their own access

Every permission change creates an audit event.

The Users module is completely Admin-only. Non-admin users must not see or access the Users page or any read-only user directory.

Inactive users cannot perform new AlfaEV actions, including when an older Supabase session or token still exists.

Deactivation preserves the Supabase Auth user, UserProfile, business history, and historical references; it does not delete the account records.

An Admin cannot deactivate their own account.

At least one active Admin must remain; deactivation of the last active Admin is forbidden.

Reactivation is an explicit Admin action and creates an immutable audit event.

Admin status and Active/Inactive account status are separate concepts; changing `is_admin` does not change `is_active`.

An inactive user may be promoted or demoted, but remains unable to use AlfaEV until explicitly reactivated through the separate account-state workflow.

An Admin cannot change their own Admin status.

At least one active Admin must remain; demotion of the last active Admin is forbidden.

Existing explicit UserPermission rows are preserved across promotion and demotion. Admin bypass applies while the user is an Admin, and the preserved permissions become effective again after demotion.

Every meaningful Admin-status promotion or demotion creates an immutable audit event.

Historical audit records continue to display the original actor after deactivation or reactivation.

---

## 12. Audit Rules

Audit records are immutable.

No user, including normal operational users, may edit/delete audit history through application workflows.

Each meaningful event should record:

- actor
- action type
- entity/module
- record identifier
- timestamp
- before/after values where relevant
- source/context where relevant

Examples:

- product created/edited/archived
- Inventory adjusted
- Work Order finished
- PCB production completed
- Project status changed
- Nabavka status changed
- Supplier edited
- Calendar edited
- user activated/deactivated
- permission changed

Do not generate audit noise for pure UI interactions.

---

## 13. Deletion / Archive Rules

General rule:

If a record has business history or is referenced by another record, preserve it through archive/deactivate/cancel instead of hard deletion.

Hard deletion is reserved for unused records/drafts where preserving history is unnecessary.

Specific rules:

### Products/components
If used/referenced:
- archive/deactivate
- do not hard-delete

### Suppliers
AlfaEV does not hard-delete Suppliers through normal application workflows, regardless of whether they are currently referenced.

- archive/deactivate is the normal removal workflow
- preserve existing historical references
- do not provide Supplier reactivation/unarchive in the current scope

### Projects
If linked history exists:
- archive/cancel rather than hard-delete

### PCB definitions
If production history exists:
- archive rather than hard-delete

### Work Orders
Draft:
- may be deleted

Finished:
- never delete

### Nabavka
Resolved items remain historical records.
Do not require Inventory side effects.

### Users
Users with history:
- deactivate rather than delete

### Audit records
- never edit
- never delete
