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
- ProcurementRequest
- PcbCard
- PcbBomVersion
- PcbBomItem
- PcbProductionRun
- WorkOrder
- WorkOrderItem
- WorkOrderPdf
- CalendarEntry
- AuditLog

Supporting sequence/counter concepts:

- Product Serial Number sequence
- yearly Work Order Number counter

Derived/read-model concepts:

- Project Material Usage
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
- Do not hard-delete a Brand once referenced by Products.
- Archived Brands remain available for historical records but cannot be selected for new Products.

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
  - unique
  - exactly 7 digits
  - system-generated
- `name`
- `category`
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
- Users never manually assign the Serial Number.
- Serial Number starts at `0000001`, increments sequentially, and is never reused.
- Barcode encodes `serial_number`.
- Catalog Number does not belong on Product.
- Products with business history are archived/deactivated rather than hard-deleted.

### Serial Number allocation

Conceptual requirement:

- use trusted backend/database sequence allocation
- return a zero-padded 7-digit string
- allocation is concurrency-safe
- issued values are never recycled

The physical implementation may use a database sequence rather than a normal application table.

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

- Referenced Suppliers are archived/deactivated rather than hard-deleted.
- One Supplier can supply many Products.

---

## 6.2 ProductSupplier

Many-to-many relationship between Product and Supplier.

Fields:

- `id`
- `product_id`
- `supplier_id`
- `catalog_number`
  - supplier-specific
  - not unique
- `is_active`
- `created_at`
- `created_by_user_id`
- `updated_at`
- `updated_by_user_id`

Recommended constraint:

- unique `(product_id, supplier_id, catalog_number)` only to prevent accidental duplicate copies of the exact same relation
- do NOT make `catalog_number` globally unique

Rules:

- One Product may have multiple Suppliers.
- The same Product may have a different Catalog Number for each Supplier.
- Different Products may share the same Catalog Number.
- Catalog Number must never be used as the Product identity.

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

Allowed manual adjustment subtypes should be captured in movement metadata/type:

- Add
- Remove
- Correction

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
- Manual Admin adjustments require a reason.

---

# 8. Projects

## 8.1 Project

Fields:

- `id`
- `name`
- `customer_name`
- `status`
  - `planned`
  - `in_progress`
  - `on_hold`
  - `completed`
  - `cancelled`
- `start_date`
- `delivery_date`
- `created_at`
- `created_by_user_id`
- `updated_at`
- `updated_by_user_id`
- `completed_at`
  - nullable
- `cancelled_at`
  - nullable

Rules:

- Completed Projects are read-only for normal business fields.
- Admin may reopen a Completed Project by explicitly changing it to `in_progress`.
- Reopening is audited.
- Projects with linked history are not hard-deleted.
- Customer is currently stored directly on Project because no separate Customer module/entity is in the locked scope.

---

## 8.2 Project Material Usage — derived

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
- `requested_name`
  - required snapshot/display name
- `supplier_id`
- `requested_quantity`
- `delivered_quantity`
  - default 0
- `status`
  - `active`
  - `partly_delivered`
  - `resolved`
- `created_at`
- `created_by_user_id`
- `updated_at`
- `updated_by_user_id`
- `resolved_at`
  - nullable
- `resolved_by_user_id`
  - nullable

Derived field:

- `remaining_quantity = max(requested_quantity - delivered_quantity, 0)`

Rules:

### Existing Product request
- `product_id` is set
- Serial Number and current Product name are available from Product
- `requested_name` may retain the request-time display snapshot

### Brand-new Product request
- `product_id` starts as null
- `requested_name`, Supplier and Quantity are provided
- request is clearly marked as not yet linked to a Product
- Admin may execute `Create component from request`

### Create component from request
Trusted workflow:

1. verify request has no linked Product
2. create Product
3. allocate next 7-digit Serial Number
4. collect any missing Product fields required by Inventory, such as Category/Brand if applicable
5. create ProductSupplier relation for the selected Supplier when appropriate
6. link ProcurementRequest.product_id to the new Product
7. create AuditLog entries
8. commit atomically

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
- `output_product_id`
  - unique reference to Product
  - Product.product_kind must be `pcb_finished_good`
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

- Every PCB card has exactly one stock-tracked output Product.
- That Product receives an AlfaEV Serial Number / Šifra and barcode like other stock items.
- If production history exists, the PCB card is archived rather than hard-deleted.

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

