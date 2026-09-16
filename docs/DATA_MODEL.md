# AlfaEV — DATA_MODEL.md

Status: Canonical logical data model v1  
Purpose: Define the relational entities, relationships, invariants, and historical-data rules required by the locked AlfaEV feature scope.  
Rule: This document defines the logical model. Physical database syntax, indexes, RLS policies, RPCs/functions, and migrations are specified later after the production tech stack is locked.

---

# 1. Modeling Principles

1. Use stable internal IDs for relational references.
2. Human-facing identifiers such as Product Serial Number / Šifra and Radni Nalog Number are separate from internal database IDs.
3. Never use Catalog Number as a unique key.
4. Important historical records must remain traceable after related records are archived/deactivated.
5. Critical stock mutations must be transactional and must never create negative Inventory.
6. Inventory has both:
   - a current balance for fast reads
   - an immutable movement ledger for traceability
7. Audit Log is separate from domain ledgers such as Inventory Movements.
8. Derived information should not be duplicated when it can be computed safely from canonical records.
9. Finished Work Orders and historical PCB BOM versions are immutable.
10. Hard deletion is allowed only where the locked deletion rules explicitly permit it.

---

# 2. Core Entity Overview

Primary entities:

- UserProfile
- PermissionDefinition
- UserPermission
- Brand
- Product
- Supplier
- ProductSupplier
- InventoryBalance
- InventoryMovement
- Project
- ProjectProduct
- ProjectProductComponent
- ProcurementRequest
- PcbCard
- PcbBomVersion
- PcbBomItem
- PcbProductionRun
- WorkOrder
- WorkOrderItem
- WorkOrderPdf
- DocumentationRecord
- FixedAsset
- CalendarEntry
- AuditLog

Supporting sequence/counter concepts:

- Product Serial Number sequence
- yearly Work Order Number counter

Derived/read-model concepts:

- Project Material Usage
- Project Inventory Commitment / Availability
- Nabavka Sidebar Badge Count
- Calendar Birthday Entries
- Dashboard widgets

---

# 3. Users and Authentication

## 3.1 UserProfile

Represents the AlfaEV application profile for one authenticated person.

Fields:

- `id`
  - stable internal ID
- `auth_user_id`
  - identifier from the selected authentication provider/backend
  - unique
- `full_name`
- `email`
  - unique within AlfaEV
- `birthday`
  - date
  - used to generate Birthday entries in Calendar
- `is_admin`
  - boolean
- `is_active`
  - boolean
- `created_at`
- `created_by_user_id`
  - nullable only for the initial/bootstrap Admin if required
- `last_login_at`
  - nullable until first successful login
- `deactivated_at`
  - nullable current-state metadata
  - set when the profile is deactivated
  - cleared when the profile is reactivated
- `deactivated_by_user_id`
  - nullable current-state metadata
  - set to the acting Admin when the profile is deactivated
  - cleared when the profile is reactivated

Rules:

- Admin accounts bypass delegable per-user permissions.
- `is_admin` and `is_active` are independent state dimensions; promotion/demotion does not activate/deactivate an account.
- UserPermission rows may remain stored for Admin users.
- Admin bypass ignores stored UserPermission rows while the profile is Admin.
- Preserved UserPermission rows become effective again if the profile is later demoted.
- Inactive users cannot authenticate/use AlfaEV.
- The Supabase Auth user is preserved when a UserProfile is deactivated; it is not deleted.
- `deactivated_at` and `deactivated_by_user_id` describe only the current deactivated state.
- Historical deactivate/reactivate events are preserved permanently in immutable AuditLog records.
- Users with history are deactivated, not hard-deleted.
- Historical Audit records continue to reference the UserProfile.

---

## 3.2 PermissionDefinition

Canonical catalog of delegable non-admin permissions.

Fields:

- `id`
- `key`
  - unique machine-readable permission key
- `module`
- `label`
- `description`
- `is_delegable`
  - boolean
- `created_at`

Examples of delegable permission keys:

### Dashboard
- `dashboard.view`

### Projects
- `projects.view`
- `projects.create`
- `projects.edit`
- `projects.archive`

### Nabavka
- `procurement.view`
- `procurement.create`
- `procurement.edit`
- `procurement.change_status`
- `procurement.resolve`

### Suppliers
- `suppliers.view`
- `suppliers.create`
- `suppliers.edit`
- `suppliers.archive`

### Inventory
- `inventory.view`
- `inventory.products.create`
- `inventory.products.edit`
- `inventory.brands.manage`
- `inventory.barcodes.generate`

### PCB Cards
- `pcb.view`
- `pcb.create`
- `pcb.edit`
- `pcb.produce`
- `pcb.archive`

### Work Orders
- `work_orders.view`
- `work_orders.create`
- `work_orders.edit_draft`
- `work_orders.finish`
- `work_orders.delete_draft`

### Archive
- `archive.view`

Not delegable:

- user account administration
- permission management
- changing Admin status
- manual Inventory quantity adjustment
- Calendar modification
- Documentation administration and private PDF access
- Fixed Asset administration

These remain Admin-only and should not be grantable through UserPermission.

---

## 3.3 UserPermission

Join entity granting one delegable permission to one non-admin user.

Fields:

- `user_id`
- `permission_definition_id`
- `granted_at`
- `granted_by_user_id`

Constraints:

- unique `(user_id, permission_definition_id)`
- Admin users do not require rows here
- non-delegable permissions cannot be inserted

Every grant/revoke operation must also create an AuditLog entry.

---

# 4. Brands

## 4.1 Brand

Represents a product/component brand/manufacturer label used by AlfaEV Inventory.

Fields:

- `id`
- `name`
  - required
  - trimmed before persistence
  - nonblank
  - case-insensitively unique
- `is_active`
- `created_at`
- `created_by_user_id`
- `updated_at`
- `updated_by_user_id`
- `archived_at`
  - nullable
- `archived_by_user_id`
  - nullable

Rules:

- Brand management belongs to the Inventory/product domain.
- Brand name comparisons for uniqueness are case-insensitive; capitalization variants do not represent separate Brands.
- Do not hard-delete Brand records through normal application workflows, regardless of whether they are currently referenced by Products.
- Archive/deactivate is the only normal removal workflow, preserving all historical references.
- Archived Brands are immutable through normal Brand editing.
- Archived Brands remain available for historical records but cannot be selected for new Products.
- Brand reactivation/unarchive is not supported in the current scope.
- Meaningful create/edit/archive changes are permanently recorded in AuditLog; no-op edits create no audit event.

