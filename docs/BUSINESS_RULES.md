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

### Core fields and dates

- Project Name is required, trimmed before persistence, nonblank, and not unique.
- Customer is required, trimmed before persistence, nonblank, and not unique.
- Start Date and Delivery Date are required calendar dates.
- Delivery Date must be on or after Start Date.

### Statuses

Allowed database status values are exactly:

- `planned`
- `in_progress`
- `on_hold`
- `completed`
- `cancelled`

The default status is `planned`.

Do not impose a rigid general Project status-transition graph beyond the explicitly locked lifecycle rules.

### Lifecycle metadata

- `completed_at` is populated only while the current status is `completed`.
- `cancelled_at` is populated only while the current status is `cancelled`.
- Every other status requires both `completed_at` and `cancelled_at` to be `NULL`.
- Lifecycle timestamps are assigned by trusted backend operations and are never client inputs.
- An Admin-only `completed` to `in_progress` reopen clears the current `completed_at`; immutable AuditLog history preserves the completion and reopen events.

### Normal Project editing

- Normal Project editing requires an active Admin or `projects.edit`.
- Normal editable fields are Name, Customer, Start Date, Delivery Date, and normal status where allowed.
- The normal edit operation handles only `planned`, `in_progress`, and `on_hold`; it cannot set `completed` or `cancelled`.
- Project completion is produced only by the trusted final-Work-Order Finish flow, which sets `completed_at` server-side and keeps `cancelled_at` `NULL`.
- Normal edit/status mutation cannot move a Project out of `completed`. The only reopen is the explicit Admin-only `completed` to `in_progress` operation, which clears the current `completed_at` and is audited.
- These explicit lifecycle rules do not establish a broader rigid status-transition graph.

### Cancelled Projects

`cancelled` is the Project removal/archive lifecycle state and is reached only through an explicit trusted cancellation operation.

- Project cancellation/archive requires an active Admin or `projects.archive`; `projects.edit` alone does not authorize it.
- Only `planned`, `in_progress`, or `on_hold` Projects may be cancelled.
- Cancellation sets `cancelled_at` server-side and leaves `completed_at` `NULL`.
- Completed Projects cannot be cancelled directly.
- Cancelled Projects remain historically readable.
- Cancelled Projects are immutable, cannot change status, and cannot be normally edited.
- Projects are not hard-deleted through normal application workflows.
- Project does not use separate `is_active`, `archived_at`, or archived-by fields.
- Cancelled Projects cannot be restored/reactivated in the current scope.

### Mutation audit behavior

- Every meaningful Project edit, normal status change, or cancellation creates exactly one immutable AuditLog entry in the same atomic operation as the mutation.
- A normalized no-op normal edit/status submission creates no update and no audit entry.
- Denied or failed mutations leave both Project state and AuditLog unchanged.

### Project Products and planned material

- A Project may contain multiple Project Products, each representing a Project-specific grouping or deliverable rather than an Inventory Product.
- Project Product Name is required, trimmed, nonblank, not globally unique, and receives no Product Serial Number.
- A Project Product may contain multiple component requirements referencing stock-tracked AlfaEV Products.
- Required Quantity is the planned total whole-number requirement for that Project Product and must be greater than zero.
- The same Product cannot be duplicated within one Project Product.
- A newly selected or changed requirement Product must exist and be active. Later Product archival preserves historical references.
- Eligible requirement Products may include components and finished PCB goods; do not restrict the planning model to `component` only.
- Completed and Cancelled Projects cannot receive normal Project Product or component-requirement changes.
- Reads require an active Admin or `projects.view`; mutations require an active Admin or `projects.edit` and trusted backend enforcement.

### Material usage and outstanding commitment

Project material usage is derived automatically from completed linked operations.

Contributors:
- Finished Work Orders linked to the Project
- PCB production linked to the Project

Draft Work Orders do not count.

Material totals must remain traceable to the originating operations.

Planned requirements do not change physical Inventory. Commitment must be calculated
per Project and Product before aggregation. For every open Project P and Product X:

`planned_requirement(P, X) = sum of ProjectProductComponent.required_quantity for X within P`

`actual_project_consumption(P, X) = qualifying physical consumption of X attributable to P`

`outstanding_commitment(P, X) = max(planned_requirement(P, X) - actual_project_consumption(P, X), 0)`

Then:

`committed_to_projects(X) = sum of outstanding_commitment(P, X) across Projects currently in planned/in_progress/on_hold`

