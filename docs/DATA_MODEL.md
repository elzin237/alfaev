# AlfaEV — DATA_MODEL.md

## Current implementation checkpoint — 2026-10-29

The previously verified DEV schema is through migration 166; this local correction
does not perform a fresh remote check or change any migration/schema. Older rollout
notes below are retained historical evidence, not the current activation summary.
All five local Test/Low Stock/WO release switches are ON only for approved DEV.

`get_dashboard_alert_counts` remains authoritative for separate active WO episode
and unread Project counts. The frontend combines them losslessly for both badges;
it never counts paginated inbox rows or treats resolved history as an active issue.
No notification/event/recipient table or accounting contract changes here.

The Raw catalog subsection verifies at most five existing Dashboard candidates using
`search_inventory_products_by_warehouse(uuid,text)` with canonical Raw warehouse ID
and a bounded Product-ID filter. Omitted IDs are not Raw members; failed reads are
unavailable, never zero. Returned active membership and physical quantity replace
legacy assumptions; candidate timestamps/order remain the existing catalog snapshot.
This is not a complete recent-Raw list. Detail links carry explicit Raw context.
Stock Health, critical items, reservations and Test holds retain their own contracts.

Low Stock runtime fixtures intentionally install only 1–159 or 1–161 in newly owned
clones; subsequent WO schema must not enter those historical foundation tests.
Known unfinished scope: procurement trends, larger-than-1,000 All Inventory server
pagination and full resolved-alert/non-Admin browser acceptance. No new data model
or backend contract is invented to conceal these gaps.

## WO-08 active shortage projection (local migration 166)

`work_order_shortage_resolved_dismissals(episode_id, recipient_user_id, dismissed_at)`
is a private RLS acknowledgement keyed by episode/recipient. Existing immutable
events and recipient delivery rows remain historical. `list_dashboard_shortage_tracking`
uses existing bounded cursor arguments and returns one Work Order item per owned
episode, with `episode_id`, `episode_status` and exact latest reconciled missing
quantity. Resolved read_at is coalesced with resolved_at. `get_dashboard_alert_counts()`
returns decimal-text `active_work_order_shortages`, `unread_project_notifications`
and database `as_of`; the metrics are never added. Original Project RPCs remain.

## Work Order shortage notification delivery — WO-04 (local migration 164)

Private RLS tables `work_order_shortage_notification_deliveries` (one processing
identity per immutable WO-03 outbox intent) and `work_order_shortage_notification_recipients`
(unique intent/profile, created/read/dismissed timestamps) provide recipient-owned state.
Delivery is an AFTER INSERT outbox trigger in the originating transaction, with no
deployment-time backfill. Reads join immutable event quantities and episode identity
snapshots; they never reinterpret those quantities as current availability.
`list_dashboard_notifications(integer,timestamptz,uuid)` returns at most 20 JSON
rows with explicit `target_type`, paired cursor and `has_more`. Project rows retain
their existing fields; Work Order rows include number, Product name and exact
decimal `shortage_quantity`. Count returns decimal text. Owner-only
`mark_dashboard_notification_read(uuid)` and `dismiss_dashboard_notification(uuid)`
return authoritative timestamps and delegate Project targets to unchanged RPCs.

## Work Order material shortage history — WO-03 (local migration 163)

`work_order_material_shortage_episodes` keeps Work Order/Product IDs, number/name
snapshots, required/eligible/missing bigint quantities, revision and opened/resolved
times. The partial unique index permits one active episode per pair. Historical
identity has no restrictive Work Order/Product FK so Draft deletion remains possible.
`work_order_material_shortage_events` is immutable, unique per episode/revision and
records opened, increased, decreased, changed or resolved observations.
`work_order_material_shortage_notification_outbox` holds exactly one opening and one
resolution intent per episode, each linked to its matching event. No recipient or
delivery state exists yet. A private `(transaction_id, product_id)` queue coalesces
deferred reconciliation within each transaction. None of these tables has direct
browser access. No migration-time historical backfill occurs.

## Work Order material availability — WO-01 (local migration 162)

`get_work_order_material_availability(p_work_order_id uuid)` returns JSON:
`{work_order_id, work_order_number, status: "draft", updated_at, as_of, materials: []}`.
Each material contains `product_id`, `serial_number`, `product_name`,
`product_is_active`, `required_quantity`, `eligible_quantity`, `missing_quantity`
and `has_shortage`. All quantities are exact decimal strings; totals outside SQL
bigint fail explicitly. Empty/incomplete Drafts remain readable. Archived persisted
Product identity is retained with its active flag; stock sufficiency does not override
Finish's independent Product/lifecycle/provenance validation.

One STABLE statement snapshot and statement-time `as_of` cover header, aggregated
origins, balances, reservations and expiry. A private snapshot-safe free-capacity core
is shared with the existing VOLATILE production wrapper; production still obtains
wall-clock time after locks. No new tables, ledgers, reservations or history writes.
Errors: 42501 denied, 22023 missing ID, P0002 unknown WO, WOR02 non-Draft,
IVB01 missing structural warehouse balance. Never interpret these errors as zero stock.

## Low Stock V1 — LS-02 local read contracts (migration 160)

`get_inventory_stock_health(p_warehouse_id uuid, p_search text DEFAULT NULL,
p_health_status text DEFAULT NULL, p_active boolean DEFAULT true,
p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)` returns Product ID,
serial_number, product_name, is_active, warehouse ID/code/name, physical_quantity,
nullable minimum_quantity, health_status and nullable configuration_version.
Quantities/versions are decimal TEXT; absent settings have null version, while an
explicit clear retains its version. Limits are 1–200; offset is nonnegative;
search is at most 200 characters. Status accepts the four exact uppercase values
or null for all. Active=true is the default; false means archived-only, null both.
Membership/search reuse `search_inventory_products_by_warehouse`; stable order is
case-insensitive Product name then Product ID. Separate pages are fresh reads,
not a promise of a cross-request snapshot during concurrent edits.

`get_dashboard_stock_health(p_critical_limit integer DEFAULT 10)` returns JSON
`{as_of, warehouses: [...], critical_items: [...]}`. Each authorized warehouse has
ID/code/name, product_count and healthy_count/low_stock_count/out_of_stock_count/
not_configured_count as decimal strings. Counts are active Product/warehouse pairs,
never summed stock units. Critical rows contain Product identity, warehouse identity,
physical/minimum text, status and configuration-version text; only configured OUT
then LOW rows qualify. Limit is 1–100; ties sort by case-insensitive Product name,
warehouse ID, Product ID. One materialized projection and STABLE statement snapshot
feed both sections. Archived Products are excluded from Dashboard. No historical
trend, private creator/receipt or other Project data is returned.

Both contracts reuse one private physical-stock classifier; neither subtracts
planning demand, FG reservations or Test holds. No existing RPC is modified.
These contracts are local only and do not activate UI or deploy migration 160.

## Low Stock V1 — LS-01 local configuration foundation (migration 159)

`inventory_stock_minimums` is private advisory metadata with composite primary key
`(product_id, warehouse_id)`, restrictive Product/warehouse FKs, nullable positive
`minimum_quantity bigint`, positive `version bigint`, created/updated timestamps
and restrictive creator/updater UserProfile FKs. A warehouse-first index supports
future warehouse reads. RLS is enabled; no browser table access is granted.

`set_inventory_stock_minimum(p_product_id uuid, p_warehouse_id uuid,
p_minimum_quantity text, p_expected_version text)` accepts a positive bigint decimal
string (leading zeros normalize) or null to clear. Expected version is null only
when no row exists; otherwise it must equal the current positive version. First
write, including an explicit clear, creates version 1; every accepted later write
increments version. Clearing retains the row, creator and metadata. Version overflow
fails closed. Response: Product/warehouse IDs, nullable minimum and version as decimal
TEXT, created_at and updated_at. Conflicts use SQLSTATE ISM01; reconcile current
configuration before resubmission, never silently overwrite a concurrent edit.

Product-first locking serializes first writes and updates and rejects archived
Products after lock waits. Membership reuses the authorized warehouse listing RPC.
Only this new configuration table is written: existing catalog, Inventory, AuditLog,
Project, reservation, Test, procurement and notification data remain unchanged.
This migration is local only; health reads, filters, UI and deployment are not included.

Status: Canonical logical data model v1  
Purpose: Define the relational entities, relationships, invariants, and historical-data rules required by the locked AlfaEV feature scope.  
Rule: This document defines the logical model. Physical database syntax, indexes, RLS policies, RPCs/functions, and migrations are specified later after the production tech stack is locked.