No separate main-navigation page is required; brand management can live inside Inventory/product administration.

---

# 5. Products / Components

## 5.1 Product

Represents any stock-tracked item in AlfaEV.

This includes:

- purchased components/materials
- finished PCB card products created by PCB production

Fields:

- `id`
  - stable internal ID
- `serial_number`
  - AlfaEV Serial Number / Šifra
  - required
  - unique
  - exactly 7 digits
  - system-generated
- `name`
  - required
  - trimmed before persistence
  - nonblank
  - not unique
- `category`
  - required
  - trimmed before persistence
  - nonblank
  - not unique
  - free text in the current scope
- `brand_id`
  - nullable
  - references Brand
- `product_kind`
  - allowed values:
    - `component`
    - `pcb_finished_good`
- `is_active`
- `created_at`
- `created_by_user_id`
- `updated_at`
- `updated_by_user_id`
- `archived_at`
  - nullable
- `archived_by_user_id`
  - nullable

Rules:

- Serial Number / Šifra is the unique business identifier.
- Product Name, Category, Brand, and Catalog Number do not define Product identity.
- Users never manually assign the Serial Number.
- Serial Number starts at `0000001`, increments sequentially, and is never reused.
- Barcode encodes `serial_number`.
- Catalog Number does not belong on Product.
- Product kind is immutable after creation.
- Normal Inventory Product creation uses `component`.
- `pcb_finished_good` is reserved for later trusted PCB workflows and must not be exposed as a normal user-selectable Product kind.
- Historical Products may continue to reference archived Brands.
- New Product creation and Product Brand changes may use only active Brands; later trusted Product create/edit operations enforce this rule.
- Products are archived/deactivated rather than hard-deleted through normal application workflows.
- Archived Products remain readable where historical records require them and are immutable through normal Product editing.
- Product reactivation/unarchive is not supported in the current scope.

### Serial Number allocation

Conceptual requirement:

- use trusted backend/database sequence allocation
- return a zero-padded 7-digit string
- allocation is concurrency-safe
- issued values are never recycled

The physical implementation may use a database sequence rather than a normal application table.

The Product schema stores the required unique seven-digit Serial Number. Serial allocation is a separate trusted concern and is not performed by the Product schema migration itself.

---

# 6. Suppliers and Catalog Numbers

## 6.1 Supplier

Fields:

- `id`
- `name`
- `country`
- `contact_person_name`
- `contact_phone`
- `contact_email`
- `is_active`
- `created_at`
- `created_by_user_id`
- `updated_at`
- `updated_by_user_id`
- `archived_at`
  - nullable
- `archived_by_user_id`
  - nullable

Rules:

- `name` is required, trimmed before persistence, nonblank, and case-insensitively unique.
- Normalized Supplier name defines Supplier identity; capitalization variants such as `Bosch`, `bosch`, and `BOSCH` cannot create separate Supplier records.
- Country and contact details do not define Supplier identity.
- `country` is required, trimmed before persistence, and nonblank.
- `contact_person_name` is optional, trimmed when provided, and stored as `NULL` when blank.
- `contact_phone` is optional, trimmed when provided, and stored as `NULL` when blank. The database boundary does not enforce aggressive phone formatting.
- `contact_email` is optional, trimmed and lowercased when provided, stored as `NULL` when blank, and subject to basic email validation. It is not unique.
- Suppliers are never hard-deleted through normal application workflows; archive/deactivate is the normal removal path.
- Archived Suppliers remain readable for historical records and are immutable through normal Supplier editing.
- Archived Suppliers cannot be selected for new ProductSupplier links or new procurement selections.
- Supplier reactivation/unarchive is not supported in the current scope.
- Existing historical references remain intact after archive.
- One Supplier can supply many Products.
- Meaningful Supplier create/edit/archive changes create immutable AuditLog history; normalized no-op edits create no audit event.

---

## 6.2 ProductSupplier

Many-to-many relationship between Product and Supplier.

Fields:

- `id`
- `product_id`
- `supplier_id`
- `catalog_number`
  - nullable
  - supplier-specific
  - trimmed when provided
  - blank stored as `NULL`
  - entered casing preserved
  - not globally unique
- `is_active`
- `created_at`
- `created_by_user_id`
- `updated_at`
- `updated_by_user_id`
- `archived_at`
  - nullable
- `archived_by_user_id`
  - nullable

Required duplicate-prevention constraint:

- unique `(product_id, supplier_id, catalog_number)` only to prevent accidental duplicate copies of the exact same relation
- uniqueness must treat two `NULL` Catalog Numbers for the same Product and Supplier as duplicates
- do NOT make `catalog_number` globally unique

Rules:

- One Product may have multiple Suppliers.
- The same Product and Supplier may have multiple relationships when their Catalog Numbers differ.
- Different Products may share the same Catalog Number.
- Catalog Number must never be used as the Product identity.
- A new ProductSupplier relationship starts active.
- Creating a new relationship requires both the referenced Product and Supplier to exist and be active.
- Existing relationships remain historically valid if the Product or Supplier is archived later; Product or Supplier archive must not delete or cascade ProductSupplier history.
- ProductSupplier relationships are archived/deactivated rather than hard-deleted through normal application workflows.
- Archived ProductSupplier relationships remain readable for authorized historical use and are immutable.
- ProductSupplier reactivation/unarchive is not supported in the current scope.
- Meaningful add/edit/archive changes create immutable AuditLog history; normalized no-op changes do not create audit noise.
- ProductSupplier reads require an active Admin, `inventory.view`, or `suppliers.view`; either view permission is sufficient and both are not required.
- Trusted Product-side ProductSupplier reads may include only the related Supplier ID, Supplier Name, and Supplier active/archive state needed to display the relationship; they do not expose general Supplier contact/details.
- A trusted ProductSupplier Supplier-choice lookup may return only active Supplier IDs and Names and requires an active Admin, `inventory.products.edit`, or `suppliers.edit`.
- General Supplier-table reads remain restricted to an active Admin or `suppliers.view`; the narrow ProductSupplier read boundary does not broaden Supplier RLS.
- Trusted Supplier-side ProductSupplier reads may include only the related Product ID, Serial Number, Name, and Product active/archive state needed to display the relationship; they do not expose Product Category, Brand, lifecycle timestamps/actors, or other Product details.
- A trusted ProductSupplier Product-choice lookup may return only active Product IDs, Serial Numbers, and Names and requires an active Admin, `inventory.products.edit`, or `suppliers.edit`.
- General Product-table reads remain restricted to an active Admin or `inventory.view`; the narrow ProductSupplier read boundary does not broaden Product RLS.
- Add/edit/archive uses one trusted backend authority and requires an active Admin, `inventory.products.edit`, or `suppliers.edit`, regardless of whether the operation originates from Product detail or Supplier detail.
- No separate ProductSupplier permission key exists.