`available_after_commitments(X) = InventoryBalance.quantity - committed_to_projects(X)`

Consumption from one Project must never reduce another Project's commitment. Completed
and Cancelled Projects contribute zero. Reopening a Completed Project to `in_progress`
makes its own still-outstanding requirement contribute again, with only its own prior
physical consumption subtracted.

Qualifying consumption includes finished Work Order Inventory deductions linked to
the same Project and Product and Project-linked PCB production input deductions where
applicable. Inventory additions/output movements, unrelated manual adjustments, and
consumption belonging to another Project do not qualify. Raw PCB inputs and later
finished-PCB consumption must not be double-counted.

Availability is not clamped to zero; negative values indicate a shortage. Neither
commitments nor their release create InventoryMovement rows or directly change stock.

Persisted Draft WorkOrderItems allocate, but do not reserve or consume, the open
Project's outstanding planned requirement. For Project P and Product X:

`other_draft_allocation(P, X) = sum of WorkOrderItem.quantity for X across other Draft Work Orders linked to P`

The current Draft's complete desired quantity for X may not exceed
`max(outstanding_commitment(P, X) - other_draft_allocation(P, X), 0)`. The current
Draft is excluded because its desired state replaces its own persisted allocation.
Finished Work Orders and Work Orders for another Project do not contribute to this
Draft allocation. Multiple ProjectProducts containing the same Product contribute to
the Project-level planned requirement before this allocation check. No allocation row
is persisted separately, and Draft allocation never changes physical Inventory.
An already-selected Completed or Cancelled Project may retain its identical historical
Draft material set while header/customer data is refreshed, but it cannot receive a
new or changed material allocation. The Draft must instead clear that Project or move
to an eligible open Project before changing its allocation.

### Completed Projects

When the final unfinished Work Order is successfully Finished, the trusted Finish
operation automatically changes the Project to Completed in the same transaction.

When status becomes Completed:

- normal business fields become read-only
- historical material usage remains preserved
- Project remains preserved rather than being hard-deleted

Admin may explicitly reopen a Completed Project by changing it back to In Progress.

Reopening must create an audit event.

---

## 4. Nabavka / Procurement Rules

### Existing vs brand-new component requests

If the requested component already exists:

- Nabavka references the existing Product/Component
- the selected Product must exist and be active when the later trusted request-creation operation executes
- Serial Number / Šifra comes from that Product/Component
- the Product's current Name is copied, with surrounding whitespace trimmed before persistence, into `requested_name` as the request-time snapshot
- Supplier and Quantity are selected/entered for the request
- later Product renames or archival do not rewrite the snapshot or remove the historical Product reference

If the requested component does not yet exist:

- the Nabavka request may exist temporarily without an AlfaEV Serial Number / Šifra
- `product_id` may start as `NULL`
- worker enters the required request-time Name snapshot, Supplier and Quantity; surrounding Name whitespace is trimmed before persistence and blank Names are invalid
- the request must be distinguishable as not yet linked to a Product/Component

Every new request requires an active Supplier at execution time. Archived Suppliers cannot be selected for new Procurement requests, but Supplier archival never removes or rewrites historical request references.

Only Admin may create the actual Product/Component from that request.

When Admin uses `Create component from request`:

- the request must still be Active or Partly Delivered and unlinked; Resolved or already-linked requests are rejected
- Product Name is prefilled from the request-time `requested_name` snapshot, but Admin may edit it before creation; the final Name and required free-text Category are trimmed and nonblank
- optional Brand must still exist and be active
- the request's existing Supplier is fixed for this workflow and must still exist and be active; an archived Supplier leaves history readable but blocks Product creation from that request
- create exactly one active Product/Component with `product_kind = 'component'`
- generate the next unique 7-digit Serial Number / Šifra through trusted backend/database logic
- create one required active ProductSupplier relationship to the request Supplier, with an optional supplier-specific Catalog Number normalized by trimming blank to `NULL` and preserving nonblank casing
- link the Product/Component back to the original Nabavka request without changing its historical requested-name snapshot, Supplier, quantities, status, resolution metadata, or creation metadata
- preserve immutable audit history for Product creation, ProductSupplier creation, and the Procurement-to-Product link

Workers never manually assign Serial Number / Šifra values.