Warehouse rollout status: migrations 136–142 are deployed to alfaev-dev (142/142);
DEV `finish-work-order` v6 is ACTIVE. The warehouse frontend is implemented locally,
and read-only browser acceptance is complete. Controlled Stage 2 mutation acceptance
is pending and non-Admin browser acceptance is incomplete. No frontend production
deployment or warehouse production database rollout has occurred; production remains
at its previously verified migration state. Finished Goods Project reservation and
fulfillment backend code is local in undeployed migrations 143–145; application
activation and reservation frontend remain pending.

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
- `projects.alerts.send`
- `projects.alerts.receive`

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

### Finished Product Calculator (`pcb_cards`)
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
  - current schema: exactly 7 digits and system-generated
  - exactly 3 or 7 digits
  - three-digit calculator values are caller-supplied text; seven-digit ordinary
    Product/import values remain system-generated
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
- Users never manually assign ordinary Product/import Serial Numbers. The approved
  Finished Product Calculator flow accepts a manual exact three-digit value through a
  trusted creation boundary.
- Ordinary seven-digit Serial Number allocation starts at `0000001` and increments
  sequentially. No three- or seven-digit value is ever reused.
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

### Excel bulk Component creation contract

The `.xlsx` template has Name, Category, and optional Brand only; it adds no Product columns or new database entity. The trusted import resolves a nonblank Brand to an existing active `Brand.id`, then creates one new active `component` Product per valid row. Duplicate-looking Name/Category/Brand values are separate Products with distinct server-allocated Serials; they are not deduplicated. The client cannot set Product ID, Serial Number, kind, actor/timestamps, or quantity. Product initialization gives each new Product three zero InventoryBalance rows, one per warehouse; import creates no InventoryMovement or Supplier/ProductSupplier record.

The whole row set is validated at execution time and persisted atomically with one immutable batch-level Product-creation AuditLog event identifying the created Product IDs and count. That event is the import's creation history; redundant per-row import audits are not required. Invalid/denied batches leave no Product, balance, or success audit, although consumed sequence values are not reused.

### Serial Number allocation

Current ordinary Product/import requirement:

- use trusted backend/database sequence allocation
- return a zero-padded 7-digit string
- allocation is concurrency-safe
- issued values are never recycled

The physical implementation may use a database sequence rather than a normal application table.

The Product schema stores a required globally unique exact three- or seven-digit Serial
Number as text. Task 001E accepts three digits only through trusted Finished Product
Calculator creation while preserving the existing seven-digit allocator for ordinary
Products/imports. Serial allocation remains a separate trusted concern.

---

# 6. Suppliers and Catalog Numbers

## 6.1 Supplier

Fields:

- `id`
- `name`
- `catalog_number`
  - required and normalized/nonblank while the Supplier is active
  - casing preserved; not globally unique and not Product identity
- `description`
  - nullable; trimmed nonblank Supplier master text
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
- Catalog Number and Description are Supplier master data, not ProductSupplier fields for live authority.
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
- deprecated `description` and `catalog_number` columns may remain temporarily for forward-compatible history, but no live application path reads or writes them as authoritative Supplier data
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

- at most one active `(product_id, supplier_id)` relationship
- Supplier `catalog_number` remains non-unique and must not define relationship identity

Rules:

- One Product may have multiple Suppliers.
- ProductSupplier expresses eligibility only: “Supplier supplies Product.”
- Different Products may share the same Catalog Number.
- Catalog Number must never be used as the Product identity.
- A new ProductSupplier relationship starts active.
- Creating a new relationship requires both the referenced Product and Supplier to exist and be active.
- Existing relationships remain historically valid if the Product or Supplier is archived later; Product or Supplier archive must not delete or cascade ProductSupplier history.
- ProductSupplier relationships are archived/deactivated rather than hard-deleted through normal application workflows.
- Archived ProductSupplier relationships remain readable for authorized historical use and are immutable.
- ProductSupplier reactivation/unarchive is not supported in the current scope.
- Meaningful add/archive changes create immutable AuditLog history; per-link metadata editing is not supported.
- ProductSupplier reads require an active Admin, `inventory.view`, or `suppliers.view`; either view permission is sufficient and both are not required.
- Trusted Product-side ProductSupplier reads may include only the related Supplier ID, Supplier Name, live Supplier Catalog Number, optional Supplier Description, and Supplier active/archive state needed to display the relationship; they do not expose Supplier contact details.
- A trusted ProductSupplier Supplier-choice lookup may return only active Supplier IDs and Names and requires an active Admin, `inventory.products.edit`, or `suppliers.edit`.
- General Supplier-table reads remain restricted to an active Admin or `suppliers.view`; the narrow ProductSupplier read boundary does not broaden Supplier RLS.
- Trusted Supplier-side ProductSupplier reads may include only the related Product ID, Serial Number, Name, and Product active/archive state needed to display the relationship; they do not expose Product Category, Brand, lifecycle timestamps/actors, or other Product details.
- A trusted ProductSupplier Product-choice lookup may return only active Product IDs, Serial Numbers, and Names and requires an active Admin, `inventory.products.edit`, or `suppliers.edit`.
- General Product-table reads remain restricted to an active Admin or `inventory.view`; the narrow ProductSupplier read boundary does not broaden Product RLS.
- Add/edit/archive uses one trusted backend authority and requires an active Admin, `inventory.products.edit`, or `suppliers.edit`, regardless of whether the operation originates from Product detail or Supplier detail.
- No separate ProductSupplier permission key exists.
- Active relationships require an active Product and active Supplier at creation. The active Supplier itself must own the normalized nonblank Catalog Number.

## 7.3 InventorySourceLot

Immutable inbound-stock provenance:

- `id`
- `product_id`
- `source_kind`: `supplier`, `legacy_unknown`, or `internal_production`
- optional `product_supplier_id` and `supplier_id` for Supplier stock
- immutable Supplier name, Supplier Catalog Number, and Supplier Description snapshots
- `received_quantity`
- trusted-decrement-only `remaining_quantity`
- optional originating InventoryMovement for non-legacy receipts
- `received_at`
- optional trusted actor for non-legacy receipts

Supplier lots require an exact active ProductSupplier/Product/Supplier relationship. The trusted receipt reads the active Supplier's nonblank Catalog Number and optional Description itself and freezes them into the lot; browser-supplied or deprecated ProductSupplier metadata is never authoritative. Legacy and internal-production lots cannot claim Supplier metadata. Existing pre-provenance positive balances are backfilled as explicit legacy lots at migration time without rewriting old InventoryMovement history.

## 7.4 InventorySourceAllocation

Immutable outbound attribution:

- `id`
- `outbound_inventory_movement_id`
- `source_lot_id`
- `product_id`
- positive `allocated_quantity`
- `created_at`

The trusted Inventory boundary consumes lots in `(received_at ASC, id ASC)` order while holding balance and lot row locks. Allocation Product must match both the outbound movement and source lot. Source-lot remaining quantities and InventoryBalance are updated atomically and reconcile at transaction end.

---

# 7. Inventory

## 7.1 InventoryBalance

Test Calculator V1 adds separate time-limited quantity holds, not another physical
balance or ledger. Its approved, unimplemented data contract is defined below under
Test Calculator V1; every actual physical mutation still follows this section.

Stores the current quantity for fast reads.

Fields:

- `product_id`
  - required reference to Product; part of the composite primary key
- `warehouse_id`
  - required reference to the canonical warehouse; part of the composite primary key
- `quantity`
  - whole-number current stock
  - must be >= 0
- `updated_at`

Current scope assumes stock quantities are whole-number pieces, matching the locked workflows.

Rules:

- Each Product has exactly three balances, one per Raw Materials, Finished Goods,
  and Customs Warehouse. `(product_id, warehouse_id)` is the balance identity.
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
- `work_order_id`
  - nullable for historical runs created before the Work Order flow
  - unique when present
  - references the originating specialized Work Order with `ON DELETE RESTRICT`
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
- `eligible_physical_stock(X) = Raw Materials quantity + Customs Warehouse quantity`
- `available_after_commitments(X) = eligible_physical_stock(X) - committed_to_projects(X)`

Finished Goods stock is excluded from Project availability in V1. Its use as direct
Work Order input remains valid physical consumption and does not reclassify it as
eligible Project stock.

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

- A PCB production run linked to a Project contributes every persisted production input
  consumption, including frozen BOM and supplemental materials.
- If the resulting finished PCB goods are later issued in a Work Order, do not expand that finished PCB Work Order line back into its BOM again.
- Frozen BOM and supplemental input consumption remain represented by the PCB
  production movements.
- Finished-goods issuance may be displayed separately as a finished item movement, but it must not cause the same underlying raw components to be counted twice.