---

# 7. Inventory

## 7.1 InventoryBalance

Stores the current quantity for fast reads.

Fields:

- `product_id`
  - primary/unique reference to Product
- `quantity`
  - whole-number current stock
  - must be >= 0
- `updated_at`

Current scope assumes stock quantities are whole-number pieces, matching the locked workflows.

Rules:

- Never update InventoryBalance directly from arbitrary frontend code.
- Every balance change must occur through a trusted Inventory mutation that also creates InventoryMovement.
- Current quantity may never become negative.

---

## 7.2 InventoryMovement

Immutable stock ledger.

Fields:

- `id`
- `product_id`
- `movement_type`
- `quantity_delta`
  - signed integer
  - positive = stock in
  - negative = stock out
- `quantity_before`
- `quantity_after`
- `reason`
  - nullable for automatically generated source events
  - required for manual adjustments
- `source_type`
  - nullable only for manual movement
  - examples:
    - `manual_adjustment`
    - `work_order`
    - `pcb_production_input`
    - `pcb_production_output`
    - `correction_reversal`
- `source_id`
  - nullable for manual adjustment
  - references the originating business record conceptually
- `project_id`
  - nullable
  - populated when the physical stock movement is directly attributable to a Project
- `actor_user_id`
- `created_at`
- `reversal_of_movement_id`
  - nullable
  - used by explicit correction/reversal workflows

Manual adjustment `movement_type` values are exactly:

- `manual_add`
- `manual_remove`
- `manual_correction`

Manual adjustment semantics:

- The target Product must exist and be active when the trusted adjustment executes.
- Archived Products retain their InventoryBalance and immutable InventoryMovement history for historical reads, but cannot receive new manual `manual_add`, `manual_remove`, or `manual_correction` movements.
- Add accepts a positive amount and records `quantity_delta = +quantity`.
- Remove accepts a positive amount and records `quantity_delta = -quantity`; `quantity_after` cannot be negative.
- Correction accepts the desired final quantity, which may be zero, and records `quantity_delta = target_quantity - quantity_before`.
- Add and Remove reject quantity zero; Correction allows target zero.
- Correction rejects a target equal to `quantity_before` as a no-op and creates no InventoryMovement or AuditLog.
- Every manual adjustment requires a reason that is trimmed and nonblank.

Rules:

- InventoryMovement is immutable.
- A stock mutation transaction must:
  1. lock/read the current balance safely
  2. validate non-negative result
  3. update InventoryBalance
  4. insert InventoryMovement
  5. insert appropriate AuditLog
  6. commit atomically
- Work Order and PCB production movements are generated automatically by those workflows.
- A meaningful manual Admin adjustment calls the central Inventory mutation primitive exactly once, creates exactly one InventoryMovement through it, and appends exactly one immutable AuditLog entry in the same transaction.
- Any failure rolls back the balance change, InventoryMovement, and AuditLog together.
- Inventory Movement history reads require an active Admin or `inventory.view` and include movements for active and archived Products, ordered newest first.
- A trusted movement-history read may join UserProfile only to return `actor_user_id` and the actor's `full_name` alongside the InventoryMovement fields required by the history UI. It must not expose actor email, birthday, Admin status, permissions, or other UserProfile fields, and it does not broaden general UserProfile RLS.
- Movement history is read-only. Task 064 adds no UPDATE, DELETE, or reversal action and does not weaken InventoryMovement immutability.

---

# 8. Projects

## 8.1 Project

Fields:

- `id`
- `name`
  - required
  - trimmed before persistence
  - nonblank
  - not unique
- `customer_name`
  - required
  - trimmed before persistence
  - nonblank
  - not unique
- `status`
  - required
  - default `planned`
  - `planned`
  - `in_progress`
  - `on_hold`
  - `completed`
  - `cancelled`
- `start_date`
  - required SQL `date`
- `delivery_date`
  - required SQL `date`
  - must be on or after `start_date`
- `created_at`
- `created_by_user_id`
- `updated_at`
- `updated_by_user_id`
- `completed_at`
  - nullable
- `cancelled_at`
  - nullable

Rules:

- The allowed Project status values are exactly `planned`, `in_progress`, `on_hold`, `completed`, and `cancelled`.
- Do not impose a rigid general status-transition graph beyond the explicitly locked lifecycle rules.
- `completed_at` is non-null only while the current status is `completed`.
- `cancelled_at` is non-null only while the current status is `cancelled`.
- All other statuses require both `completed_at` and `cancelled_at` to be `NULL`.
- Trusted operations assign lifecycle timestamps server-side; clients do not provide them.
- Normal Project editing requires an active Admin or `projects.edit` and may change only `name`, `customer_name`, `start_date`, `delivery_date`, and a normal status where allowed.
- The normal edit operation accepts only `planned`, `in_progress`, or `on_hold`; it never sets `completed` or `cancelled`.
- Only the trusted final-Work-Order Finish transaction enters `completed`, sets `completed_at`, and leaves `cancelled_at` `NULL`.
- A normal edit/status operation cannot move a Project out of `completed`.
- Completed Projects are read-only for normal business fields.
- Admin may reopen a Completed Project by explicitly changing it to `in_progress`.
- Reopening clears the current `completed_at` and is audited; immutable AuditLog entries preserve historical completion and reopen events.
- `cancelled` is the Project removal/archive lifecycle state. A separate trusted cancellation operation requires an active Admin or `projects.archive`; `projects.edit` alone is insufficient.
- Cancellation is allowed only from `planned`, `in_progress`, or `on_hold`, sets `cancelled_at` server-side, and leaves `completed_at` `NULL`. Completed Projects cannot be cancelled directly.
- Project does not use separate `is_active`, `archived_at`, or archived-by fields.
- Projects are not hard-deleted through normal application workflows, and Cancelled Projects remain historically readable.
- Cancelled Projects are immutable, cannot be normally edited or change status, and have no restore/reactivation workflow in the current scope.
- Every meaningful edit, normal status change, or cancellation appends exactly one AuditLog entry atomically. Normalized no-op edits/status submissions create no update or audit, and denied/failed operations persist neither.
- Customer is currently stored directly on Project because no separate Customer module/entity is in the locked scope.