- component_product_id must reference a stock-tracked Product.
- A PCB card must not directly consume itself.
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
- Selecting Project automatically sets/refreshes the customer snapshot while Draft.
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
10. create permanent PDF
11. create AuditLog
12. commit atomically

No Inventory mutation occurs before Finish.

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

# 12. Calendar

## 12.1 CalendarEntry

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

## 12.2 Birthday calendar entries — derived

Do not duplicate birthdays into CalendarEntry.

Birthday items are derived from:

`UserProfile.birthday`

Calendar filtering combines:

- derived Birthday entries
- CalendarEntry Business Trips
- CalendarEntry Events
- CalendarEntry Vacations

---

# 13. Audit / Archive

## 13.1 AuditLog

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

AuditLog does not replace InventoryMovement.

Example:
- InventoryMovement stores the exact stock ledger transaction.
- AuditLog stores the human/business action and actor context.

---

# 14. Derived Read Models

These should normally be implemented as queries/views/selectors rather than writable tables.

## 14.1 Nabavka Sidebar Badge

Count ProcurementRequest rows with:

- `active`
- `partly_delivered`

Exclude:

- `resolved`

---

## 14.2 Project Material Usage

Derived from physical completed consumption:

- Work Order InventoryMovement rows for Finished Work Orders linked to Project
- PCB production input InventoryMovement rows when production run is linked to Project

Do not count Draft activity.

Do not expand a finished PCB item consumed by a Work Order back into BOM raw components when those raw components were already recorded through Project-linked PCB production.

---

## 14.3 Calendar feed

Union of:

- UserProfile birthdays
- CalendarEntry rows

Filtered by selected category set.

---

## 14.4 Dashboard

Dashboard is a permission-aware read model.

Rules:

- Admin can query all relevant modules.
- Non-admin widgets must be limited to modules the user has permission to view.
- Global company information such as Calendar may be shown to all authenticated users.
- Dashboard itself must not become an authorization bypass.

---

# 15. Relationship Summary

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
```

---

# 16. Immutability Matrix

| Entity / Record | Mutable? | Locked behavior |
|---|---|---|
| UserProfile | Yes, Admin-controlled | Deactivate rather than delete when historical |
| UserPermission | Yes, Admin-controlled | Every change audited |
| Brand | Yes until archived | Referenced brand not hard-deleted |
| Product | Yes until archived | Serial Number never changes/reuses |
| ProductSupplier | Yes | History/audit required for meaningful changes |
| InventoryBalance | Transactionally mutable | Never directly mutated without movement |
| InventoryMovement | No | Immutable ledger |
| Project | Yes until Completed | Completed read-only; Admin may reopen |
| ProcurementRequest | Yes | Resolved stays historical |
| PcbCard | Yes subject to history | Archive if production history exists |
| Used PcbBomVersion | No | Immutable |
| PcbBomItem on used version | No | Immutable |
| PcbProductionRun | No after completion | Historical production record |
| Draft WorkOrder | Yes | May be deleted |
| Finished WorkOrder | No | Never reopen/edit/delete |
| WorkOrderPdf | No | Permanent document |
| CalendarEntry | Yes, Admin-only | Audit meaningful edits |
| AuditLog | No | Never edit/delete |

---

# 17. Critical Transaction Boundaries

The physical implementation must provide trusted atomic operations for at least:

## Inventory manual adjustment
- permission/Admin check
- quantity validation
- InventoryBalance update
- InventoryMovement insert
- AuditLog insert

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
- all-stock sufficiency validation
- InventoryBalance deductions
- InventoryMovement inserts
- WorkOrder Finished transition
- PDF generation/finalization strategy
- AuditLog insert

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

# 18. Data Not Added to Current Scope

Do not add entities solely because they are common in ERP software.

The locked scope currently does not require dedicated entities for:

- Customers
- Warehouses/multiple storage locations
- Purchase Orders
- Invoices
- Quality Control
- Production planning outside PCB production/Work Orders
- Documents other than generated Work Order PDFs
- Reports as a standalone module
- employee vacation approvals
- global state workflows

If future Alfa Proteh requirements introduce these concepts, extend the model deliberately rather than pre-building them now.

---

# 19. Definition of Done for the Data Model

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
- Project material usage is derived without raw-material double counting
- Calendar birthdays are derived from UserProfile
- non-admin permissions are data-driven
- Users module remains Admin-only
- AuditLog is immutable
- Dashboard can be built as a permission-aware read model