For a PCB produced for general stock with no Project:
- its original BOM consumption is not retroactively assigned to a later Project
- if that PCB finished good is later consumed by a Project Work Order, the Project sees the finished PCB item as the consumed stock item

This preserves traceability without inventing raw-material attribution after the fact.

---

## 8.6 ProjectActivityUpdate

Immutable human-authored Project collaboration content. It is a domain record distinct
from AuditLog.

Fields:

- `id`
- `project_id`
  - required Project reference with historical preservation
- `author_user_id`
  - required retained UserProfile reference with restrictive delete behavior
- `request_id`
  - required client-generated UUID
  - unique idempotency authority
  - permanently owned by the original `author_user_id`; another actor, including an
    Admin, is denied before payload comparison
- `title`
  - required normalized plain text
  - 1–120 characters after trimming
- `description`
  - required normalized plain text
  - 1–5000 characters after trimming
  - preserves internal newlines
- `activity_kind`
  - required immutable `general` or `issue`
  - existing rows default to `general`
- `created_at`
  - server-owned timestamp

Rules:

- append-only; V1 has no edit or delete, including no Admin delete
- corrections are separate Activity updates
- inactive authors remain resolvable historically, but cannot post
- Activity read requires active Admin or `projects.view`
- posting requires active Admin or `projects.edit` and a Project currently in
  `planned`, `in_progress`, or `on_hold`
- Completed and Cancelled Projects retain readable Activity but reject posting
- deterministic newest-first index: `(project_id, created_at DESC, id DESC)`
- bounded reads use default 20, limit 1–50, and keyset `(created_at, id)`

## 8.6A ProjectIssueResolution

One immutable terminal resolution for one Issue Activity.

Fields:

- `id`
- `project_activity_id`
  - required and unique retained ProjectActivityUpdate reference
- `request_id`
  - required unique resolver-owned idempotency UUID
- `resolved_by_user_id`
  - required retained UserProfile reference
- `description`
  - required normalized plain text, 1–5000 characters
- `resolved_at`
  - required server-owned timestamp

Rules:

- the target must be an `issue`; General updates cannot be resolved
- exactly one resolution may exist for an Issue
- active Admin or `projects.edit` may resolve, including on Completed/Cancelled Projects
- Project status and original Activity/image remain unchanged
- identical same-resolver replay returns the original row; changed payload fails with
  `PIR01`, another resolver receives `42501`, and a second request fails
- direct browser table access, update, and delete are forbidden
- one optional immutable resolution attachment may be added afterward through the
  trusted resolver-owned private Storage flow

## 8.6B ProjectIssueResolutionAttachment

Optional immutable private image evidence for one Project Issue resolution.

Fields:

- `id`
- `project_issue_resolution_id`
  - required and unique; at most one image per resolution
- `storage_path`
  - required, server-generated, unique, and never exposed by Activity reads
- `mime_type`
  - exactly `image/jpeg`, `image/png`, or `image/webp`
- `byte_size`
  - 1 through 5 MiB
- `content_hash`
  - server-derived lowercase SHA-256; never exposed by Activity reads
- `alt_text`
  - optional normalized text, 1–500 characters
- `created_at`
  - server-owned timestamp

The attachment retains the exact resolution relationship and is never replaced,
updated, or deleted. Browser roles have no direct table or Storage access.

## 8.7 ProjectActivityAttachment

Optional immutable private image metadata for one Activity update.

Fields:

- `id`
- `project_activity_id`
  - required and unique; enforces at most one attachment per Activity
- `storage_path`
  - required, server-generated, and unique
- `mime_type`
  - exactly `image/jpeg`, `image/png`, or `image/webp`
- `byte_size`
  - required, positive, maximum 5 MiB
- `content_hash`
  - required trusted content identity used for validation/idempotency
- `alt_text`
  - optional normalized plain text
- `created_at`
  - server-owned timestamp

Rules:

- no attachment replacement or removal in V1
- only the Activity author may attach in V1, using the Activity's original request UUID
  and current Activity-post authority while the Project remains writable
- no SVG or animated image format
- object remains private and is read only through exact authorized signing
- authorized signed access expires after five minutes
- browser callers never choose arbitrary object paths or directly replace/delete objects
- the UI may use the Activity title when explicit alt text is absent

## 8.8 ProjectActivityAlert / Project notification event

The retained physical table stores manual Activity alerts and automatic Project-domain
notification events while preserving all historical IDs.

Fields:

- `id`
- `project_activity_id`
  - Activity target; required for `activity` and `issue_resolved`
- `notification_kind`
  - required `activity`, `issue_resolved`, or `shortage`
- `project_id`
  - required only by the Project-level `shortage` target shape
- `project_issue_resolution_id`
  - required and unique only for `issue_resolved`
- `project_shortage_event_id`, `product_id`, `shortage_event_type`, `shortage_quantity`
  - exact immutable shortage-event snapshot; required only for `shortage`
- `sent_by_user_id`
  - required retained UserProfile reference for user-originated events; NULL for
    system-owned shortage events
- `sent_at`
  - required server-owned timestamp

Rules:

- Activity content is referenced, not duplicated into this row
- no alert resend in V1
- sending requires Activity-post authority plus active Admin or
  `projects.alerts.send`
- zero eligible recipients fails the whole Activity/alert database transaction
- one manual `activity` event per Activity and one automatic `issue_resolved` event per
  resolution; strict target constraints reject mixed/dangling shapes
- one system-owned shortage notification per opening or resolution event; quantity-only
  changes do not create notifications
- the trusted unified inbox read derives shortage context only through the retained
  notification → shortage event → shortage episode → Product relationship and returns
  Product ID, Serial Number / Šifra, Product name, `opened`/`resolved`, the event's
  exact global shortage-quantity snapshot, and baseline-detection state
- shortage-only inbox fields are NULL for Activity and Issue-resolution notifications;
  no recipient identity, Inventory internals, or unrelated Product data is exposed

## 8.9 ProjectActivityAlertRecipient

Immutable send-time recipient membership plus independent per-recipient read and
dismissal state.

Fields:

- `id`
- `alert_id`
  - required ProjectActivityAlert reference
- `recipient_user_id`
  - required retained UserProfile reference
- `created_at`
  - required server-owned timestamp
- `read_at`
  - nullable server-owned timestamp
- `dismissed_at`
  - nullable server-owned timestamp
  - `NULL` means the notification remains active in that recipient's inbox
  - non-`NULL` means the notification is permanently dismissed from that recipient's
    active inbox

Rules:

- unique `(alert_id, recipient_user_id)`
- every active Admin is included automatically at send time for both manual and
  Issue-resolution notifications
- manual-alert non-admin eligibility requires active state, an explicit
  `projects.alerts.receive` assignment, and effective `dashboard.view` and
  `projects.view` access
- Issue-resolution non-admin eligibility requires active state plus effective
  `dashboard.view` and `projects.view`; send/receive alert permissions are irrelevant
- an alert sender is included in the recipient snapshot whenever that sender satisfies
  the same Admin or non-admin eligibility rules as every other recipient
- membership is frozen; later permission grants/removals do not insert/delete history
- recipient identity, alert relationship, recipient ownership, and `created_at` are
  immutable; deletion is forbidden
- current active state plus current `dashboard.view` and `projects.view` governs
  notification visibility/opening
- only notification click marks that recipient row read; panel open and unrelated
  Project navigation do not
- `read_at` and `dismissed_at` are independent one-way transitions from `NULL` to a
  server-owned timestamp; each may be set once and never rewritten or cleared, and
  both transitions require trusted authorized operations
- existing recipient rows receive `dismissed_at = NULL` without a historical rewrite
- dismissal retains the recipient row and does not delete recipient history
- inbox index: `(recipient_user_id, created_at DESC, id DESC)` where
  `dismissed_at IS NULL`
- unread inbox index: `(recipient_user_id, created_at DESC, id DESC)` where
  `read_at IS NULL AND dismissed_at IS NULL`
- bounded reads use default 20, limit 1–50, and keyset
  `(created_at, recipient_row_id)`

The Activity insert, optional alert event, recipient snapshot, and narrow AuditLog
inserts form one database transaction. `request_id` is permanently bound to the
original author. Exact Project, normalized-content, and alert-intent retries by that
author return the same Activity without new recipient fanout, AuditLog, attachment, or
history mutation. Such exact replay remains valid for completed/cancelled Projects when
the author retains current authorization. Conflicting reuse by that author fails with
`PAC01`, while another actor is denied with generic `42501` before payload comparison.
Storage upload cannot share the PostgreSQL
transaction. After the post succeeds, the trusted private image workflow uploads and
attaches the optional immutable image using the same author-bound request UUID, with
best-effort cleanup on definitive failure and idempotent reconciliation after an
indeterminate outcome. Image failure may leave the committed text Activity available
for retry.

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
  - nullable foreign key to Supplier with historical references preserved
  - `NULL` means Supplier was not selected at request time
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
- a worker provides the trimmed, nonblank `requested_name` and Quantity
- request is clearly marked as not yet linked to a Product
- Admin may execute `Create component from request`