---

## 8.2 ProjectProduct

Represents one Project-specific grouping or deliverable, such as B24, Control Unit,
or Main Cabinet. It is not automatically an Inventory Product.

Fields:

- `id`
- `project_id`
  - required reference to Project with historical preservation
- `name`
  - required
  - trimmed before persistence
  - nonblank
  - not globally unique
- `created_at`
- `created_by_user_id`
- `updated_at`
- `updated_by_user_id`

Rules:

- One Project may contain multiple Project Products.
- ProjectProduct receives no Product Serial Number and has no Product foreign key merely because it exists.
- Reads require an active Admin or `projects.view`; trusted mutations require an active Admin or `projects.edit`.
- Completed or Cancelled Projects reject normal ProjectProduct changes.
- Meaningful create/edit/removal changes are audited.

---

## 8.3 ProjectProductComponent

Represents one planned total stock requirement within a ProjectProduct.

Fields:

- `id`
- `project_product_id`
  - required reference to ProjectProduct with historical preservation
- `product_id`
  - required reference to stock-tracked Product with historical preservation
- `required_quantity`
  - required whole number greater than zero
- `created_at`
- `created_by_user_id`
- `updated_at`
- `updated_by_user_id`

Rules:

- Unique `(project_product_id, product_id)` prevents duplicate Product requirements within one ProjectProduct.
- A Product selected for a new or changed requirement must exist and be active at execution time.
- Later Product archival does not invalidate or rewrite historical requirements.
- Eligible stock-tracked kinds include `component` and `pcb_finished_good`; do not restrict requirements unnecessarily to components.
- Required Quantity is the planned total for that ProjectProduct. No separate per-unit BOM/build-quantity model exists in current scope.
- Reads require an active Admin or `projects.view`; trusted mutations require an active Admin or `projects.edit`.
- Completed or Cancelled Projects reject normal requirement changes.
- Meaningful add/edit/removal changes are audited.

---

## 8.4 Project Inventory Commitment / Availability — derived

Project planning is not a physical Inventory mutation.

Commitment is calculated per Project and Product before aggregation. For every open
Project P and Product X:

- `planned_requirement(P, X)` is the sum of `ProjectProductComponent.required_quantity` for Product X within Project P
- `actual_project_consumption(P, X)` is qualifying physical consumption of Product X attributable to Project P
- `outstanding_commitment(P, X) = max(planned_requirement(P, X) - actual_project_consumption(P, X), 0)`

Then:

- `committed_to_projects(X) = sum of outstanding_commitment(P, X)` across Projects currently in `planned`, `in_progress`, or `on_hold`
- `available_after_commitments(X) = InventoryBalance.quantity - committed_to_projects(X)`

Consumption from one Project never reduces another Project's commitment. Completed and
Cancelled Projects contribute zero. An Admin-reopened Project in `in_progress`
contributes its own still-outstanding requirements again after subtracting only its
own prior qualifying physical consumption.

Qualifying consumption for the same Project and Product includes finished Work Order
Inventory deductions and, where applicable, Project-linked PCB production input
deductions. Do not count Inventory additions/output movements, unrelated manual
Inventory adjustments, or another Project's consumption. Preserve the Project
material-usage rule that prevents double-counting raw PCB inputs and later consumption
of the resulting finished PCB Product.

Do not clamp `available_after_commitments` to zero; a negative value is a shortage
signal. Do not persist commitments as InventoryMovement rows or decrement
InventoryBalance when planning changes. Physical stock is already reduced by actual
movement records, so only the unconsumed remainder remains committed.

Pure derived commitment and availability calculations create no AuditLog entries.

---

## 8.5 Project Material Usage — derived

Do not create a manually editable Project material table.

Project material usage is derived from completed physical consumption records.

Sources:

1. Finished Work Orders linked to the Project
2. PCB production input consumption when the PCB production run is linked to the Project

Important anti-double-counting rule:

- A PCB production run linked to a Project contributes its raw BOM input consumption.
- If the resulting finished PCB goods are later issued in a Work Order, do not expand that finished PCB Work Order line back into its BOM again.
- The raw BOM consumption remains represented by the PCB production movements.
- Finished-goods issuance may be displayed separately as a finished item movement, but it must not cause the same underlying raw components to be counted twice.

For a PCB produced for general stock with no Project:
- its original BOM consumption is not retroactively assigned to a later Project
- if that PCB finished good is later consumed by a Project Work Order, the Project sees the finished PCB item as the consumed stock item

This preserves traceability without inventing raw-material attribution after the fact.

---

# 9. Nabavka / Procurement

## 9.1 ProcurementRequest

Fields:

- `id`
- `product_id`
  - nullable
  - populated when request references an existing/created Product
  - foreign key to Product with historical references preserved
- `requested_name`
  - required snapshot/display name
  - surrounding whitespace is trimmed before persistence
  - nonblank
- `supplier_id`
  - required foreign key to Supplier with historical references preserved
- `requested_quantity`
  - required whole-number pieces
  - greater than 0
- `delivered_quantity`
  - required whole-number pieces
  - default 0
  - greater than or equal to 0
  - less than or equal to `requested_quantity`
- `status`
  - `active`
  - `partly_delivered`
  - `resolved`
  - default `active`
- `created_at`
- `created_by_user_id`
- `updated_at`
- `updated_by_user_id`
- `resolved_at`
  - nullable
- `resolved_by_user_id`
  - nullable

Derived field:

- `remaining_quantity = requested_quantity - delivered_quantity`
- derived only; never persisted

Rules:

### Initial state
- every new ProcurementRequest starts with `status = 'active'`
- `delivered_quantity = 0`
- `resolved_at = NULL`
- `resolved_by_user_id = NULL`
- clients do not choose another initial lifecycle state

### Existing Product request
- `product_id` is set
- trusted creation requires the selected Product to exist and be active at execution time
- Serial Number remains available from Product
- trusted creation copies the current Product name into `requested_name`
- `requested_name` permanently retains the request-time display snapshot; later Product renames do not rewrite it
- later Product archival preserves the historical `product_id` reference and request readability