The workflow is one concurrency-safe transaction. Competing Admin attempts cannot create two Products for the same request, and any required audit failure rolls back all domain mutations. Sequence gaps after a failed attempt are acceptable and never reused. Product initialization creates its normal zero InventoryBalance, but creates no InventoryMovement and does not add delivered Procurement quantity to stock; physical stock is entered separately through the Admin Inventory workflow.

### Statuses

Allowed statuses:

- Active
- Partly Delivered
- Resolved

Every new request starts as Active with Delivered Quantity `0` and no resolution metadata. Clients cannot choose another initial status.

### Partly Delivered

Store/display:

- Requested Quantity
- Delivered So Far
- Remaining Quantity

Remaining Quantity = Requested Quantity - Delivered So Far.

Requested Quantity and Delivered Quantity are whole-number pieces. Requested Quantity must be greater than zero. Delivered Quantity defaults to zero and must remain between zero and Requested Quantity, inclusive. Remaining Quantity is derived only and is not stored.

While unresolved:

- Delivered Quantity `0` corresponds to Active
- Delivered Quantity greater than `0` corresponds to Partly Delivered
- a Partly Delivered request may temporarily have Delivered Quantity equal to Requested Quantity
- full delivery does not silently resolve the request

Task 080 owns trusted delivery updates and synchronization between Active and Partly Delivered. The trusted operation accepts the request ID and desired Delivered Quantity, then derives the unresolved status atomically: zero is Active and any positive value, including full delivery, is Partly Delivered. The client does not independently choose either status.

Task 080 requires an active Admin or `procurement.change_status`; `procurement.edit` alone does not authorize Delivered Quantity or Active/Partly Delivered lifecycle changes, and `procurement.view` is not required inside the trusted mutation. Task 080 never changes Requested Quantity.

A meaningful delivery update creates exactly one immutable AuditLog entry atomically. A no-op Delivered Quantity submission changes no update metadata and creates no audit entry. Task 080 cannot modify, resolve, reopen, delete, or reactivate a Resolved request.

This information is informational only.

### Resolved

Resolved is an explicit terminal business state owned by Task 082 and authorized by an active Admin or `procurement.resolve`. `procurement.change_status`, `procurement.edit`, `procurement.create`, and `procurement.view` alone do not authorize resolution, and the trusted Resolve mutation does not require `procurement.view`. Resolution may start from Active or Partly Delivered and does not require full delivery, so Delivered Quantity may be any value from zero through Requested Quantity.

The trusted Resolve operation sets status and resolution/update metadata from server time and the active caller. It does not change Requested Quantity, Delivered Quantity, Product, requested-name snapshot, Supplier, or creation metadata. Remaining Quantity stays derived only.

Resolved requests remain readable historical records, are excluded from the Sidebar badge, and are never hard-deleted. They cannot be normally modified, receive delivery updates, be resolved a second time, reopen, or reactivate. An already-Resolved request is rejected rather than treated as a successful no-op.

`resolved_at` and `resolved_by_user_id` are both populated exactly while the request is Resolved and are both `NULL` for Active and Partly Delivered requests.

Every successful resolution creates exactly one immutable AuditLog entry atomically with the lifecycle change. Denied or invalid attempts create neither a mutation nor an audit event. Resolution never changes Inventory.

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

### Products

- Product Name is required, trimmed before persistence, and must not be empty or blank. Product names are not unique.
- Product Category is required, trimmed before persistence, and must not be empty or blank. Categories are not unique and remain free text in the current scope.
- Product identity is the unique Serial Number / Šifra, not Name, Category, Brand, or Catalog Number.
- Brand is optional. Historical Products may continue to reference archived Brands, but new Products and Product Brand changes may select only active Brands.
- The only Product kinds are `component` and `pcb_finished_good`.
- Product kind is immutable after creation.
- Normal Inventory Add Product creates a `component`; `pcb_finished_good` is reserved for later trusted PCB workflows and is not a normal user-selectable Product kind.
- Product archive/deactivate is a trusted backend lifecycle mutation authorized only for an active Admin or a user with `inventory.products.edit`; `inventory.products.create` does not authorize archive, `inventory.view` remains read-only, and no separate `inventory.products.archive` permission is added.
- AlfaEV does not hard-delete Products through normal application workflows.
- Archived Products remain readable for historical records and are immutable through normal Product editing.
- Product reactivation/unarchive is not supported in the current scope.

### Excel Component bulk import