### Supplier relation
- Procurement Request creation does not ask for or require Supplier and stores `supplier_id = NULL`
- existing historical requests may retain a non-null Supplier reference
- every non-null Supplier reference remains protected by the Supplier foreign key
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
5. derive Supplier only from `ProcurementRequest.supplier_id`; when non-null, require it still exists and is active
6. allocate the next permanent 7-digit Serial Number server-side and create exactly one active Product with `product_kind = 'component'`
7. when Supplier is non-null, require its nonblank normalized Supplier master Catalog Number and create exactly one active ProductSupplier relation without accepting Catalog/Description input; when Supplier is null, create no ProductSupplier relation
8. set only `ProcurementRequest.product_id`; preserve requested name, Supplier, requested/delivered quantities, status, resolution metadata, and creation metadata
9. create immutable audit history for Product creation, any ProductSupplier creation, and Procurement linking
10. commit all domain mutations and required audits atomically

The Product's request-time name snapshot remains unchanged even when the final Product Name differs. A request with no Supplier can still create and link its Product without inventing a Supplier relationship. An archived non-null request Supplier or supplied Brand cannot be used for this new Product/relationship. Competing Admin attempts on one request cannot create duplicate linked Products. Failed attempts persist no domain mutation or audit; consumed Serial sequence values are never reused.

Product initialization creates three zero InventoryBalance rows automatically, one per warehouse. This workflow creates no InventoryMovement and does not convert Delivered Quantity into stock; physical receipt remains a separate authorized Inventory operation.

### Status/badge behavior
Sidebar badge count is:

`COUNT(status IN ('active', 'partly_delivered'))`

Resolved requests remain historical records but do not count in the badge.

### Inventory separation
Procurement status/delivery tracking never automatically changes Inventory.

Admin updates Inventory manually when physical goods are entered into stock.

---

# 10. Finished Product Calculator and BOMs

This is the Normal Calculator at `/pcb`. The planned Product Calculator sidebar
container also links a separate Test Calculator, which creates no PcbCard/output Product.

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
- Trusted creation accepts normalized PcbCard Name/Code and a manual exact three-digit Serial Number as text, preserving leading zeroes. It creates a new active output Product whose Name is that same normalized value, Category is exactly `PCB`, Brand is `NULL`, and kind is `pcb_finished_good`. Other Product fields and initial stock are server-derived. Ordinary Product/import creation retains generated seven-digit serials.
- The new Product receives exactly three zero InventoryBalance rows, one per warehouse. No InventoryMovement, Supplier, ProductSupplier, or Catalog Number is created by card definition. Actual-good output is credited to Finished Goods only when production Finish succeeds.
- Product, three zero balances, PcbCard, and exactly one `product.created` plus one `pcb_card.created` AuditLog entry commit atomically. The card audit identifies the card ID, normalized Name, output Product ID, and supplied Serial Number. Failed creation leaves no Product, balance, card, or audit; calculator creation does not consume the ordinary Product serial allocator. Persisted serial identities remain globally unique and are never reassigned.

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
- Use is derived from a PcbProductionRun referencing the exact version; no separate used field is stored.
- Once used, `pcb_card_id`, `version_number`, `created_at`, and `created_by_user_id` cannot change, and the version cannot be deleted. The only allowed update is `is_active` from true to false, with all other fields unchanged, when superseded by a new version. False-to-true reactivation is forbidden.
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
- Once a production run references their version, BOM items cannot be inserted, updated, or deleted, including during the version's one-way deactivation.

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

- New calculator production has no Project association. Historical Project-linked production retains its traceability and remains readable and finishable; finishing PCB production never automatically completes that Project.
- Production uses one immutable BOM version.
- Work Order-driven production creates this row only on successful Finish. `quantity_produced` stores actual-good output and may be zero for new Work Order-driven runs; historical rows remain valid.
- On successful Finish:
  - validate all frozen BOM and supplemental inputs
  - deduct every persisted WorkOrderItem input, aggregating rows that share a Product
  - consume ordinary inputs in Raw Materials FIFO → Customs FIFO → unreserved Finished Goods FIFO order; Calculator-linked finished inputs use unreserved FG FIFO only, without BOM expansion (local migration 148)
  - credit `quantity_produced` actual-good output to the PcbCard output Product in Finished Goods
  - create InventoryMovement rows for every input and a positive output only when actual good is greater than zero
  - create AuditLog
  - commit atomically
- If any input is insufficient, no stock or production record changes are committed.

Input consumption can be reconstructed from:

- immutable finished WorkOrderItems and their `source_type`
- the frozen PcbBomVersion/PcbBomItems for the planned BOM portion
- linked InventoryMovement rows

No mutable duplicate consumption table is required unless implementation later demonstrates a concrete need.

## 10.5 PcbProductionWorkOrder

`pcb_production_work_orders` is a protected one-to-one context whose `work_order_id` is its primary key. It stores `pcb_card_id`, the exact `bom_version_id`, positive bigint `planned_quantity`, unique `creation_request_id`, and creation timestamp/actor. The request UUID is a durable idempotency key: replay of the same payload returns the same Work Order, while reuse for different data is rejected. The context, Work Order Project/Customer/description plan, and `pcb_bom` WorkOrderItems are immutable after creation. A Draft may additionally contain `manual` supplemental items managed only through the narrow trusted supplemental-material operation. A Draft may be deleted through the canonical trusted Work Order deletion flow, which removes context and both item origins without stock/run effects; a finished context is historical and cannot be removed.

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
  - nullable only while the initial Draft is incomplete
- `customer_name_snapshot`
  - copied automatically from Project.customer_name
  - nullable only while the initial Draft is incomplete
- `description`
  - short text
  - nullable only while the initial Draft is incomplete
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
- Trusted creation creates the numbered Draft before Project, Customer snapshot, and
  Description are entered; those three fields may temporarily be NULL on Draft only.
- Draft save/update selects Project, derives Customer from Project, and saves
  Description. A Finished Work Order requires all three fields to be non-NULL.
- A saved Draft may remain incomplete. Project NULL requires Customer snapshot NULL;
  blank Description is normalized to NULL.
- A new/replacement Project must be `planned`, `in_progress`, or `on_hold`. An
  already-selected Project may be retained after later completion/cancellation, and
  its Customer snapshot is refreshed from the trusted Project row when saved.
- Draft header updates use the authoritative `updated_at` value for optimistic
  concurrency. Normalized no-ops do not change update metadata or create audit noise.
- One Project may have one or many Work Orders; `project_id` is not unique.
- Selecting Project automatically sets/refreshes the customer snapshot while Draft.
- Draft material persistence does not reserve Inventory or allocate Project planning
  commitments; Finish owns authoritative physical-stock validation.
- Draft is editable according to permission.
- Draft does not affect Inventory.
- Draft deletion is a trusted atomic parent/child operation authorized for active
  Admin or `work_orders.delete_draft`. It locks the parent, checks the exact expected
  `updated_at`, deletes its WorkOrderItems before the parent, records one immutable
  `work_order.deleted` audit, and never reclaims the allocated Work Order Number.
- Draft deletion does not mutate Inventory, Project, Product, PCB, PDF, or Storage
  state; direct normal-client WorkOrder/WorkOrderItem deletion remains denied.
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
- `source_type`
  - `manual`
  - `pcb_bom`
- `added_at`
- `added_by_user_id`

Optional implementation convenience:

- preserve a product-name/serial snapshot only if required for PDF/historical display guarantees; relational Product reference plus immutable PDF may otherwise be sufficient

Constraints:

- quantity > 0
- unique `(work_order_id, product_id, source_type)`
  - ordinary Drafts use `manual`, so rescanning locates that one row
  - a PCB production Draft may represent the same Product once as frozen `pcb_bom` and once as supplemental `manual`

Barcode workflow:

- scanner yields Serial Number / Šifra
- a narrow trusted Draft-context read resolves an existing active Product by exact
  unique `serial_number` and returns only Product ID, Serial Number, and Name
- both `component` and `pcb_finished_good` are eligible for resolution
- resolution does not grant general Product reads and creates no WorkOrderItem,
  Inventory effect, or AuditLog entry