### Brand-new Product request
- `product_id` starts as null
- a worker provides the trimmed, nonblank `requested_name`, Supplier and Quantity
- request is clearly marked as not yet linked to a Product
- Admin may execute `Create component from request`

### Supplier relation
- every ProcurementRequest has one Supplier
- trusted creation requires the Supplier to exist and be active at execution time
- archived Suppliers cannot be selected for new requests
- later Supplier archival preserves the historical Supplier reference and request readability
- Procurement history is never cascade-deleted

### Delivery and resolution lifecycle
- while unresolved, `delivered_quantity = 0` corresponds to `active`
- while unresolved, `delivered_quantity > 0` corresponds to `partly_delivered`
- an unresolved `partly_delivered` row may have `delivered_quantity = requested_quantity`
- full delivery never silently resolves a request
- Task 080 accepts only request ID and desired Delivered Quantity; the backend derives Active/Partly Delivered atomically rather than trusting a client-submitted status
- Task 080 requires an active Admin or `procurement.change_status`, does not require `procurement.view`, and is not authorized by `procurement.edit` alone
- Task 080 does not change `requested_quantity`; `remaining_quantity` remains derived and unpersisted
- meaningful Task 080 updates create exactly one atomic AuditLog entry; no-op updates change no metadata and create no audit noise
- Task 080 cannot modify, resolve, reopen, delete, or reactivate a Resolved request
- `resolved` is an explicit terminal state owned by Task 082, requires an active Admin or `procurement.resolve`, and does not require full delivery
- the trusted Resolve mutation does not require `procurement.view`; `procurement.change_status`, `procurement.edit`, `procurement.create`, and `procurement.view` alone do not imply terminal-resolution authority
- resolution may transition an `active` or `partly_delivered` request to `resolved`; an already-Resolved request is rejected
- a Resolved request may have Delivered Quantity from 0 through Requested Quantity
- resolution sets `resolved_at`, `resolved_by_user_id`, `updated_at`, and `updated_by_user_id` server-side without changing Requested Quantity, Delivered Quantity, Product, requested-name snapshot, Supplier, or creation metadata
- `status = 'resolved'` if and only if both `resolved_at` and `resolved_by_user_id` are non-null
- `active` and `partly_delivered` require both resolution fields to be null
- Resolved requests remain historical/readable, are excluded from the Sidebar badge, and permit no normal modification, delivery update, second resolution, hard delete, reopen, or reactivation
- every successful resolution creates exactly one immutable AuditLog entry atomically; denied or invalid attempts create neither a mutation nor an audit event
- Procurement delivery/status operations never mutate Inventory automatically

### Create component from request
Trusted workflow:

1. require an active Admin; use no delegable permission and do not require `procurement.view` inside the mutation
2. lock the ProcurementRequest and verify it remains `active` or `partly_delivered` with `product_id = NULL`; reject resolved or already-linked requests
3. validate required trimmed, nonblank Product Name and free-text Category; Name may be prefilled from but may differ from immutable `requested_name`
4. validate an optional supplied Brand exists and is active
5. derive Supplier only from `ProcurementRequest.supplier_id` and require it still exists and is active
6. allocate the next permanent 7-digit Serial Number server-side and create exactly one active Product with `product_kind = 'component'`
7. create exactly one required active ProductSupplier relation to the request Supplier; normalize optional Catalog Number by trimming, storing blank as `NULL`, and preserving nonblank casing
8. set only `ProcurementRequest.product_id`; preserve requested name, Supplier, requested/delivered quantities, status, resolution metadata, and creation metadata
9. create immutable audit history for Product creation, ProductSupplier creation, and Procurement linking
10. commit all domain mutations and required audits atomically

The Product's request-time name snapshot remains unchanged even when the final Product Name differs. An archived request Supplier or supplied Brand cannot be used for this new Product/relationship. Competing Admin attempts on one request cannot create duplicate linked Products. Failed attempts persist no domain mutation or audit; consumed Serial sequence values are never reused.

Existing Product initialization creates one zero InventoryBalance automatically. This workflow creates no InventoryMovement and does not convert Delivered Quantity into stock; physical receipt remains a separate Admin Inventory operation.

### Status/badge behavior
Sidebar badge count is:

`COUNT(status IN ('active', 'partly_delivered'))`

Resolved requests remain historical records but do not count in the badge.

### Inventory separation
Procurement status/delivery tracking never automatically changes Inventory.

Admin updates Inventory manually when physical goods are entered into stock.

---

# 10. PCB Cards and BOMs

## 10.1 PcbCard

Represents one PCB card type/definition.

Fields:

- `id`
- `name`
  - required
  - trimmed before persistence
  - nonblank
  - not unique
  - human-facing PCB card name/code
- `output_product_id`
  - required
  - unique reference to Product
  - foreign key to Product with `ON DELETE RESTRICT`
  - referenced `Product.product_kind` must be `pcb_finished_good`
- `is_active`
  - required
  - default `true`
- `created_at`
- `created_by_user_id`
  - references UserProfile with `ON DELETE RESTRICT`
- `updated_at`
- `updated_by_user_id`
  - references UserProfile with `ON DELETE RESTRICT`
- `archived_at`
  - nullable
- `archived_by_user_id`
  - nullable
  - references UserProfile with `ON DELETE RESTRICT`

Rules:

- Every PCB card has exactly one stock-tracked output Product.
- One Product may be the output Product of at most one PcbCard.
- The output Product link is immutable after PcbCard creation and cannot be changed to another Product.
- Output-Product validation requires `pcb_finished_good` when the relationship is created, but does not require the Product to remain active forever; archiving the Product later preserves the historical PcbCard relationship.
- That Product receives an AlfaEV Serial Number / Šifra and barcode like other stock items.
- New cards start with `is_active = true`, `archived_at = NULL`, and `archived_by_user_id = NULL`.
- Active cards require both archive metadata fields to be null. Archived cards require both `archived_at` and `archived_by_user_id` to be non-null.
- Task 085 defines the lifecycle metadata and consistency constraints but adds no archive, hard-delete, or reactivation operation.
- If production history exists, the PCB card is archived rather than hard-deleted.
- Trusted creation accepts only the normalized PcbCard Name/Code. It creates a new active output Product whose Name is that same normalized value, Category is exactly the free-text value `PCB`, Brand is `NULL`, and kind is `pcb_finished_good`. The existing trusted allocator supplies its 7-digit Serial Number; the client supplies no Product fields or initial stock.
- The new Product receives exactly one zero InventoryBalance through normal Product initialization. No InventoryMovement, Supplier, ProductSupplier, or Catalog Number is created by card definition. Finished-goods stock increases only during later PCB production.
- Product, zero balance, PcbCard, and exactly one `product.created` plus one `pcb_card.created` AuditLog entry commit atomically. The card audit identifies the card ID, normalized Name, output Product ID, and generated Serial Number. Failed creation leaves no Product, balance, card, or audit; allocated Serial Numbers are not reused after rollback.