- Inventory supports creating Components from `.xlsx` only. The initial template contains only Name, Category, and optional Brand; Supplier and Catalog Number are not imported.
- Each valid spreadsheet row requests one new `component`. Name and free-text Category are required, trimmed, and nonblank. Blank Brand means no Brand; a provided Brand must resolve to an existing active Brand. Import never creates Brands implicitly.
- Name, Category, and Brand are not Product identity. Visually duplicate rows are not silently deduplicated; each valid row receives its own server-allocated permanent 7-digit Serial Number. Excel never supplies Serial Number or Product kind, and `pcb_finished_good` remains reserved for trusted PCB workflows.
- Import sets no initial stock. Each created Product receives its normal zero InventoryBalance, with no InventoryMovement; physical stock entry is a separate Inventory operation.
- A confirmed import is all-or-nothing: the trusted backend revalidates every row and Brand before writes, then creates all Products and one immutable batch-level Product-creation audit containing created Product IDs and count in one transaction. Failed or denied import persists no Product, balance, or success audit. Rolled-back Serial allocations may leave gaps and are never reused.

### Serial Number / Šifra

- required
- unique
- generated automatically by AlfaEV
- exactly 7 digits
- starts at `0000001`
- sequentially increments
- never reused
- used as barcode value

The sequence must be generated safely by trusted backend/database logic to prevent duplicates under concurrent creation.

### Catalog Number

- separate from Serial Number
- supplier-related
- belongs to the Product–Supplier relationship
- optional and nullable
- trimmed when provided, with blank input stored as `NULL`
- preserves entered casing
- one product/component may have multiple Suppliers
- the same Product and Supplier may have multiple relationships when their Catalog Numbers differ
- not globally unique
- may be shared by multiple different products/components
- must not be used as primary identifier

### ProductSupplier Relationships

- An exact duplicate `(product_id, supplier_id, catalog_number)` relationship is not allowed.
- Two rows with the same Product and Supplier and a `NULL` Catalog Number also count as duplicates.
- A new ProductSupplier relationship starts active and may be created only between an active Product and an active Supplier.
- If a related Product or Supplier is archived later, the existing ProductSupplier relationship remains historically valid and is not deleted or cascaded away.
- ProductSupplier relationships are never hard-deleted through normal application workflows; archive/deactivate is the removal path.
- Archived ProductSupplier relationships remain historically readable and are immutable.
- ProductSupplier reactivation/unarchive is not supported in the current scope.
- Meaningful ProductSupplier add/edit/archive changes create immutable AuditLog history; normalized no-op edits do not create audit noise.
- ProductSupplier add/edit/archive requires an active Admin, `inventory.products.edit`, or `suppliers.edit`, enforced through one shared trusted backend authority regardless of the originating detail screen.
- Trusted Product-side ProductSupplier relationship reads may expose only the related Supplier ID, Name, and active/archive state required to display the relationship to an active Admin or a user with `inventory.view` or `suppliers.view`.
- A trusted Supplier-choice lookup for ProductSupplier management may expose only active Supplier IDs and Names to an active Admin or a user with `inventory.products.edit` or `suppliers.edit`.
- These narrow ProductSupplier reads do not provide general Supplier access or Supplier contact/details; normal Supplier reads still require an active Admin or `suppliers.view`.
- Trusted Supplier-side ProductSupplier relationship reads may expose only the related Product ID, Serial Number, Name, and active/archive state required to display the relationship to an active Admin or a user with `inventory.view` or `suppliers.view`.
- A trusted Product-choice lookup for ProductSupplier management may expose only active Product IDs, Serial Numbers, and Names to an active Admin or a user with `inventory.products.edit` or `suppliers.edit`.
- These narrow ProductSupplier reads do not provide general Product access or Product Category, Brand, lifecycle timestamps/actors, or other Product details; normal Product reads still require an active Admin or `inventory.view`.
- No separate ProductSupplier permission key is added.

---

## 6. Inventory Quantity Rules

Inventory quantity must never go below zero.

Inventory mutations come from:

- manual Admin adjustment
- Finished Work Order
- completed PCB production

Draft Work Orders never affect Inventory.

Incomplete/failed PCB production never affects Inventory.

Project planning commitments never affect InventoryBalance or create InventoryMovement.
Only trusted physical-consumption workflows change stock. Actual Project-linked
consumption reduces derived outstanding commitment without a second stock deduction.

### Manual adjustment

Only Admin may manually adjust Inventory.