- a narrow trusted Draft-context read may return only the resolved active Product
  ID and its physical `InventoryBalance.quantity` for Current Inventory display
- Current Inventory is a point-in-time informational snapshot, not
  `available_after_commitments` and not a reservation; Finish re-checks stock
- add/locate WorkOrderItem
- user enters quantity

Rules:

- Ordinary `manual` WorkOrderItem rows are editable only while the parent WorkOrder is Draft.
- PCB-derived `pcb_bom` rows are immutable even while Draft and can be created only as the verified nested effect of trusted PCB-production creation. A client or generic trusted path cannot forge that origin.
- A PCB production Draft's complete `manual` supplemental set may be added, changed, or removed by Admin or `work_orders.edit_draft`; its production header and frozen rows remain unchanged.
- Save for Later submits the complete desired set atomically with the Draft header.
- Quantity is a positive whole `bigint` transported as an exact decimal string.
- Existing retained/updated rows preserve `id`, `added_at`, and
  `added_by_user_id`; only newly inserted rows receive new server-owned add metadata.
- A new Product reference must resolve at save time to an active `component` or
  `pcb_finished_good`. An existing persisted reference may remain, change Quantity,
  or be removed after later Product archival.
- Any meaningful header or material save advances the parent WorkOrder `updated_at`
  exactly once; a normalized full no-op changes no row and creates no audit.
- Persisted Draft material reads use a narrow trusted projection of Product ID,
  Serial Number, Name, persisted Quantity, authoritative origin, and physical InventoryBalance Quantity;
  normal Product and InventoryBalance RLS remains unchanged.
- Project requirements are planning/reference data, not a WorkOrderItem whitelist or
  quantity cap. A generic Draft may reference any active eligible Product and may record
  quantities above the selected Project's remaining plan.
- Persisted Draft WorkOrderItems are proposed actual-use records, not Project allocation
  rows and not Inventory reservations. The Project row remains the lifecycle/selection
  concurrency boundary; switching Projects locks old and new rows in UUID order.
- Draft persistence has no physical Inventory side effect and creates no
  InventoryMovement.
- On Finish, rows become immutable.
- PCB Finish consumes both origins. Rows sharing a Product are aggregated for exact
  physical-stock validation, deterministic locking, and one input InventoryMovement.

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
  - required and unique
  - FK to WorkOrder with `ON DELETE RESTRICT`
- `storage_reference`
  - required and unique
  - exactly `final/<work_order_id>/<object_uuid>.pdf`
- `generated_at`
  - required
- `generated_by_user_id`
  - required FK to UserProfile with `ON DELETE RESTRICT`
- `document_version`
  - required, defaults to 1, and must equal 1 in current scope
- `content_hash`
  - nullable lowercase SHA-256 hex; exactly 64 `[0-9a-f]` characters when present

Rules:

- generated only for Finished Work Order
- document remains tied to that Work Order
- referenced object must already exist in private bucket `work-order-pdfs`, have MIME
  `application/pdf`, and exactly match the final storage reference
- temporary `_tmp/<work_order_id>/<object_uuid>.pdf` paths can never be persisted as
  the permanent reference
- one canonical PDF per Work Order; metadata cannot be updated or deleted
- normal application workflows do not overwrite/delete the historical PDF or bytes
- canonical PDF layout is A4 portrait Alfa Proteh Radni Nalog. Trusted snapshot data is
  limited to Work Order Number, Project Name, Customer snapshot, Description, Work Order
  creation timestamp, and persisted material Product Serial Number, Product Name, and
  exact Quantity. Unsupported unit/price/total/report/person/completion/signature/stamp
  values remain blank rather than being inferred.

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

Do not expand a finished PCB item consumed by a Work Order back into raw components when
those frozen BOM and supplemental inputs were already recorded through Project-linked
PCB production.

---

## 16.3 Project Inventory Commitment / Availability

For Raw Materials planning, expose Raw Physical Quantity separately from Eligible
Stock (Raw + Customs), Outstanding Project Commitments, and Available after
Commitments (eligible minus commitments). First calculate `outstanding_commitment(P, X)` independently for
each open Project P by subtracting only qualifying consumption attributed to that same
Project/Product pair and clamping that individual result at zero. Then sum those
per-Project values into `committed_to_projects(X)`. Consumption from one Project never
reduces another Project's commitment. Available is not clamped and may be negative to
expose a shortage. This is a read model, not a reservation ledger or Inventory
mutation.

Finished Goods instead uses the warehouse-level trusted read
`get_finished_goods_inventory_commitments()` (local migration 148, not deployed).
It returns only Product ID and bigint Physical/Committed/Available: FG balance,
sum of positive remaining hard reservations, and their difference. Includes zero-stock
and archived Calculator outputs under the existing membership rule, with no Project
identities and no changes to private reservation tables. Production eligibility and
source plans use only unreserved FG for Calculator-linked finished inputs; ordinary
inputs retain Raw → Customs → unreserved FG FIFO. The shared plan remains authoritative
for Finish and the warehouse/source-lot PDF fingerprint. No historical DML is performed.

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
- The Project Activity alert inbox is a separate bounded read model over immutable
  send-time recipient membership. It additionally re-checks current active state and
  effective `dashboard.view` plus `projects.view` access before returning a row.
- active Admins are included in new recipient snapshots automatically; non-admin
  recipient membership requires an explicit `projects.alerts.receive` assignment.

---

# 17. Relationship Summary