---

## 10.2 PcbBomVersion

Fields:

- `id`
- `pcb_card_id`
- `version_number`
  - sequential within one PcbCard
- `is_active`
- `created_at`
- `created_by_user_id`

Constraints:

- unique `(pcb_card_id, version_number)`
- exactly one active version per active PCB card

Rules:

- Before first production, current BOM may be edited without preserving older unused drafts if desired by implementation.
- Once a BOM version has been used in production, it is immutable.
- Editing after production creates the next version.
- Historical production always references the exact version used.

---

## 10.3 PcbBomItem

Fields:

- `id`
- `bom_version_id`
- `component_product_id`
- `quantity_per_card`

Constraints:

- `quantity_per_card > 0`
- unique `(bom_version_id, component_product_id)`

Rules:

- `component_product_id` may reference a stock-tracked Product of kind `component` or `pcb_finished_good`.
- When adding or changing a BOM item, the referenced Product must exist and be active; the PcbCard's own `output_product_id` is not eligible.
- Later Product archival does not invalidate, delete, or rewrite an existing BOM item. Historical BOM versions continue to display their referenced Product.
- BOM items for historical used versions are immutable.

---

## 10.4 PcbProductionRun

Fields:

- `id`
- `pcb_card_id`
- `bom_version_id`
- `project_id`
  - nullable
- `quantity_produced`
- `status`
  - current successful persisted state: `completed`
  - failed pre-check attempts do not need a production record unless later explicitly required
- `produced_by_user_id`
- `completed_at`

Rules:

- Project is optional.
- Production uses one immutable BOM version.
- On successful production:
  - validate all BOM inputs
  - deduct input Products
  - add `quantity_produced` to the PcbCard output Product
  - create InventoryMovement rows for every input and the output
  - create AuditLog
  - commit atomically
- If any input is insufficient, no stock or production record changes are committed.

Input consumption can be reconstructed from:

- PcbBomVersion
- PcbBomItem
- quantity_produced
- linked InventoryMovement rows

No mutable duplicate consumption table is required unless implementation later demonstrates a concrete need.

---

# 11. Work Orders / Radni Nalozi

## 11.1 WorkOrder

Fields:

- `id`
  - internal database ID
- `work_order_number`
  - human-facing
  - unique
  - format `RN-YYYY-NNNN`
- `project_id`
- `customer_name_snapshot`
  - copied automatically from Project.customer_name
- `description`
  - short text
- `status`
  - `draft`
  - `finished`
- `created_at`
- `created_by_user_id`
- `updated_at`
- `updated_by_user_id`
- `finished_at`
  - nullable
- `finished_by_user_id`
  - nullable

Rules:

- Work Order Number is allocated at creation, including Draft.
- Number never changes or gets reused.
- One Project may have one or many Work Orders; `project_id` is not unique.
- Selecting Project automatically sets/refreshes the customer snapshot while Draft.
- Draft materials integrate with the selected Project's planned component requirements.
- Allocation across multiple Draft Work Orders must not double-allocate the same planned requirement.
- Draft is editable according to permission.
- Draft does not affect Inventory.
- Finished is immutable.
- Finished Work Order cannot be reopened or deleted.

---

## 11.2 WorkOrderItem

Draft/finished materials table.

Fields:

- `id`
- `work_order_id`
- `product_id`
- `quantity`
- `added_at`
- `added_by_user_id`

Optional implementation convenience:

- preserve a product-name/serial snapshot only if required for PDF/historical display guarantees; relational Product reference plus immutable PDF may otherwise be sufficient

Constraints:

- quantity > 0
- recommended unique `(work_order_id, product_id)` so rescanning the same product updates/merges one row rather than creating duplicate lines

Barcode workflow:

- scanner yields Serial Number / Šifra
- resolve Product by unique `serial_number`
- add/locate WorkOrderItem
- user enters quantity

Rules:

- WorkOrderItem rows are editable only while parent WorkOrder is Draft.
- On Finish, rows become immutable.

---

## 11.3 Work Order finishing transaction

Trusted Finish workflow:

1. verify Work Order is Draft
2. verify actor has `work_orders.finish` or is Admin
3. validate Project and Work Order fields
4. validate all WorkOrderItem quantities
5. validate Inventory availability for every consumed Product
6. create negative InventoryMovement rows
7. update InventoryBalance rows
8. mark WorkOrder Finished
9. set finished actor/time
10. record qualifying Project/Product physical consumption so the derived read model reduces only that matching Project/Product commitment
11. check for other unfinished Work Orders belonging to the same Project
12. if none remain, set the Project to `completed`, set `completed_at`, and update actor/time metadata
13. create permanent PDF
14. create required Work Order, Inventory, and automatic Project-completion AuditLog history
15. commit atomically

No Inventory mutation occurs before Finish.

ProjectProductComponent requirements are not deducted separately. Inventory changes
only through the Work Order's physical movements. If the final unfinished Work Order
completes the Project, any unused planned commitment stops counting without changing
physical stock.

---

## 11.4 WorkOrderPdf

Represents the permanent generated document tied to a Finished Work Order.

Fields:

- `id`
- `work_order_id`
  - unique
- `storage_reference`
  - path/key/identifier determined by selected storage backend
- `generated_at`
- `generated_by_user_id`
- `document_version`
  - initial value 1
- `content_hash`
  - optional but recommended for integrity verification

Rules:

- generated only for Finished Work Order
- document remains tied to that Work Order
- normal application workflows do not overwrite/delete the historical PDF
- exact PDF visual layout is defined later in UI/document specification

---

## 11.5 Work Order corrections/reversals

Finished Work Orders themselves remain immutable.

The data model must support explicit corrections through new records/events rather than changing original rows.

At minimum:

- reversal InventoryMovement rows can reference `reversal_of_movement_id`
- correction action must include a required reason
- actor and timestamp are audited
- original Work Order and original PDF remain unchanged

The exact correction UI/workflow can be specified before that feature is implemented; the immutable historical model must not require rewriting the original Work Order.