The target Product must exist and be active when the adjustment executes. Archived Products remain historically readable and retain their InventoryBalance and InventoryMovement history, but cannot receive new manual Add, Remove, or Correction adjustments or movements.

Required fields:

- target Product
- adjustment type:
  - Add
  - Remove
  - Correction
- quantity interpreted according to the selected adjustment type
- required reason/note, trimmed before use and nonblank

Adjustment semantics:

- Add enters the positive amount to add. Quantity must be greater than zero and `delta = +quantity`.
- Remove enters the positive amount to remove. Quantity must be greater than zero, `delta = -quantity`, and resulting stock cannot be negative.
- Correction enters the desired final stock quantity, not a delta. The target must be greater than or equal to zero and `delta = target_quantity - current_quantity`.
- A Correction target of zero is valid.
- A Correction target equal to current stock is rejected as a no-op and creates no InventoryMovement or AuditLog.

Manual InventoryMovement types are exactly:

- `manual_add`
- `manual_remove`
- `manual_correction`

Record:

- previous quantity
- delta
- new quantity
- reason
- actor
- timestamp

Every meaningful manual adjustment creates exactly one InventoryMovement and exactly one immutable AuditLog event in the same atomic business operation. If any part fails, the balance, movement, and audit changes all roll back.

Work Order and PCB changes are recorded under their own source event rather than pretending to be manual adjustments.

### Inventory Movement history

Inventory Movement history is available to an active Admin or a user with `inventory.view`.

History includes movements for active and archived Products, is ordered newest first, and is read-only. Task 064 adds no movement update, deletion, or reversal action.

Where the history identifies the actor, a trusted read may expose only `actor_user_id` and the actor's Full Name in addition to the InventoryMovement fields required by the UI. It must not expose other UserProfile data or broaden general UserProfile access.

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

### PCB card definitions

- PcbCard Name is the required human-facing card name/code. It is trimmed before persistence, must be nonblank, and is not unique.
- Every PcbCard has exactly one stock-tracked output Product, and one Product may be the output of at most one PcbCard.
- The output Product must be a `pcb_finished_good`; its link to the PcbCard cannot be changed after card creation.
- A new PcbCard starts active with no archive metadata. An active card has null archive timestamp and actor, while an archived card has both values populated.
- Archiving the output Product later does not invalidate or rewrite the historical PcbCard relationship.
- Task 085 creates no PcbCard archive or reactivation workflow. Where production history exists, a PcbCard must be archived rather than hard-deleted, consistent with the existing lifecycle rule.
- Creating a PcbCard takes only its required, trimmed, nonblank human-facing Name/Code; card names are not unique. The trusted operation creates exactly one new active output Product with the same normalized Name, Category `PCB`, no Brand, and kind `pcb_finished_good`. Its unique 7-digit Serial Number comes from the trusted allocator, never from the user.
- Normal Product setup initializes the output Product's InventoryBalance at zero. Card creation is not production: it adds no finished-goods stock and creates no InventoryMovement. Only later PCB production may increase finished-goods stock.
- A PcbCard definition does not inherently require a Supplier. Creation adds no Supplier, ProductSupplier relationship, or Catalog Number.
- Task 086 creation is authorized by an active Admin or `pcb.create`, without requiring `pcb.view` or Inventory Product permissions. It atomically creates the Product, zero balance, card, and exactly one Product creation audit plus one `pcb_card.created` audit. Failure leaves none of those rows or audits; a rolled-back Serial allocation may leave a permanent sequence gap.

### BOM calculation

PCB BOM inputs may be existing stock-tracked Products of kind `component` or `pcb_finished_good`. When adding or changing a BOM item, the Product must exist and be active; a PcbCard cannot directly consume its own output Product. Archiving an input Product later does not invalidate, delete, or rewrite the existing BOM item or its historical version.

For each BOM row:

Required Quantity = Quantity Per Card × Production Quantity

Before production completes, AlfaEV must compare all required quantities with current Inventory.

For PCB production precheck, Available is current physical `InventoryBalance.quantity`, not Available after Commitments. Missing is `max(Required - Available, 0)` for each BOM input. Project commitments do not reserve or mutate physical stock; all authoritative quantities remain exact whole numbers.

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

A new production run may link only a currently open Project (`planned`, `in_progress`, or `on_hold`), not a `completed` or `cancelled` Project. The trusted production operation re-checks Project existence and current status when it executes; a prior frontend choice is not authoritative.

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