```text
UserProfile
  ├─< UserPermission >─ PermissionDefinition
  ├─< AuditLog
  ├─< ProjectActivityUpdate
  ├─< ProjectActivityAlertRecipient
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
  ├─< PcbProductionRun
  └─< ProjectActivityUpdate
       ├─0..1 ProjectActivityAttachment
       └─0..1 ProjectActivityAlert
            └─< ProjectActivityAlertRecipient

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
  └─0..1 Supplier

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
| ProjectActivityUpdate | No | Human-authored append-only Project collaboration; correct with a later update |
| ProjectActivityAttachment | No | At most one private immutable image per Activity |
| ProjectActivityAlert | No | At most one send event per Activity; no resend in V1 |
| ProjectActivityAlertRecipient | Read/dismiss state only | Recipient identity, alert relationship, recipient ownership, and creation timestamp are immutable; trusted authorized operations may independently set `read_at` and `dismissed_at` once from NULL, but neither timestamp may be rewritten or cleared and deletion is forbidden |
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
- idempotent specialized Draft creation freezes the exact PCB Card, BOM version, planned quantity, description, and generated material rows without a Project association or Inventory change; historical Project-linked contexts remain preserved
- later Work Order Finish authorization and frozen-identity validation
- all-stock sufficiency validation at Finish
- all planned input InventoryBalance deductions
- actual-good Finished Goods InventoryBalance increment only when greater than zero
- corresponding nonzero InventoryMovement inserts
- one Work Order-linked PcbProductionRun insert
- Work Order/PDF finalization and required AuditLog inserts

## Work Order Finish
- permission check
- Draft-state validation
- Project relationship/lifecycle validation; requirements remain planning/reference data
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

## Project Activity post / alert send
- normalize and validate title/description
- re-check active actor, Project authority, and writable Project status under lock
- enforce one client request UUID as the original author's idempotency authority
- insert Activity
- for alert intent, re-check both post/send authority and snapshot all eligible
  recipients, including every active Admin and the sender when eligible; reject an
  empty set
- insert one optional alert event and recipient rows
- append narrow `project_activity.created` and optional
  `project_activity.alert_sent` AuditLog events
- commit all database rows together or none
- after the post commits, reconcile the separate author-bound trusted private-Storage
  attachment step without exposing service-role credentials or deleting a potentially
  committed object on an indeterminate outcome

---

# 20. Data Not Added to Current Scope

Do not add entities solely because they are common in ERP software.

The locked scope currently does not require dedicated entities for:

- Customers
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
- PCB production Draft creation changes no stock; its later Work Order Finish creates actual-good finished-goods stock atomically
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

## Project shortage episode history

`ProjectShortageEpisode` stores one current episode identity per Project/Product,
its global shortage quantity, opening time, and optional one-way resolution time. A
partial unique index permits only one unresolved episode for the pair.

`ProjectShortageEvent` is immutable and records `opened`, `increased`, `decreased`, or
`resolved`, the authoritative global quantity, server timestamp, and whether an opening
was detected by the enablement baseline. Resolved episodes/events are retained.

Shortage notifications reference the exact immutable event and snapshot Project,
Product, event type, and quantity. System notifications have no sender. Existing
Activity and Issue-resolution notification targets remain unchanged.

## Finished Goods Project reservation foundation — local Phase 3A

Migration 143 is local and undeployed. Its DDL/runtime proof is rollback-only; DEV
remains at migration 142. Operational hard reservations are NOT enabled.

Explicit demand already exists through `ProjectProductComponent.product_id` and
`required_quantity`, joined through `ProjectProduct.project_id`. Requirements may
explicitly select `pcb_finished_good`. A ProjectProduct name is not a Product link.
For a selected Calculator output Product, the private reservation algorithm uses the
existing sum of explicit requirements minus qualifying same-Project/Product physical
consumption, floored at zero. It never infers demand from names, serials, Categories,
BOMs or manufacturing history, and never reduces a component/BOM plan automatically.

- `finished_goods_project_reservations`: one retained identity per Project/Product;
  fixed Finished Goods warehouse; nonnegative exact bigint quantity; monotonic version;
  retained creation and update actors/timestamps. Zero quantity retains the identity.
- `finished_goods_project_reservation_events`: immutable reserve/release receipts with
  before/after quantities, version, original actor, request UUID and exact request
  parameters. UUID uniqueness provides one-shot replay ownership. No backfill occurs.
- Owner-only reserve/release algorithms check demand, free FG stock, current versions
  and permissions, serialize by request UUID and the FG balance row, and append one
  receipt plus AuditLog entry atomically. Exact replay returns its original result.
- Trusted Project-scoped state/history reads require Project and FG view authority;
  receipt request IDs and actor IDs are not part of the read projection.

Phase 3B MUST guard every debit/transfer/production input path, demand edit/removal,
Product lifecycle and Project cancellation/completion/reopening before granting
mutation EXECUTE. Cancellation must release reservations; completion must require
explicit resolution; reopening must not reclaim stock. These integrations are not
implemented in Phase 3A. Fulfillment is a separate Phase 3C integration below;
reservation UI remains unimplemented.

## Finished Goods hard-reservation safeguards — local Phase 3B1

Migration 144 supplements the unchanged Phase 3A foundation. It is local/undeployed;
reservation mutation APIs remain private. A balance UPDATE trigger checks every FG
physical debit against the aggregate retained reservation quantity while the stock
row is locked. Ordinary consumption can use only physical minus reserved, regardless
of which Project owns the reservation; fulfillment is a separate Phase 3C operation.

Production prechecks and source allocation exclude reserved FG quantities while
retaining Raw → Customs → Finished Goods FIFO order and the existing fingerprint/PDF
projection. Requirement/group changes and qualifying Project consumption must leave
explicit outstanding Product demand at least as large as that Project's reservation.
These are immediate safety checks; existing deferred shortage reconciliation is unchanged.

Cancellation releases outstanding reservations atomically, advances versions and
appends immutable release receipts/audits. Completion rejects unresolved reservations
with `FGR08`; reopening creates none. Archived Products remain in history, reject new
reservations and permit release under the unchanged foundation contract.

Phase 3A/3B1 local acceptance passed. No frontend or remote deployment is included,
and no mutation EXECUTE grant is enabled.

## Finished Goods fulfillment data — local migration 145

The existing reservation event table additionally accepts `fulfilled`. Its quantity
transition subtracts `requested_quantity`, like release, but only fulfillment has a
non-NULL `inventory_movement_id`. That FK is unique, retained and immutable; historical
reserve/release receipts keep NULL. No second fulfillment/demand/stock table is added.

The linked movement uses `finished_goods_reservation_fulfillment` as movement/source
type, the receipt ID as `source_id`, the exact Project/Product/FG warehouse, negative
fulfilled quantity and original actor. Existing source allocations link the movement
to FIFO lots and their frozen supplier/catalog snapshots. Deferred reciprocal triggers
verify matching identities, quantity, actor, reservation and allocation totals.

`fulfill_finished_goods_project_reservation(uuid,uuid,uuid,bigint,bigint,uuid)` takes
reservation, Project, Product, quantity, expected version and request UUID. It returns
reservation_id, project_id, product_id, reserved_quantity, reservation_version, event_id,
movement_id, physical_quantity_before and physical_quantity_after. Exact replay returns
the original immutable receipt/movement values, not later current-state quantities.
Existing trusted reservation/history read signatures remain unchanged.

Canonical commitment consumption includes this source exactly once, while physical
Project availability remains Raw plus Customs. Requirements, BOMs, historical movement
types and rows are not rewritten. Migration 145 is local, private and undeployed;
frontend/application activation remains pending.

## Finished Goods reservation read context — local migration 146

`get_project_finished_goods_reservation_context(p_project_id uuid)` is a STABLE
trusted read for active Admins or callers with both `projects.view` and
`inventory.finished_goods.view`. It returns one row per explicitly required
Calculator-linked `pcb_finished_good`, without filtering zero stock or archived
Products. Completed/cancelled Project history remains readable.

Exact projection: `product_id uuid`, `product_name text`, `serial_number text`,
`planned_requirement numeric`, `actual_project_consumption numeric`,
`outstanding_demand numeric`, `physical_quantity bigint`,
`globally_reserved_quantity bigint`, `available_quantity bigint`,
`project_reserved_quantity bigint`, `reservation_id uuid`, `reservation_version bigint`.
The numeric demand fields are exact whole-quantity aggregates, not floating point;
future frontend parsing must preserve exact integer values, including above 2^53.

Physical means only the actual Finished Goods balance. Globally reserved sums
positive retained reservations for that Product across all Projects; available is
physical minus that aggregate, without clamping or exposing foreign Project IDs,
reservation IDs or actors. Own reservation fields match only the requested Project.
An absent state returns quantity/version zero and NULL identity; an existing zero
state retains its identity/version. Existing history RPCs remain authoritative for
events even if a requirement is later removed.

One statement snapshot supplies every quantity. Private
`calculate_project_product_demand(uuid,uuid)` shares the canonical explicit planned
minus qualifying physical consumption formula with `calculate_open_project_commitments`.
Historical outstanding demand is informational for closed Projects; the unchanged
open-Project lifecycle filter still excludes them from global commitments/shortages.
No parallel ledger, new mutation path or historical rewrite is introduced.

Historical Phase 3D1 checkpoint: read model implemented locally; frontend pending, mutation activation pending,
DEV deployment pending. Migrations 136–145 are unchanged.

Phase 3D3B adds local mutation services/UI, not a new ledger. Positive bigint deltas,
versions and receipt values remain lossless decimal strings at the JSON boundary.
Historical retry receipts are never substituted for current stock. Prepared migration
147 changes only wrapper EXECUTE grants and validates existing security boundaries;
it remains unapplied. The Material Usage RPC is unchanged and does not include FG
fulfillment; detailed fulfillment-history UI is deferred.

## Warehouse-aware Inventory model and production extensions

Tasks 001B–001G implement the fixed warehouse reference, composite balance identity,
warehouse identity on movements/lots/allocations, independent permissions, scoped
reads/adjustments, atomic transfers, warehouse-aware production, and warehouse-aware
Project availability. Migrations 136–142 are deployed to DEV (142/142); the frontend
remains local, with read-only browser acceptance complete and controlled Stage 2
mutation/non-Admin acceptance still pending.

- A fixed warehouse reference identifies `raw_materials` (Raw Materials / Skladište
  repromaterijala), `finished_goods` (Finished Goods / Skladište gotovih proizvoda),
  and `customs` (Customs Warehouse / Carinsko skladište).
- `Product` remains a global master identity. Serial Number uniqueness is global and
  includes archived Products; warehouses never create separate Product identities.
- Warehouse-scoped Product detail is exposed through a trusted read that returns the
  global Product identity/lifecycle and Brand identity/lifecycle together with only the
  requested warehouse balance and its separate balance timestamp. Product `updated_at`
  is never substituted with the InventoryBalance timestamp.
- Listing membership is not balance existence. Raw Materials excludes Products linked
  by `pcb_cards.output_product_id`, including historical Calculator stock; Raw-scoped
  detail reads reject those outputs (forward migration 161). Finished Goods lists only
  Products referenced by `pcb_cards.output_product_id`, including zero-stock and
  archived outputs. Customs lists positive balances or retained committed Customs
  movement history; structural zero rows alone establish no membership. Depletion
  preserves membership; rollback creates none. No stored origin/membership flag is added.
- Calculator output-stock reads use Finished Goods only. BOM input/picker stock stays
  Raw. Apart from the linked-output Raw detail exclusion, listing does not restrict
  trusted detail, adjustments, transfers or allocation.
  Historical stock and provenance are not moved.
- `InventoryBalance` becomes one row per `(product_id, warehouse_id)`.
  `InventoryMovement` and `InventorySourceLot` carry a non-null warehouse identity;
  before/after quantities and FIFO consumption are evaluated inside that warehouse.
- Existing balances, movements, and lots are backfilled to Raw Materials without
  duplicating quantity or rewriting immutable identifiers/history. Finished Goods and
  Customs begin at zero for that history; old PCB output is not reclassified.
- `InventoryWarehouseTransfer` immutably binds one source movement to one destination
  movement for the same Product and requested transfer, preserving actor/reason and
  source-lot provenance without permitting direct browser writes.
- Inventory Add source choices use a warehouse-authorized trusted read and expose only
  active Supplier/ProductSupplier choices required by the adjustment flow; protected
  Supplier and ProductSupplier tables receive no broader browser grant.
- Warehouse-aware allocation and its fingerprint include warehouse plus source-lot
  identity. Mixed-source input and actual-good Finished Goods output commit atomically
  with Work Order/PDF/audit history, and retries cannot duplicate deductions or output.
- Project availability and shared shortage use the sum of Raw Materials and Customs
  balances. Finished Goods remains excluded from Project availability even though it
  can be consumed by warehouse-aware production.
- Eligible-warehouse transfers are shortage-neutral; transfers across the eligible /
  Finished Goods boundary may change shortage after deferred final-state reconciliation.
- Migration 140 replaces calculation/read/reconciliation definitions only. Existing
  shortage episodes, immutable events, notification snapshots, and read/dismiss state
  are not rewritten or re-baselined.
- Migration 142 (deployed to DEV) adds an InventoryMovement INSERT trigger
  for negative Project-linked `work_order`/`pcb_production_input` consumption in any
  warehouse. It uses the existing unique transaction/Product queue and deferred
  final-state reconciler. Finished Goods consumption reduces matching Project demand
  but Finished Goods balances remain excluded from eligible physical stock. No
  historical backfill or reservation data model is introduced.
- Product Serial Number accepts exact three- or seven-digit text. New Finished Product
  Calculator outputs use a caller-supplied three-digit value; ordinary Product/import
  creation keeps generated seven-digit values. Leading zeroes are data.
- Finished Product Calculator Name/Code has a trimmed, case-insensitive uniqueness
  constraint covering active and archived calculator definitions. This does not make
  ordinary component names globally unique.
- The existing PCB/BOM tables and identifiers remain canonical under the user-visible
  Finished Product Calculator name. New calculator production stores no Project link;
  historical Project-linked production remains readable and finishable.

### Task 001L requirement-operation receipts (local migration 149)

`project_requirement_mutation_receipts` retains request UUID, original actor,
Project, FG-affecting flag, canonical immutable payload, original JSON result and
creation timestamp. It intentionally retains the deleted requirement UUID as receipt
data rather than a restrictive FK to a removable requirement. RLS is enabled and no
application/service table privileges are granted. UPDATE/DELETE is forbidden.
Existing reservation state/version/events remain the only hard-reservation ledger.
No parallel stock balance or fulfillment counter is introduced. Zero allocation also
has a receipt, so retry after later stock arrival cannot allocate new quantities.

## Test Calculator V1 — conceptual contract (approved, not implemented)

No table, migration, RPC or permission is created by this specification. Test data
must be separate from PcbCard, BOM, WorkOrder, Project requirements and physical Inventory.
The names below describe concepts, not frozen SQL names or additional stock ledgers.

### Test Calculation and items

- Calculation: UUID identity, trimmed nonblank name, creator UserProfile, server
  creation timestamp, original deadline date, timezone `Europe/Sarajevo`, and fixed
  exclusive `expires_at timestamptz` derived from the next local midnight.
- Items: parent identity, authoritative Product identity, historical name/serial/kind
  snapshots, positive required quantity, reserved-at-save quantity and missing-at-save
  quantity. Each Product occurs once; quantities are exact whole numbers, not JS floats.
- A saved calculation and its items are immutable and retained after expiry. Required
  is the entered total quantity, not an implicit production multiplier/BOM expansion.
  Historical Product archival must not delete or hide the saved entry.

### Warehouse holds and Save receipt

- Warehouse-specific holds link calculation/item/Product to a canonical warehouse
  and nonnegative reserved quantity. Sum of holds equals the item's reserved-at-save
  quantity, which is at most required; missing-at-save equals required minus reserved.
  Zero allocation still retains the item and receipt; a zero-valued hold need not exist.
- Holds are not source-lot assignments or movements. Their original allocation remains
  immutable; effective active quantity is original quantity only while database time
  is strictly less than the parent's expiry, otherwise zero.
- An immutable Save receipt retains a unique request UUID, original actor, canonical
  exact payload and original result/calculation identity, including zero/partial saves.
  It may be co-located with the immutable header; no separate table is mandated.
- Exact authorized replay returns the original receipt, never another hold/audit or
  allocation of new stock. Current effective state must be read separately; replay of
  an expired calculation cannot renew it. Actor ownership precedes payload comparison.

### Availability invariants and read contract

Use the authoritative formulas in BUSINESS_RULES section 17: free quantity per
warehouse is physical minus existing hard Project FG reservations minus active Tests;
ordinary open-Project demand is deducted once from the combined Test admission budget.
Physical balances/movements/lots/allocations, existing Project demand and FG reservation
state remain separate. Every debit and competing reservation preserves the combined
hard-stock bound; no saved Test changes physical or Project-consumption quantities.

Inventory reads return Product/warehouse scope, physical quantity, existing Project
planning/hard-reservation fields, active Test aggregate, additional availability,
server as-of time and next relevant expiry. Use one consistent snapshot and exact
decimal text for bigint/numeric transport. Do not expose Test creators, request UUIDs
or calculation identities through warehouse aggregates. Preserve existing membership,
ordering and permission filters; Raw+Customs combined values require both views.

Saved allocation/missing snapshots and current active/expired quantities must have
distinct field meanings. A status label is derived from the immutable expiry, not a
background-maintained flag. No current-time partial index or scheduled release is the
correctness boundary. RLS, private storage and trusted projections are mandatory.

### TC-02 implemented local schema (migration 151; undeployed)

`test_calculations` co-locates the immutable Save receipt with name, creator profile
FK, server creation time, unique request UUID, object-shaped submitted payload and
receipt, original deadline date, fixed Europe/Sarajevo timezone and mandatory expiry.
Row checks require finite dates/timestamps, expiry after creation and exactly the
next Sarajevo midnight. There is no current-time CHECK that would invalidate history.

`test_calculation_items` retains Product FK, name/serial/kind snapshots, required,
held and uncovered bigint quantities, created time and unique calculation/Product.
Exact numeric-intermediate checks enforce required = held + uncovered without overflow.
`test_calculation_holds` has explicit warehouse FK, nonnegative bigint quantity,
created time and item/warehouse identity. A composite FK enforces matching item,
calculation and Product; deferred insert checks require hold sums to equal item held.
All relationships restrict deletion; no cascading removal of retained history exists.

All three tables have RLS and no direct PUBLIC/anon/authenticated/service_role grants
or read policies. Private SECURITY INVOKER triggers reject UPDATE/DELETE/TRUNCATE and
check deferred totals. No SECURITY DEFINER mutation, public read/Save/Preview RPC,
stock-protection trigger, live-expiry helper, job, seed calculation or movement exists
yet. Indexes support history, expiry, creator, Product and warehouse hold lookup; none
depend on the current time. Business authority/snapshot authenticity and complete
Save payload validation remain the future trusted Save boundary, not JSON shape checks.

### TC-03 local search/preview contracts (migration 152; undeployed)

- `search_test_calculator_products(p_search text default null, p_limit integer default 50)`
  returns Product ID/name/serial/kind and `finished_goods_only` or `raw_customs_fg`
  policy. Limit is 1..100; search is literal case-insensitive name containment or
  serial prefix, at most 200 characters. Only active, authorized selections appear;
  zero stock does not hide an eligible Product. Unlinked finished-kind rows are excluded.
- `preview_test_calculation(p_items jsonb)` accepts 1..100 distinct objects with exactly
  `product_id` UUID string and positive decimal-string `quantity` within SQL bigint.
  Reject numeric JSON quantities, duplicate IDs, unknown fields and invalid selections.
  No calculation/exclusion context exists: callers cannot ignore their prior holds.
- Per-Product output: identity/name/serial/kind, `required_quantity`,
  `eligible_free_quantity` (sum of hard-free source quantities),
  `project_priority_quantity` (ordinary open demand, zero for linked FG),
  `eligible_availability` (free minus priority, floored at zero), `reservable_quantity`
  (minimum of required and availability), and `missing_quantity` (required minus reservable).
  All quantities are decimal TEXT, including numeric aggregates above bigint range.
- `provisional_warehouse_quantities` lists authorized source warehouse ID/code and
  decimal-string quantity in Raw -> Customs -> FG order, or FG only. This is a
  quantity preview, not persistent holds/FIFO/lot allocation. `as_of` is database
  statement time and `save_will_recalculate` is always true. Save must revalidate later.
- Active Test totals join the immutable parent with `expires_at > as_of`; expired
  rows stay intact. Existing hard FG reservations are subtracted only from FG,
  ordinary Project demand once from the combined budget, and linked-FG demand is not
  double-subtracted. Missing structural balances fail closed rather than becoming zero.

Both RPCs are STABLE SECURITY DEFINER with empty search_path, explicit authenticated
EXECUTE and PUBLIC/anon/service_role denial. They create no rows, locks for mutation,
events, movements, Work Orders or permissions; no receipt payload or foreign identity
is returned. Existing inventory/search contracts and Normal Calculator remain unchanged.

### TC-04 local atomic Save (migration 153; undeployed)

`save_test_calculation(p_request_id uuid, p_name text, p_items jsonb, p_deadline_date date)`
returns an immutable JSON receipt. Items use the same strict decimal-string quantity
contract as preview; canonical payload order is Product UUID, with trimmed name,
normalized UUIDs, deadline date/timezone and original authenticated user identity.
The private header stores this payload and receipt; items snapshot Product identity
and required/held/uncovered quantities; positive holds store explicit warehouses.
One `test_calculator.saved` audit is appended in the same transaction.

A request advisory lock precedes deterministic Product UPDATE and warehouse-balance
locks. Save recalculates current free stock, ordinary demand priority, hard Project
FG reservations and unexpired Test holds after waits. Deadline is the exclusive
next Sarajevo midnight, rechecked using database wall time. Full/partial/zero results
are retained; all returned quantities are decimal strings, never JSON numbers.
Exact original-actor replay returns the historical receipt without renewing expired
holds; changed payload fails TCS01, expired new Save TCS02. Current authority is still
required for replay. Private invoker-only deferred total checks run inside Save
before it returns, preserving constraints and private-table ACLs at authenticated commit.
No stock, movement, lot, allocation, Work Order or Project state is changed. Universal
debit protection and Project/Test admission coexistence remain TC-05 through TC-07,
not guarantees supplied by this local Save foundation.
Save requires READ COMMITTED isolation; fixed transaction snapshots are rejected
with 25000 rather than risking admission against holds committed during lock waits.

### TC-05 local physical-stock guard (migration 154; undeployed)

`active_test_warehouse_hold_quantity(uuid,uuid)` is a private VOLATILE SECURITY INVOKER
numeric aggregate of immutable warehouse holds whose parent expiry is greater than
one database wall-clock observation. It reveals no calculation identity and has no
application/PUBLIC/service_role EXECUTE. `protect_test_calculator_warehouse_holds()`
is a private VOLATILE SECURITY DEFINER trigger with empty search_path, attached to
every `inventory_balances.quantity` decrease. It enforces new physical >= active
Test holds, plus global hard Project reservations only in FG; violations raise IVB02.
READ COMMITTED is required (25000 otherwise) to avoid stale post-wait snapshots.
It acquires no Product/Project locks after the already-held balance row lock.
Existing adjustment/transfer/debit FIFO and movement primitives are unchanged.
Expiry removes effective protection without deleting history, moving holds or writing
stock/audits. Production eligibility and Project reservation admission integration
remain separate TC-06/TC-07 work; this guard alone does not activate the feature.

### TC-06 local Test-aware production capacity (migration 155; undeployed)

Private `get_production_free_warehouse_quantity(uuid,uuid)` returns numeric
`max(physical - active Test holds - applicable hard Project FG reservations,0)`.
It reuses the private wall-clock Test aggregate. Production eligible quantity sums
these capacities for Raw/Customs/FG, or FG only for an authoritative linked output.
The existing bigint return contract is preserved; numeric intermediates do not round.

The warehouse source plan retains its exact return columns and FIFO priority. It
locks Products in order, then balances and source lots, before reading current Test
expiry/capacities; fixed-snapshot isolation is rejected. Captured warehouse capacities
bound each FIFO lot prefix, so existing source fingerprints, PDF snapshots and Finish
use the same plan. No physical/debit/output function, BOM expansion, consumption timing,
historical allocation or official PDF is rewritten. Ordinary soft Project planning
demand remains a Test-Save admission priority, not a production hard reservation.
Precheck is current-state information, not a promise across separate transactions;
Finish rechecks under locks and rejects a stale source fingerprint without partial debit.

### TC-07 local Project/Test admission (migration 156; undeployed)

Existing manual Reserve checks the requested increment against
`max(FG physical - global hard FG Project reservations - active FG Test holds,0)`.
Existing automatic requirement reservation caps its increment at the minimum of this
capacity and this Project's uncovered outstanding demand. Full/partial/zero receipts
retain their existing shape, actor binding and version semantics. Both evaluate the
private wall-clock Test helper after Product/FG balance/state locks; non-READ-COMMITTED
new admissions fail closed. Original immutable replay returns before admission and
does not renew holds or top up allocations.

No balance, movement, lot, allocation, demand formula, lifecycle function or receipt
table is rewritten. Fulfillment still reduces its own reservation before an FG-only
physical debit; the shared guard enforces
`physical >= remaining Project reservations + active Test holds`.
Release/expiry changes effective free stock without automatic
allocation or deletion of Test history. Ordinary Raw/Customs planning stays soft.

### TC-08 local Inventory aggregates (migration 157; undeployed)

`get_inventory_test_commitments(p_warehouse_id uuid,p_search text default null)`
returns Product/warehouse IDs, `quantity_scope`, `physical_quantity`,
`project_commitment_quantity`, `available_after_projects`, `committed_to_tests`,
`available_after_projects_and_tests`, `as_of` and nullable `next_expiry`.
All five quantities are decimal TEXT, including aggregates beyond SQL bigint and
signed planning shortages. Physical always means the requested warehouse balance.
Scope applies to the aggregate planning/Test fields, not to that physical field.

- Raw: existing Raw+Customs Project demand D; base availability Raw+Customs-D;
  Test commitment T(Raw)+T(Customs); additional availability Raw+Customs-D-T(Raw)-T(Customs).
  The user confirmed preserving D's existing Product/lifecycle scope, including
  linked FG rows, rather than substituting the ordinary-input Test-Save admission D.
- FG: hard Project reservations R; base availability FG-R; Test commitment T(FG);
  additional availability FG-R-T(FG). No Raw/Customs stock or soft demand is used.
- Customs: Project quantity zero; base availability Customs; Test commitment
  T(Customs); additional availability Customs-T(Customs). No second demand deduction.

One database wall-clock observation classifies positive holds with expires_at > as_of
in the read snapshot; next_expiry is the earliest such expiry in the authorized
Product/warehouse scope. Expired/zero/no holds give zero commitments and null expiry.
No client clock, worker, status update, movement or history deletion is required.
Membership, archival visibility, literal search and ordering reuse the existing
warehouse search RPC. Missing Raw/Customs structural balances fail 55000, not zero.
Existing Inventory contracts remain unchanged; calculation-history reads are separate
contracts, not exposed by this aggregate.

### Task 9/16 local retained history reads (migration 158; undeployed)

`list_test_calculations(p_limit integer default 50,p_before_created_at timestamptz
default null,p_before_id uuid default null)` returns headers newest-first by
(created_at,id), with both cursor fields supplied together and a 1–100 limit.
`get_test_calculation(p_calculation_id uuid)` returns one JSON detail or a not-found
error after authorization. Null identities/invalid pagination are rejected.

Headers expose calculation ID/name, current creator Full Name, created_at,
deadline_date, deadline_timezone, expires_at, status and as_of. Product identities
and name/serial/kind snapshots come from immutable saved items, never live Product
labels; archived Products and inactive creators do not hide historical calculations.
Detail items expose required_quantity, held_quantity and missing_quantity as exact
decimal strings, plus saved warehouse ID/code/quantity allocations (also TEXT).
No holds is an empty array; zero allocation is not confused with expired saved holds.

Each call observes one database wall-clock as_of; status is active iff expires_at >
as_of. Expired details keep original held/missing quantities and allocations; only
the separate current Inventory aggregate excludes expired commitments. Reads never
renew, release or modify holds. Creator display is current, not historically frozen.
Private request UUIDs, canonical payloads and receipts are never projected. Shared
history requires active Admin or Test view, not ownership or current warehouse views.