---

# 12. Documentation

## 12.1 DocumentationRecord

Admin-only company Documentation record.

Fields:

- `id`
- `name`
  - required, trimmed, nonblank
- `category`
  - exactly `uvoz`, `izvoz`, `nabavka`, or `troskovi`
- `document_date`
  - required SQL `date`
- `amount`
  - required exact decimal/numeric monetary value
  - non-negative
- `pdf_storage_path`
  - nullable private Supabase Storage object path/reference
- `created_at`
- `created_by_user_id`
  - references UserProfile with historical preservation
- `updated_at`
- `updated_by_user_id`
  - references UserProfile with historical preservation
- `is_active`
  - required, default `true`
- `archived_at`
  - nullable
- `archived_by_user_id`
  - nullable reference to UserProfile with historical preservation

Rules:

- No currency field exists in current scope.
- PDF bytes are never stored in PostgreSQL.
- At most one optional PDF attachment belongs to a Documentation record.
- Admin-only trusted operations own create/read/edit/archive and PDF upload/read/download/replace/remove.
- Archived records remain readable to Admin, are not hard-deleted, and have no current reactivation workflow.
- Active records require null archive metadata; archived records require both archive timestamp and actor.
- Meaningful record and PDF changes are audited.

---

# 13. Fixed Assets

## 13.1 FixedAsset

Admin-only company asset record, independent from warehouse Inventory.

Fields:

- `id`
- `name`
  - required, trimmed, nonblank
- `category`
  - exactly `oprema`, `uredjaji`, or `alati`
- `purchase_date`
  - required SQL `date`
- `quantity`
  - required whole number greater than zero
- `created_at`
- `created_by_user_id`
  - references UserProfile with historical preservation
- `updated_at`
- `updated_by_user_id`
  - references UserProfile with historical preservation
- `is_active`
  - required, default `true`
- `archived_at`
  - nullable
- `archived_by_user_id`
  - nullable reference to UserProfile with historical preservation

Rules:

- FixedAsset does not reference or synchronize Product, ProcurementRequest, InventoryBalance, or InventoryMovement.
- Admin-only trusted operations own create/read/edit/archive.
- Archived records remain readable to Admin, are not hard-deleted, and have no current reactivation workflow.
- Active records require null archive metadata; archived records require both archive timestamp and actor.
- Meaningful create/edit/archive changes are audited.

---

# 14. Calendar

## 14.1 CalendarEntry

Stores Admin-managed calendar information except Birthdays.

Fields:

- `id`
- `entry_type`
  - `business_trip`
  - `event`
  - `vacation`
- `title`
- `start_date`
- `end_date`
  - may equal start_date
- `description`
  - nullable
- `related_user_id`
  - nullable
  - useful for employee-specific vacation/business-trip entries
- `created_at`
- `created_by_user_id`
- `updated_at`
- `updated_by_user_id`

Rules:

- all authenticated users may read CalendarEntry
- only Admin may create/edit/delete/archive CalendarEntry
- Business Trips and Vacations are informational only
- no approval state is required

---

## 14.2 Birthday calendar entries — derived

Do not duplicate birthdays into CalendarEntry.

Birthday items are derived from:

`UserProfile.birthday`

Calendar filtering combines:

- derived Birthday entries
- CalendarEntry Business Trips
- CalendarEntry Events
- CalendarEntry Vacations

---

# 15. Audit / Archive

## 15.1 AuditLog

Immutable system-wide business audit record.

Fields:

- `id`
- `actor_user_id`
- `action_type`
- `entity_type`
- `entity_id`
  - may be nullable only for system-level actions
- `summary`
  - human-readable short description
- `before_data`
  - structured snapshot/JSON, nullable
- `after_data`
  - structured snapshot/JSON, nullable
- `metadata`
  - structured context, nullable
  - examples:
    - source Work Order Number
    - Project ID
    - Inventory movement IDs
    - permission key
- `created_at`

Rules:

- immutable
- never edited
- never deleted through normal application workflows
- Admin always has read access
- non-admin read access requires `archive.view`
- do not log meaningless UI interactions
- record meaningful create/edit/archive/status/permission/stock/production/work-order actions
- record meaningful Documentation/PDF, Fixed Asset, Project Product, component-requirement, and automatic Project-completion actions

AuditLog does not replace InventoryMovement.

Example:
- InventoryMovement stores the exact stock ledger transaction.
- AuditLog stores the human/business action and actor context.

---

# 16. Derived Read Models

These should normally be implemented as queries/views/selectors rather than writable tables.

## 16.1 Nabavka Sidebar Badge

Count ProcurementRequest rows with:

- `active`
- `partly_delivered`

Exclude:

- `resolved`

---

## 16.2 Project Material Usage

Derived from physical completed consumption:

- Work Order InventoryMovement rows for Finished Work Orders linked to Project
- PCB production input InventoryMovement rows when production run is linked to Project

Do not count Draft activity.

Do not expand a finished PCB item consumed by a Work Order back into BOM raw components when those raw components were already recorded through Project-linked PCB production.

---

## 16.3 Project Inventory Commitment / Availability

For each Product X, expose Physical Quantity, Committed to Projects, and Available
after Commitments. First calculate `outstanding_commitment(P, X)` independently for
each open Project P by subtracting only qualifying consumption attributed to that same
Project/Product pair and clamping that individual result at zero. Then sum those
per-Project values into `committed_to_projects(X)`. Consumption from one Project never
reduces another Project's commitment. Available is not clamped and may be negative to
expose a shortage. This is a read model, not a reservation ledger or Inventory
mutation.

---

## 16.4 Calendar feed

Union of:

- UserProfile birthdays
- CalendarEntry rows

Filtered by selected category set.

---

## 16.5 Dashboard

Dashboard is a permission-aware read model.

Rules:

- Admin can query all relevant modules.
- Non-admin widgets must be limited to modules the user has permission to view.
- Global company information such as Calendar may be shown to all authenticated users.
- Dashboard itself must not become an authorization bypass.

---

# 17. Relationship Summary