A version used by any PcbProductionRun keeps its card identity, version number, creation timestamp/actor, and BOM items permanently immutable; it cannot be deleted. Its sole permitted lifecycle change is one-way deactivation from active to inactive when a new version supersedes it. Deactivation does not edit its contents, and an inactive used version cannot be reactivated. Production-use state is derived from run history, not stored as a separate flag.

---

## 9. Work Order Rules

### Required content

Before Finish, a Work Order must contain:

- Work Order Number
- Project
- Customer
- consumed materials table
- short description

The trusted creation flow first creates the numbered Draft. At that initial creation
point, Project, Customer snapshot, and Description may be unset. The later Draft
save/update flow selects the Project, derives Customer from that Project, and saves
the Description before Finish validation requires the complete business content.

### Work Order number generation

AlfaEV generates Work Order numbers automatically.

Human-readable format:

`RN-YYYY-NNNN`

Examples:

- `RN-2026-0001`
- `RN-2026-0002`

Rules:

- numbering sequence resets each calendar year
- the `YYYY` value and calendar-year reset boundary are determined at authoritative database allocation time in the IANA timezone `Europe/Sarajevo`
- number is assigned at Work Order creation, including Draft
- number is immutable
- number is never reused after deletion of a Draft
- trusted backend/database logic must allocate numbers safely under concurrency
- internal database UUID and human-facing Work Order number are separate identifiers

### Project/customer

User manually selects Project after the numbered Draft has been created.

Customer is auto-filled from the selected Project when the Draft is saved/updated.
Saved Drafts may remain incomplete: clearing Project also clears the Customer
snapshot, and blank Description normalizes to NULL. A new or replacement Project
must be open (`planned`, `in_progress`, or `on_hold`), while an existing selected
Project may be retained after later completion/cancellation. Saving the same Project
refreshes Customer from the trusted current Project row. A normalized no-op changes
neither update metadata nor audit history, and stale `updated_at` submissions are
rejected rather than overwriting newer Draft state.

One Project may have one or many Work Orders. No uniqueness rule may limit a Project
to one Work Order. Draft material persistence records intended material rows but does
not reserve Inventory or calculate/allocate Project commitments.

### Barcode scanning

When a product barcode is scanned while editing a Work Order:

- resolve an existing active Product by its exact 7-digit Serial Number / Šifra
- allow either stock-tracked Product kind: `component` or `pcb_finished_good`
- add product to materials table
- populate product data automatically
- user manually enters consumed quantity

The narrow trusted resolver is authorized only for an active Admin or
`work_orders.edit_draft` actor in the context of an existing Draft Work Order. It
returns only Product ID, Serial Number, and Name, does not grant general Product
access, and does not create a WorkOrderItem, change Inventory, or create audit
history. Later item persistence and Finish operations re-check Product eligibility.

Current Inventory shown for a resolved Draft material is the Product's physical
`InventoryBalance.quantity`, exposed through a narrow trusted Work Order read. It
does not subtract Project commitments, grant general Inventory access, reserve
stock, or create any Inventory effect. Finish later re-checks authoritative stock.

### Draft

Saving as draft:

- atomically persists the normalized header and complete desired Materials set
- allows later editing
- does not affect Inventory
- accepts positive whole `bigint` material quantities as exact decimal strings
- revalidates every newly introduced Product reference at save time
- preserves original item identity/add metadata when an existing Quantity changes
- advances the Work Order's unified `updated_at` version for any meaningful header
  or material change
- performs no mutation and creates no audit for a normalized full no-op

Persisted Draft materials are reloaded through a narrow trusted Work Order read that
may expose only Product identity, persisted Quantity, and current physical Inventory.
It does not grant general Product or Inventory access. A persisted item remains
historically readable if its Product is archived later; adding a new archived Product
is forbidden. Inventory sufficiency remains a Finish-time decision.

Deleting a Draft is an explicit trusted operation for an active Admin or
`work_orders.delete_draft` actor. It locks the Draft, rejects a stale expected
`updated_at`, deletes its WorkOrderItem rows and parent atomically, and records exactly
one `work_order.deleted` audit containing the deleted header and deterministic
Product-ID/Quantity material snapshot. The allocated Work Order Number remains
permanently consumed. Deletion changes no Inventory, Project, Product, PCB, PDF, or
Storage state. Finished Work Orders remain undeletable.

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
- records qualifying Project/Product consumption so the derived read model reduces only that matching Project/Product commitment
- checks for other unfinished Work Orders for the same Project
- automatically completes the Project when none remain

Inventory changes happen only on Finish.

The final Work Order transaction must atomically validate and finish the Work Order,
deduct Inventory, create InventoryMovement rows, update actual Project consumption,
complete the Project when this is the last unfinished Work Order, and create required
AuditLog entries. ProjectProductComponent requirements are never deducted separately.
Completing or cancelling a Project releases remaining unused commitment without
changing physical stock.

### Finished Work Order

Finished Work Orders:

- are immutable
- cannot be edited
- cannot be reopened
- cannot be deleted

If a mistake must be corrected later:
- use a separate explicit correction/reversal process
- never silently rewrite the Finished record

### Permanent Work Order PDF

- Each Finished Work Order has at most one canonical `WorkOrderPdf` in the current
  scope, with document version exactly 1.
- PDF bytes live only in the private `work-order-pdfs` bucket; PostgreSQL stores only
  immutable metadata and the exact final object reference.
- Temporary objects use `_tmp/<work_order_id>/<object_uuid>.pdf`; permanent objects
  use `final/<work_order_id>/<object_uuid>.pdf`. Both IDs are internal UUIDs, never a
  Work Order number or user filename.
- A permanent metadata row may reference only an existing `application/pdf` final
  object in its own Work Order namespace, and only after that Work Order is Finished.
- Uploading a final candidate does not expose it. Browser read access begins only
  after an exact `WorkOrderPdf` reference exists and is limited to an active Admin or
  `work_orders.view` actor.
- `WorkOrderPdf` rows cannot be updated or deleted. There is no current replacement,
  re-versioning, or removal workflow.
- The canonical document is an A4 portrait Alfa Proteh Radni Nalog. It renders only
  trusted Work Order identity, selected Project name, Customer snapshot, Description,
  Work Order creation date, and persisted material Product Serial Number, Product Name,
  and exact Quantity. Report, authorized-person, unit, price, total, completion-date,
  signature, and stamp fields remain blank until an authoritative domain value exists.
- The trusted snapshot reuses Finish preflight authorization and validation. The PDF
  generator consumes that snapshot independently of React/browser state and creates no
  Inventory, AuditLog, Storage, or Work Order mutation by itself.

---

## 10. Documentation Rules

- Documentation is permanently Admin-only for navigation, routes, reads, and mutations.
- DocumentationRecord Name is required, trimmed, and nonblank.
- Category is exactly `uvoz`, `izvoz`, `nabavka`, or `troskovi`.
- Document Date is a required SQL date.
- Amount is a required exact non-negative decimal monetary value; floating point is forbidden and no currency field exists in current scope.
- One optional PDF may be attached. PDF bytes are stored only in private Supabase Storage, not PostgreSQL.
- Only Admin may upload, read/download, replace, or remove the PDF through trusted operations.
- Normal workflows archive rather than hard-delete Documentation records; archived records remain readable to Admin and have no current reactivation workflow.
- Meaningful create/edit/archive/PDF changes are audited.

---

## 11. Fixed Asset Rules

- Osnovna sredstva is permanently Admin-only for navigation, routes, reads, and mutations.
- Fixed Asset Name is required, trimmed, and nonblank.
- Category is exactly `oprema`, `uredjaji`, or `alati`.
- Purchase Date is a required SQL date.
- Quantity is a required whole number greater than zero.
- Fixed Assets are independent of Product, Procurement, InventoryBalance, and InventoryMovement; asset quantity never changes warehouse stock automatically.
- Normal workflows archive rather than hard-delete Fixed Assets; archived records remain readable to Admin and have no current reactivation workflow.
- Meaningful create/edit/archive changes are audited.

---

## 12. Calendar Rules

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

## 13. User and Permission Rules

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

## 14. Audit Rules

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
- Project Product/component requirement changed
- Project automatically completed by final Work Order Finish
- Nabavka status changed
- Supplier edited
- Calendar edited
- user activated/deactivated
- permission changed
- Documentation/PDF changed
- Fixed Asset changed

Do not generate audit noise for pure UI interactions.

Pure derived commitment/availability calculations create no AuditLog noise.

---

## 15. Deletion / Archive Rules

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

### Documentation
- archive rather than hard-delete
- no current reactivation workflow

### Fixed Assets
- archive rather than hard-delete
- no current reactivation workflow

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