```text
UserProfile
  ├─< UserPermission >─ PermissionDefinition
  ├─< AuditLog
  ├─< InventoryMovement
  ├─< ProcurementRequest
  ├─< WorkOrder
  ├─< PcbProductionRun
  └─< CalendarEntry (optional related employee)

Brand
  └─< Product

Product
  ├─1 InventoryBalance
  ├─< InventoryMovement
  ├─< ProductSupplier >─ Supplier
  ├─< WorkOrderItem
  ├─< PcbBomItem
  └─0..1 PcbCard as output_product

Project
  ├─< ProjectProduct
  │    └─< ProjectProductComponent >─ Product
  ├─< WorkOrder
  └─< PcbProductionRun

PcbCard
  ├─1 Product (finished-goods output)
  └─< PcbBomVersion
       └─< PcbBomItem >─ Product

PcbProductionRun
  ├─1 PcbCard
  ├─1 PcbBomVersion
  ├─0..1 Project
  └─< InventoryMovement

WorkOrder
  ├─1 Project
  ├─< WorkOrderItem >─ Product
  ├─0..1 WorkOrderPdf
  └─< InventoryMovement

ProcurementRequest
  ├─0..1 Product
  └─1 Supplier

DocumentationRecord
  └─0..1 private PDF Storage object reference

FixedAsset
  └─ no Inventory/Product/Procurement relationship
```

---

# 18. Immutability Matrix

| Entity / Record | Mutable? | Locked behavior |
|---|---|---|
| UserProfile | Yes, Admin-controlled | Deactivate rather than delete when historical |
| UserPermission | Yes, Admin-controlled | Every change audited |
| Brand | Yes until archived | Never hard-deleted through normal workflows; archived records are immutable and cannot be reactivated in the current scope |
| Product | Yes until archived | Serial Number never changes/reuses |
| ProductSupplier | Yes until archived | Never hard-deleted through normal workflows; archived relationships are historically readable, immutable, and cannot be reactivated in the current scope |
| InventoryBalance | Transactionally mutable | Never directly mutated without movement |
| InventoryMovement | No | Immutable ledger |
| Project | Yes subject to lifecycle | Completed is normally read-only and may be explicitly reopened only by Admin; Cancelled is the historical removal/archive state with no current restore workflow |
| ProjectProduct | Yes while Project is open | No normal changes after Project Completed/Cancelled |
| ProjectProductComponent | Yes while Project is open | Planned requirement; never a physical Inventory movement |
| ProcurementRequest | Yes until resolved | Resolved is terminal, stays historical, and has no hard-delete, reopen, or reactivation workflow |
| PcbCard | Yes subject to history | Archive if production history exists |
| Used PcbBomVersion | No | Immutable |
| PcbBomItem on used version | No | Immutable |
| PcbProductionRun | No after completion | Historical production record |
| Draft WorkOrder | Yes | May be deleted |
| Finished WorkOrder | No | Never reopen/edit/delete |
| WorkOrderPdf | No | Permanent document |
| DocumentationRecord | Yes until archived, Admin-only | Private optional PDF; no hard delete/current reactivation |
| FixedAsset | Yes until archived, Admin-only | Separate from Inventory; no hard delete/current reactivation |
| CalendarEntry | Yes, Admin-only | Audit meaningful edits |
| AuditLog | No | Never edit/delete |

---

# 19. Critical Transaction Boundaries

The physical implementation must provide trusted atomic operations for at least:

## Inventory manual adjustment
- active Admin authorization
- target Product existence and active-state re-check at execution time
- Add/Remove/Correction input and required nonblank reason validation
- exactly one call to the central Inventory mutation primitive
- exactly one InventoryBalance update and InventoryMovement insert through that primitive
- exactly one immutable AuditLog insert
- atomic rollback of balance, movement, and audit on any failure

## PCB production
- permission check
- BOM version validation
- all-stock sufficiency validation
- all input InventoryBalance deductions
- finished PCB InventoryBalance increment
- all InventoryMovement inserts
- PcbProductionRun insert
- AuditLog insert

## Work Order Finish
- permission check
- Draft-state validation
- Project relationship and planned-requirement synchronization validation
- all-stock sufficiency validation
- InventoryBalance deductions
- InventoryMovement inserts
- WorkOrder Finished transition
- reduction of outstanding commitment from actual Project-linked consumption
- check for other unfinished Work Orders on the same Project
- atomic automatic Project completion when this is the final unfinished Work Order
- release of unused remaining commitment when Project completes
- PDF generation/finalization strategy
- required Work Order, Inventory, and Project-completion AuditLog inserts

The final backend design must ensure a failure cannot leave partially updated Inventory.

If PDF byte generation cannot participate in the same database transaction, the implementation must use a safe finalize strategy so the Work Order cannot appear successfully Finished without a valid final document.

## Create Product from Nabavka
- permission/Admin check
- unique Serial Number allocation
- Product creation
- ProductSupplier creation when applicable
- ProcurementRequest link update
- AuditLog insert

## Work Order number allocation
- allocate `RN-YYYY-NNNN` safely
- never duplicate/reuse a number
- create Draft WorkOrder

---

# 20. Data Not Added to Current Scope

Do not add entities solely because they are common in ERP software.

The locked scope currently does not require dedicated entities for:

- Customers
- Warehouses/multiple storage locations
- Purchase Orders
- Invoices
- Quality Control
- broader production planning beyond the locked ProjectProduct commitment model, PCB production, and Work Orders
- multiple Documentation PDF attachments or a currency model
- Reports as a standalone module
- employee vacation approvals
- global state workflows

If future Alfa Proteh requirements introduce these concepts, extend the model deliberately rather than pre-building them now.

---

# 21. Definition of Done for the Data Model

The logical model is ready for physical implementation when:

- every locked module maps to explicit entities or derived read models
- Product Serial Number uniqueness is enforceable
- Product↔Supplier many-to-many is represented correctly
- Catalog Number is supplier-specific and non-unique
- Inventory cannot change without an immutable movement record
- Nabavka can reference both existing and proposed new components
- PCB BOM version history is preserved
- PCB production creates finished-goods stock atomically
- Work Order drafts do not affect Inventory
- Work Order Finish is atomic and immutable afterward
- one Project may own multiple Work Orders without double-allocating planned requirements
- Project planning commitments never directly mutate physical Inventory
- Inventory availability exposes Physical, Committed, and unclamped Available values
- final Work Order Finish automatically completes its Project and releases unused commitment atomically
- Project material usage is derived without raw-material double counting
- Documentation and its optional PDF remain Admin-only and private
- Fixed Assets remain Admin-only and independent from Inventory
- Calendar birthdays are derived from UserProfile
- non-admin permissions are data-driven
- Users module remains Admin-only
- AuditLog is immutable
- Dashboard can be built as a permission-aware read model
